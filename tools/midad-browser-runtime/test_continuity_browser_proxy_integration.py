"""Proxy integration contract for the Cloudflare-backed Browser Worker v2.

These tests keep the proxy optional and scoped to the existing worker/session path.
"""
import asyncio
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from persistent_session import BrowserSessionError, PersistentSessionPool, PlatformBrowserSession
from proxy_policy import ProxyLeaseBinding, ProxyPolicyError, ProxyRuntime


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

    def configure_proxy(self, settings, release_callback=None, lease_lost_event=None):
        self.proxy_settings = dict(settings) if settings else None
        self.release_callback = release_callback
        self.lease_lost_event = lease_lost_event

    async def close(self):
        self.authenticated = False
        if self.release_callback is not None:
            await self.release_callback()
            self.release_callback = None


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


class FakeCentralVaultClient:
    def __init__(self):
        self.issued = []
        self.renewed = []
        self.released = []
        self.next_token = "renewed-central-vault-token-000000000000000000"

    async def issue_vault_lease(self, **kwargs):
        self.issued.append(dict(kwargs))
        return {
            "ok": True,
            "lease": {
                "lease_id": "a" * 32,
                "lease_token": "initial-central-vault-token-000000000000000",
                "expires_at": "2026-11-10T03:10:00Z",
                "secret": {
                    "username": "central-proxy-user",
                    "password": "central-proxy-password",
                },
            },
        }

    async def renew_vault_lease(self, **kwargs):
        self.renewed.append(dict(kwargs))
        return {
            "ok": True,
            "lease": {
                "lease_id": kwargs["lease_id"],
                "lease_token": self.next_token,
                "expires_at": "2026-11-10T03:15:00Z",
            },
        }

    async def release_vault_lease(self, lease_id, lease_token):
        self.released.append((lease_id, lease_token))
        return {"ok": True, "state": "RELEASED"}


class CentralVaultProxyRuntimeTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addAsyncCleanup(self._cleanup)
        self.config_path = Path(self.temp.name) / "network-access.json"
        self.config_path.write_text(json.dumps(proxy_config()), encoding="utf-8")
        self.client = FakeCentralVaultClient()
        self.runtime = ProxyRuntime.from_env(
            environ={
                "MIDAD_NETWORK_ACCESS_CONFIG": str(self.config_path),
                "MIDAD_VAULT_MODE": "central",
            },
            vault_client=self.client,
            renew_interval_seconds=0.01,
        )
        self.runtime.set_task_context({
            "task_id": "browser-task-01",
            "lease_token": "b" * 64,
            "credential_binding_ids": ["example-proxy-auth"],
        })

    async def _cleanup(self):
        await self.runtime.end_task()
        self.temp.cleanup()

    async def test_central_vault_issues_only_declared_binding_and_returns_browser_context_settings(self):
        binding = await self.runtime.resolve_for_profile(PROFILE)
        self.assertIsInstance(binding, ProxyLeaseBinding)
        self.assertEqual(binding.settings["server"], "https://proxy.example.net:8443")
        self.assertEqual(binding.settings["username"], "central-proxy-user")
        self.assertEqual(binding.settings["password"], "central-proxy-password")
        self.assertEqual(len(self.client.issued), 1)
        request = self.client.issued[0]
        self.assertEqual(request["task_id"], "browser-task-01")
        self.assertEqual(request["task_lease_token"], "b" * 64)
        self.assertEqual(request["binding_id"], "example-proxy-auth")
        self.assertEqual(request["host"], "example.com")
        self.assertEqual(request["purpose"], "PROXY_AUTH")
        self.assertEqual(request["scope"], "AUTOMATION")
        self.assertNotIn("secret", request)

    async def test_central_vault_lease_is_renewed_and_release_uses_latest_token(self):
        binding = await self.runtime.resolve_for_profile(PROFILE)
        await asyncio.sleep(0.035)
        self.assertGreaterEqual(len(self.client.renewed), 1)
        self.assertEqual(self.client.renewed[0]["task_id"], "browser-task-01")
        await binding.release()
        self.assertEqual(len(self.client.released), 1)
        self.assertEqual(self.client.released[0][0], "a" * 32)
        self.assertEqual(self.client.released[0][1], self.client.next_token)

    async def test_central_vault_never_falls_back_when_task_does_not_declare_proxy_binding(self):
        await self.runtime.end_task()
        self.runtime.set_task_context({
            "task_id": "browser-task-02",
            "lease_token": "c" * 64,
            "credential_binding_ids": [],
        })
        with self.assertRaisesRegex(ProxyPolicyError, "VAULT_BINDING_NOT_AUTHORIZED_FOR_TASK"):
            await self.runtime.resolve_for_profile(PROFILE)
        self.assertEqual(self.client.issued, [])

    async def test_central_vault_mode_requires_a_real_vault_client(self):
        with self.assertRaisesRegex(ProxyPolicyError, "VAULT_CLIENT_REQUIRED"):
            ProxyRuntime.from_env(
                environ={
                    "MIDAD_NETWORK_ACCESS_CONFIG": str(self.config_path),
                    "MIDAD_VAULT_MODE": "central",
                },
                vault_client=None,
            )


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
