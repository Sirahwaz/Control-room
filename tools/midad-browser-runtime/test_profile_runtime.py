import asyncio
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from profile_runtime import open_profile_session, setup_login
from profile_vault import ProfileStore


class FakeLocator:
    async def inner_text(self, *, timeout):
        return "Task market public content"


class FakePage:
    def __init__(self):
        self.url = "about:blank"
        self.default_timeout = None
        self.goto_calls = []
        self.locator_calls = []

    def set_default_navigation_timeout(self, timeout):
        self.default_timeout = timeout

    async def goto(self, url, *, wait_until, timeout):
        self.goto_calls.append((url, wait_until, timeout))
        self.url = url

    async def title(self):
        return "Task Market"

    def locator(self, selector):
        self.locator_calls.append(selector)
        return FakeLocator()


class FakeContext:
    def __init__(self):
        self.pages = [FakePage()]
        self.route_pattern = None
        self.route_handler = None
        self.default_timeout = None
        self.closed = False

    async def route(self, pattern, handler):
        self.route_pattern = pattern
        self.route_handler = handler

    def set_default_navigation_timeout(self, timeout):
        self.default_timeout = timeout

    async def close(self):
        self.closed = True


class FakeChromium:
    def __init__(self, context):
        self.context = context
        self.launch_kwargs = None

    async def launch_persistent_context(self, **kwargs):
        self.launch_kwargs = kwargs
        return self.context


class FakePlaywright:
    def __init__(self, context):
        self.chromium = FakeChromium(context)


class FakePlaywrightManager:
    def __init__(self, playwright):
        self.playwright = playwright
        self.stopped = False

    async def start(self):
        return self.playwright

    async def stop(self):
        self.stopped = True


class FakeRequest:
    def __init__(self, url, method="GET"):
        self.url = url
        self.method = method


class FakeRoute:
    def __init__(self, url, method="GET"):
        self.request = FakeRequest(url, method)
        self.action = None

    async def abort(self, reason):
        self.action = ("abort", reason)

    async def continue_(self):
        self.action = ("continue", None)


class PersistentProfileRuntimeTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "profiles"
        self.store = ProfileStore(self.root)
        self.store.create_pending(
            "taskmarket",
            "https://taskmarket.dev/login",
            {"taskmarket.dev"},
        )
        self.store.confirm_setup("taskmarket", "https://taskmarket.dev/account")

        self.context = FakeContext()
        self.playwright = FakePlaywright(self.context)
        self.manager = FakePlaywrightManager(self.playwright)

    async def test_open_profile_uses_existing_persistent_directory_and_read_only_facade(self):
        with patch("profile_runtime.validate_navigation_url", return_value="https://taskmarket.dev/account"):
            async with open_profile_session(
                self.store,
                "taskmarket",
                "https://taskmarket.dev/account",
                playwright_factory=lambda: self.manager,
            ) as session:
                self.assertEqual(session.profile_id, "taskmarket")
                self.assertEqual(session.mode, "agent_read_only")
                self.assertEqual(
                    self.playwright.chromium.launch_kwargs["user_data_dir"],
                    str(self.root / "taskmarket" / "chromium"),
                )
                self.assertTrue(self.playwright.chromium.launch_kwargs["headless"])
                self.assertFalse(self.playwright.chromium.launch_kwargs["accept_downloads"])
                self.assertEqual(self.context.route_pattern, "**/*")
                snapshot = await session.navigate(
                    "https://taskmarket.dev/tasks?token=not-for-display#fragment"
                )
                self.assertEqual(snapshot["text"], "Task market public content")
                self.assertEqual(snapshot["url"], "https://taskmarket.dev/")
                self.assertNotIn("not-for-display", str(snapshot))
                self.assertNotIn("token=", str(snapshot))

                allowed = FakeRoute("https://taskmarket.dev/assets.js", "GET")
                await self.context.route_handler(allowed)
                self.assertEqual(allowed.action, ("continue", None))

                mutation = FakeRoute("https://taskmarket.dev/claim", "POST")
                await self.context.route_handler(mutation)
                self.assertEqual(mutation.action[0], "abort")

                cross_host = FakeRoute("https://attacker.example/collect", "GET")
                await self.context.route_handler(cross_host)
                self.assertEqual(cross_host.action[0], "abort")

        self.assertTrue(self.context.closed)
        self.assertTrue(self.manager.stopped)

    async def test_setup_login_is_attended_and_marks_profile_only_after_confirmation(self):
        self.context.pages[0].url = "about:blank"
        prompt_messages = []

        def manual_confirmation(message):
            prompt_messages.append(message)
            return ""

        with patch("profile_runtime.validate_navigation_url", return_value="https://taskmarket.dev/login"):
            record = await setup_login(
                self.store,
                "new-profile",
                "https://taskmarket.dev/login?temporary=not-persisted",
                {"taskmarket.dev"},
                prompt=manual_confirmation,
                playwright_factory=lambda: self.manager,
            )

        self.assertEqual(record.status, "ready_user_confirmed")
        self.assertTrue(prompt_messages)
        self.assertIn("Finish signing in", prompt_messages[0])
        self.assertFalse(self.playwright.chromium.launch_kwargs["headless"])
        self.assertFalse(self.playwright.chromium.launch_kwargs["accept_downloads"])
        self.assertTrue(self.context.closed)
        self.assertTrue(self.manager.stopped)
        registry_text = (self.root / "registry.json").read_text(encoding="utf-8")
        self.assertNotIn("temporary=not-persisted", registry_text)


if __name__ == "__main__":
    unittest.main(verbosity=2)
