"""Offline tests for public_target_probe; no browser or network is launched."""
import unittest
from unittest.mock import patch

from public_target_probe import BrowserPolicyError, validate_navigation_url
from public_target_probe import probe


class PublicTargetProbePolicyTests(unittest.TestCase):
    def setUp(self):
        self.dns = patch(
            "runner.socket.getaddrinfo",
            return_value=[(2, 1, 6, "", ("93.184.216.34", 443))],
        )
        self.dns.start()
        self.addCleanup(self.dns.stop)

    def test_exact_public_https_host_is_normalized(self):
        self.assertEqual(
            validate_navigation_url("https://example.com/path?q=1", {"example.com"}),
            "https://example.com/path?q=1",
        )

    def test_non_allowlisted_target_is_blocked(self):
        with self.assertRaises(BrowserPolicyError):
            validate_navigation_url("https://other.example/", {"example.com"})

    def test_http_target_is_blocked(self):
        with self.assertRaises(BrowserPolicyError):
            validate_navigation_url("http://example.com/", {"example.com"})

    def test_credentials_are_blocked(self):
        with self.assertRaises(BrowserPolicyError):
            validate_navigation_url("https://user:pass@example.com/", {"example.com"})

    def test_private_dns_answer_is_blocked(self):
        with patch("runner.socket.getaddrinfo", return_value=[
            (2, 1, 6, "", ("127.0.0.1", 443))
        ]):
            with self.assertRaises(BrowserPolicyError):
                validate_navigation_url("https://example.com/", {"example.com"})

    def test_timeout_range_is_bounded_before_browser_start(self):
        with self.assertRaisesRegex(ValueError, "between 1000 and 20000"):
            import asyncio
            asyncio.run(probe("https://example.com/", {"example.com"}, timeout_ms=999))


if __name__ == "__main__":
    unittest.main()
