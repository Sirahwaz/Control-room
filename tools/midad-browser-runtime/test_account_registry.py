"""Offline tests for persistent account metadata registry."""
import json
import os
import tempfile
import unittest
from pathlib import Path
from account_registry import AccountRegistry, AccountRegistryError

class AccountRegistryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "accounts.json"
        self.registry = AccountRegistry(self.path, {"example.com"})
        self.profile = {
            "account_id": "work-account",
            "host": "example.com",
            "username": "operator@example.com",
            "password_secret_ref": "MIDAD_WORK_ACCOUNT_SECRET",
            "login_url": "https://example.com/login",
        }

    def test_profile_persists_and_can_be_retrieved(self):
        self.registry.save_profile(self.profile)
        self.assertEqual(self.registry.get_profile("work-account")["host"], "example.com")

    def test_registry_never_persists_secret_value_fields(self):
        self.registry.save_profile({**self.profile, "password": "never-store-this", "secret_value": "also-never"})
        stored = self.path.read_text(encoding="utf-8")
        self.assertNotIn("never-store-this", stored)
        self.assertNotIn("also-never", stored)

    def test_legacy_secret_fields_are_not_returned_or_rewritten(self):
        self.path.write_text(json.dumps({"profiles": [{
            **self.profile,
            "password": "legacy-secret-must-not-leak",
            "session": {"token": "nested-secret-must-not-leak"}
        }]}), encoding="utf-8")
        loaded = self.registry.get_profile("work-account")
        self.assertNotIn("password", loaded)
        self.assertNotIn("session", loaded)
        self.registry.save_profile({**self.profile, "notes": "safe"})
        stored = self.path.read_text(encoding="utf-8")
        self.assertNotIn("legacy-secret-must-not-leak", stored)
        self.assertNotIn("nested-secret-must-not-leak", stored)

    def test_rejects_non_allowlisted_host(self):
        with self.assertRaisesRegex(AccountRegistryError, "INVALID_ACCOUNT_PROFILE"):
            self.registry.save_profile({**self.profile, "host": "evil.example"})

    def test_rejects_wildcard_allowlist(self):
        with self.assertRaisesRegex(AccountRegistryError, "EXACT_HOST_ALLOWLIST_REQUIRED"):
            AccountRegistry(self.path, {"*.example.com"})

    def test_unknown_account_fails_closed(self):
        with self.assertRaisesRegex(AccountRegistryError, "ACCOUNT_NOT_FOUND"):
            self.registry.get_profile("missing")

    def test_registry_file_permissions_are_private_on_posix(self):
        self.registry.save_profile(self.profile)
        if os.name != "nt":
            self.assertEqual(self.path.stat().st_mode & 0o777, 0o600)

if __name__ == "__main__":
    unittest.main()
