"""Route operator hints to approved browser profiles and validate commands.

This module converts conversational platform hints into a small typed protocol. It
never evaluates page text as instructions and never accepts arbitrary Python/JS.
"""
from __future__ import annotations

import re
from urllib.parse import urlsplit

SAFE_ACTIONS = frozenset({
    "start_session", "status", "inspect", "navigate", "wait_for_selector",
    "click", "fill", "submit_form", "stop_session",
})
ALWAYS_BLOCKED = frozenset({
    "payment", "transfer", "withdraw", "withdrawal", "wallet_sign", "sign",
    "delete", "download", "captcha_bypass", "mfa_bypass", "bot_evasion",
})
_FINANCIAL_OR_DESTRUCTIVE = re.compile(
    r"\b(pay(?:ment)?|transfer|withdraw(?:al)?|sign(?:ature)?(?!\s+in\b)|delete|"
    r"send\s+money|buy\s+crypto|wallet\s+sign)\b|"
    r"(سحب|تحويل|دفع|توقيع|حذف|شراء\s+عملات)",
    re.IGNORECASE,
)
_ACTIONS = {
    "stop_session": ("stop", "logout", "log out", "close session", "وقف", "اغلق الجلسة", "تسجيل خروج"),
    "status": ("status", "session status", "الحالة", "حالة الجلسة"),
    "inspect": ("inspect", "check", "read", "look at", "show", "review", "افحص", "تحقق", "شوف", "اعرض", "راجع"),
    "navigate": ("navigate", "go to", "open page", "visit", "اذهب", "افتح صفحة", "انتقل"),
    "wait_for_selector": ("wait for", "wait until", "انتظر ظهور", "انتظر"),
    "start_session": ("login", "log in", "sign in", "start session", "connect", "open session", "تسجيل الدخول", "سجل دخول", "اتصل"),
}

class CommandRoutingError(ValueError):
    """A hint or command cannot be routed safely."""

def _normalize(value: object) -> str:
    text = str(value or "").casefold().replace("_", " ").replace("-", " ")
    return " ".join(re.sub(r"[^\w.]+", " ", text, flags=re.UNICODE).split())

def _profile_aliases(profile: dict) -> set[str]:
    values = [profile.get("platform_key"), profile.get("display_name"),
              profile.get("host"), profile.get("account_id")]
    aliases = profile.get("aliases", [])
    if isinstance(aliases, str):
        aliases = [aliases]
    if isinstance(aliases, list):
        values.extend(aliases)
    return {_normalize(v) for v in values if isinstance(v, str) and _normalize(v)}

def resolve_platform_hint(hint: str, profiles: list[dict]) -> dict:
    """Resolve a platform hint only when a single approved profile matches."""
    normalized = _normalize(hint)
    if not normalized:
        raise CommandRoutingError("PLATFORM_HINT_REQUIRED")
    matches: list[tuple[int, dict]] = []
    for profile in profiles:
        aliases = _profile_aliases(profile)
        score = 0
        for alias in aliases:
            if len(alias) < 3:
                continue
            if normalized == alias:
                score = max(score, 1000 + len(alias))
            elif re.search(r"(?<!\w)" + re.escape(alias) + r"(?!\w)", normalized):
                score = max(score, 500 + len(alias))
        if score:
            matches.append((score, profile))
    if not matches:
        raise CommandRoutingError("NO_APPROVED_PLATFORM_MATCH")
    best = max(score for score, _ in matches)
    winners = [profile for score, profile in matches if score == best]
    unique = {str(p.get("account_id", "")): p for p in winners}
    if len(unique) != 1:
        raise CommandRoutingError("PLATFORM_HINT_AMBIGUOUS")
    profile = next(iter(unique.values()))
    for key in ("account_id", "host", "password_secret_ref"):
        if not isinstance(profile.get(key), str) or not profile[key].strip():
            raise CommandRoutingError("PROFILE_NOT_READY")
    return profile

def infer_hint_action(hint: str) -> str:
    """A bare platform hint defaults to opening an approved session and waiting."""
    normalized = _normalize(hint)
    if _FINANCIAL_OR_DESTRUCTIVE.search(hint or ""):
        raise CommandRoutingError("FINANCIAL_OR_DESTRUCTIVE_COMMAND_BLOCKED")
    for action in ("stop_session", "status", "inspect", "navigate", "wait_for_selector", "start_session"):
        phrases = _ACTIONS[action]
        if any(_normalize(phrase) in normalized for phrase in phrases):
            return action
    return "start_session"

def build_operator_request(hint: str, profiles: list[dict]) -> dict:
    """Build a secret-free queue payload from a platform hint."""
    profile = resolve_platform_hint(hint, profiles)
    action = infer_hint_action(hint)
    urls = re.findall(r"https://[^\\s,;]+", str(hint or ""))
    target_url = urls[0].rstrip(").]}") if urls else None
    if action == "navigate" and not target_url:
        # A platform-only hint should establish a session, not fail on a missing URL.
        action = "start_session"
    if action == "start_session":
        target_url = profile.get("login_url")
        required = ("username", "username_selector", "password_selector", "submit_selector",
                    "success_selector", "login_post_paths")
        if not isinstance(target_url, str) or any(not profile.get(key) for key in required):
            raise CommandRoutingError("PROFILE_NOT_READY_FOR_LOGIN")
    if target_url:
        _validate_profile_url(target_url, profile)
    return {
        "version": 1,
        "platform_key": str(profile.get("platform_key") or profile.get("display_name") or profile["host"]),
        "account_id": profile["account_id"],
        "action": action,
        "target_url": target_url,
        "action_approved": False,
        "request_text": str(hint)[:500],
    }

def _validate_profile_url(raw_url: str, profile: dict) -> str:
    try:
        parts = urlsplit(raw_url)
        port = parts.port
    except (TypeError, ValueError) as exc:
        raise CommandRoutingError("INVALID_TARGET_URL") from exc
    host = (parts.hostname or "").lower().rstrip(".")
    if parts.scheme.lower() != "https" or not host or port not in (None, 443):
        raise CommandRoutingError("HTTPS_TARGET_REQUIRED")
    allowed = {str(profile.get("host", "")).lower().rstrip(".")}
    extra = profile.get("resource_hosts", [])
    if isinstance(extra, list):
        allowed.update(str(h).lower().rstrip(".") for h in extra if isinstance(h, str))
    if host not in allowed:
        raise CommandRoutingError("TARGET_HOST_NOT_PROFILE_ALLOWED")
    if parts.username is not None or parts.password is not None:
        raise CommandRoutingError("URL_CREDENTIALS_FORBIDDEN")
    return raw_url

def validate_operator_command(command: dict, profile: dict, allowed_hosts: set[str]) -> dict:
    """Validate a typed operator command; no command text is executed as code."""
    if not isinstance(command, dict):
        raise CommandRoutingError("COMMAND_OBJECT_REQUIRED")
    action = str(command.get("action", "")).strip().lower()
    if action in ALWAYS_BLOCKED:
        raise CommandRoutingError("ACTION_BLOCKED_BY_POLICY")
    if action not in SAFE_ACTIONS:
        raise CommandRoutingError("UNKNOWN_ACTION")
    if str(command.get("account_id", "")) != str(profile.get("account_id", "")):
        raise CommandRoutingError("ACCOUNT_PROFILE_MISMATCH")
    host = str(profile.get("host", "")).strip().lower().rstrip(".")
    allow = {str(item).strip().lower().rstrip(".") for item in allowed_hosts}
    if not host or host not in allow or "*" in host:
        raise CommandRoutingError("PROFILE_HOST_NOT_ALLOWLISTED")
    target = command.get("target_url")
    if action == "start_session" and not target:
        target = profile.get("login_url")
    if action == "navigate" and not target:
        raise CommandRoutingError("NAVIGATION_URL_REQUIRED")
    if target:
        target = _validate_profile_url(str(target), profile)
    approval = command.get("action_approved") is True
    request_text = str(command.get("request_text", ""))
    if _FINANCIAL_OR_DESTRUCTIVE.search(request_text):
        raise CommandRoutingError("FINANCIAL_OR_DESTRUCTIVE_COMMAND_BLOCKED")
    if action in {"click", "fill", "submit_form"} and not approval:
        raise CommandRoutingError("ACTION_APPROVAL_REQUIRED")
    if action in {"click", "fill", "submit_form", "wait_for_selector"}:
        selector = str(command.get("selector", "")).strip()
        if not selector or len(selector) > 300:
            raise CommandRoutingError("SELECTOR_REQUIRED")
    if action == "fill":
        value = command.get("value")
        if not isinstance(value, str) or len(value) > 2000:
            raise CommandRoutingError("FILL_VALUE_INVALID")
        if str(profile.get("password_selector", "")) and command.get("selector") == profile.get("password_selector"):
            raise CommandRoutingError("PASSWORD_FIELD_NOT_AVAILABLE_TO_GENERIC_FILL")
    return {
        "version": 1, "account_id": profile["account_id"], "platform_key": str(profile.get("platform_key") or profile["host"]),
        "action": action, "target_url": target, "selector": str(command.get("selector", ""))[:300] or None,
        "value": command.get("value") if action == "fill" else None,
        "action_approved": approval, "request_text": str(command.get("request_text", ""))[:500],
    }
