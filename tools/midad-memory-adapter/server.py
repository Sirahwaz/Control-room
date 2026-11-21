"""Private HTTP entrypoint for the MIDAD Memory Adapter.

Only the authenticated Supabase Edge Gateway may call this service. Keep it behind
TLS and a private ingress; never expose its service key to browsers, bots, or agents.
"""
from __future__ import annotations

import hmac
import json
import os
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

from gateway import MidadMemoryGateway
from memora_api_backend import MemoraApiBackend
from midad_memory_adapter import (
    AdapterError,
    MemoryAdapter,
    MemoryRequest,
    Principal,
    MAX_PAYLOAD_BYTES,
)

MAX_HTTP_BODY = MAX_PAYLOAD_BYTES
UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", re.I)
AGENT_RE = re.compile(r"^[A-Za-z0-9_.:-]{2,100}$")
PROJECT_RE = re.compile(r"^[A-Za-z0-9._:-]{1,100}$")
ALLOWED_CAPABILITIES = {"create", "search"}


def _principal_from_context(value: Any) -> Principal | None:
    if not isinstance(value, dict):
        return None
    owner_id = value.get("principal_id")
    owner_scope = value.get("owner_scope")
    agent_id = value.get("agent_id")
    run_id = value.get("run_id")
    projects = value.get("allowed_projects")
    capabilities = value.get("capabilities")
    if not isinstance(owner_id, str) or not UUID_RE.fullmatch(owner_id):
        return None
    if owner_scope != "midad-owner:" + owner_id:
        return None
    if not isinstance(agent_id, str) or not AGENT_RE.fullmatch(agent_id):
        return None
    if not isinstance(run_id, str) or not UUID_RE.fullmatch(run_id):
        return None
    if not isinstance(projects, list) or not projects or len(projects) > 100:
        return None
    if any(not isinstance(p, str) or not PROJECT_RE.fullmatch(p) for p in projects):
        return None
    if not isinstance(capabilities, list) or not capabilities:
        return None
    if any(not isinstance(cap, str) or cap not in ALLOWED_CAPABILITIES for cap in capabilities):
        return None
    if value.get("authenticated") is not True:
        return None
    return Principal(
        principal_id=owner_id,
        owner_scope=owner_scope,
        allowed_projects=frozenset(projects),
        agent_id=agent_id,
        run_id=run_id,
        capabilities=frozenset(capabilities),
        authenticated=True,
    )


def dispatch_request(
    authorization: str,
    raw_body: bytes,
    service_key: str,
    gateway: MidadMemoryGateway,
) -> tuple[int, dict[str, Any]]:
    if not service_key or len(service_key) < 32:
        return 503, {"status": "ERROR", "error": {"code": "SERVICE_NOT_CONFIGURED"}}
    expected = "Bearer " + service_key
    if not hmac.compare_digest(authorization or "", expected):
        return 401, {"status": "ERROR", "error": {"code": "UNAUTHENTICATED"}}
    if not isinstance(raw_body, bytes) or len(raw_body) > MAX_HTTP_BODY:
        return 413, {"status": "ERROR", "error": {"code": "REQUEST_TOO_LARGE"}}
    try:
        envelope = json.loads(raw_body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return 400, {"status": "ERROR", "error": {"code": "INVALID_JSON"}}
    if not isinstance(envelope, dict) or set(envelope) != {"principal", "request"}:
        return 400, {"status": "ERROR", "error": {"code": "INVALID_ENVELOPE"}}
    request_data = envelope.get("request")
    if not isinstance(request_data, dict):
        return 400, {"status": "ERROR", "error": {"code": "INVALID_REQUEST"}}
    request_id = request_data.get("request_id")
    operation = request_data.get("operation")
    project_id = request_data.get("project_id")
    payload = request_data.get("payload")
    idempotency_key = request_data.get("idempotency_key")
    if (not isinstance(request_id, str) or not UUID_RE.fullmatch(request_id) or
        not isinstance(operation, str) or operation not in ALLOWED_CAPABILITIES or
        not isinstance(project_id, str) or not PROJECT_RE.fullmatch(project_id) or
        not isinstance(payload, dict) or
        (operation == "create" and (not isinstance(idempotency_key, str) or not idempotency_key))):
        return 400, {"status": "ERROR", "error": {"code": "INVALID_REQUEST"}}
    try:
        result = gateway.execute(
            envelope["principal"],
            MemoryRequest(request_id, operation, project_id, payload, idempotency_key),
        )
        return 200, result
    except AdapterError as exc:
        status = {
            "UNAUTHENTICATED": 401,
            "FORBIDDEN": 403,
            "VALIDATION_ERROR": 400,
            "IDEMPOTENCY_CONFLICT": 409,
            "CONFLICT": 409,
            "RATE_LIMITED": 429,
            "ADAPTER_DISABLED": 503,
            "CAPABILITY_UNAVAILABLE": 503,
            "UPSTREAM_UNAVAILABLE": 502,
            "SCOPE_NOT_FOUND": 403,
        }.get(exc.code, 500)
        return status, {
            "contract_version": "midad-memory/v1",
            "request_id": request_id,
            "status": "ERROR",
            "error": {
                "code": exc.code,
                "message": str(exc).split(": ", 1)[-1][:240],
                "retryable": bool(exc.retryable),
            },
        }
    except Exception:
        return 500, {
            "contract_version": "midad-memory/v1",
            "request_id": request_id,
            "status": "ERROR",
            "error": {"code": "INTERNAL_ERROR", "message": "Memory operation failed", "retryable": False},
        }


def build_handler(gateway: MidadMemoryGateway, service_key: str, enabled: bool):
    class Handler(BaseHTTPRequestHandler):
        server_version = "MIDADMemoryGateway/1"

        def log_message(self, fmt, *args):
            # Avoid logging request headers, body, tokens, or memory content.
            return

        def _send(self, status: int, payload: dict[str, Any]):
            data = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_POST(self):
            if self.path != "/v1/memory/execute":
                self._send(404, {"status": "ERROR", "error": {"code": "NOT_FOUND"}})
                return
            if not enabled:
                self._send(404, {"status": "ERROR", "error": {"code": "ADAPTER_DISABLED"}})
                return
            try:
                length = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                self._send(400, {"status": "ERROR", "error": {"code": "INVALID_CONTENT_LENGTH"}})
                return
            if length < 1 or length > MAX_HTTP_BODY:
                self._send(413, {"status": "ERROR", "error": {"code": "REQUEST_TOO_LARGE"}})
                return
            raw = self.rfile.read(length)
            status, payload = dispatch_request(
                self.headers.get("Authorization", ""),
                raw,
                service_key,
                gateway,
            )
            self._send(status, payload)

    return Handler


def build_runtime():
    enabled = os.environ.get("MIDAD_MEMORY_ADAPTER_ENABLED", "false").strip().lower() == "true"
    service_key = os.environ.get("MIDAD_MEMORY_ADAPTER_SERVICE_KEY", "")
    if len(service_key) < 32:
        raise RuntimeError("MIDAD_MEMORY_ADAPTER_SERVICE_KEY must be configured with at least 32 characters")
    if not enabled:
        # No in-memory or alternate persistence fallback when the feature is off.
        return None, service_key, False

    base_url = os.environ.get("MIDAD_MEMORA_API_URL", "")
    routes_raw = os.environ.get("MIDAD_MEMORA_OWNER_ROUTES_JSON", "")
    ledger_path = os.environ.get("MIDAD_MEMORY_LEDGER_PATH", "")
    if not base_url or not routes_raw or not ledger_path or not os.path.isabs(ledger_path):
        raise RuntimeError("Memora URL, owner routes, and absolute durable ledger path are required")
    routes = json.loads(routes_raw)
    if not isinstance(routes, dict) or not routes:
        raise RuntimeError("At least one server-owned Memora owner route is required")
    backend = MemoraApiBackend(base_url, routes)
    adapter = MemoryAdapter(backend, ledger_path)
    gateway = MidadMemoryGateway(adapter, _principal_from_context)
    return gateway, service_key, True


def main():
    gateway, service_key, enabled = build_runtime()
    if gateway is None:
        raise RuntimeError("Memory adapter is disabled; refusing to start an active service")
    bind = os.environ.get("MIDAD_MEMORY_ADAPTER_BIND", "127.0.0.1")
    port = int(os.environ.get("PORT", "8080"))
    server = ThreadingHTTPServer((bind, port), build_handler(gateway, service_key, enabled))
    server.serve_forever()


if __name__ == "__main__":
    main()
