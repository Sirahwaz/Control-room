import unittest
from analyze_web import validate_target_url

def public_resolver(host, port, type=None):
    return [(None, None, None, None, ("93.184.216.34", 443))]

def private_resolver(host, port, type=None):
    return [(None, None, None, None, ("127.0.0.1", 443))]

class WebTargetPolicyTests(unittest.TestCase):
    def test_accepts_https_public_host(self):
        self.assertEqual(validate_target_url("https://example.com/path", resolver=public_resolver), "example.com")
    def test_rejects_non_https(self):
        with self.assertRaisesRegex(ValueError, "HTTPS_PUBLIC_URL_REQUIRED"):
            validate_target_url("http://example.com", resolver=public_resolver)
    def test_rejects_embedded_credentials(self):
        with self.assertRaisesRegex(ValueError, "HTTPS_PUBLIC_URL_REQUIRED"):
            validate_target_url("https://user:pass@example.com", resolver=public_resolver)
    def test_rejects_non_public_dns_answer(self):
        with self.assertRaisesRegex(ValueError, "TARGET_HOST_NOT_PUBLIC"):
            validate_target_url("https://example.com", resolver=private_resolver)
    def test_rejects_cross_host_redirect_target(self):
        with self.assertRaisesRegex(ValueError, "CROSS_HOST_REDIRECT_BLOCKED"):
            validate_target_url("https://other.example.com", expected_host="example.com", resolver=public_resolver)

if __name__ == "__main__":
    unittest.main()
