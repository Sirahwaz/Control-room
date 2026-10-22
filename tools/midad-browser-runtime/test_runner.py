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
        runner._open_browser = AsyncMock(return_value=(AsyncMock(), fake_browser, fake_context, fake_page))
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
        runner._open_browser = AsyncMock(return_value=(AsyncMock(), fake_browser, fake_context, fake_page))
        runner._navigate_and_capture = AsyncMock(return_value={
            "url": "https://example.com/", "title": "Example", "text": "public evidence", "http_status": 200,
        })
        result = await runner.run({"id": "job-3", "current_url": "https://example.com/"}, asyncio.Event())
        self.assertEqual(result["status"], "CAPTURED")
        self.assertRegex(result["content_sha256"], r"^[a-f0-9]{64}$")
        self.assertNotIn("public evidence", str(result))
        runner.gateway.record_event.assert_awaited()
        event_payload = runner.gateway.record_event.await_args.kwargs
        self.assertEqual(event_payload["content_sha256"], result["content_sha256"])
        self.assertIn("duration_ms", event_payload["evidence"])
        self.assertIn("bytes_read", event_payload["evidence"])
        self.assertNotIn("title", event_payload["evidence"])
        fake_context.close.assert_awaited()
        fake_browser.close.assert_awaited()


    async def test_cancel_event_interrupts_hanging_navigation_and_cleans_up(self):
        runner = self.make_runner(overall_timeout_seconds=1)
        runner.gateway.record_event.return_value = {"ok": True}
        fake_page = AsyncMock()
        fake_page.url = "https://example.com/"
        fake_context = AsyncMock()
        fake_context.pages = [fake_page]
        fake_browser = AsyncMock()
        fake_browser.new_context.return_value = fake_context
        runner._open_browser = AsyncMock(return_value=(AsyncMock(), fake_browser, fake_context, fake_page))
        async def hang(*_args, **_kwargs):
            await asyncio.sleep(5)
        runner._navigate_and_capture = AsyncMock(side_effect=hang)
        cancel = asyncio.Event()
        async def trigger_cancel():
            await asyncio.sleep(0.02)
            cancel.set()
        asyncio.create_task(trigger_cancel())
        with self.assertRaises(asyncio.CancelledError):
            await runner.run({"id": "job-cancel", "current_url": "https://example.com/"}, cancel)
        fake_context.close.assert_awaited()
        fake_browser.close.assert_awaited()
        runner.gateway.record_event.assert_awaited()

if __name__ == "__main__":
    unittest.main()


class BrowserWorkerLifecycleContractTests(unittest.IsolatedAsyncioTestCase):
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

    async def test_human_gate_job_is_deferred_without_opening_browser(self):
        runner = self.make_runner()
        runner._open_browser = AsyncMock(side_effect=AssertionError("must not open browser"))
        result = await runner.run({
            "id": "job-human-gate",
            "state": "HUMAN_GATE",
            "current_url": "https://example.com/",
        })
        self.assertEqual(result["status"], "DEFERRED")
        self.assertEqual(result["reason"], "HUMAN_GATE")
        runner._open_browser.assert_not_awaited()
        runner.gateway.record_event.assert_not_awaited()

    async def test_paid_terminal_job_is_skipped_without_claiming_paid_or_opening_browser(self):
        runner = self.make_runner()
        runner._open_browser = AsyncMock(side_effect=AssertionError("must not open browser"))
        result = await runner.run({
            "id": "job-already-paid",
            "state": "PAID",
            "current_url": "https://example.com/",
        })
        self.assertEqual(result["status"], "SKIPPED")
        self.assertEqual(result["reason"], "TERMINAL_JOB_STATE")
        self.assertNotEqual(result["status"], "PAID")
        runner._open_browser.assert_not_awaited()
        runner.gateway.record_event.assert_not_awaited()

    async def test_running_transition_is_recorded_before_navigation(self):
        runner = self.make_runner()
        runner.gateway.record_event.return_value = {"ok": True}
        fake_page = AsyncMock()
        fake_page.url = "https://example.com/"
        fake_page.title.return_value = "Example"
        fake_page.locator.return_value.inner_text.return_value = "public evidence"
        fake_context = AsyncMock()
        fake_context.pages = [fake_page]
        fake_browser = AsyncMock()
        fake_browser.new_context.return_value = fake_context
        runner._open_browser = AsyncMock(return_value=(AsyncMock(), fake_browser, fake_context, fake_page))
        runner._navigate_and_capture = AsyncMock(return_value={
            "url": "https://example.com/", "title": "Example", "text": "public evidence", "http_status": 200,
        })
        await runner.run({"id": "job-running", "state": "PREPARING", "current_url": "https://example.com/"})
        calls = runner.gateway.record_event.await_args_list
        self.assertGreaterEqual(len(calls), 2)
        self.assertEqual(calls[0].kwargs["event_type"], "state_transition")
        self.assertEqual(calls[0].kwargs["state"], "RUNNING")
        self.assertEqual(calls[1].kwargs["event_type"], "navigation_observed")

    async def test_transient_navigation_failure_retries_and_captures_on_second_attempt(self):
        runner = self.make_runner()
        runner.gateway.record_event.return_value = {"ok": True}
        fake_page = AsyncMock()
        fake_page.url = "https://example.com/"
        fake_context = AsyncMock()
        fake_context.pages = [fake_page]
        fake_browser = AsyncMock()
        fake_browser.new_context.return_value = fake_context
        runner._open_browser = AsyncMock(return_value=(AsyncMock(), fake_browser, fake_context, fake_page))
        runner._navigate_and_capture = AsyncMock(side_effect=[
            RuntimeError("transient navigation failure"),
            {"url": "https://example.com/", "title": "Example", "text": "public evidence", "http_status": 200},
        ])
        result = await runner.run({"id": "job-retry", "state": "PREPARING", "current_url": "https://example.com/"})
        self.assertEqual(result["status"], "CAPTURED")
        self.assertEqual(runner._navigate_and_capture.await_count, 2)
        navigation_calls = [call.kwargs for call in runner.gateway.record_event.await_args_list
                            if call.kwargs.get("event_type") == "navigation_observed"]
        self.assertEqual(navigation_calls[-1]["attempt_count"], 1)

    async def test_cancelled_job_records_cancelled_state_not_failed_or_paid(self):
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
            await runner.run({"id": "job-cancel-state", "state": "RUNNING", "current_url": "https://example.com/"})
        payloads = [call.kwargs for call in runner.gateway.record_event.await_args_list]
        self.assertTrue(any(p.get("event_type") == "job_cancelled" and p.get("state") == "CANCELLED" for p in payloads))
        self.assertFalse(any(p.get("state") == "PAID" for p in payloads))


class BrowserWorkerRetryLimitTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.dns = patch("runner.socket.getaddrinfo", return_value=[(2, 1, 6, "", ("93.184.216.34", 443))])
        self.dns.start()
        self.addCleanup(self.dns.stop)

    async def test_transient_failure_retries_are_bounded_and_never_claim_paid(self):
        config = BrowserConfig(
            supabase_url="https://project.supabase.co",
            ingest_key="test-key-not-real",
            allowed_hosts=frozenset({"example.com"}),
            navigation_timeout_ms=250,
            overall_timeout_seconds=1,
            max_attempts=99,
        )
        runner = BrowserJobRunner(config, gateway=AsyncMock(), playwright_factory=AsyncMock())
        runner.gateway.record_event.return_value = {"ok": True}
        fake_page = AsyncMock()
        fake_page.url = "https://example.com/"
        fake_context = AsyncMock()
        fake_context.pages = [fake_page]
        fake_browser = AsyncMock()
        fake_browser.new_context.return_value = fake_context
        runner._open_browser = AsyncMock(return_value=(AsyncMock(), fake_browser, fake_context, fake_page))
        runner._navigate_and_capture = AsyncMock(side_effect=RuntimeError("transient"))
        result = await runner.run({"id": "job-retry-limit", "state": "PREPARING", "current_url": "https://example.com/"})
        self.assertEqual(result["status"], "FAILED")
        self.assertEqual(runner._navigate_and_capture.await_count, 3)
        self.assertFalse(any(call.kwargs.get("state") == "PAID"
                             for call in runner.gateway.record_event.await_args_list))
