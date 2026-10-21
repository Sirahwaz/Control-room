"""Provider-neutral policy gate for MIDAD browser actions.

This module is a decision layer, not a browser sandbox by itself. A runtime must
call it before every action and independently enforce request/redirect policy.
"""

from __future__ import annotations

import ipaddress
from urllib.parse import urlsplit


READ_ONLY_ACTIONS = frozenset({"navigate", "read_dom", "extract_text", "screenshot"})
INTERACTION_ACTIONS = frozenset({"click", "fill", "upload", "download"})
EXTERNAL_EFFECT_ACTIONS = frozenset(
    {"submit_form", "publish_post", "apply_to_task", "send_message"}
)
FINANCIAL_ACTIONS = frozenset({"wallet_sign", "transfer", "withdraw"})
PROHIBITED_ACTIONS = frozenset(
    {"captcha_bypass", "human_verification_bypass", "mfa_bypass", "bot_evasion"}
)

KNOWN_ACTIONS = (
    READ_ONLY_ACTIONS
    | INTERACTION_ACTIONS
    | EXTERNAL_EFFECT_ACTIONS
    | FINANCIAL_ACTIONS
    | PROHIBITED_ACTIONS
)


def _result(status: str, code: str, action: str, reason: str, host: str | None = None) -> dict:
    return {
        "status": status,
        "code": code,
        "action": action,
        "reason": reason,
        "target_host": host,
    }


def _blocked(code: str, action: str, reason: str, host: str | None = None) -> dict:
    return _result("BLOCK", code, action, reason, host)


def _allowed(code: str, action: str, reason: str, host: str | None = None) -> dict:
    return _result("ALLOW", code, action, reason, host)


def _normalize_allowlist(allowed_hosts) -> set[str]:
    if not isinstance(allowed_hosts, (set, frozenset, list, tuple)):
        return set()
    hosts = set()
    for host in allowed_hosts:
        if not isinstance(host, str) or not host.strip():
            return set()
        normalized = host.strip().lower().rstrip(".")
        if "*" in normalized or "/" in normalized or "://" in normalized:
            return set()
        hosts.add(normalized)
    return hosts


def evaluate_action(
    action: str,
    target_url: str,
    allowed_hosts,
    *,
    requires_session: bool = False,
    session_confirmed: bool = False,
    action_approved: bool = False,
    financial_gate_enabled: bool = False,
) -> dict:
    """Return an explicit ALLOW/BLOCK decision for a proposed browser action.

    Defaults are fail-closed: no implicit host access, no unapproved interaction,
    no unconfirmed authenticated session, and no financial action.
    """
    normalized_action = action.strip().lower() if isinstance(action, str) else ""

    if normalized_action in PROHIBITED_ACTIONS:
        return _blocked(
            "SECURITY_CONTROL_BYPASS_PROHIBITED",
            normalized_action,
            "Human verification, CAPTCHA, MFA and anti-bot controls must not be bypassed.",
        )
    if normalized_action not in KNOWN_ACTIONS:
        return _blocked(
            "UNKNOWN_ACTION",
            normalized_action,
            "The action is not part of the declared browser capability contract.",
        )

    if not isinstance(target_url, str) or not target_url.strip():
        return _blocked("INVALID_URL", normalized_action, "A non-empty target URL is required.")

    try:
        parts = urlsplit(target_url.strip())
        port = parts.port
    except ValueError:
        return _blocked("INVALID_URL", normalized_action, "The target URL is malformed.")

    if parts.scheme.lower() != "https":
        return _blocked("HTTPS_REQUIRED", normalized_action, "Only HTTPS targets are allowed.")
    if parts.username is not None or parts.password is not None:
        return _blocked(
            "URL_CREDENTIALS_FORBIDDEN",
            normalized_action,
            "Embedded URL credentials are forbidden.",
        )
    if not parts.hostname or port not in (None, 443):
        return _blocked(
            "INVALID_URL",
            normalized_action,
            "A hostname and the default HTTPS port are required.",
        )

    host = parts.hostname.lower().rstrip(".")
    if host in {"localhost", "localhost.localdomain"} or host.endswith(
        (".local", ".internal", ".localhost")
    ):
        return _blocked("NON_PUBLIC_HOST", normalized_action, "Local and internal hosts are forbidden.", host)

    try:
        ip_value = ipaddress.ip_address(host)
    except ValueError:
        ip_value = None
    if ip_value is not None and not ip_value.is_global:
        return _blocked("NON_PUBLIC_HOST", normalized_action, "Non-public IP targets are forbidden.", host)

    allowlist = _normalize_allowlist(allowed_hosts)
    if not allowlist or host not in allowlist:
        return _blocked(
            "HOST_NOT_ALLOWLISTED",
            normalized_action,
            "The exact hostname must appear in an explicit non-wildcard allowlist.",
            host,
        )

    if requires_session and not session_confirmed:
        return _blocked(
            "SESSION_NOT_CONFIRMED",
            normalized_action,
            "The required site session has not been confirmed by the operator.",
            host,
        )

    if normalized_action in READ_ONLY_ACTIONS:
        return _allowed(
            "READ_ONLY_ALLOWED",
            normalized_action,
            "Read-only action passed the declared URL, host and session preflight.",
            host,
        )

    if normalized_action in INTERACTION_ACTIONS:
        if not action_approved:
            return _blocked(
                "ACTION_APPROVAL_REQUIRED",
                normalized_action,
                "This interaction requires an approved task plan or action authorization.",
                host,
            )
        return _allowed(
            "APPROVED_INTERACTION_ALLOWED",
            normalized_action,
            "Interaction is allowed by explicit task approval; runtime guards still apply.",
            host,
        )

    if normalized_action in EXTERNAL_EFFECT_ACTIONS:
        if not action_approved:
            return _blocked(
                "ACTION_APPROVAL_REQUIRED",
                normalized_action,
                "External submissions and messages require explicit per-task approval.",
                host,
            )
        return _allowed(
            "APPROVED_EXTERNAL_EFFECT_ALLOWED",
            normalized_action,
            "External action passed the explicit approval gate.",
            host,
        )

    if normalized_action in FINANCIAL_ACTIONS:
        if not action_approved:
            return _blocked(
                "ACTION_APPROVAL_REQUIRED",
                normalized_action,
                "Financial actions require explicit approval for the specific operation.",
                host,
            )
        if not financial_gate_enabled:
            return _blocked(
                "FINANCIAL_GATE_DISABLED",
                normalized_action,
                "Financial actions remain disabled unless a separate financial gate is enabled.",
                host,
            )
        return _allowed(
            "APPROVED_FINANCIAL_ACTION_ALLOWED",
            normalized_action,
            "Policy gates passed; an external signer and transaction-level checks remain mandatory.",
            host,
        )

    return _blocked("UNKNOWN_ACTION", normalized_action, "No rule matched; fail closed.", host)
