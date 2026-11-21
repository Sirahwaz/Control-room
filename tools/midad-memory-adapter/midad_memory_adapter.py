"""Fail-closed server-side boundary for MIDAD knowledge memory.

This module deliberately contains no identity provider or public HTTP endpoint.
The caller must pass a Principal constructed by MIDAD's trusted auth/policy layer.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import json
import os
import re
import sqlite3
import threading
import uuid
from typing import Any, Protocol


CONTRACT_VERSION = "midad-memory/v1"
MAX_PAYLOAD_BYTES = 64 * 1024
MAX_SEARCH_LIMIT = 50
ALLOWED_VERIFICATION_STATES = {"VERIFIED", "INFERRED", "PENDING", "FAILED", "BLOCKED"}
FORBIDDEN_SCOPE_FIELDS = {"owner_scope", "owner_id", "tenant_id", "store_name", "database", "db_path"}
SECRET_PATTERNS = (
    re.compile(r"(?i)\b(api[_-]?key|access[_-]?token|secret|password)\s*[:=]\s*\S+"),
    re.compile(r"\bsk-[A-Za-z0-9_-]{16,}\b"),
    re.compile(r"(?i)\bbearer\s+[A-Za-z0-9._~+/-]{12,}"),
    re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
)


class AdapterError(Exception):
    def __init__(self, code: str, message: str, retryable: bool = False):
        super().__init__(message)
        self.code = code
        self.retryable = retryable


@dataclass(frozen=True)
class Principal:
    principal_id: str
    owner_scope: str
    allowed_projects: frozenset[str]
    agent_id: str
    run_id: str
    capabilities: frozenset[str]
    authenticated: bool = False


@dataclass(frozen=True)
class MemoryRequest:
    request_id: str
    operation: str
    project_id: str
    payload: dict[str, Any]
    idempotency_key: str | None = None


class ScopedMemoryBackend(Protocol):
    def create(self, record: dict[str, Any], idempotency_key: str) -> str: ...
    def search(self, owner_scope: str, project_id: str, query: str, limit: int) -> list[dict[str, Any]]: ...


class InMemoryScopedBackend:
    """Deterministic test backend; never use as a production persistence layer."""
    def __init__(self):
        self.records: dict[str, dict[str, Any]] = {}
        self._by_intent: dict[str, str] = {}

    def create(self, record: dict[str, Any], idempotency_key: str) -> str:
        if idempotency_key in self._by_intent:
            return self._by_intent[idempotency_key]
        record_id = str(uuid.uuid4())
        self.records[record_id] = dict(record, record_id=record_id)
        self._by_intent[idempotency_key] = record_id
        return record_id

    def seed(self, record: dict[str, Any]) -> str:
        record_id = str(uuid.uuid4())
        self.records[record_id] = dict(record, record_id=record_id)
        return record_id

    def search(self, owner_scope: str, project_id: str, query: str, limit: int) -> list[dict[str, Any]]:
        needle = query.casefold()
        # Scope predicates are applied before text matching, ranking, and truncation.
        scoped = (
            record for record in self.records.values()
            if record.get("owner_scope") == owner_scope
            and record.get("project_id") == project_id
        )
        matches = [record for record in scoped if needle in str(record.get("content", "")).casefold()]
        return [dict(record) for record in matches[:limit]]


def _contains_secret(value: Any) -> bool:
    if isinstance(value, dict):
        return any(_contains_secret(k) or _contains_secret(v) for k, v in value.items())
    if isinstance(value, (list, tuple)):
        return any(_contains_secret(item) for item in value)
    if isinstance(value, str):
        return any(pattern.search(value) for pattern in SECRET_PATTERNS)
    return False


def _canonical_hash(value: Any) -> str:
    encoded = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


class MemoryAdapter:
    """MIDAD memory boundary; disabled by default and fail-closed on all unknowns."""
    def __init__(
        self,
        backend: ScopedMemoryBackend,
        idempotency_db_path: str,
        enabled: bool | None = None,
        max_payload_bytes: int = MAX_PAYLOAD_BYTES,
    ):
        self.backend = backend
        self.idempotency_db_path = idempotency_db_path
        self.enabled = (
            os.environ.get("MIDAD_MEMORY_ADAPTER_ENABLED", "false").strip().lower() == "true"
            if enabled is None else bool(enabled)
        )
        self.max_payload_bytes = max_payload_bytes
        self._lock = threading.RLock()
        self._initialize_ledger()

    def _connect(self):
        connection = sqlite3.connect(self.idempotency_db_path, timeout=3, isolation_level=None)
        connection.execute("PRAGMA busy_timeout=3000")
        return connection

    def _initialize_ledger(self):
        with self._connect() as db:
            db.execute("""
                CREATE TABLE IF NOT EXISTS memory_idempotency (
                    intent_key TEXT PRIMARY KEY,
                    principal_id TEXT NOT NULL,
                    project_id TEXT NOT NULL,
                    operation TEXT NOT NULL,
                    payload_hash TEXT NOT NULL,
                    response_json TEXT NOT NULL,
                    created_at TEXT NOT NULL
                )
            """)

    def execute(self, principal: Principal | None, request: MemoryRequest) -> dict[str, Any]:
        if not self.enabled:
            raise AdapterError("ADAPTER_DISABLED", "Memory adapter is disabled")
        if not isinstance(principal, Principal) or not principal.authenticated:
            raise AdapterError("UNAUTHENTICATED", "Authenticated MIDAD principal required")
        if not request.request_id or not request.project_id or not isinstance(request.payload, dict):
            raise AdapterError("VALIDATION_ERROR", "Invalid request envelope")
        if request.project_id not in principal.allowed_projects:
            raise AdapterError("FORBIDDEN", "Project access denied")
        if request.operation not in principal.capabilities:
            raise AdapterError("FORBIDDEN", "Operation is not authorized")
        if request.operation not in {"create", "search"}:
            raise AdapterError("CAPABILITY_UNAVAILABLE", "Operation is not available in this adapter version")
        if any(key in request.payload for key in FORBIDDEN_SCOPE_FIELDS):
            raise AdapterError("VALIDATION_ERROR", "Caller-controlled scope or store routing is forbidden")

        payload_bytes = json.dumps(request.payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        if len(payload_bytes) > self.max_payload_bytes:
            raise AdapterError("VALIDATION_ERROR", "Payload exceeds configured limit")
        if _contains_secret(request.payload):
            raise AdapterError("VALIDATION_ERROR", "Secret-like content must not be persisted")
        if request.operation == "search":
            return self._search(principal, request)
        return self._create(principal, request)

    def _create(self, principal: Principal, request: MemoryRequest) -> dict[str, Any]:
        payload = request.payload
        required = ("memory_type", "source_ref", "content", "sensitivity", "retention_class",
                    "confidence", "verification_state")
        if any(not payload.get(field) for field in required):
            raise AdapterError("VALIDATION_ERROR", "Required provenance and memory metadata missing")
        if not isinstance(payload["confidence"], (int, float)) or not 0 <= payload["confidence"] <= 1:
            raise AdapterError("VALIDATION_ERROR", "Confidence must be between 0 and 1")
        if payload["verification_state"] not in ALLOWED_VERIFICATION_STATES:
            raise AdapterError("VALIDATION_ERROR", "Unknown verification state")
        if not isinstance(payload["content"], str):
            raise AdapterError("VALIDATION_ERROR", "Content must be text")
        if not request.idempotency_key or len(request.idempotency_key) > 200:
            raise AdapterError("VALIDATION_ERROR", "Stable idempotency key required")

        canonical_payload_hash = _canonical_hash(payload)
        intent_key = _canonical_hash({
            "principal_id": principal.principal_id,
            "project_id": request.project_id,
            "operation": request.operation,
            "intent": request.idempotency_key,
        })
        with self._lock, self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            prior = db.execute(
                "SELECT payload_hash, response_json FROM memory_idempotency WHERE intent_key = ?",
                (intent_key,),
            ).fetchone()
            if prior:
                if prior[0] != canonical_payload_hash:
                    db.execute("ROLLBACK")
                    raise AdapterError("IDEMPOTENCY_CONFLICT", "Idempotency key was reused with different content")
                response = json.loads(prior[1])
                db.execute("COMMIT")
                return response

            now = datetime.now(timezone.utc).isoformat()
            record = {
                "owner_scope": principal.owner_scope,
                "project_id": request.project_id,
                "memory_type": payload["memory_type"],
                "source_ref": payload["source_ref"],
                "content": payload["content"],
                "sensitivity": payload["sensitivity"],
                "retention_class": payload["retention_class"],
                "confidence": float(payload["confidence"]),
                "verification_state": payload["verification_state"],
                "created_at": now,
                "observed_at": payload.get("observed_at", now),
                "created_by_agent": principal.agent_id,
                "run_id": principal.run_id,
                "schema_version": 1,
                "untrusted_content": True,
            }
            try:
                record_id = self.backend.create(record, intent_key)
                response = {
                    "contract_version": CONTRACT_VERSION,
                    "request_id": request.request_id,
                    "status": "OK",
                    "data": {"record_id": record_id},
                    "evidence": {"backend": "injected-scoped-backend", "record_ids": [record_id]},
                }
                db.execute(
                    """INSERT INTO memory_idempotency
                    (intent_key, principal_id, project_id, operation, payload_hash, response_json, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)""",
                    (intent_key, principal.principal_id, request.project_id, request.operation,
                     canonical_payload_hash, json.dumps(response, sort_keys=True), now),
                )
                db.execute("COMMIT")
                return response
            except Exception:
                db.execute("ROLLBACK")
                raise

    def _search(self, principal: Principal, request: MemoryRequest) -> dict[str, Any]:
        query = request.payload.get("query")
        limit = request.payload.get("limit", 10)
        if not isinstance(query, str) or not query.strip():
            raise AdapterError("VALIDATION_ERROR", "Search query is required")
        if not isinstance(limit, int) or isinstance(limit, bool) or not 1 <= limit <= MAX_SEARCH_LIMIT:
            raise AdapterError("VALIDATION_ERROR", "Search limit is outside the allowed range")
        records = self.backend.search(principal.owner_scope, request.project_id, query, limit)
        safe_records = []
        for record in records:
            if record.get("owner_scope") != principal.owner_scope or record.get("project_id") != request.project_id:
                raise AdapterError("INTEGRITY_FAILURE", "Backend returned an out-of-scope record")
            safe_records.append({**record, "untrusted_content": True})
        return {
            "contract_version": CONTRACT_VERSION,
            "request_id": request.request_id,
            "status": "OK",
            "data": {"records": safe_records},
            "evidence": {"backend": "injected-scoped-backend", "record_ids": [r.get("record_id") for r in safe_records]},
        }
