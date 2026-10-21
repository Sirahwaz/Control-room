"""Contract tests for the isolated Playwright worker; no network or browser needed."""

import asyncio
import unittest
from unittest.mock import AsyncMock, patch

from runner import (
    BrowserConfig,
    BrowserJobRunner,
    BrowserPolicyError,
    validate_navigation_url,
)


class URLPolicyTests(unittest.TestCase):
    def setUp(self):
        self.dns = patch("runner.socket.getaddrinfo", return_value=[(2, 1, 6, "", ("93.184.216.34", 443))])
        self.dns.start()
        self.addCleanup(self.dns.stop)
    def test_allows_exact_allowlisted_https_host(self):
        self.assertEqual(
            validate_navigation_url("https://example.com/path", {"example.com"}),
            "https://example.com/path",
        )

    def test_rejects_http(self):
        with self.assertRaises(BrowserPolicyError):
            validate_navigation_url("http://example.com", {"example.com"})

    def test_rejects_host_suffix_attack(self):
        with self.assertRaises(BrowserPolicyError):
            validate_navigation_url("https://example.com.attacker.test/", {"example.com"})

    def test_rejects_wildcards_in_allowlist(self):
        with self.assertRaises(BrowserPolicyError):
            validate_navigation_url("https://example.com/", {"*.example.com"})

    def test_rejects_embedded_credentials(self):
        with self.assertRaises(BrowserPolicyError):
            validate_navigation_url("https://user:pass@example.com/", {"example.com"})

    def test_rejects_nonstandard_port(self):
        with self.assertRaises(BrowserPolicyError):
            validate_navigation_url("https://example.com:8443/", {"example.com"})


class RuntimeLifecycleTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.dns = patch("runner.socket.getaddrinfo", return_value=[(2, 1, 6, "", ("93.184.216.34", 443))])
        self.dns.start()
        self.addCleanup(self.dns.stop)
    def make_runner(self, **kwargs):
        config = BrowserConfig(
            supabase_url="https://project.supabase.co",
            ingest_key="test-key-not-real",
            allowed_hosts=frozenset({"example.com"}),
            navigation_timeout_ms=250,
            overall_timeout_seconds=kwargs.pop("overall_timeout_seconds", 1),
            **kwargs,
        )
        return BrowserJobRunner(config, gateway=AsyncMock(), playwright_factory=AsyncMock())

    async def test_redirect_to_non_allowlisted_host_is_aborted(self):
        runner = self.make_runner()
        decision = runner.request_decision("https://evil.example/steal")
        self.assertFalse(decision.allowed)
        self.assertEqual(decision.code, "HOST_NOT_ALLOWLISTED")

    async def test_https_redirect_to_allowlisted_host_is_allowed(self):
        runner = self.make_runner()
        decision = runner.request_decision("https://example.com/next")
        self.assertTrue(decision.allowed)

    async def test_cancelled_job_closes_browser_and_records_cancel(self):
        runner = self.make_runner()
        runner.gateway.record_event.return_value = {"ok": True}
        fake_page = AsyncMock()
        fake_page.url = "https://example.com/"
        fake_context = AsyncMock()
        fake_context.pages = [fake_page]
        fake_browser = AsyncMock()
        fake_browser.new_context.return_value = fake_context
        runner._open_browser = AsyncMock(return_value=(AsyncMock(), fake_browser, fake_context, fake_page))
        runner._navigate_and_capture = AsyncMock(side_effect=asyncio.CancelledError())
        with self.assertRaises(asyncio.CancelledError):
            await runner.run({"id": "job-1", "current_url": "https://example.com/"}, asyncio.Event())
        fake_context.close.assert_awaited()
        fake_browser.close.assert_awaited()
        runner.gateway.record_event.assert_awaited()

    async def test_timeout_is_bounded_and_recorded_as_error(self):
        runner = self.make_runner(overall_timeout_seconds=0.02)
        runner.gateway.record_event.return_value = {"ok": True}
        fake_page = AsyncMock()
        fake_page.url = "https://example.com/"
        fake_context = AsyncMock()
        fake_context.pages = [fake_page]
        fake_browser = AsyncMock()
        fake_browser.new_context.return_value = fake_context
        runner._open_browser = AsyncMock(return_value=(fake_browser, fake_context, fake_page))
        async def hang(*_args, **_kwargs):
            await asyncio.sleep(1)
        runner._navigate_and_capture = AsyncMock(side_effect=hang)
        result = await runner.run({"id": "job-2", "current_url": "https://example.com/"}, asyncio.Event())
        self.assertEqual(result["status"], "TIMEOUT")
        fake_context.close.assert_awaited()
        fake_browser.close.assert_awaited()
        runner.gateway.record_event.assert_awaited()

    async def test_success_records_content_hash_without_page_secrets(self):
        runner = self.make_runner()
        runner.gateway.record_event.return_value = {"ok": True}
        fake_page = AsyncMock()
        fake_page.url = "https://example.com/"
        fake_page.title.return_value = "Example"
        fake_page.locator.return_value.inner_text.return_value = "public evidence"
        fake_page.screenshot.return_value = None
        fake_context = AsyncMock()
        fake_context.pages = [fake_page]
        fake_browser = AsyncMock()
        fake_browser.new_context.return_value = fake_context
        runner._open_browser = AsyncMock(return_value=(fake_browser, fake_context, fake_page))
        runner._navigate_and_capture = AsyncMock(return_value={
            "url": "https://example.com/", "title": "Example", "text": "public evidence", "http_status": 200,
        })
        result = await runner.run({"id": "job-3", "current_url": "https://example.com/"}, asyncio.Event())
        self.assertEqual(result["status"], "CAPTURED")
        self.assertRegex(result["content_sha256"], r"^[a-f0-9]{64}$")
        self.assertNotIn("public evidence", str(result))
        runner.gateway.record_event.assert_awaited()
        fake_context.close.assert_awaited()
        fake_browser.close.assert_awaited()


if __name__ == "__main__":
    unittest.main()
