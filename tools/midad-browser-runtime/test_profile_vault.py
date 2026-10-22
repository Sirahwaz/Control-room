import json
import os
import tempfile
import unittest
from pathlib import Path

from profile_vault import (
    ProfileError,
    ProfileStore,
    request_policy,
    validate_profile_url,
)


class ProfileUrlPolicyTests(unittest.TestCase):
    def test_accepts_https_url_on_exactly_allowlisted_host(self):
        self.assertEqual(
            validate_profile_url("https://app.example.com/dashboard", {"app.example.com"}),
            "https://app.example.com/dashboard",
        )

    def test_rejects_unlisted_hosts_and_suffix_attacks(self):
        for url in (
            "https://example.com.attacker.test/",
            "https://auth.example.com/",
        ):
            with self.subTest(url=url), self.assertRaises(ProfileError):
                validate_profile_url(url, {"example.com"})

    def test_rejects_http_credentials_nonstandard_port_and_wildcard_hosts(self):
        cases = [
            ("http://example.com/", {"example.com"}),
            ("https://user:pass@example.com/", {"example.com"}),
            ("https://example.com:8443/", {"example.com"}),
            ("https://example.com/", {"*.example.com"}),
        ]
        for url, hosts in cases:
            with self.subTest(url=url, hosts=hosts), self.assertRaises(ProfileError):
                validate_profile_url(url, hosts)

    def test_rejects_local_and_private_destinations(self):
        for url, hosts in (
            ("https://localhost/", {"localhost"}),
            ("https://127.0.0.1/", {"127.0.0.1"}),
            ("https://192.168.1.5/", {"192.168.1.5"}),
        ):
            with self.subTest(url=url), self.assertRaises(ProfileError):
                validate_profile_url(url, hosts)

    def test_request_policy_allows_manual_login_posts_but_blocks_mutations_for_agents(self):
        hosts = {"login.example.com"}
        self.assertTrue(request_policy("https://login.example.com/session", "POST", hosts, mode="setup"))
        self.assertTrue(request_policy("https://login.example.com/", "GET", hosts, mode="agent_read_only"))
        for method in ("POST", "PUT", "PATCH", "DELETE"):
            with self.subTest(method=method):
                self.assertFalse(request_policy("https://login.example.com/action", method, hosts, mode="agent_read_only"))

    def test_request_policy_rejects_cross_host_and_unknown_modes(self):
        self.assertFalse(request_policy("https://other.example.com/", "GET", {"login.example.com"}, mode="setup"))
        self.assertFalse(request_policy("https://login.example.com/", "GET", {"login.example.com"}, mode="unrestricted"))


class ProfileStoreTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "midad-profiles"
        self.store = ProfileStore(self.root)

    def test_create_profile_stores_only_metadata_not_url_query_or_auth_state(self):
        profile = self.store.create_pending(
            "taskmarket",
            "https://taskmarket.dev/login?token=do-not-store#fragment",
            {"taskmarket.dev", "auth.taskmarket.dev"},
        )
        registry_text = (self.root / "registry.json").read_text(encoding="utf-8")
        self.assertNotIn("do-not-store", registry_text)
        self.assertNotIn("fragment", registry_text)
        self.assertNotIn("cookies", registry_text.lower())
        self.assertEqual(profile.start_host, "taskmarket.dev")
        self.assertEqual(profile.status, "setup_pending")
        self.assertTrue(profile.user_data_dir.is_dir())
        if os.name == "posix":
            self.assertEqual(self.root.stat().st_mode & 0o777, 0o700)
            self.assertEqual(profile.profile_dir.stat().st_mode & 0o777, 0o700)
            self.assertEqual((self.root / "registry.json").stat().st_mode & 0o777, 0o600)

    def test_setup_confirmation_promotes_pending_profile_and_never_exports_storage_state(self):
        self.store.create_pending("example", "https://example.com/login", {"example.com"})
        profile = self.store.confirm_setup("example", "https://example.com/account")
        self.assertEqual(profile.status, "ready_user_confirmed")
        self.assertIsNotNone(profile.last_setup_confirmed_at)
        self.assertFalse(hasattr(profile, "cookies"))
        self.assertFalse(hasattr(profile, "storage_state"))

    def test_cannot_confirm_pending_setup_on_unapproved_host(self):
        self.store.create_pending("example", "https://example.com/login", {"example.com"})
        with self.assertRaises(ProfileError):
            self.store.confirm_setup("example", "https://attacker.test/complete")
        self.assertEqual(self.store.get("example").status, "setup_pending")

    def test_duplicate_or_unsafe_profile_ids_are_rejected(self):
        for profile_id in ("../escape", "UPPERCASE", "", "name with spaces"):
            with self.subTest(profile_id=profile_id), self.assertRaises(ProfileError):
                self.store.create_pending(profile_id, "https://example.com/", {"example.com"})
        self.store.create_pending("example", "https://example.com/", {"example.com"})
        with self.assertRaises(ProfileError):
            self.store.create_pending("example", "https://example.com/", {"example.com"})

    def test_agent_cannot_open_profile_before_user_confirmation(self):
        self.store.create_pending("example", "https://example.com/login", {"example.com"})
        with self.assertRaises(ProfileError):
            self.store.require_ready("example")

    def test_registry_is_json_and_profile_listing_is_redacted(self):
        self.store.create_pending("example", "https://example.com/login?secret=x", {"example.com"})
        rows = self.store.list_profiles()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0].profile_id, "example")
        self.assertNotIn("secret", json.dumps([row.to_public_dict() for row in rows]))
        self.assertIsInstance(json.loads((self.root / "registry.json").read_text(encoding="utf-8")), dict)


if __name__ == "__main__":
    unittest.main()
