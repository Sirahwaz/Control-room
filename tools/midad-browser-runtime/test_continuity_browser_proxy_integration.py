"""Proxy integration contract for the Cloudflare-backed Browser Worker v2.

These tests keep the proxy optional and scoped to the existing worker/session path.
"""
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from persistent_session import BrowserSessionError, PersistentSessionPool, PlatformBrowserSession
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
    def __init__(self, profile, *args, proxy_settings=None, **kwargs):
        self.profile = dict(profile)
        self.proxy_settings = dict(proxy_settings) if proxy_settings else None
        self.authenticated = False
        self.last_status = "NOT_STARTED"

    async def start(self):
        self.authenticated = True
        self.last_status = "AUTHENTICATED_IN_MEMORY"
        return {"status": self.last_status}

    def configure_proxy(self, settings):
        self.proxy_settings = dict(settings) if settings else None

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




class FakePage:
    def set_default_navigation_timeout(self, _timeout):
        pass

    async def route(self, *_args):
        pass


class FakeContext:
    async def new_page(self):
        return FakePage()

    async def close(self):
        pass


class FakeBrowser:
    def __init__(self):
        self.context_options = None

    async def new_context(self, **kwargs):
        self.context_options = dict(kwargs)
        return FakeContext()

    async def close(self):
        pass


class FakeChromium:
    def __init__(self):
        self.browser = FakeBrowser()

    async def launch(self, **_kwargs):
        return self.browser


class FakePlaywright:
    def __init__(self):
        self.chromium = FakeChromium()

    async def stop(self):
        pass


class FakePlaywrightManager:
    async def start(self):
        return FakePlaywright()


class PlaywrightContextProxyTests(unittest.IsolatedAsyncioTestCase):
    async def test_proxy_is_attached_to_browser_context_without_disabling_tls_validation(self):
        with patch("runner.socket.getaddrinfo", return_value=[
            (2, 1, 6, "", ("93.184.216.34", 443)),
        ]):
            session = PlatformBrowserSession(
                PROFILE,
                {"example.com"},
                secret_provider=object(),
                playwright_factory=FakePlaywrightManager,
            )
        session.configure_proxy({
            "server": "https://proxy.example.net:8443",
            "username": "proxy-user",
            "password": "test-only-proxy-password",
        })
        await session._open()

        options = session.browser.context_options
        self.assertEqual(options["proxy"]["server"], "https://proxy.example.net:8443")
        self.assertEqual(options["proxy"]["username"], "proxy-user")
        self.assertEqual(options["proxy"]["password"], "test-only-proxy-password")
        self.assertFalse(options["ignore_https_errors"])

        await session.close(persist=False)


class PlatformProxyValidationTests(unittest.TestCase):
    def test_session_rejects_proxy_credentials_embedded_in_server_url(self):
        with patch("runner.socket.getaddrinfo", return_value=[
            (2, 1, 6, "", ("93.184.216.34", 443)),
        ]):
            session = PlatformBrowserSession(
                PROFILE, {"example.com"}, secret_provider=object()
            )
        with self.assertRaisesRegex(BrowserSessionError, "PROXY_SETTINGS_INVALID"):
            session.configure_proxy({
                "server": "https://proxy-user:proxy-password@proxy.example.net:8443",
            })

    def test_session_accepts_separate_ephemeral_proxy_auth_fields(self):
        with patch("runner.socket.getaddrinfo", return_value=[
            (2, 1, 6, "", ("93.184.216.34", 443)),
        ]):
            session = PlatformBrowserSession(
                PROFILE, {"example.com"}, secret_provider=object()
            )
        session.configure_proxy({
            "server": "https://proxy.example.net:8443",
            "username": "proxy-user",
            "password": "test-only-proxy-password",
        })
        self.assertEqual(session.proxy_settings["server"], "https://proxy.example.net:8443")


class BrowserWorkerV2ProxyWiringTests(unittest.TestCase):
    def test_worker_v2_passes_the_proxy_resolver_to_its_existing_session_pool(self):
        from continuity_browser_worker_v2 import ContinuityBrowserWorker, ContinuityWorkerConfig

        class FakeRegistry:
            def list_profiles(self):
                return [dict(PROFILE)]

        class FakeRuntime:
            def resolve_for_profile(self, profile):
                return None

        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            registry_path = root / "accounts.json"
            registry_path.write_text("{}", encoding="utf-8")
            os.chmod(registry_path, 0o600)
            config = ContinuityWorkerConfig(
                ledger_url="https://ledger.example.workers.dev",
                node_id="browser-node-1",
                node_token="b" * 64,
                owner_id=OWNER,
                allowed_hosts=frozenset({"example.com"}),
                account_registry_path=registry_path,
                session_store_path=root / "sessions",
                session_store_key_b64="dGVzdA==",
                enrolled_capabilities=frozenset({
                    "interactive-browser-execution",
                    "persistent-browser-session",
                    "encrypted-session-store",
                }),
                cost_per_hour_usd=0.0,
                poll_seconds=3.0,
                heartbeat_seconds=15.0,
            )
            captured = {}
            fake_pool = object()

            def pool_factory(*args, **kwargs):
                captured.update(kwargs)
                return fake_pool

            with (
                patch.dict(os.environ, {"MIDAD_TEST_BROWSER_PASSWORD": "test-only-password"}),
                patch("continuity_browser_worker_v2.AccountRegistry", return_value=FakeRegistry()),
                patch("continuity_browser_worker_v2.EncryptedSessionStore", return_value=object()),
                patch("continuity_browser_worker_v2.PersistentSessionPool", side_effect=pool_factory),
            ):
                proxy_runtime = FakeRuntime()
                worker = ContinuityBrowserWorker(
                    config,
                    operator=object(),
                    proxy_runtime=proxy_runtime,
                )

        self.assertIs(worker.session_pool, fake_pool)
        resolver = captured.get("proxy_settings_resolver")
        self.assertIsNotNone(resolver)
        self.assertIs(resolver.__self__, proxy_runtime)
        self.assertIs(resolver.__func__, FakeRuntime.resolve_for_profile)


if __name__ == "__main__":
    unittest.main()
