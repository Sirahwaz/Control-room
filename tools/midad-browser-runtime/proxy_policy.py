"""Fail-closed, scope-aware proxy policy and Playwright adapter.

Secret material is resolved only at runtime through an injected Vault adapter.
This module never persists proxy credentials or writes them to logs.
"""
from __future__ import annotations

from urllib.parse import urlsplit

CONTRACT_VERSION = "midad.network-access/v1"
SCOPES = {"BROWSER", "AUTOMATION", "INFRASTRUCTURE"}
PLAYWRIGHT_MODES = {"HTTP": "http", "HTTPS": "https", "SOCKS5": "socks5"}


class ProxyPolicyError(RuntimeError):
    """A route or proxy configuration failed closed."""


def _target_host(value: str) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > 2048:
        raise ProxyPolicyError("TARGET_URL_INVALID")
    raw = value.strip()
    parsed = urlsplit(raw if "://" in raw else "https://" + raw)
    if parsed.scheme.lower() not in {"http", "https"} or not parsed.hostname:
        raise ProxyPolicyError("TARGET_URL_INVALID")
    if parsed.username is not None or parsed.password is not None:
        raise ProxyPolicyError("TARGET_URL_CREDENTIALS_FORBIDDEN")
    try:
        return parsed.hostname.encode("idna").decode("ascii").lower().rstrip(".")
    except UnicodeError as exc:
        raise ProxyPolicyError("TARGET_HOST_INVALID") from exc


def resolve_proxy_route(config: dict, target: str, scope: str) -> dict:
    """Resolve one exact-host route for a runtime scope; never infer Direct."""
    if not isinstance(config, dict) or config.get("contract_version") != CONTRACT_VERSION:
        raise ProxyPolicyError("NETWORK_ACCESS_CONTRACT_UNSUPPORTED")
    scope = str(scope or "").upper()
    if scope not in SCOPES:
        raise ProxyPolicyError("NETWORK_SCOPE_INVALID")
    host = _target_host(target)
    rules = config.get("routing_rules")
    if not isinstance(rules, list):
        raise ProxyPolicyError("ROUTING_RULES_INVALID")

    matches = []
    for rule in rules:
        if not isinstance(rule, dict):
            raise ProxyPolicyError("ROUTING_RULE_INVALID")
        hosts = rule.get("hosts")
        scopes = rule.get("scopes")
        if isinstance(hosts, list) and isinstance(scopes, list):
            normalized_hosts = {str(item).strip().lower().rstrip(".") for item in hosts}
            if host in normalized_hosts and scope in {str(item).upper() for item in scopes}:
                matches.append(rule)

    if not matches:
        defaults = config.get("defaults") or {}
        if defaults.get("on_no_match") == "DIRECT":
            return {"action": "DIRECT", "host": host, "scope": scope, "rule_id": None}
        raise ProxyPolicyError("NO_ROUTE_MATCH")

    highest = max(int(rule.get("priority", 0)) for rule in matches)
    winners = [rule for rule in matches if int(rule.get("priority", 0)) == highest]
    if len(winners) != 1:
        raise ProxyPolicyError("ROUTE_RULE_AMBIGUOUS")
    rule = winners[0]
    action = str(rule.get("action") or "").upper()
    base = {"action": action, "host": host, "scope": scope, "rule_id": rule.get("rule_id")}
    if action == "BLOCK":
        raise ProxyPolicyError("ROUTE_BLOCKED")
    if action == "DIRECT":
        return base
    if action != "USE_PROXY":
        raise ProxyPolicyError("ROUTE_ACTION_INVALID")

    profile_id = rule.get("proxy_profile_id")
    profiles = config.get("proxy_profiles")
    if not isinstance(profiles, list):
        raise ProxyPolicyError("PROXY_PROFILES_INVALID")
    profile = next((item for item in profiles
                    if isinstance(item, dict) and item.get("profile_id") == profile_id), None)
    if profile is None:
        raise ProxyPolicyError("PROXY_PROFILE_NOT_FOUND")
    if profile.get("enabled") is not True:
        raise ProxyPolicyError("PROXY_PROFILE_DISABLED")
    if profile.get("mode") == "DIRECT":
        raise ProxyPolicyError("PROXY_PROFILE_MODE_INVALID")
    endpoint = profile.get("endpoint")
    if not isinstance(endpoint, dict):
        raise ProxyPolicyError("PROXY_ENDPOINT_INVALID")
    endpoint_host = endpoint.get("host")
    port = endpoint.get("port")
    if not isinstance(endpoint_host, str) or not endpoint_host.strip() or "@" in endpoint_host:
        raise ProxyPolicyError("PROXY_ENDPOINT_INVALID")
    if not isinstance(port, int) or isinstance(port, bool) or not 1 <= port <= 65535:
        raise ProxyPolicyError("PROXY_ENDPOINT_INVALID")
    return {**base, "profile": profile}


def build_playwright_proxy(profile: dict, secret_resolver=None) -> dict:
    """Create ephemeral Playwright proxy settings from a profile and Vault resolver."""
    if not isinstance(profile, dict):
        raise ProxyPolicyError("PROXY_PROFILE_INVALID")
    mode = str(profile.get("mode") or "").upper()
    if mode not in PLAYWRIGHT_MODES:
        raise ProxyPolicyError("TUNNEL_ADAPTER_REQUIRED")
    endpoint = profile.get("endpoint")
    if not isinstance(endpoint, dict):
        raise ProxyPolicyError("PROXY_ENDPOINT_INVALID")
    host = endpoint.get("host")
    port = endpoint.get("port")
    if not isinstance(host, str) or not host.strip() or any(ch in host for ch in "/@?#"):
        raise ProxyPolicyError("PROXY_ENDPOINT_INVALID")
    if not isinstance(port, int) or isinstance(port, bool) or not 1 <= port <= 65535:
        raise ProxyPolicyError("PROXY_ENDPOINT_INVALID")

    settings = {"server": f"{PLAYWRIGHT_MODES[mode]}://{host.strip()}:{port}"}
    secret_ref = profile.get("auth_secret_ref")
    if secret_ref:
        if not callable(secret_resolver):
            raise ProxyPolicyError("VAULT_RESOLVER_REQUIRED")
        try:
            credentials = secret_resolver(secret_ref)
        except Exception as exc:
            raise ProxyPolicyError("VAULT_SECRET_RESOLUTION_FAILED") from exc
        if not isinstance(credentials, dict):
            raise ProxyPolicyError("PROXY_AUTH_SECRET_INVALID")
        username = credentials.get("username")
        password = credentials.get("password")
        if (not isinstance(username, str) or not username or len(username) > 256 or
                not isinstance(password, str) or not password or len(password) > 1024):
            raise ProxyPolicyError("PROXY_AUTH_SECRET_INVALID")
        settings["username"] = username
        settings["password"] = password
    return settings
