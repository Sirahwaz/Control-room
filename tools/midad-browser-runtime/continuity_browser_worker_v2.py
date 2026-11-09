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
from operator_command_router import SAFE_ACTIONS, infer_hint_action
from operator_worker import OperatorWorker
from persistent_session import BrowserSessionError, PersistentSessionPool


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


def validate_browser_payload(payload: Any) -> dict:
    if not isinstance(payload, dict) or len(payload) != 1:
        raise ContinuityWorkerError("BROWSER_TASK_PAYLOAD_INVALID")
    if _contains_sensitive(payload):
        raise ContinuityWorkerError("SENSITIVE_TASK_PAYLOAD_REJECTED")
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
        return {"mode": "hint", "value": hint.strip(), "action": action}
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
        if set(command) - {
            "version", "action", "platform_key", "account_id", "target_url",
            "selector", "action_approved", "request_text",
        }:
            raise ContinuityWorkerError("OPERATOR_COMMAND_FIELDS_NOT_ALLOWED")
        request_text = command.get("request_text", "")
        if not isinstance(request_text, str) or len(request_text) > 500:
            raise ContinuityWorkerError("OPERATOR_COMMAND_TEXT_INVALID")
        return {"mode": "command", "value": command, "action": action}
    raise ContinuityWorkerError("BROWSER_TASK_PAYLOAD_INVALID")


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
    return {
        "task_id": task_id,
        "owner_id": claimed_owner,
        "workload": workload,
        "lease_token": lease,
        "attempt": attempt,
        "payload": payload,
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
            from urllib.parse import urlsplit
            parts = urlsplit(raw_url)
            if parts.hostname and parts.username is None and parts.password is None:
                result["url"] = raw_url
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

    async def call(self, _action: str, **_payload):
        return {"ok": True}

    async def record_event(self, **_payload):
        return {"ok": True}


class ContinuityBrowserWorker:
    def __init__(self, config: ContinuityWorkerConfig, client=None, operator=None,
                 session_pool=None, runtime_probe=None, resource_probe=None):
        self.config = config
        self.client = client or ContinuityLedgerClient(
            config.ledger_url, config.node_id, config.node_token
        )
        self.store = EncryptedSessionStore(
            config.session_store_path, config.session_store_key_b64, key_id="v1"
        )
        registry_path = config.account_registry_path
        if registry_path.is_symlink() or not registry_path.is_file():
            raise ContinuityWorkerError("PRIVATE_ACCOUNT_REGISTRY_REQUIRED")
        if os.name != "nt" and (registry_path.stat().st_mode & 0o077):
            raise ContinuityWorkerError("ACCOUNT_REGISTRY_PERMISSIONS_INVALID")
        registry = AccountRegistry(str(registry_path), set(config.allowed_hosts))
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
            set(config.allowed_hosts), session_store=self.store, owner_id=config.owner_id
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
            except Exception:
                lost.set()
                return

    async def _execute_claimed(self, task: dict) -> dict:
        task_id = task["task_id"]
        lease = task["lease_token"]
        payload = validate_browser_payload(task["payload"])
        command_payload = (
            {"operator_hint": payload["value"]}
            if payload["mode"] == "hint"
            else {"operator_command": payload["value"]}
        )
        await self.client.checkpoint(task_id, lease, {
            "stage": "claimed",
            "attempt": task["attempt"],
            "worker_version": "midad-operator-worker-v2.0.0",
            "action": payload["action"],
        })
        job = {
            "id": task_id,
            "state": "PREPARING",
            "input_data": command_payload,
        }
        done = asyncio.Event()
        lost = asyncio.Event()
        renewer = asyncio.create_task(self._renew_until_done(task_id, lease, done, lost))
        execution = asyncio.create_task(self.operator.process_job(job))
        lost_waiter = asyncio.create_task(lost.wait())
        try:
            await asyncio.wait(
                {execution, lost_waiter},
                return_when=asyncio.FIRST_COMPLETED,
            )
            if lost.is_set():
                execution.cancel()
                try:
                    await execution
                except asyncio.CancelledError:
                    pass
                await self.session_pool.close_all()
                raise ContinuityWorkerError("LEASE_LOST_DURING_BROWSER_TASK")
            raw_result = await execution
            result = sanitize_browser_result(raw_result)
            status = str(result.get("status", "FAILED")).upper()
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
            for pending in (renewer, lost_waiter):
                if not pending.done():
                    pending.cancel()
                try:
                    await pending
                except asyncio.CancelledError:
                    pass

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
                          "OPERATOR_COMMAND_FIELDS_NOT_ALLOWED"}:
                await self.client.fail(task["task_id"], task["lease_token"], reason=reason, retryable=False)
                return {"task_id": task["task_id"], "status": "BLOCKED", "code": reason}
            raise

    async def run_forever(self):
        browser_version = await self.runtime_probe()
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


async def run_from_env():
    config = ContinuityWorkerConfig.from_env()
    worker = ContinuityBrowserWorker(config)
    await worker.run_forever()


if __name__ == "__main__":
    asyncio.run(run_from_env())
