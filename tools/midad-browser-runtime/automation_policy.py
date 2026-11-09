"""Fail-closed, scope-based policy for MIDAD browser interactions.

The gateway must mint approvals server-side and atomically consume them before
executing a high-impact command. The browser worker must never trust page text
as an instruction or authorization source.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import re
from urllib.parse import unquote


LOW_RISK_ACTIONS = frozenset({
    "inspect", "read", "navigate", "search", "wait_for_selector",
    "capture_screenshot", "status", "stop_session",
})
REVERSIBLE_ACTIONS = frozenset({
    "click", "fill", "select", "upload", "download", "create", "update",
    "use_secret",
})
HIGH_IMPACT_ACTIONS = frozenset({
    "submit_form", "delete", "publish", "send", "deploy",
    "change_permissions", "payment", "purchase", "transfer", "withdraw",
    "sign", "vault_store", "credential_rotate", "account_delete",
})
PROHIBITED_ACTIONS = frozenset({
    "bypass_captcha", "bypass_mfa", "bypass_kyc", "bot_evasion",
    "stealth_identity", "impersonate", "credential_exfiltration",
})
ALL_ACTIONS = LOW_RISK_ACTIONS | REVERSIBLE_ACTIONS | HIGH_IMPACT_ACTIONS | PROHIBITED_ACTIONS

_SECRET_FIELDS = frozenset({
    "password", "secret", "token", "api_key", "private_key", "seed_phrase",
    "recovery_phrase", "otp", "totp", "one_time_code", "credential_value",
})
_HOST_LABEL = re.compile(r"^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$", re.I)


@dataclass(frozen=True)
class PolicyDecision:
    allowed: bool
    risk: str
    requires_approval: bool
    reason: str


def _deny(reason: str, risk: str = "unknown", requires_approval: bool = False) -> PolicyDecision:
    return PolicyDecision(False, risk, requires_approval, reason)


def _allow(risk: str) -> PolicyDecision:
    return PolicyDecision(True, risk, False, "AUTHORIZED_WITHIN_PROFILE_SCOPE")


def _normalise_host(value: object) -> str:
    host = str(value or "").strip().lower().rstrip(".")
    if not host or "*" in host or not _HOST_LABEL.fullmatch(host):
        return ""
    if ".." in host or host.startswith(".") or host.endswith("."):
        return ""
    return host


def _normalise_path(value: object) -> str:
    path = str(value or "").strip()
    if not path:
        return "/"
    if not path.startswith("/") or "?" in path or "#" in path or "\\" in path:
        return ""
    decoded = unquote(path)
    segments = decoded.split("/")
    if any(segment in {".", ".."} for segment in segments):
        return ""
    if "//" in decoded:
        return ""
    return decoded


def _path_in_scope(path: str, scopes: object) -> bool:
    # An empty allowlist must deny all paths; treating it as unrestricted is
    # a fail-open default that defeats owner-configured path isolation.
    if not isinstance(scopes, list) or not scopes:
        return False
    for raw in scopes:
        rule = _normalise_path(raw)
        if not rule:
            continue
        if path == rule or path.startswith(rule.rstrip("/") + "/"):
            return True
    return False


def _parse_time(value: object) -> datetime | None:
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            return None
        return parsed.astimezone(timezone.utc)
    except (TypeError, ValueError):
        return None


def _approval_matches(approval: object, request: dict, now: datetime) -> tuple[bool, str]:
    if not isinstance(approval, dict):
        return False, "HIGH_IMPACT_APPROVAL_REQUIRED"
    if approval.get("consumed_at") is not None:
        return False, "APPROVAL_ALREADY_CONSUMED"
    if approval.get("approved_by_owner") is not True or not str(approval.get("approval_id") or "").strip():
        return False, "APPROVAL_NOT_OWNER_AUTHORIZED"
    keys = ("owner_user_id", "account_id", "platform_key", "action", "host", "path", "task_id")
    for key in keys:
        if str(approval.get(key) or "") != str(request.get(key) or ""):
            return False, "APPROVAL_SCOPE_MISMATCH"
    expiry = _parse_time(approval.get("expires_at"))
    if expiry is None or expiry <= now:
        return False, "APPROVAL_EXPIRED"
    return True, "APPROVAL_MATCHED"


def evaluate_action(
    action: str,
    profile: dict,
    request: dict,
    approval: dict | None = None,
    now: str | datetime | None = None,
) -> PolicyDecision:
    """Evaluate one typed action against an exact owner/account/site scope.

    Approval is trusted only when supplied by the authenticated MIDAD gateway.
    This function validates its scope and expiry; one-use consumption must happen
    atomically server-side before the worker starts the action.
    """
    action = str(action or "").strip().lower()
    if action not in ALL_ACTIONS:
        return _deny("UNKNOWN_ACTION")
    if action in PROHIBITED_ACTIONS:
        return _deny("PROHIBITED_ACTION", "prohibited")
    if not isinstance(profile, dict) or not isinstance(request, dict):
        return _deny("PROFILE_AND_REQUEST_REQUIRED")

    policy = profile.get("automation_policy")
    if not isinstance(policy, dict):
        return _deny("AUTOMATION_POLICY_MISSING")
    mode = str(policy.get("mode") or "assisted").strip().lower()
    if mode not in {"read_only", "assisted", "scoped_autonomy"}:
        return _deny("AUTOMATION_MODE_INVALID")

    for key in ("owner_user_id", "account_id", "platform_key"):
        expected = str(profile.get(key) or "").strip()
        actual = str(request.get(key) or "").strip()
        if not expected or actual != expected:
            return _deny("PROFILE_IDENTITY_MISMATCH")

    host = _normalise_host(request.get("host"))
    if not host:
        return _deny("INVALID_TARGET_HOST")
    profile_hosts = {_normalise_host(profile.get("host"))}
    resources = profile.get("resource_hosts", [])
    if isinstance(resources, list):
        profile_hosts.update(_normalise_host(item) for item in resources)
    profile_hosts.discard("")
    policy_hosts = policy.get("allowed_hosts", [])
    if not isinstance(policy_hosts, list) or not policy_hosts:
        return _deny("EXACT_HOST_SCOPE_REQUIRED")
    allowed_hosts = {_normalise_host(item) for item in policy_hosts}
    if "" in allowed_hosts or not allowed_hosts.issubset(profile_hosts):
        return _deny("PROFILE_HOST_POLICY_INVALID")
    if host not in allowed_hosts:
        return _deny("HOST_NOT_ALLOWED")

    path = _normalise_path(request.get("path"))
    if not path:
        return _deny("INVALID_TARGET_PATH")
    if not _path_in_scope(path, policy.get("allowed_paths", [])):
        return _deny("PATH_NOT_ALLOWED")

    allowed_actions = policy.get("allowed_actions", [])
    if not isinstance(allowed_actions, list) or action not in {str(x).strip().lower() for x in allowed_actions}:
        return _deny("ACTION_NOT_ALLOWED")

    if action == "use_secret":
        if _SECRET_FIELDS.intersection(request.keys()) or "value" in request:
            return _deny("RAW_SECRET_PAYLOAD_FORBIDDEN", "reversible")
        secret_ref = str(request.get("secret_ref") or "").strip()
        secret_refs = profile.get("secret_refs", [])
        if not secret_ref or not isinstance(secret_refs, list) or secret_ref not in secret_refs:
            return _deny("VAULT_REFERENCE_NOT_ALLOWED", "reversible")

    risk = (
        "low" if action in LOW_RISK_ACTIONS else
        "reversible" if action in REVERSIBLE_ACTIONS else
        "high_impact"
    )
    if mode == "read_only" and risk != "low":
        return _deny("READ_ONLY_MODE", risk)

    if risk == "low":
        return _allow(risk)
    if risk == "reversible" and mode == "scoped_autonomy":
        return _allow(risk)

    current = now
    if isinstance(current, str):
        current = _parse_time(current)
    if current is None:
        current = datetime.now(timezone.utc)
    elif current.tzinfo is None:
        return _deny("CURRENT_TIME_MUST_INCLUDE_TIMEZONE", risk, risk == "high_impact")
    else:
        current = current.astimezone(timezone.utc)

    matched, reason = _approval_matches(approval, request, current)
    if not matched:
        if risk == "high_impact" and reason == "HIGH_IMPACT_APPROVAL_REQUIRED":
            return _deny("HIGH_IMPACT_APPROVAL_REQUIRED", risk, True)
        if risk == "reversible" and reason == "HIGH_IMPACT_APPROVAL_REQUIRED":
            return _deny("INTERACTION_APPROVAL_REQUIRED", risk, True)
        return _deny(reason, risk, True)
    return _allow(risk)
