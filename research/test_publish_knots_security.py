import unittest

from publish_knots import (
    IMAGE_URL,
    is_allowed_devto_request,
    is_allowed_public_image_url,
    _NoExternalRedirect,
)
import urllib.error
import urllib.request


class DevtoEndpointPolicyTests(unittest.TestCase):
    def test_allows_only_the_existing_published_articles_read_route(self):
        self.assertTrue(
            is_allowed_devto_request(
                "https://dev.to/api/articles/me/published?per_page=100",
                "GET",
            )
        )

    def test_allows_only_the_existing_article_creation_route(self):
        self.assertTrue(
            is_allowed_devto_request(
                "https://dev.to/api/articles",
                "POST",
            )
        )

    def test_rejects_other_hosts_and_plain_http(self):
        for url in (
            "http://dev.to/api/articles",
            "https://evil.example/api/articles",
            "https://dev.to.evil.example/api/articles",
            "https://user@dev.to/api/articles",
        ):
            with self.subTest(url=url):
                self.assertFalse(is_allowed_devto_request(url, "POST"))

    def test_rejects_other_paths_methods_and_query_strings(self):
        cases = (
            ("https://dev.to/api/articles", "GET"),
            ("https://dev.to/api/articles/me/published?per_page=100", "POST"),
            ("https://dev.to/api/articles/me/published?per_page=100&next=https://evil.example", "GET"),
            ("https://dev.to/api/admin", "GET"),
            ("https://dev.to/api/articles#fragment", "POST"),
        )
        for url, method in cases:
            with self.subTest(url=url, method=method):
                self.assertFalse(is_allowed_devto_request(url, method))

    def test_rejects_nonstandard_ports(self):
        self.assertFalse(
            is_allowed_devto_request("https://dev.to:8443/api/articles", "POST")
        )

    def test_public_image_must_match_the_exact_checked_in_asset_url(self):
        self.assertTrue(is_allowed_public_image_url(IMAGE_URL))
        self.assertFalse(
            is_allowed_public_image_url(
                "https://raw.githubusercontent.com/attacker/repo/main/image.png"
            )
        )
        self.assertFalse(is_allowed_public_image_url("http://raw.githubusercontent.com/Sirahwaz/Control-room/main/assets/knots-research-infographic.png"))

    def test_external_redirects_are_rejected(self):
        handler = _NoExternalRedirect()
        request = urllib.request.Request("https://dev.to/api/articles")
        with self.assertRaises(urllib.error.HTTPError):
            handler.redirect_request(
                request, None, 302, "Found", {}, "https://evil.example/collect"
            )


if __name__ == "__main__":
    unittest.main()
