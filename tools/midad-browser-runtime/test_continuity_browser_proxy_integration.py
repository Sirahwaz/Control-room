"""Proxy integration contract for the Cloudflare-backed Browser Worker v2.

These tests keep the proxy optional and scoped to the existing worker/session path.
"""
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from persistent_session import PersistentSessionPool
from proxy_policy import ProxyPolicyError, ProxyRuntime


OWNER = "00000000-0000-4000-8000-000000000001"
PROFILE = {
    "account_id": "example-account",
    "platform_key": "example",
    "host": "example.com",
    "username": "operator@example.invalid",
    "password_secret_ref": "MIDAD_TEST_BROWSER_PASSWORD",
    "login_url": "https://example.com/login",
    "username_selector": "input[name='username']",
    "password_selector": "input[name='password']",
    "submit_selector": "button[type='submit']",
    "success_selector": "[data-testid='account-home']",
    "login_post_paths": ["/login"],
}


def proxy_config():
    return {
        "contract_version": "midad.network-access/v1",
        "proxy_profiles": [{
            "profile_id": "proxy-example-01",
            "mode": "HTTPS",
            "enabled": True,
            "endpoint": {
                "kind": "NETWORK",
                "host": "proxy.example.net",
                "port": 8443,
                "scheme": "https",
            },
            "auth_secret_ref": "vault://proxy/example/auth",
            "health_policy": {"on_failure": "BLOCK", "max_attempts": 1},
        }],
        "routing_rules": [{
            "rule_id": "automation-example",
            "priority": 100,
            "scopes": ["AUTOMATION"],
            "hosts": ["example.com"],
            "action": "USE_PROXY",
            "proxy_profile_id": "proxy-example-01",
            "allow_direct_fallback": False,
        }],
        "credential_bindings": [{
            "binding_id": "example-proxy-auth",
            "account_id": "example-account",
            "platform_id": "example",
            "host": "example.com",
            "purpose": "PROXY_AUTH",
            "scope": "AUTOMATION",
            "secret_ref": "vault://proxy/example/auth",
            "lease_ttl_seconds": 300,
        }],
        "defaults": {
            "on_no_match": "BLOCK",
            "on_route_failure": "BLOCK",
            "allow_direct_fallback": False,
            "max_failover_attempts": 0,
        },
    }


class FakeSession:
    def __init__(self, *args, proxy_settings=None, **kwargs):
        self.proxy_settings = dict(proxy_settings) if proxy_settings else None
        self.authenticated = False
        self.last_status = "NOT_STARTED"

    async def start(self):
        self.authenticated = True
        self.last_status = "AUTHENTICATED_IN_MEMORY"
        return {"status": self.last_status}

    async def close(self):
        self.authenticated = False


class ProxyRuntimeContractTests(unittest.TestCase):
    def test_proxy_remains_disabled_when_no_runtime_config_is_supplied(self):
        self.assertIsNone(ProxyRuntime.from_env(environ={}))

    def test_worker_profile_resolves_only_its_exact_automation_proxy_binding(self):
        with tempfile.TemporaryDirectory() as temp:
            config_path = Path(temp) / "network-access.json"
            config_path.write_text(json.dumps(proxy_config()), encoding="utf-8")
            env = {
                "MIDAD_NETWORK_ACCESS_CONFIG": str(config_path),
                "MIDAD_VAULT_BINDINGS_JSON": json.dumps({
                    "vault://proxy/example/auth": "MIDAD_PROXY_EXAMPLE_AUTH",
                }),
                "MIDAD_PROXY_EXAMPLE_AUTH": json.dumps({
                    "username": "proxy-user",
                    "password": "test-only-proxy-password",
                }),
            }
            runtime = ProxyRuntime.from_env(environ=env)
            settings = runtime.resolve_for_profile(PROFILE)

        self.assertEqual(settings["server"], "https://proxy.example.net:8443")
        self.assertEqual(settings["username"], "proxy-user")
        self.assertEqual(settings["password"], "test-only-proxy-password")

    def test_proxy_runtime_blocks_profile_without_exact_secret_binding(self):
        config = proxy_config()
        config["credential_bindings"] = []
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "network-access.json"
            path.write_text(json.dumps(config), encoding="utf-8")
            runtime = ProxyRuntime.from_env(environ={
                "MIDAD_NETWORK_ACCESS_CONFIG": str(path),
                "MIDAD_VAULT_BINDINGS_JSON": "{}",
            })
        with self.assertRaisesRegex(ProxyPolicyError, "VAULT_BINDING_SCOPE_MISMATCH"):
            runtime.resolve_for_profile(PROFILE)


class PersistentSessionProxyIntegrationTests(unittest.IsolatedAsyncioTestCase):
    async def test_pool_pins_proxy_settings_to_the_created_owner_session(self):
        settings = {
            "server": "https://proxy.example.net:8443",
            "username": "proxy-user",
            "password": "test-only-proxy-password",
        }
        resolver_calls = []

        def resolve(profile):
            resolver_calls.append(profile["account_id"])
            return dict(settings)

        with patch("persistent_session.PlatformBrowserSession", FakeSession):
            pool = PersistentSessionPool(
                {"example.com"},
                secret_provider_factory=lambda _profile: object(),
                session_store=object(),
                owner_id=OWNER,
                proxy_settings_resolver=resolve,
            )
            first = await pool.ensure(PROFILE)
            second = await pool.ensure(PROFILE)

        self.assertIs(first, second)
        self.assertEqual(first.proxy_settings, settings)
        self.assertEqual(resolver_calls, ["example-account"])

    async def test_missing_proxy_resolver_preserves_existing_direct_session_path(self):
        with patch("persistent_session.PlatformBrowserSession", FakeSession):
            pool = PersistentSessionPool(
                {"example.com"},
                secret_provider_factory=lambda _profile: object(),
                session_store=object(),
                owner_id=OWNER,
            )
            session = await pool.ensure(PROFILE)
        self.assertIsNone(session.proxy_settings)


if __name__ == "__main__":
    unittest.main()
