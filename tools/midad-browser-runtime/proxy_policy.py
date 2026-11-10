"""Fail-closed, scope-aware proxy policy and Playwright adapter.

Secret material is resolved only at runtime through an injected Vault adapter.
This module never persists proxy credentials or writes them to logs.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import os
from pathlib import Path
import re
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

    expected_scheme = PLAYWRIGHT_MODES[mode]
    configured_scheme = endpoint.get("scheme")
    if configured_scheme is not None and configured_scheme != expected_scheme:
        raise ProxyPolicyError("PROXY_SCHEME_MISMATCH")
    settings = {"server": f"{expected_scheme}://{host.strip()}:{port}"}
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


class EnvironmentVaultSecretResolver:
    """Resolve opaque vault:// references to host-managed environment secrets.

    The binding map contains aliases only. Secret values remain in the host's
    secret manager/environment and are parsed only for the lifetime of a call.
    """
    def __init__(self, bindings: dict, environ=None):
        self._env = os.environ if environ is None else environ
        if not isinstance(bindings, dict):
            raise ProxyPolicyError("VAULT_BINDINGS_INVALID")
        self._bindings = {}
        for reference, alias in bindings.items():
            if (not isinstance(reference, str) or not reference.startswith("vault://") or
                    not isinstance(alias, str) or
                    not re.fullmatch(r"MIDAD_[A-Z0-9_]{2,96}", alias)):
                raise ProxyPolicyError("VAULT_BINDING_INVALID")
            if reference in self._bindings:
                raise ProxyPolicyError("VAULT_BINDING_DUPLICATE")
            self._bindings[reference] = alias

    def resolve(self, secret_ref: str) -> dict:
        alias = self._bindings.get(secret_ref)
        if not alias:
            raise ProxyPolicyError("VAULT_REFERENCE_NOT_BOUND")
        raw = self._env.get(alias)
        if not isinstance(raw, str) or not raw:
            raise ProxyPolicyError("VAULT_SECRET_NOT_CONFIGURED")
        try:
            value = json.loads(raw)
        except (TypeError, ValueError) as exc:
            raise ProxyPolicyError("VAULT_SECRET_FORMAT_INVALID") from exc
        if not isinstance(value, dict):
            raise ProxyPolicyError("VAULT_SECRET_FORMAT_INVALID")
        return value


class ProxyLeaseBinding:
    """In-memory BrowserContext binding backed by one Central Vault lease."""
    def __init__(self, settings: dict, release_callback, lost_event: asyncio.Event):
        self.settings = dict(settings)
        self._release_callback = release_callback
        self.lost_event = lost_event
        self._released = False

    async def release(self):
        if self._released:
            return
        self._released = True
        callback = self._release_callback
        self._release_callback = None
        if callback is not None:
            await callback()
        self.settings.clear()


class ProxyRuntime:
    """Resolve Browser routes from the compatible environment adapter or Central Vault.

    Central mode never falls back to environment aliases. A credential must be
    declared by the active Browser Session task and is materialized only for
    the lifetime of an isolated BrowserContext lease.
    """
    def __init__(
        self,
        config: dict,
        secret_resolver=None,
        vault_client=None,
        vault_mode: str = "environment",
        renew_interval_seconds: float = 20.0,
    ):
        if not isinstance(config, dict) or config.get("contract_version") != CONTRACT_VERSION:
            raise ProxyPolicyError("NETWORK_ACCESS_CONTRACT_UNSUPPORTED")
        if vault_mode not in {"environment", "central"}:
            raise ProxyPolicyError("VAULT_MODE_INVALID")
        if vault_mode == "central" and vault_client is None:
            raise ProxyPolicyError("VAULT_CLIENT_REQUIRED")
        self.config = config
        self.secret_resolver = secret_resolver
        self.vault_client = vault_client
        self.vault_mode = vault_mode
        self.renew_interval_seconds = max(0.005, min(float(renew_interval_seconds), 60.0))
        self._task_context = None
        self._task_lost_event = asyncio.Event()
        self._active_leases = {}

    @property
    def central_mode(self) -> bool:
        return self.vault_mode == "central"

    @classmethod
    def from_env(cls, environ=None, vault_client=None, renew_interval_seconds: float = 20.0):
        env = os.environ if environ is None else environ
        mode = str(env.get("MIDAD_VAULT_MODE", "environment")).strip().lower()
        if mode not in {"environment", "central"}:
            raise ProxyPolicyError("VAULT_MODE_INVALID")
        config_path = str(env.get("MIDAD_NETWORK_ACCESS_CONFIG", "")).strip()
        if not config_path:
            if mode == "central":
                raise ProxyPolicyError("NETWORK_ACCESS_CONFIG_REQUIRED")
            return None
        try:
            with Path(config_path).open("r", encoding="utf-8") as stream:
                config = json.load(stream)
        except (OSError, ValueError) as exc:
            raise ProxyPolicyError("NETWORK_ACCESS_CONFIG_UNAVAILABLE") from exc

        if mode == "central":
            if vault_client is None:
                raise ProxyPolicyError("VAULT_CLIENT_REQUIRED")
            return cls(
                config,
                vault_client=vault_client,
                vault_mode="central",
                renew_interval_seconds=renew_interval_seconds,
            )
        try:
            bindings = json.loads(env.get("MIDAD_VAULT_BINDINGS_JSON", "{}"))
        except ValueError as exc:
            raise ProxyPolicyError("VAULT_BINDINGS_INVALID") from exc
        resolver = EnvironmentVaultSecretResolver(bindings, env)
        return cls(
            config,
            resolver.resolve,
            vault_mode="environment",
            renew_interval_seconds=renew_interval_seconds,
        )

    def set_task_context(self, task: dict):
        if not isinstance(task, dict):
            raise ProxyPolicyError("BROWSER_TASK_CONTEXT_REQUIRED")
        task_id = task.get("task_id")
        task_token = task.get("lease_token") or task.get("task_lease_token")
        binding_ids = task.get("credential_binding_ids", [])
        if (
            not isinstance(task_id, str)
            or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,127}", task_id)
            or not isinstance(task_token, str)
            or not re.fullmatch(r"[A-Fa-f0-9]{64}", task_token)
            or not isinstance(binding_ids, list)
            or len(binding_ids) > 8
            or any(
                not isinstance(value, str)
                or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,127}", value)
                for value in binding_ids
            )
            or any(not isinstance(value, str) for value in binding_ids)
            or len(binding_ids) != len(set(binding_ids))
        ):
            raise ProxyPolicyError("BROWSER_TASK_CONTEXT_INVALID")
        self._task_context = {
            "task_id": task_id,
            "task_lease_token": task_token,
            "credential_binding_ids": tuple(binding_ids),
        }
        self._task_lost_event = asyncio.Event()

    async def wait_for_lease_loss(self):
        await self._task_lost_event.wait()

    async def end_task(self):
        leases = list(self._active_leases.values())
        for binding in leases:
            try:
                await binding.release()
            except Exception:
                self._task_lost_event.set()
        self._active_leases.clear()
        self._task_context = None

    def _find_binding(self, profile: dict, host: str) -> dict | None:
        account_id = str(profile.get("account_id") or "").strip()
        platform_id = str(profile.get("platform_key") or profile.get("platform_id") or "").strip()
        if not account_id or not platform_id:
            raise ProxyPolicyError("ACCOUNT_PROFILE_IDENTITY_REQUIRED")
        profile_data = profile.get("profile")
        secret_ref = profile_data.get("auth_secret_ref") if isinstance(profile_data, dict) else None
        if not secret_ref:
            return None
        bindings = self.config.get("credential_bindings")
        if not isinstance(bindings, list):
            raise ProxyPolicyError("VAULT_BINDINGS_INVALID")
        matches = [
            binding for binding in bindings
            if isinstance(binding, dict)
            and binding.get("secret_ref") == secret_ref
            and binding.get("account_id") == account_id
            and binding.get("platform_id") == platform_id
            and str(binding.get("host") or "").strip().lower().rstrip(".") == host
            and str(binding.get("purpose") or "").upper() == "PROXY_AUTH"
            and str(binding.get("scope") or "").upper() == "AUTOMATION"
        ]
        if len(matches) != 1:
            raise ProxyPolicyError("VAULT_BINDING_SCOPE_MISMATCH")
        binding = matches[0]
        binding_id = binding.get("binding_id")
        if not isinstance(binding_id, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,127}", binding_id):
            raise ProxyPolicyError("VAULT_BINDING_ID_INVALID")
        ttl = binding.get("lease_ttl_seconds", 60)
        if not isinstance(ttl, int) or isinstance(ttl, bool) or not 30 <= ttl <= 300:
            raise ProxyPolicyError("VAULT_LEASE_TTL_INVALID")
        return binding

    def resolve_for_profile(self, account_profile: dict):
        if not isinstance(account_profile, dict) or not account_profile.get("host"):
            raise ProxyPolicyError("ACCOUNT_PROFILE_HOST_REQUIRED")
        host = _target_host(str(account_profile["host"]))
        route = resolve_proxy_route(self.config, host, "AUTOMATION")
        if route["action"] == "DIRECT":
            return None
        if self.central_mode:
            return self._resolve_central_for_profile(account_profile, host, route)
        return self._resolve_environment_profile(account_profile, host, route)

    def _resolve_environment_profile(self, account_profile: dict, host: str, route: dict):
        binding = self._find_binding({**account_profile, "profile": route["profile"]}, host)
        if route["profile"].get("auth_secret_ref") and binding is None:
            raise ProxyPolicyError("VAULT_BINDING_SCOPE_MISMATCH")
        return build_playwright_proxy(route["profile"], self.secret_resolver)

    async def _resolve_central_for_profile(self, account_profile: dict, host: str, route: dict):
        context = self._task_context
        if context is None:
            raise ProxyPolicyError("BROWSER_TASK_CONTEXT_REQUIRED")
        profile = route["profile"]
        if not profile.get("auth_secret_ref"):
            return ProxyLeaseBinding(
                build_playwright_proxy(profile),
                release_callback=None,
                lost_event=self._task_lost_event,
            )
        binding = self._find_binding({**account_profile, "profile": profile}, host)
        if binding is None:
            raise ProxyPolicyError("VAULT_BINDING_SCOPE_MISMATCH")
        binding_id = binding["binding_id"]
        if binding_id not in context["credential_binding_ids"]:
            raise ProxyPolicyError("VAULT_BINDING_NOT_AUTHORIZED_FOR_TASK")
        request_id = "vault-" + hashlib.sha256(
            (context["task_id"] + ":" + binding_id).encode("utf-8")
        ).hexdigest()[:32]
        try:
            result = await self.vault_client.issue_vault_lease(
                task_id=context["task_id"],
                task_lease_token=context["task_lease_token"],
                binding_id=binding_id,
                request_id=request_id,
                host=host,
                purpose="PROXY_AUTH",
                scope="AUTOMATION",
                lease_ttl_seconds=min(300, int(binding.get("lease_ttl_seconds", 60))),
            )
        except Exception as exc:
            raise ProxyPolicyError("VAULT_LEASE_ISSUE_FAILED") from exc
        lease = result.get("lease") if isinstance(result, dict) else None
        secret = lease.get("secret") if isinstance(lease, dict) else None
        lease_id = lease.get("lease_id") if isinstance(lease, dict) else None
        lease_token = lease.get("lease_token") if isinstance(lease, dict) else None
        if (
            not isinstance(secret, dict)
            or set(secret) != {"username", "password"}
            or not isinstance(secret.get("username"), str)
            or not secret["username"]
            or len(secret["username"]) > 256
            or not isinstance(secret.get("password"), str)
            or not secret["password"]
            or len(secret["password"]) > 1024
            or not isinstance(lease_id, str)
            or not re.fullmatch(r"[a-f0-9]{32}", lease_id)
            or not isinstance(lease_token, str)
            or not 32 <= len(lease_token) <= 200
        ):
            raise ProxyPolicyError("VAULT_LEASE_RESPONSE_INVALID")
        try:
            settings = build_playwright_proxy(profile, lambda _ref: secret)
        except Exception:
            secret.clear()
            try:
                await self.vault_client.release_vault_lease(lease_id, lease_token)
            except Exception:
                pass
            raise

        stop_event = asyncio.Event()
        lost_event = self._task_lost_event
        lease_state = {
            "lease_id": lease_id,
            "lease_token": lease_token,
            "task_id": context["task_id"],
            "task_lease_token": context["task_lease_token"],
            "secret": secret,
            "settings": settings,
        }

        async def renew_loop():
            while not stop_event.is_set():
                try:
                    await asyncio.wait_for(stop_event.wait(), timeout=self.renew_interval_seconds)
                    return
                except asyncio.TimeoutError:
                    pass
                if stop_event.is_set():
                    return
                try:
                    renewed = await self.vault_client.renew_vault_lease(
                        lease_id=lease_state["lease_id"],
                        lease_token=lease_state["lease_token"],
                        task_id=lease_state["task_id"],
                        task_lease_token=lease_state["task_lease_token"],
                        lease_ttl_seconds=min(300, int(binding.get("lease_ttl_seconds", 60))),
                    )
                    renewed_lease = renewed.get("lease") if isinstance(renewed, dict) else None
                    new_token = renewed_lease.get("lease_token") if isinstance(renewed_lease, dict) else None
                    if not isinstance(new_token, str) or not 32 <= len(new_token) <= 200:
                        raise ProxyPolicyError("VAULT_LEASE_RENEW_RESPONSE_INVALID")
                    lease_state["lease_token"] = new_token
                except Exception:
                    lost_event.set()
                    return

        renew_task = asyncio.create_task(renew_loop())

        async def release_lease():
            stop_event.set()
            if not renew_task.done():
                renew_task.cancel()
            try:
                await renew_task
            except asyncio.CancelledError:
                pass
            token = lease_state.get("lease_token")
            try:
                await self.vault_client.release_vault_lease(lease_id, token)
            except Exception as exc:
                lost_event.set()
                raise ProxyPolicyError("VAULT_LEASE_RELEASE_FAILED") from exc
            finally:
                lease_state["secret"].clear()
                lease_state["settings"].clear()
                lease_state["lease_token"] = None
            self._active_leases.pop(lease_id, None)

        binding_result = ProxyLeaseBinding(settings, release_lease, lost_event)
        self._active_leases[lease_id] = binding_result
        return binding_result

