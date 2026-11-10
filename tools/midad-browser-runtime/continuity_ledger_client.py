"""Small, fail-closed HTTP client for the Cloudflare MIDAD Continuity Ledger."""
from __future__ import annotations

import asyncio
import json
import re
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener


class ContinuityLedgerError(RuntimeError):
    """Stable, non-sensitive error code for continuity ledger transport failures."""


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class ContinuityLedgerClient:
    MAX_RESPONSE_BYTES = 1024 * 1024
    TIMEOUT_SECONDS = 10

    def __init__(self, base_url: str, node_id: str, node_token: str, opener=None):
        if not isinstance(base_url, str):
            raise ContinuityLedgerError("LEDGER_URL_INVALID")
        try:
            parts = urlsplit(base_url.strip())
            port = parts.port
        except (TypeError, ValueError) as exc:
            raise ContinuityLedgerError("LEDGER_URL_INVALID") from exc
        if (
            parts.scheme.lower() != "https"
            or not parts.hostname
            or parts.username is not None
            or parts.password is not None
            or port not in (None, 443)
            or parts.path not in ("", "/")
            or parts.query
            or parts.fragment
        ):
            raise ContinuityLedgerError("LEDGER_URL_INVALID")
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,127}", str(node_id or "")):
            raise ContinuityLedgerError("NODE_ID_INVALID")
        if (
            not isinstance(node_token, str)
            or len(node_token) < 32
            or len(node_token) > 200
            or not node_token.isascii()
            or any(ord(char) < 33 or ord(char) > 126 for char in node_token)
        ):
            raise ContinuityLedgerError("NODE_TOKEN_INVALID")
        self.base_url = f"https://{parts.hostname.lower()}"
        self.node_id = node_id
        self._node_token = node_token
        self._opener = opener or build_opener(_NoRedirect())

    @staticmethod
    def _object(value, name):
        if not isinstance(value, dict):
            raise ContinuityLedgerError(name + "_INVALID")
        return value

    def _post_sync(self, path: str, payload: dict) -> dict:
        allowed = {
            "/v1/nodes/heartbeat",
            "/v1/tasks/claim",
            "/v1/tasks/renew",
            "/v1/tasks/checkpoint",
            "/v1/tasks/complete",
            "/v1/tasks/fail",
            "/v1/vault/leases/issue",
            "/v1/vault/leases/renew",
            "/v1/vault/leases/release",
        }
        if path not in allowed:
            raise ContinuityLedgerError("LEDGER_ROUTE_NOT_ALLOWED")
        body = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
        request = Request(
            self.base_url + path,
            data=body,
            method="POST",
            headers={
                "content-type": "application/json",
                "accept": "application/json",
                "authorization": "Bearer " + self._node_token,
                "x-midad-node-id": self.node_id,
            },
        )
        try:
            with self._opener.open(request, timeout=self.TIMEOUT_SECONDS) as response:
                status = response.getcode() if hasattr(response, "getcode") else getattr(response, "status", 200)
                raw = response.read(self.MAX_RESPONSE_BYTES + 1)
        except HTTPError as exc:
            raise ContinuityLedgerError(f"LEDGER_HTTP_{int(exc.code)}") from exc
        except (URLError, TimeoutError, OSError) as exc:
            raise ContinuityLedgerError("LEDGER_TRANSPORT_FAILED") from exc
        if status < 200 or status >= 300:
            raise ContinuityLedgerError(f"LEDGER_HTTP_{int(status)}")
        if len(raw) > self.MAX_RESPONSE_BYTES:
            raise ContinuityLedgerError("LEDGER_RESPONSE_TOO_LARGE")
        try:
            result = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, ValueError) as exc:
            raise ContinuityLedgerError("LEDGER_RESPONSE_INVALID") from exc
        if not isinstance(result, dict) or result.get("ok") is not True:
            raise ContinuityLedgerError("LEDGER_REJECTED")
        return result

    async def _post(self, path: str, payload: dict) -> dict:
        return await asyncio.to_thread(self._post_sync, path, payload)

    async def heartbeat(self, payload: dict) -> dict:
        return await self._post("/v1/nodes/heartbeat", self._object(payload, "HEARTBEAT"))

    async def claim(self, lease_ttl_seconds: int = 90) -> dict:
        if not isinstance(lease_ttl_seconds, int) or isinstance(lease_ttl_seconds, bool):
            raise ContinuityLedgerError("LEASE_TTL_INVALID")
        ttl = max(15, min(300, lease_ttl_seconds))
        return await self._post("/v1/tasks/claim", {"lease_ttl_seconds": ttl})

    async def renew(self, task_id: str, lease_token: str, lease_ttl_seconds: int = 90) -> dict:
        return await self._post("/v1/tasks/renew", {
            "task_id": task_id,
            "lease_token": lease_token,
            "lease_ttl_seconds": max(15, min(300, int(lease_ttl_seconds))),
        })

    async def checkpoint(self, task_id: str, lease_token: str, checkpoint: dict) -> dict:
        return await self._post("/v1/tasks/checkpoint", {
            "task_id": task_id,
            "lease_token": lease_token,
            "checkpoint": self._object(checkpoint, "CHECKPOINT"),
        })

    async def complete(self, task_id: str, lease_token: str, result: dict) -> dict:
        return await self._post("/v1/tasks/complete", {
            "task_id": task_id,
            "lease_token": lease_token,
            "result": self._object(result, "RESULT"),
        })

    async def fail(self, task_id: str, lease_token: str, reason: str, retryable: bool = False) -> dict:
        if not isinstance(reason, str) or not reason.strip():
            raise ContinuityLedgerError("FAILURE_REASON_REQUIRED")
        return await self._post("/v1/tasks/fail", {
            "task_id": task_id,
            "lease_token": lease_token,
            "reason": reason[:200],
            "retryable": retryable is True,
        })
