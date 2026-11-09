"""Integration contract for encrypted Playwright session lifecycle."""
import base64
import os
import tempfile
import unittest
from pathlib import Path

from encrypted_session_store import EncryptedSessionStore
from persistent_session import BrowserSessionError, PlatformBrowserSession


class FakeLocator:
    def __init__(self, page, selector):
        self.page = page
        self.selector = selector

    async def count(self):
        return 0

    async def is_visible(self):
        return self.selector == self.page.success_selector

    async def inner_text(self, timeout=None):
        return "Account dashboard"

    async def get_attribute(self, name):
        return None


class FakePage:
    def __init__(self, success_selector):
        self.url = "about:blank"
        self.success_selector = success_selector
        self.timeout = None

    def set_default_navigation_timeout(self, value):
        self.timeout = value

    async def route(self, pattern, handler):
        self.route_handler = handler

    async def goto(self, url, wait_until=None, timeout=None):
        self.url = "https://example.com/dashboard"

    def locator(self, selector):
        return FakeLocator(self, selector)

    async def title(self):
        return "Example Dashboard"


class FakeContext:
    def __init__(self, state=None):
        self.loaded_state = state
        self.saved_state = state or {"cookies": [], "origins": []}
        self.page = None
        self.closed = False

    async def new_page(self):
        return self.page

    async def storage_state(self):
        return self.saved_state

    async def close(self):
        self.closed = True


class FakeBrowser:
    def __init__(self, success_selector):
        self.success_selector = success_selector
        self.context_options = None
        self.context = None
        self.closed = False

    async def new_context(self, **options):
        self.context_options = options
        self.context = FakeContext(options.get("storage_state"))
        self.context.page = FakePage(self.success_selector)
        return self.context

    async def close(self):
        self.closed = True


class FakeChromium:
    def __init__(self, browser):
        self.browser = browser

    async def launch(self, **options):
        return self.browser


class FakePlaywright:
    def __init__(self, browser):
        self.chromium = FakeChromium(browser)
        self.stopped = False

    async def stop(self):
        self.stopped = True


class FakeManager:
    def __init__(self, browser):
        self.playwright = FakePlaywright(browser)

    async def start(self):
        return self.playwright


class EncryptedSessionIntegrationTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "session-store"
        self.owner = "00000000-0000-4000-8000-000000000001"
        self.account = "example-account"
        self.host = "example.com"
        self.success_selector = "[data-testid='account-home']"
        self.store = EncryptedSessionStore(
            self.root, base64.b64encode(bytes(range(32))).decode("ascii"), key_id="test-v1"
        )
        self.profile = {
            "account_id": self.account,
            "platform_key": "example",
            "host": self.host,
            "username": "operator@example.invalid",
            "password_secret_ref": "MIDAD_EXAMPLE_PASSWORD",
            "login_url": "https://example.com/login",
            "username_selector": "input[name='username']",
            "password_selector": "input[name='password']",
            "submit_selector": "button[type='submit']",
            "success_selector": self.success_selector,
            "login_post_paths": ["/login"],
        }
        self.allowed_hosts = {self.host}
        self.state = {
            "cookies": [{
                "name": "session_id", "value": "FAKE_PRIVATE_SESSION_COOKIE",
                "domain": ".example.com", "path": "/", "expires": 2000000000,
                "httpOnly": True, "secure": True, "sameSite": "Lax",
            }],
            "origins": [],
        }

    def session(self):
        browser = FakeBrowser(self.success_selector)
        session = PlatformBrowserSession(
            self.profile, self.allowed_hosts, secret_provider=object(),
            playwright_factory=lambda: FakeManager(browser),
            session_store=self.store, owner_id=self.owner,
        )
        return session, browser

    async def test_start_resumes_a_valid_encrypted_session_without_plaintext_login(self):
        self.store.save(self.owner, self.account, self.host, self.state)
        session, browser = self.session()
        result = await session.start()
        self.assertTrue(session.authenticated)
        self.assertEqual(result["session_storage"], "encrypted_at_rest")
        self.assertEqual(result["status"], "AUTHENTICATED_ENCRYPTED_AT_REST")
        self.assertEqual(browser.context_options["storage_state"], self.state)
        self.assertEqual(self.store.load(self.owner, self.account, self.host), self.state)
        await session.close()

    async def test_tampered_saved_state_fails_closed_without_fresh_login(self):
        self.store.save(self.owner, self.account, self.host, self.state)
        path = self.store.path_for(self.owner, self.account, self.host)
        envelope = __import__("json").loads(path.read_text(encoding="ascii"))
        ciphertext = bytearray(base64.b64decode(envelope["ciphertext"]))
        ciphertext[len(ciphertext) // 2] ^= 1
        envelope["ciphertext"] = base64.b64encode(ciphertext).decode("ascii")
        path.write_text(__import__("json").dumps(envelope), encoding="ascii")
        os.chmod(path, 0o600)
        session, browser = self.session()
        with self.assertRaisesRegex(BrowserSessionError, "SESSION_STORE_AUTH_FAILED"):
            await session.start()
        self.assertIsNone(browser.context_options)
        self.assertFalse(session.authenticated)

    async def test_graceful_close_persists_authenticated_session(self):
        session, browser = self.session()
        session.context = FakeContext(self.state)
        session.browser = browser
        session.playwright = FakePlaywright(browser)
        session.authenticated = True
        await session.close()
        self.assertEqual(self.store.load(self.owner, self.account, self.host), self.state)
        self.assertTrue(browser.closed)

    async def test_explicit_stop_discards_saved_encrypted_session(self):
        self.store.save(self.owner, self.account, self.host, self.state)
        session, _ = self.session()
        await session.stop_and_discard()
        self.assertIsNone(self.store.load(self.owner, self.account, self.host))
        self.assertEqual(session.last_status, "STOPPED")


if __name__ == "__main__":
    unittest.main()
