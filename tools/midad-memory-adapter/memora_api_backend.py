"""Pinned Memora HTTP API v1 backend for the MIDAD Memory Adapter.

Owner-to-store routing and bearer tokens are server configuration only.
"""
from __future__ import annotations

import json
import re
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Mapping

from midad_memory_adapter import AdapterError


_STORE_RE = re.compile(r"^[a-z0-9_-]{1,64}$")
_TOKEN_ENV_RE = re.compile(r"^MIDAD_MEMORA_API_TOKEN_[A-Z0-9_]{1,80}$")
_IDEMPOTENCY_RE = re.compile(r"^[A-Za-z0-9._:-]{1,128}$")
_MAX_RESPONSE_BYTES = 256 * 1024


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class MemoraApiBackend:
    """Implements the adapter backend protocol using Memora's frozen API v1."""

    def __init__(
        self,
        base_url: str,
        owner_routes: Mapping[str, Mapping[str, str]],
        *,
        environ: Mapping[str, str] | None = None,
        timeout: float = 8.0,
        opener=None,
    ):
        self.environ = environ if environ is not None else __import__("os").environ
        self.timeout = max(1.0, min(float(timeout), 20.0))
        parsed = urllib.parse.urlsplit(base_url)
        loopback = parsed.hostname in {"localhost", "127.0.0.1", "::1"}
        if parsed.scheme != "https" and not (parsed.scheme == "http" and loopback):
            raise AdapterError("VALIDATION_ERROR", "Memora API must use HTTPS (HTTP is allowed only on loopback)")
        if not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise AdapterError("VALIDATION_ERROR", "Invalid Memora API base URL")
        self.base_url = base_url.rstrip("/")
        self.owner_routes = {}
        configured_stores = set()
        for owner, route in owner_routes.items():
            store = route.get("store", "")
            token_env = route.get("token_env", "")
            if not isinstance(owner, str) or not owner or not _STORE_RE.fullmatch(store):
                raise AdapterError("VALIDATION_ERROR", "Invalid server-side owner/store route")
            if not isinstance(token_env, str) or not _TOKEN_ENV_RE.fullmatch(token_env):
                raise AdapterError("VALIDATION_ERROR", "Invalid server-side token environment binding")
            if store in configured_stores:
                raise AdapterError("VALIDATION_ERROR", "Each owner scope must map to a distinct Memora store")
            configured_stores.add(store)
            self.owner_routes[owner] = {"store": store, "token_env": token_env}
        self.opener = opener or urllib.request.build_opener(_NoRedirect())

    def _route(self, owner_scope: str):
        route = self.owner_routes.get(owner_scope)
        if route is None:
            raise AdapterError("SCOPE_NOT_FOUND", "No authorized Memora store is mapped to this owner scope")
        token = self.environ.get(route["token_env"], "")
        if not token:
            raise AdapterError("UPSTREAM_UNAVAILABLE", "Memora server credential is not configured", retryable=False)
        return route["store"], token

    def _request(self, owner_scope: str, method: str, suffix: str, body: dict | None = None):
        store, token = self._route(owner_scope)
        url = f"{self.base_url}/api/v1/{store}/{suffix}"
        data = None if body is None else json.dumps(body, sort_keys=True, separators=(",", ":")).encode("utf-8")
        request = urllib.request.Request(url, data=data, method=method)
        request.add_header("Authorization", f"Bearer {token}")
        request.add_header("Accept", "application/json")
        if data is not None:
            request.add_header("Content-Type", "application/json")
        try:
            with self.opener.open(request, timeout=self.timeout) as response:
                raw = response.read(_MAX_RESPONSE_BYTES + 1)
                status = getattr(response, "status", 200)
        except urllib.error.HTTPError as exc:
            raw = exc.read(_MAX_RESPONSE_BYTES + 1)
            status = exc.code
        except (urllib.error.URLError, TimeoutError, OSError):
            raise AdapterError("UPSTREAM_UNAVAILABLE", "Memora API request failed", retryable=True) from None
        if len(raw) > _MAX_RESPONSE_BYTES:
            raise AdapterError("UPSTREAM_UNAVAILABLE", "Memora API response exceeded the configured limit")
        try:
            payload = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise AdapterError("UPSTREAM_UNAVAILABLE", "Memora API returned an invalid response") from None
        if not isinstance(payload, dict):
            raise AdapterError("UPSTREAM_UNAVAILABLE", "Memora API returned an invalid response")
        if not 200 <= status < 300:
            code = payload.get("error")
            if status == 409 and code == "key_conflict":
                raise AdapterError("IDEMPOTENCY_CONFLICT", "Memora rejected a reused idempotency key")
            if status == 409 and code == "in_progress":
                raise AdapterError("CONFLICT", "Memora is processing this idempotency key", retryable=True)
            if status == 429:
                raise AdapterError("RATE_LIMITED", "Memora API admission limit reached", retryable=True)
            if status == 501 or code == "writes_unsupported":
                raise AdapterError("CAPABILITY_UNAVAILABLE", "Memora backend does not support transactional writes")
            if status in (400, 413):
                raise AdapterError("VALIDATION_ERROR", "Memora rejected the bounded request")
            raise AdapterError("UPSTREAM_UNAVAILABLE", "Memora API is unavailable or rejected authentication", retryable=status >= 500)
        return payload

    def check_health(self, owner_scope: str, *, require_writes: bool) -> dict[str, Any]:
        health = self._request(owner_scope, "GET", "health")
        if health.get("api_version") != "v1" or not str(health.get("contract_version", "")).startswith("1."):
            raise AdapterError("CAPABILITY_UNAVAILABLE", "Memora API contract version is incompatible")
        if health.get("status") != "ok":
            raise AdapterError("UPSTREAM_UNAVAILABLE", "Memora store is not healthy", retryable=True)
        if health.get("writes") not in {"transactional", "unsupported"}:
            raise AdapterError("CAPABILITY_UNAVAILABLE", "Memora write capability is unproven")
        if require_writes and health.get("writes") != "transactional":
            raise AdapterError("CAPABILITY_UNAVAILABLE", "Memora store has no verified transactional write capability")
        return health

    @staticmethod
    def _ensure_project(health: dict[str, Any], project_id: str):
        projects = health.get("projects")
        if not isinstance(projects, list):
            raise AdapterError("CAPABILITY_UNAVAILABLE", "Memora project capabilities are unproven")
        if not projects or project_id not in projects:
            raise AdapterError("FORBIDDEN", "Project is not enabled in the mapped Memora store")

    def create(self, record: dict[str, Any], idempotency_key: str) -> str:
        if not _IDEMPOTENCY_RE.fullmatch(idempotency_key):
            raise AdapterError("VALIDATION_ERROR", "Invalid Memora idempotency key")
        content = record.get("content")
        source_ref = record.get("source_ref")
        if not isinstance(content, str) or not 1 <= len(content) <= 10000:
            raise AdapterError("VALIDATION_ERROR", "Memora facts must contain 1..10000 characters")
        if not isinstance(source_ref, str) or not 1 <= len(source_ref) <= 64:
            raise AdapterError("VALIDATION_ERROR", "Memora source must contain 1..64 characters")
        owner_scope = record["owner_scope"]
        health = self.check_health(owner_scope, require_writes=True)
        self._ensure_project(health, record["project_id"])
        absorb = {
            "idempotency_key": idempotency_key,
            "project": record["project_id"],
            "facts": [content],
            "source": source_ref,
            "context": f"agent={record['created_by_agent']} run={record['run_id']}",
            "metadata": {
                "owner_scope": owner_scope,
                "project": record["project_id"],
                "memory_type": record["memory_type"],
                "sensitivity": record["sensitivity"],
                "retention_class": record["retention_class"],
                "confidence": record["confidence"],
                "verification_state": record["verification_state"],
                "source_ref": source_ref,
                "created_by_agent": record["created_by_agent"],
                "run_id": record["run_id"],
                "schema_version": record.get("schema_version", 1),
                "untrusted_content": True,
            },
        }
        result = self._request(owner_scope, "POST", "absorb", absorb)
        if result.get("status") != "done":
            raise AdapterError("UPSTREAM_UNAVAILABLE", "Memora absorb did not reach its completion boundary", retryable=True)
        memory_ids = result.get("memory_ids") or []
        return str(memory_ids[0]) if memory_ids else f"absorb:{idempotency_key}"

    def search(self, owner_scope: str, project_id: str, query: str, limit: int) -> list[dict[str, Any]]:
        health = self.check_health(owner_scope, require_writes=False)
        self._ensure_project(health, project_id)
        result = self._request(owner_scope, "POST", "search", {
            "query": query,
            "top_k": min(limit, 20),
            "project": project_id,
            "preview_chars": 400,
        })
        if result.get("mode") != "hybrid-v1" or not isinstance(result.get("results"), list):
            raise AdapterError("UPSTREAM_UNAVAILABLE", "Memora search response does not match API v1")
        rows = []
        for item in result["results"]:
            if not isinstance(item, dict) or not isinstance(item.get("id"), int):
                raise AdapterError("INTEGRITY_FAILURE", "Memora returned a malformed search result")
            tags = item.get("tags")
            if not isinstance(tags, list) or project_id not in tags:
                raise AdapterError("INTEGRITY_FAILURE", "Memora returned a result outside the requested project")
            rows.append({
                "record_id": str(item["id"]),
                "owner_scope": owner_scope,
                "project_id": project_id,
                "content": str(item.get("preview", "")),
                "tags": item.get("tags", []),
                "created_at": item.get("created_at"),
                "cosine": item.get("cosine"),
                "fused": item.get("fused"),
                "rank": item.get("rank"),
                "untrusted_content": True,
                "backend": "memora-api-v1",
            })
        return rows
