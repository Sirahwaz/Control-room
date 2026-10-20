import unittest
from email.message import Message
from unittest.mock import patch
from urllib.request import Request

from agent import (
    _SafeRedirectHandler,
    extract_visible_text,
    require_read_only_method,
    validate_target,
)


class PublicUrlValidationTests(unittest.TestCase):
    @patch("agent.resolve_public_host", return_value=["93.184.216.34"])
    def test_accepts_public_https_url(self, _resolve):
        target = validate_target("https://example.com/research?q=1")
        self.assertEqual(target["url"], "https://example.com/research?q=1")
        self.assertEqual(target["hostname"], "example.com")

    def test_rejects_plain_http(self):
        with self.assertRaises(ValueError):
            validate_target("http://example.com")

    def test_rejects_embedded_credentials(self):
        with self.assertRaises(ValueError):
            validate_target("https://user:secret@example.com")

    def test_rejects_local_hostname_without_network_access(self):
        with self.assertRaises(ValueError):
            validate_target("https://localhost/admin")

    def test_rejects_loopback_ip_without_network_access(self):
        with self.assertRaises(ValueError):
            validate_target("https://127.0.0.1/admin")

    @patch("agent.resolve_public_host", side_effect=ValueError("non-public address"))
    def test_rejects_private_dns_resolution(self, _resolve):
        with self.assertRaises(ValueError):
            validate_target("https://example.com")

    @patch("agent.resolve_public_host", return_value=["93.184.216.34"])
    def test_rejects_hostname_outside_allowlist(self, _resolve):
        with self.assertRaises(ValueError):
            validate_target("https://other.example/path", allowed_hosts={"example.com"})

    def test_extracts_visible_text_and_omits_script_and_style(self):
        document = """
        <html><head><style>.secret { display:none }</style>
        <script>credential = 'never collect';</script></head>
        <body><h1>Official bounty</h1><p>Payment terms</p></body></html>
        """
        text = extract_visible_text(document)
        self.assertIn("Official bounty", text)
        self.assertIn("Payment terms", text)
        self.assertNotIn("credential", text)
        self.assertNotIn("secret", text)

    def test_empty_page_is_valid_evidence(self):
        self.assertEqual(extract_visible_text("<html><body></body></html>"), "")

    def test_allows_only_read_only_http_methods(self):
        self.assertEqual(require_read_only_method("GET"), "GET")
        self.assertEqual(require_read_only_method("head"), "HEAD")
        for method in ("POST", "PUT", "PATCH", "DELETE", "OPTIONS", "CONNECT", ""):
            with self.subTest(method=method):
                with self.assertRaises(ValueError):
                    require_read_only_method(method)

    def test_redirect_refuses_unallowlisted_host_before_following(self):
        handler = _SafeRedirectHandler({"example.com"})
        request = Request("https://example.com/start", method="GET")
        with self.assertRaisesRegex(ValueError, "out-of-allowlist"):
            handler.redirect_request(
                request, None, 302, "Found", Message(),
                "https://attacker.example/collect",
            )

    @patch("agent.resolve_public_host", side_effect=ValueError("non-public address"))
    def test_redirect_refuses_private_destination_before_following(self, _resolve):
        handler = _SafeRedirectHandler({"example.com"})
        request = Request("https://example.com/start", method="GET")
        with self.assertRaisesRegex(ValueError, "non-public address"):
            handler.redirect_request(
                request, None, 302, "Found", Message(),
                "https://example.com/private-hop",
            )


if __name__ == "__main__":
    unittest.main()
