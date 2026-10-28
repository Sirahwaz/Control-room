"""Offline policy tests for persistent platform sessions."""
import unittest
from unittest.mock import patch

from persistent_session import (
    BrowserSessionError, PlatformBrowserSession, _safe_preview,
)

class FakeFrame:
    parent_frame = None

class FakeRequest:
    def __init__(self, url, method="GET", content_type="application/x-www-form-urlencoded"):
        self.url = url
        self.method = method
        self.headers = {"content-type": content_type}
        self.frame = FakeFrame()
    def is_navigation_request(self):
        return True

class FakeRoute:
    def __init__(self, request):
        self.request = request
        self.continued = False
        self.aborted = False
    async def continue_(self):
        self.continued = True
    async def abort(self, *_args):
        self.aborted = True

class PersistentSessionPolicyTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.dns = patch("runner.socket.getaddrinfo", return_value=[(2, 1, 6, "", ("93.184.216.34", 443))])
        self.dns.start()
        self.addCleanup(self.dns.stop)
        self.profile = {
            "account_id": "example-account",
            "platform_key": "example",
            "host": "example.com",
            "username": "operator@example.invalid",
            "password_secret_ref": "MIDAD_EXAMPLE_PASSWORD",
            "login_url": "https://example.com/login",
            "username_selector": "input[name='username']",
            "password_selector": "input[name='password']",
            "submit_selector": "button[type='submit']",
            "success_selector": "[data-testid='account-home']",
            "login_post_paths": ["/login"],
        }
        self.session = PlatformBrowserSession(self.profile, {"example.com"}, secret_provider=object())

    async def test_login_post_allowed_once_only_on_declared_main_frame_path(self):
        self.session._login_submit_active = True
        first = FakeRoute(FakeRequest("https://example.com/login", "POST"))
        await self.session._guard_route(first)
        self.assertTrue(first.continued)
        self.assertTrue(self.session._login_post_used)
        second = FakeRoute(FakeRequest("https://example.com/login", "POST"))
        await self.session._guard_route(second)
        self.assertTrue(second.aborted)

    async def test_unlisted_post_path_is_blocked_during_login(self):
        self.session._login_submit_active = True
        route = FakeRoute(FakeRequest("https://example.com/admin/delete", "POST"))
        await self.session._guard_route(route)
        self.assertTrue(route.aborted)

    async def test_post_after_login_window_is_blocked(self):
        route = FakeRoute(FakeRequest("https://example.com/login", "POST"))
        await self.session._guard_route(route)
        self.assertTrue(route.aborted)

    async def test_non_allowlisted_host_is_blocked(self):
        route = FakeRoute(FakeRequest("https://evil.example/pixel", "GET", "image/png"))
        await self.session._guard_route(route)
        self.assertTrue(route.aborted)

    async def test_get_to_allowlisted_host_is_allowed(self):
        route = FakeRoute(FakeRequest("https://example.com/dashboard", "GET", "text/html"))
        await self.session._guard_route(route)
        self.assertTrue(route.continued)

    async def test_profile_without_explicit_login_post_paths_is_rejected(self):
        bad = dict(self.profile)
        bad.pop("login_post_paths")
        with self.assertRaisesRegex(BrowserSessionError, "EXPLICIT_LOGIN_POST_PATHS_REQUIRED"):
            PlatformBrowserSession(bad, {"example.com"}, secret_provider=object())

    def test_preview_redacts_common_secret_patterns(self):
        text = "access_token=abcXYZ1234567890 Bearer abcdefghijklmnopqrstuvwxyz password=hunter2"
        preview = _safe_preview(text)
        self.assertNotIn("abcXYZ1234567890", preview)
        self.assertNotIn("abcdefghijklmnopqrstuvwxyz", preview)
        self.assertNotIn("hunter2", preview)

if __name__ == "__main__":
    unittest.main()
