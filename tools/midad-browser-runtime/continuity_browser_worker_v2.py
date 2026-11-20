"""Cloudflare Continuity participant for the existing MIDAD Playwright operator runtime.

This adapter reuses the existing AccountRegistry, OperatorWorker and Playwright
sessions. Cloudflare is the authoritative queue/lease/checkpoint layer; no
parallel Supabase job consumer is started from this process.
"""
from __future__ import annotations

import asyncio
import hashlib
import importlib.metadata
import json
import os
import re
import signal
import uuid
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from pathlib import Path
from types import SimpleNamespace
from typing import Any

from account_registry import AccountRegistry
from continuity_ledger_client import ContinuityLedgerClient, ContinuityLedgerError
from encrypted_session_store import EncryptedSessionStore
from operator_command_router import SAFE_ACTIONS, build_operator_request, infer_hint_action
from operator_worker import OperatorWorker
from persistent_session import BrowserSessionError, PersistentSessionPool
from proxy_policy import ProxyRuntime


class ContinuityWorkerError(RuntimeError):
    """Stable, non-sensitive participant error code."""


_REQUIRED_CAPABILITIES = frozenset({
    "interactive-browser-execution",
    "persistent-browser-session",
    "encrypted-session-store",
})
_ALLOWED_ACTIONS = frozenset({
    "start_session", "status", "inspect", "navigate", "wait_for_selector", "stop_session",
})
_INTERACTIVE_ACTIONS = frozenset({"click", "fill", "submit_form"})
_SECRET_KEYS = re.compile(r"(?i)(password|passcode|secret|token|private[_-]?key|mnemonic|seed|cookie|authorization)")
_SECRET_VALUES = (
    re.compile(r"(?i)\bBearer\s+[A-Za-z0-9._~+/=-]{24,}"),
    re.compile(r"(?i)\b(?:password|passcode|api[_ -]?key|secret)\s*[:=]\s*[^\s,;]+"),
    re.compile(r"\bgh[pousr]_[A-Za-z0-9]{20,}\b"),
    re.compile(r"\bsk-[A-Za-z0-9_-]{20,}\b"),
    re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
)


def _contains_sensitive(value: Any, depth: int = 0) -> bool:
    if depth > 10:
        return True
    if isinstance(value, dict):
        for key, item in value.items():
            if _SECRET_KEYS.search(str(key)) or _contains_sensitive(item, depth + 1):
                return True
        return False
    if isinstance(value, (list, tuple)):
        return any(_contains_sensitive(item, depth + 1) for item in value)
    if isinstance(value, str):
        return any(pattern.search(value) for pattern in _SECRET_VALUES)
    return False


def build_action_checkpoint(task_id: str, profile_id: str, action_id: str,
                            operation: str, status: str, updated_at: int,
                            result: dict | None = None) -> dict:
    """Build a secret-free, task-bound action checkpoint with a stable idempotency key."""
    identity = {"taskId": task_id, "profileId": profile_id, "actionId": action_id, "operation": operation}
    if (
        not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,127}", task_id or "")
        or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,127}", profile_id or "")
        or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,127}", action_id or "")
        or operation not in {"status", "inspect", "wait_for_selector", "navigate", "start_session", "stop_session", "click", "fill", "submit_form", "operator_hint"}
        or status not in {"pending", "running", "succeeded", "failed", "reconciliation_required"}
        or isinstance(updated_at, bool) or not isinstance(updated_at, int) or updated_at < 0
    ):
        raise ContinuityWorkerError("ACTION_CHECKPOINT_INVALID")
    safe_result = result if result is not None else None
    if safe_result is not None and (
        not isinstance(safe_result, dict) or _contains_sensitive(safe_result)
        or len(json.dumps(safe_result, separators=(",", ":"))) > 12000
    ):
        raise ContinuityWorkerError("ACTION_CHECKPOINT_RESULT_INVALID_OR_SENSITIVE")
    if status == "succeeded" and safe_result is None:
        raise ContinuityWorkerError("ACTION_CHECKPOINT_RESULT_REQUIRED")
    if status != "succeeded" and safe_result is not None:
        raise ContinuityWorkerError("ACTION_CHECKPOINT_RESULT_STATE_INVALID")
    key = hashlib.sha256(json.dumps(identity, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()
    return {
        "actionId": action_id,
        "idempotencyKey": key,
        "operation": operation,
        "status": status,
        **({"result": safe_result} if safe_result is not None else {}),
    }


def validate_action_checkpoint(action: Any, task_id: str, profile_id: str) -> dict:
    if not isinstance(action, dict):
        raise ContinuityWorkerError("ACTION_CHECKPOINT_INVALID")
    required = {"actionId", "idempotencyKey", "operation", "status"}
    if set(action) not in (required, required | {"result"}):
        raise ContinuityWorkerError("ACTION_CHECKPOINT_FIELDS_INVALID")
    normalized = build_action_checkpoint(
        task_id, profile_id, action.get("actionId"), action.get("operation"),
        action.get("status"), action.get("updatedAt", 0) if "updatedAt" in action else 0,
        action.get("result"),
    )
    if not re.fullmatch(r"[a-f0-9]{64}", str(action.get("idempotencyKey") or "")):
        raise ContinuityWorkerError("ACTION_CHECKPOINT_IDEMPOTENCY_KEY_INVALID")
    if normalized["idempotencyKey"] != action["idempotencyKey"]:
        raise ContinuityWorkerError("ACTION_CHECKPOINT_IDENTITY_MISMATCH")
    return normalized


def action_checkpoint_resume_decision(action: Any) -> dict:
    if not isinstance(action, dict):
        return {"allowed": False, "code": "ACTION_CHECKPOINT_MISSING"}
    if action.get("operation") == "operator_hint":
        return {"allowed": False, "code": "UNTRUSTED_OPERATOR_HINT_NOT_RESUMABLE"}
    if action.get("operation") not in {"status", "inspect", "wait_for_selector"}:
        return {"allowed": False, "code": "ACTION_NOT_AUTO_RESUMABLE"}
    if action.get("status") != "succeeded":
        return {"allowed": False, "code": "ACTION_IN_PROGRESS_REQUIRES_RECONCILIATION"}
    if not isinstance(action.get("result"), dict):
        return {"allowed": False, "code": "ACTION_CHECKPOINT_RESULT_REQUIRED"}
    return {"allowed": True, "code": "RESUME_FROM_COMPLETED_ACTION", "result": action["result"]}


def validate_browser_payload(payload: Any) -> dict:
    if not isinstance(payload, dict) or set(payload) - {"profile_id", "operator_hint", "operator_command", "credential_binding_ids"}:
        raise ContinuityWorkerError("BROWSER_TASK_PAYLOAD_INVALID")
    if _contains_sensitive(payload):
        raise ContinuityWorkerError("SENSITIVE_TASK_PAYLOAD_REJECTED")
    profile_id = payload.get("profile_id")
    if not isinstance(profile_id, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,127}", profile_id):
        raise ContinuityWorkerError("BROWSER_PROFILE_ID_REQUIRED")
    binding_ids = payload.get("credential_binding_ids", [])
    if (
        not isinstance(binding_ids, list)
        or len(binding_ids) > 8
        or any(
            not isinstance(value, str)
            or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,127}", value)
            for value in binding_ids
        )
        or len(binding_ids) != len(set(binding_ids))
    ):
        raise ContinuityWorkerError("CREDENTIAL_BINDING_IDS_INVALID")
    action_keys = set(payload) & {"operator_hint", "operator_command"}
    if len(action_keys) != 1:
        raise ContinuityWorkerError("BROWSER_TASK_PAYLOAD_INVALID")
    if "operator_hint" in payload:
        hint = payload["operator_hint"]
        if not isinstance(hint, str) or not hint.strip() or len(hint) > 500:
            raise ContinuityWorkerError("OPERATOR_HINT_INVALID")
        try:
            action = infer_hint_action(hint)
        except Exception as exc:
            raise ContinuityWorkerError("OPERATOR_HINT_POLICY_REJECTED") from exc
        if action in _INTERACTIVE_ACTIONS:
            raise ContinuityWorkerError("HUMAN_APPROVAL_REQUIRED")
        if action not in _ALLOWED_ACTIONS:
            raise ContinuityWorkerError("ACTION_NOT_ALLOWED_IN_BROWSER_V2")
        return {
            "mode": "hint", "value": hint.strip(), "action": action,
            "profile_id": profile_id,
            "credential_binding_ids": list(binding_ids),
        }
    if "operator_command" in payload:
        command = payload["operator_command"]
        if not isinstance(command, dict) or len(command) > 12:
            raise ContinuityWorkerError("OPERATOR_COMMAND_INVALID")
        action = str(command.get("action") or "").strip().lower()
        if action in _INTERACTIVE_ACTIONS:
            raise ContinuityWorkerError("HUMAN_APPROVAL_REQUIRED")
        if action not in _ALLOWED_ACTIONS:
            raise ContinuityWorkerError("ACTION_NOT_ALLOWED_IN_BROWSER_V2")
        if "value" in command:
            raise ContinuityWorkerError("HUMAN_APPROVAL_REQUIRED")
        if command.get("account_id") != profile_id:
            raise ContinuityWorkerError("BROWSER_PROFILE_ID_MISMATCH")
        if set(command) - {
            "version", "action", "platform_key", "account_id", "target_url",
            "selector", "action_approved", "request_text",
        }:
            raise ContinuityWorkerError("OPERATOR_COMMAND_FIELDS_NOT_ALLOWED")
        request_text = command.get("request_text", "")
        if not isinstance(request_text, str) or len(request_text) > 500:
            raise ContinuityWorkerError("OPERATOR_COMMAND_TEXT_INVALID")
        return {
            "mode": "command", "value": command, "action": action,
            "profile_id": profile_id,
            "credential_binding_ids": list(binding_ids),
        }
    raise ContinuityWorkerError("BROWSER_TASK_PAYLOAD_INVALID")


def validate_browser_action_plan(payload: Any) -> dict:
    """Validate a bounded sequence of explicit, read-only operator commands.

    Natural-language hints and actions with external side effects are never
    accepted in a resumable plan.
    """
    if not isinstance(payload, dict) or set(payload) - {
        "profile_id", "action_plan", "credential_binding_ids"
    }:
        raise ContinuityWorkerError("BROWSER_ACTION_PLAN_INVALID")
    if _contains_sensitive(payload):
        raise ContinuityWorkerError("SENSITIVE_TASK_PAYLOAD_REJECTED")
    profile_id = payload.get("profile_id")
    if not isinstance(profile_id, str) or not re.fullmatch(
        r"[A-Za-z0-9][A-Za-z0-9._:-]{0,127}", profile_id
    ):
        raise ContinuityWorkerError("BROWSER_PROFILE_ID_REQUIRED")
    raw_plan = payload.get("action_plan")
    if not isinstance(raw_plan, list) or not 1 <= len(raw_plan) <= 8:
        raise ContinuityWorkerError("BROWSER_ACTION_PLAN_SIZE_INVALID")
    binding_ids = payload.get("credential_binding_ids", [])
    if (
        not isinstance(binding_ids, list) or len(binding_ids) > 8
        or len(binding_ids) != len(set(binding_ids))
        or any(not isinstance(value, str) or not re.fullmatch(
            r"[A-Za-z0-9][A-Za-z0-9._:-]{0,127}", value
        ) for value in binding_ids)
    ):
        raise ContinuityWorkerError("CREDENTIAL_BINDING_IDS_INVALID")
    allowed = {"status", "inspect", "navigate", "wait_for_selector"}
    actions = []
    seen_ids = set()
    for item in raw_plan:
        if not isinstance(item, dict) or set(item) != {"action_id", "operator_command"}:
            raise ContinuityWorkerError("BROWSER_ACTION_PLAN_STEP_INVALID")
        action_id = item.get("action_id")
        if not isinstance(action_id, str) or not re.fullmatch(
            r"[A-Za-z0-9][A-Za-z0-9._:-]{0,127}", action_id
        ) or action_id in seen_ids:
            raise ContinuityWorkerError("BROWSER_ACTION_PLAN_ID_INVALID")
        seen_ids.add(action_id)
        command = item.get("operator_command")
        if not isinstance(command, dict):
            raise ContinuityWorkerError("BROWSER_ACTION_PLAN_COMMAND_REQUIRED")
        operation = str(command.get("action") or "").strip().lower()
        if operation not in allowed:
            raise ContinuityWorkerError(
                "HUMAN_APPROVAL_REQUIRED" if operation in _INTERACTIVE_ACTIONS
                else "BROWSER_ACTION_PLAN_OPERATION_NOT_ALLOWED"
            )
        validated = validate_browser_payload({
            "profile_id": profile_id,
            "operator_command": command,
            "credential_binding_ids": list(binding_ids),
        })
        actions.append({
            "action_id": action_id,
            "operation": validated["action"],
            "command": validated["value"],
        })
    return {
        "mode": "plan",
        "profile_id": profile_id,
        "credential_binding_ids": list(binding_ids),
        "actions": actions,
    }


def validate_claimed_task(claim: Any, owner_id: str) -> dict:
    if not isinstance(claim, dict) or claim.get("ok") is not True:
        raise ContinuityWorkerError("LEDGER_CLAIM_RESPONSE_INVALID")
    task = claim.get("task")
    if task is None:
        return {}
    if not isinstance(task, dict):
        raise ContinuityWorkerError("LEDGER_TASK_INVALID")
    task_id = task.get("task_id")
    claimed_owner = task.get("owner_id")
    lease = task.get("lease_token")
    attempt = task.get("attempt")
    payload = task.get("payload")
    if not isinstance(task_id, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,127}", task_id):
        raise ContinuityWorkerError("TASK_ID_INVALID")
    if claimed_owner != owner_id:
        raise ContinuityWorkerError("TASK_OWNER_MISMATCH")
    workload = task.get("workload")
    if workload != "BROWSER_SESSION":
        raise ContinuityWorkerError("TASK_WORKLOAD_NOT_ALLOWED")
    if not isinstance(lease, str) or not re.fullmatch(r"[a-fA-F0-9]{64}", lease):
        raise ContinuityWorkerError("TASK_LEASE_TOKEN_INVALID")
    if not isinstance(attempt, int) or isinstance(attempt, bool) or not 1 <= attempt <= 3:
        raise ContinuityWorkerError("TASK_ATTEMPT_INVALID")
    if not isinstance(payload, dict):
        raise ContinuityWorkerError("BROWSER_TASK_PAYLOAD_INVALID")
    checkpoint = task.get("checkpoint")
    if checkpoint is not None:
        if not isinstance(checkpoint, dict):
            raise ContinuityWorkerError("BROWSER_CHECKPOINT_INVALID")
        allowed_checkpoint_keys = {"taskId", "profileId", "state", "updatedAt", "evidenceRefs"}
        if set(checkpoint) not in (
            allowed_checkpoint_keys,
            allowed_checkpoint_keys | {"action"},
            allowed_checkpoint_keys | {"actions", "action_cursor"},
        ):
            raise ContinuityWorkerError("BROWSER_CHECKPOINT_FIELDS_INVALID")
        if checkpoint.get("taskId") != task_id or checkpoint.get("profileId") != payload.get("profile_id"):
            raise ContinuityWorkerError("BROWSER_CHECKPOINT_IDENTITY_MISMATCH")
        if checkpoint.get("state") not in {"running", "paused"}:
            raise ContinuityWorkerError("BROWSER_CHECKPOINT_STATE_INVALID")
        updated_at = checkpoint.get("updatedAt")
        if isinstance(updated_at, bool) or not isinstance(updated_at, (int, float)) or updated_at < 0:
            raise ContinuityWorkerError("BROWSER_CHECKPOINT_TIMESTAMP_INVALID")
        evidence_refs = checkpoint.get("evidenceRefs")
        if (
            not isinstance(evidence_refs, list)
            or len(evidence_refs) > 20
            or any(
                not isinstance(ref, str)
                or len(ref) > 256
                or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}", ref)
                or ref.lower().startswith(("http://", "https://"))
                for ref in evidence_refs
            )
        ):
            raise ContinuityWorkerError("BROWSER_CHECKPOINT_EVIDENCE_INVALID")
        normalized_checkpoint = {
            "taskId": task_id,
            "profileId": payload.get("profile_id"),
            "state": checkpoint["state"],
            "updatedAt": updated_at,
            "evidenceRefs": list(evidence_refs),
        }
        if "action" in checkpoint:
            normalized_action = validate_action_checkpoint(
                checkpoint["action"], task_id, payload.get("profile_id")
            )
            expected_operation = (
                payload.get("operator_command", {}).get("action")
                if isinstance(payload.get("operator_command"), dict)
                else "operator_hint"
            )
            if normalized_action["operation"] != expected_operation:
                raise ContinuityWorkerError("ACTION_CHECKPOINT_OPERATION_MISMATCH")
            normalized_checkpoint["action"] = normalized_action
        if "actions" in checkpoint or "action_cursor" in checkpoint:
            if "action" in checkpoint:
                raise ContinuityWorkerError("ACTION_PLAN_CHECKPOINT_INVALID")
            validated_plan = validate_browser_action_plan(payload)
            raw_actions = checkpoint.get("actions")
            cursor = checkpoint.get("action_cursor")
            if not isinstance(raw_actions, list) or len(raw_actions) != len(validated_plan["actions"]):
                raise ContinuityWorkerError("ACTION_PLAN_CHECKPOINT_INVALID")
            if isinstance(cursor, bool) or not isinstance(cursor, int) or not 0 <= cursor <= len(raw_actions):
                raise ContinuityWorkerError("ACTION_PLAN_CURSOR_INVALID")
            normalized_actions = []
            for index, raw_action in enumerate(raw_actions):
                action = validate_action_checkpoint(raw_action, task_id, payload.get("profile_id"))
                planned = validated_plan["actions"][index]
                if action["actionId"] != planned["action_id"] or action["operation"] != planned["operation"]:
                    raise ContinuityWorkerError("ACTION_PLAN_IDENTITY_MISMATCH")
                if action["operation"] not in {"status", "inspect", "navigate", "wait_for_selector"}:
                    raise ContinuityWorkerError("ACTION_PLAN_OPERATION_NOT_ALLOWED")
                normalized_actions.append(action)
            if any(action["status"] != "succeeded" for action in normalized_actions[:cursor]):
                raise ContinuityWorkerError("ACTION_PLAN_CURSOR_INVALID")
            if cursor < len(normalized_actions):
                if normalized_actions[cursor]["status"] not in {"pending", "running"}:
                    raise ContinuityWorkerError("ACTION_PLAN_CURSOR_INVALID")
                if any(action["status"] != "pending" for action in normalized_actions[cursor + 1:]):
                    raise ContinuityWorkerError("ACTION_PLAN_CURSOR_INVALID")
            elif any(action["status"] != "succeeded" for action in normalized_actions):
                raise ContinuityWorkerError("ACTION_PLAN_CURSOR_INVALID")
            normalized_checkpoint["actions"] = normalized_actions
            normalized_checkpoint["action_cursor"] = cursor
        checkpoint = normalized_checkpoint
    return {
        "task_id": task_id,
        "owner_id": claimed_owner,
        "workload": workload,
        "lease_token": lease,
        "attempt": attempt,
        "payload": payload,
        "checkpoint": checkpoint,
    }


def sanitize_browser_result(raw: Any) -> dict:
    source = raw if isinstance(raw, dict) else {}
    result = {}
    for key in ("status", "action", "account_id", "platform_key", "host", "session_storage"):
        value = source.get(key)
        if isinstance(value, str) and value and len(value) <= 120 and not _contains_sensitive(value):
            result[key] = value
    for key in ("authenticated",):
        if isinstance(source.get(key), bool):
            result[key] = source[key]
    for key in ("http_status", "text_chars", "value_length"):
        value = source.get(key)
        if isinstance(value, int) and not isinstance(value, bool) and 0 <= value <= 30000:
            result[key] = value
    raw_url = source.get("url")
    if isinstance(raw_url, str) and raw_url.startswith("https://") and len(raw_url) <= 1500:
        try:
            from urllib.parse import unquote, urlsplit, urlunsplit
            parts = urlsplit(raw_url)
            host = (parts.hostname or "").lower().rstrip(".")
            if (
                parts.scheme.lower() == "https"
                and host
                and ":" not in host
                and parts.username is None
                and parts.password is None
                and parts.port in (None, 443)
            ):
                safe_segments = []
                for segment in parts.path.split("/"):
                    decoded = unquote(segment)
                    if (
                        re.search(r"(?i)(?:token|secret|session|auth|reset|verify|code|key|password|otp|signature)", decoded)
                        or re.fullmatch(r"[A-Za-z0-9_-]{32,}", decoded)
                    ):
                        safe_segments.append("[redacted]")
                        break
                    safe_segments.append(segment)
                safe_path = "/".join(safe_segments) or "/"
                # Query strings and fragments can contain OAuth tokens, signed URLs,
                # reset codes and other credentials; never persist either component.
                result["url"] = urlunsplit(("https", host, safe_path, "", ""))
        except ValueError:
            pass
    title = source.get("title")
    if isinstance(title, str) and len(title) <= 200 and not _contains_sensitive(title):
        result["title"] = title
    preview = source.get("text_preview")
    if isinstance(preview, str):
        result["text_sha256"] = hashlib.sha256(preview.encode("utf-8")).hexdigest()
        result.setdefault("text_chars", min(len(preview), 30000))
    for key in ("code", "reason"):
        value = source.get(key)
        if isinstance(value, str) and len(value) <= 300 and not _contains_sensitive(value):
            result[key] = value
    return result


@dataclass(frozen=True)
class ContinuityWorkerConfig:
    ledger_url: str
    node_id: str
    node_token: str
    owner_id: str
    allowed_hosts: frozenset[str]
    account_registry_path: Path
    session_store_path: Path
    session_store_key_b64: str
    enrolled_capabilities: frozenset[str]
    cost_per_hour_usd: float
    poll_seconds: float
    heartbeat_seconds: float

    @classmethod
    def from_env(cls):
        def required(name: str) -> str:
            value = os.environ.get(name, "").strip()
            if not value:
                raise ContinuityWorkerError(name + "_REQUIRED")
            return value

        ledger_url = required("MIDAD_CONTINUITY_LEDGER_URL")
        node_id = required("MIDAD_CONTINUITY_NODE_ID")
        token_env = os.environ.get("MIDAD_CONTINUITY_NODE_TOKEN", "").strip()
        token_file_env = os.environ.get("MIDAD_CONTINUITY_NODE_TOKEN_FILE", "").strip()
        if bool(token_env) == bool(token_file_env):
            raise ContinuityWorkerError("SET_EXACTLY_ONE_NODE_TOKEN_SOURCE")
        if token_file_env:
            token_path = Path(token_file_env).expanduser()
            if not token_path.is_absolute() or token_path.is_symlink() or not token_path.is_file():
                raise ContinuityWorkerError("NODE_TOKEN_FILE_INVALID")
            if os.name != "nt" and (token_path.stat().st_mode & 0o077):
                raise ContinuityWorkerError("NODE_TOKEN_FILE_PERMISSIONS_INVALID")
            try:
                node_token = token_path.read_text(encoding="ascii").strip()
            except (OSError, UnicodeError) as exc:
                raise ContinuityWorkerError("NODE_TOKEN_FILE_UNREADABLE") from exc
        else:
            node_token = token_env
        if not re.fullmatch(r"[A-Fa-f0-9]{64}", node_token):
            raise ContinuityWorkerError("NODE_TOKEN_INVALID")
        owner_id = required("MIDAD_CONTINUITY_OWNER_ID")
        try:
            uuid.UUID(owner_id)
        except (ValueError, TypeError, AttributeError) as exc:
            raise ContinuityWorkerError("OWNER_ID_INVALID") from exc
        allowed_hosts = frozenset(
            host.strip().lower().rstrip(".")
            for host in required("MIDAD_BROWSER_ALLOWED_HOSTS").split(",")
            if host.strip()
        )
        if not allowed_hosts or any("*" in host or "/" in host or "://" in host for host in allowed_hosts):
            raise ContinuityWorkerError("EXACT_BROWSER_HOST_ALLOWLIST_REQUIRED")
        capabilities = frozenset(
            item.strip() for item in required("MIDAD_CONTINUITY_ENROLLED_CAPABILITIES").split(",")
            if item.strip()
        )
        if not _REQUIRED_CAPABILITIES.issubset(capabilities):
            raise ContinuityWorkerError("ENROLLED_BROWSER_CAPABILITIES_INCOMPLETE")
        if os.environ.get("MIDAD_CONTINUITY_COST_ESTIMATE_VERIFIED", "").strip().lower() != "true":
            raise ContinuityWorkerError("VERIFIED_HOST_COST_ESTIMATE_REQUIRED")
        try:
            cost = Decimal(required("MIDAD_CONTINUITY_COST_PER_HOUR_USD"))
        except InvalidOperation as exc:
            raise ContinuityWorkerError("HOST_COST_ESTIMATE_INVALID") from exc
        if not cost.is_finite() or cost < 0:
            raise ContinuityWorkerError("HOST_COST_ESTIMATE_INVALID")
        registry = Path(os.environ.get(
            "MIDAD_BROWSER_ACCOUNT_REGISTRY", "/var/lib/midad-browser/accounts.json"
        )).expanduser()
        store_path = Path(os.environ.get(
            "MIDAD_BROWSER_SESSION_STORE_DIR", "/var/lib/midad-browser/sessions"
        )).expanduser()
        if not registry.is_absolute() or not store_path.is_absolute():
            raise ContinuityWorkerError("RUNTIME_PATHS_MUST_BE_ABSOLUTE")
        return cls(
            ledger_url=ledger_url,
            node_id=node_id,
            node_token=node_token,
            owner_id=owner_id,
            allowed_hosts=allowed_hosts,
            account_registry_path=registry,
            session_store_path=store_path,
            session_store_key_b64=required("MIDAD_BROWSER_SESSION_MASTER_KEY_B64"),
            enrolled_capabilities=capabilities,
            cost_per_hour_usd=float(cost),
            poll_seconds=max(1.0, min(float(os.environ.get("MIDAD_CONTINUITY_POLL_SECONDS", "3")), 30.0)),
            heartbeat_seconds=max(10.0, min(float(os.environ.get("MIDAD_CONTINUITY_HEARTBEAT_SECONDS", "15")), 30.0)),
        )


class _ResultSink:
    """Discards the legacy Gateway side-effects while reusing its command executor."""

    async def call(self, action: str, **_payload):
        if action == "renew_operator_lease":
            return {"renewed": True}
        return {"ok": True}

    async def record_event(self, **_payload):
        return {"ok": True}


class ContinuityBrowserWorker:
    def __init__(self, config: ContinuityWorkerConfig, client=None, operator=None,
                 session_pool=None, runtime_probe=None, resource_probe=None, proxy_runtime=None):
        self.config = config
        self.client = client or ContinuityLedgerClient(
            config.ledger_url, config.node_id, config.node_token
        )
        self.proxy_runtime = (
            proxy_runtime
            if proxy_runtime is not None
            else ProxyRuntime.from_env(vault_client=self.client)
        )
        self._browser_version = ""
        self.store = EncryptedSessionStore(
            config.session_store_path, config.session_store_key_b64, key_id="v1"
        )
        registry_path = config.account_registry_path
        if registry_path.is_symlink() or not registry_path.is_file():
            raise ContinuityWorkerError("PRIVATE_ACCOUNT_REGISTRY_REQUIRED")
        if os.name != "nt" and (registry_path.stat().st_mode & 0o077):
            raise ContinuityWorkerError("ACCOUNT_REGISTRY_PERMISSIONS_INVALID")
        registry = AccountRegistry(str(registry_path), set(config.allowed_hosts))
        self.registry = registry
        profiles = registry.list_profiles()
        if not profiles:
            raise ContinuityWorkerError("NO_APPROVED_BROWSER_ACCOUNT_PROFILES")
        missing_aliases = [
            profile.get("password_secret_ref")
            for profile in profiles
            if not os.environ.get(str(profile.get("password_secret_ref") or ""), "").strip()
        ]
        if missing_aliases:
            raise ContinuityWorkerError("ACCOUNT_SECRET_ALIASES_MISSING")
        self.session_pool = session_pool or PersistentSessionPool(
            set(config.allowed_hosts),
            session_store=self.store,
            owner_id=config.owner_id,
            proxy_settings_resolver=(
                self.proxy_runtime.resolve_for_profile if self.proxy_runtime is not None else None
            ),
        )
        self.operator = operator or OperatorWorker(
            SimpleNamespace(allowed_hosts=set(config.allowed_hosts)),
            config.owner_id,
            registry,
            gateway=_ResultSink(),
            session_pool=self.session_pool,
        )
        self.runtime_probe = runtime_probe or self._probe_browser_runtime
        self.resource_probe = resource_probe or self._probe_resources
        self._last_heartbeat = 0.0
        self._stopping = asyncio.Event()

    @staticmethod
    def _probe_resources() -> dict:
        cpu = os.cpu_count() or 1
        memory_mb = 0
        try:
            for line in Path("/proc/meminfo").read_text(encoding="ascii").splitlines():
                if line.startswith("MemTotal:"):
                    memory_mb = int(line.split()[1]) // 1024
                    break
        except (OSError, ValueError, IndexError):
            pass
        if memory_mb <= 0:
            try:
                page_size = os.sysconf("SC_PAGE_SIZE")
                pages = os.sysconf("SC_PHYS_PAGES")
                memory_mb = int(page_size * pages // (1024 * 1024))
            except (OSError, ValueError, AttributeError):
                pass
        if cpu < 1 or memory_mb < 256:
            raise ContinuityWorkerError("HOST_RESOURCE_PROBE_FAILED")
        return {"cpu_cores": float(cpu), "memory_mb": int(memory_mb)}

    @staticmethod
    async def _probe_browser_runtime() -> str:
        try:
            from playwright.async_api import async_playwright
            async with async_playwright() as playwright:
                browser = await playwright.chromium.launch(
                    headless=True,
                    args=["--disable-background-networking", "--disable-sync", "--no-first-run"],
                )
                try:
                    page = await browser.new_page()
                    await page.goto("about:blank")
                    if page.url != "about:blank":
                        raise ContinuityWorkerError("BROWSER_RUNTIME_SMOKE_FAILED")
                finally:
                    await browser.close()
            return "playwright-" + importlib.metadata.version("playwright")
        except ContinuityWorkerError:
            raise
        except Exception as exc:
            raise ContinuityWorkerError("BROWSER_RUNTIME_UNAVAILABLE") from exc

    async def heartbeat(self, browser_version: str) -> dict:
        resources = self.resource_probe()
        return await self.client.heartbeat({
            **resources,
            "available_slots": 1,
            "cost_per_hour_usd": self.config.cost_per_hour_usd,
            "cost_estimate_verified": True,
            "capabilities": sorted(_REQUIRED_CAPABILITIES),
            "agent_version": "midad-operator-worker-v2.0.0",
            "browser_runtime_version": browser_version,
            "encrypted_session_store": True,
        })

    async def _renew_until_done(self, task_id: str, lease_token: str,
                                done: asyncio.Event, lost: asyncio.Event):
        while not done.is_set() and not self._stopping.is_set():
            try:
                await asyncio.wait_for(done.wait(), timeout=25.0)
                return
            except asyncio.TimeoutError:
                pass
            try:
                await self.client.renew(task_id, lease_token, lease_ttl_seconds=90)
                if self.proxy_runtime is not None and getattr(self.proxy_runtime, "central_mode", False):
                    if not self._browser_version:
                        raise ContinuityWorkerError("BROWSER_RUNTIME_VERSION_UNAVAILABLE")
                    await self.heartbeat(self._browser_version)
            except Exception:
                lost.set()
                return

    async def _execute_action_plan(self, task: dict, plan: dict) -> dict:
        """Execute a bounded read-only plan with durable per-action checkpoints."""
        task_id = task["task_id"]
        lease = task["lease_token"]
        profile_id = plan["profile_id"]
        planned = plan["actions"]
        saved = task.get("checkpoint")
        if saved is None:
            actions = [
                build_action_checkpoint(
                    task_id, profile_id, step["action_id"], step["operation"],
                    "pending", int(__import__("time").time() * 1000),
                )
                for step in planned
            ]
            cursor = 0
        else:
            actions = [dict(item) for item in saved["actions"]]
            cursor = saved["action_cursor"]
            if cursor < len(actions) and actions[cursor]["status"] == "running":
                outcome = await self.client.fail(
                    task_id, lease, reason="ACTION_PLAN_IN_FLIGHT_REQUIRES_RECONCILIATION",
                    retryable=False,
                )
                return {
                    "task_id": task_id, "status": "BLOCKED",
                    "code": "ACTION_PLAN_IN_FLIGHT_REQUIRES_RECONCILIATION",
                    "ledger_state": outcome.get("state"),
                }
        if cursor == 0 and actions and actions[0]["status"] == "pending":
            actions[0] = build_action_checkpoint(
                task_id, profile_id, planned[0]["action_id"], planned[0]["operation"],
                "running", int(__import__("time").time() * 1000),
            )
            await self.client.checkpoint(task_id, lease, {
                "taskId": task_id, "profileId": profile_id, "state": "running",
                "updatedAt": int(__import__("time").time() * 1000),
                "evidenceRefs": [], "actions": actions, "action_cursor": cursor,
            })
        if self.proxy_runtime is not None and getattr(self.proxy_runtime, "central_mode", False):
            self.proxy_runtime.set_task_context({
                "task_id": task_id, "lease_token": lease,
                "credential_binding_ids": plan["credential_binding_ids"],
            })
        done = asyncio.Event()
        lost = asyncio.Event()
        renewer = asyncio.create_task(self._renew_until_done(task_id, lease, done, lost))
        central_vault = self.proxy_runtime is not None and getattr(self.proxy_runtime, "central_mode", False)
        vault_lost_waiter = asyncio.create_task(self.proxy_runtime.wait_for_lease_loss()) if central_vault else None
        try:
            while cursor < len(planned):
                if lost.is_set() or (vault_lost_waiter is not None and vault_lost_waiter.done()):
                    reason = "VAULT_LEASE_LOST_DURING_BROWSER_TASK" if vault_lost_waiter is not None and vault_lost_waiter.done() else "LEASE_LOST_DURING_BROWSER_TASK"
                    try:
                        await self.session_pool.close_all()
                    except BrowserSessionError:
                        pass
                    outcome = await self.client.fail(task_id, lease, reason=reason, retryable=False)
                    return {"task_id": task_id, "status": "BLOCKED", "code": reason, "ledger_state": outcome.get("state")}
                step = planned[cursor]
                if actions[cursor]["status"] == "pending":
                    actions[cursor] = build_action_checkpoint(
                        task_id, profile_id, step["action_id"], step["operation"],
                        "running", int(__import__("time").time() * 1000),
                    )
                    await self.client.checkpoint(task_id, lease, {
                        "taskId": task_id, "profileId": profile_id, "state": "running",
                        "updatedAt": int(__import__("time").time() * 1000),
                        "evidenceRefs": [], "actions": actions, "action_cursor": cursor,
                    })
                job = {
                    "id": task_id,
                    "state": "PREPARING",
                    "worker_id": getattr(self.operator, "worker_id", self.config.node_id),
                    "owner_user_id": self.config.owner_id,
                    "lease_token": lease,
                    "input_data": {"operator_command": step["command"]},
                }
                execution = asyncio.create_task(self.operator.process_job(job))
                lost_waiter = asyncio.create_task(lost.wait())
                waiters = {execution, lost_waiter}
                if vault_lost_waiter is not None:
                    waiters.add(vault_lost_waiter)
                await asyncio.wait(waiters, return_when=asyncio.FIRST_COMPLETED)
                if lost.is_set() or (vault_lost_waiter is not None and vault_lost_waiter.done()):
                    execution.cancel()
                    try:
                        await execution
                    except asyncio.CancelledError:
                        pass
                    try:
                        await self.session_pool.close_all()
                    except BrowserSessionError:
                        pass
                    reason = "VAULT_LEASE_LOST_DURING_BROWSER_TASK" if vault_lost_waiter is not None and vault_lost_waiter.done() else "LEASE_LOST_DURING_BROWSER_TASK"
                    outcome = await self.client.fail(task_id, lease, reason=reason, retryable=False)
                    return {"task_id": task_id, "status": "BLOCKED", "code": reason, "ledger_state": outcome.get("state")}
                lost_waiter.cancel()
                try:
                    await lost_waiter
                except asyncio.CancelledError:
                    pass
                result = sanitize_browser_result(await execution)
                status = str(result.get("status", "FAILED")).upper()
                if status in {"FAILED", "TIMEOUT", "CANCELLED", "HUMAN_GATE"}:
                    actions[cursor] = build_action_checkpoint(
                        task_id, profile_id, step["action_id"], step["operation"],
                        "failed", int(__import__("time").time() * 1000),
                    )
                    await self.client.checkpoint(task_id, lease, {
                        "taskId": task_id, "profileId": profile_id, "state": "running",
                        "updatedAt": int(__import__("time").time() * 1000),
                        "evidenceRefs": [], "actions": actions, "action_cursor": cursor,
                    })
                    reason = "HUMAN_GATE_REQUIRED" if status == "HUMAN_GATE" else "BROWSER_ACTION_REQUIRES_RECONCILIATION"
                    outcome = await self.client.fail(task_id, lease, reason=reason, retryable=False)
                    return {"task_id": task_id, "status": "BLOCKED", "code": reason, "ledger_state": outcome.get("state")}
                actions[cursor] = build_action_checkpoint(
                    task_id, profile_id, step["action_id"], step["operation"],
                    "succeeded", int(__import__("time").time() * 1000), result=result,
                )
                cursor += 1
                await self.client.checkpoint(task_id, lease, {
                    "taskId": task_id, "profileId": profile_id, "state": "running",
                    "updatedAt": int(__import__("time").time() * 1000),
                    "evidenceRefs": [], "actions": actions, "action_cursor": cursor,
                })
                if cursor < len(planned):
                    next_step = planned[cursor]
                    actions[cursor] = build_action_checkpoint(
                        task_id, profile_id, next_step["action_id"], next_step["operation"],
                        "running", int(__import__("time").time() * 1000),
                    )
                    await self.client.checkpoint(task_id, lease, {
                        "taskId": task_id, "profileId": profile_id, "state": "running",
                        "updatedAt": int(__import__("time").time() * 1000),
                        "evidenceRefs": [], "actions": actions, "action_cursor": cursor,
                    })
            if central_vault:
                try:
                    await self.session_pool.close_all()
                except BrowserSessionError:
                    outcome = await self.client.fail(task_id, lease, reason="VAULT_LEASE_RELEASE_FAILED", retryable=False)
                    return {"task_id": task_id, "status": "BLOCKED", "code": "VAULT_LEASE_RELEASE_FAILED", "ledger_state": outcome.get("state")}
            summary = {"status": "COMPLETED", "actions": [
                {"actionId": item["actionId"], "operation": item["operation"], "result": item.get("result", {})}
                for item in actions
            ]}
            completed = await self.client.complete(task_id, lease, summary)
            return {"task_id": task_id, "status": "COMPLETED", "ledger_state": completed.get("state", "COMPLETED")}
        finally:
            done.set()
            for pending in (renewer, vault_lost_waiter):
                if pending is not None and not pending.done():
                    pending.cancel()
                if pending is not None:
                    try:
                        await pending
                    except asyncio.CancelledError:
                        pass
            if central_vault:
                try:
                    await self.session_pool.close_all()
                finally:
                    await self.proxy_runtime.end_task()

    async def _execute_claimed(self, task: dict) -> dict:
        task_id = task["task_id"]
        lease = task["lease_token"]
        if isinstance(task.get("payload"), dict) and "action_plan" in task["payload"]:
            plan = validate_browser_action_plan(task["payload"])
            return await self._execute_action_plan(task, plan)
        if task.get("checkpoint") is not None:
            saved = task["checkpoint"].get("action") if isinstance(task["checkpoint"], dict) else None
            decision = action_checkpoint_resume_decision(saved) if saved is not None else {
                "allowed": False, "code": "BROWSER_CHECKPOINT_REQUIRES_RECONCILIATION"
            }
            if decision["allowed"]:
                completed = await self.client.complete(task_id, lease, decision["result"])
                return {
                    "task_id": task_id,
                    "status": "RESUMED",
                    "code": decision["code"],
                    "ledger_state": completed.get("state", "COMPLETED"),
                }
            outcome = await self.client.fail(
                task_id, lease,
                reason=decision["code"] or "BROWSER_CHECKPOINT_REQUIRES_RECONCILIATION",
                retryable=False,
            )
            return {
                "task_id": task_id,
                "status": "BLOCKED",
                "code": decision["code"],
                "ledger_state": outcome.get("state"),
            }
        payload = validate_browser_payload(task["payload"])
        if payload["mode"] == "hint":
            resolved_command = build_operator_request(payload["value"], self.registry.list_profiles())
            command_payload = {"operator_hint": payload["value"]}
        else:
            resolved_command = payload["value"]
            command_payload = {"operator_command": payload["value"]}
        if resolved_command.get("account_id") != payload["profile_id"]:
            raise ContinuityWorkerError("BROWSER_PROFILE_ID_MISMATCH")
        import time
        operation = resolved_command.get("action") if payload["mode"] == "command" else "operator_hint"
        action_id = resolved_command.get("action_id") or "action-1"
        action_checkpoint = build_action_checkpoint(
            task_id, payload["profile_id"], action_id, operation, "running",
            int(time.time() * 1000),
        )
        await self.client.checkpoint(task_id, lease, {
            "taskId": task_id,
            "profileId": payload["profile_id"],
            "state": "running",
            "updatedAt": int(time.time() * 1000),
            "evidenceRefs": [],
            "action": action_checkpoint,
        })
        if self.proxy_runtime is not None and getattr(self.proxy_runtime, "central_mode", False):
            self.proxy_runtime.set_task_context({
                "task_id": task_id,
                "lease_token": lease,
                "credential_binding_ids": payload["credential_binding_ids"],
            })
        job = {
            "id": task_id,
            "state": "PREPARING",
            "worker_id": getattr(self.operator, "worker_id", self.config.node_id),
            "owner_user_id": self.config.owner_id,
            "lease_token": lease,
            "input_data": command_payload,
        }
        done = asyncio.Event()
        lost = asyncio.Event()
        renewer = asyncio.create_task(self._renew_until_done(task_id, lease, done, lost))
        execution = asyncio.create_task(self.operator.process_job(job))
        lost_waiter = asyncio.create_task(lost.wait())
        vault_lost_waiter = None
        central_vault = self.proxy_runtime is not None and getattr(self.proxy_runtime, "central_mode", False)
        if central_vault:
            vault_lost_waiter = asyncio.create_task(self.proxy_runtime.wait_for_lease_loss())
        try:
            waiters = {execution, lost_waiter}
            if vault_lost_waiter is not None:
                waiters.add(vault_lost_waiter)
            await asyncio.wait(waiters, return_when=asyncio.FIRST_COMPLETED)
            if lost.is_set() or (vault_lost_waiter is not None and vault_lost_waiter.done()):
                execution.cancel()
                try:
                    await execution
                except asyncio.CancelledError:
                    pass
                try:
                    await self.session_pool.close_all()
                except BrowserSessionError:
                    pass
                reason = "VAULT_LEASE_LOST_DURING_BROWSER_TASK" if vault_lost_waiter is not None and vault_lost_waiter.done() else "LEASE_LOST_DURING_BROWSER_TASK"
                outcome = await self.client.fail(task_id, lease, reason=reason, retryable=False)
                return {"task_id": task_id, "status": "BLOCKED", "code": reason,
                        "ledger_state": outcome.get("state")}
            raw_result = await execution
            result = sanitize_browser_result(raw_result)
            status = str(result.get("status", "FAILED")).upper()
            if operation in {"status", "inspect", "wait_for_selector"} and status not in {"FAILED", "TIMEOUT", "CANCELLED", "HUMAN_GATE"}:
                action_checkpoint = build_action_checkpoint(
                    task_id, payload["profile_id"], action_id, operation, "succeeded",
                    int(time.time() * 1000), result=result,
                )
                await self.client.checkpoint(task_id, lease, {
                    "taskId": task_id,
                    "profileId": payload["profile_id"],
                    "state": "running",
                    "updatedAt": int(time.time() * 1000),
                    "evidenceRefs": [],
                    "action": action_checkpoint,
                })
            if central_vault:
                # Persist the browser state encrypted, close the context, and release its
                # short-lived proxy-auth lease before the task is acknowledged.
                try:
                    await self.session_pool.close_all()
                except BrowserSessionError:
                    outcome = await self.client.fail(
                        task_id, lease, reason="VAULT_LEASE_RELEASE_FAILED", retryable=False
                    )
                    return {
                        "task_id": task_id, "status": "BLOCKED",
                        "code": "VAULT_LEASE_RELEASE_FAILED",
                        "ledger_state": outcome.get("state"),
                    }
            if status in {"HUMAN_GATE", "FAILED", "TIMEOUT", "CANCELLED"}:
                outcome = await self.client.fail(
                    task_id, lease,
                    reason="HUMAN_GATE_REQUIRED" if status == "HUMAN_GATE" else "BROWSER_TASK_REQUIRES_RECONCILIATION",
                    retryable=False,
                )
                return {"task_id": task_id, "status": status, "ledger_state": outcome.get("state")}
            completed = await self.client.complete(task_id, lease, result)
            return {"task_id": task_id, "status": status, "ledger_state": completed.get("state", "COMPLETED")}
        finally:
            done.set()
            for pending in (renewer, lost_waiter, vault_lost_waiter):
                if pending is not None and not pending.done():
                    pending.cancel()
                if pending is not None:
                    try:
                        await pending
                    except asyncio.CancelledError:
                        pass
            if central_vault:
                try:
                    await self.session_pool.close_all()
                finally:
                    await self.proxy_runtime.end_task()

    async def poll_once(self) -> dict:
        claim = await self.client.claim(lease_ttl_seconds=90)
        task = validate_claimed_task(claim, self.config.owner_id)
        if not task:
            return {"status": "IDLE"}
        # Validate and block high-impact actions before the existing operator executor runs.
        try:
            return await self._execute_claimed(task)
        except ContinuityWorkerError as exc:
            reason = str(exc)
            if reason == "HUMAN_APPROVAL_REQUIRED":
                await self.client.fail(task["task_id"], task["lease_token"], reason=reason, retryable=False)
                return {"task_id": task["task_id"], "status": "BLOCKED", "code": reason}
            if reason in {"SENSITIVE_TASK_PAYLOAD_REJECTED", "BROWSER_TASK_PAYLOAD_INVALID",
                          "ACTION_NOT_ALLOWED_IN_BROWSER_V2", "OPERATOR_HINT_INVALID",
                          "OPERATOR_HINT_POLICY_REJECTED", "OPERATOR_COMMAND_INVALID",
                          "OPERATOR_COMMAND_FIELDS_NOT_ALLOWED", "BROWSER_PROFILE_ID_REQUIRED",
                          "BROWSER_PROFILE_ID_MISMATCH"}:
                await self.client.fail(task["task_id"], task["lease_token"], reason=reason, retryable=False)
                return {"task_id": task["task_id"], "status": "BLOCKED", "code": reason}
            raise

    async def run_forever(self):
        browser_version = await self.runtime_probe()
        self._browser_version = browser_version
        await self.heartbeat(browser_version)
        self._last_heartbeat = asyncio.get_running_loop().time()
        failures = 0
        try:
            while not self._stopping.is_set():
                try:
                    now = asyncio.get_running_loop().time()
                    if now - self._last_heartbeat >= self.config.heartbeat_seconds:
                        await self.heartbeat(browser_version)
                        self._last_heartbeat = now
                    await self.poll_once()
                    failures = 0
                    delay = self.config.poll_seconds
                except Exception as exc:
                    failures = min(failures + 1, 5)
                    # Only the exception class is observable; never log request bodies or credentials.
                    import sys
                    print("continuity_browser_worker_failed:" + type(exc).__name__, file=sys.stderr, flush=True)
                    delay = min(30.0, self.config.poll_seconds * (2 ** failures))
                try:
                    await asyncio.wait_for(self._stopping.wait(), timeout=delay)
                except asyncio.TimeoutError:
                    pass
        finally:
            await self.session_pool.close_all()

    def stop(self):
        self._stopping.set()


def register_sigterm_handler(loop, worker) -> None:
    """Route systemd SIGTERM through the worker's graceful async shutdown path."""
    try:
        loop.add_signal_handler(signal.SIGTERM, worker.stop)
    except (NotImplementedError, RuntimeError, ValueError) as exc:
        raise ContinuityWorkerError("GRACEFUL_SHUTDOWN_HANDLER_UNAVAILABLE") from exc


async def run_from_env():
    config = ContinuityWorkerConfig.from_env()
    worker = ContinuityBrowserWorker(config)
    register_sigterm_handler(asyncio.get_running_loop(), worker)
    await worker.run_forever()


if __name__ == "__main__":
    asyncio.run(run_from_env())
