"""Encrypted at-rest Playwright session state contract tests."""
import base64
import os
import shutil
import stat
import tempfile
import unittest
from pathlib import Path

from encrypted_session_store import EncryptedSessionStore, SessionStoreError


class EncryptedSessionStoreTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "sessions"
        self.key = base64.b64encode(bytes(range(32))).decode("ascii")
        self.store = EncryptedSessionStore(self.root, self.key, key_id="test-v1")
        self.owner = "00000000-0000-4000-8000-000000000001"
        self.account = "test-account"
        self.host = "example.com"
        self.state = {
            "cookies": [{
                "name": "session_id",
                "value": "FAKE_PRIVATE_SESSION_COOKIE_VALUE",
                "domain": ".example.com",
                "path": "/",
                "expires": 2000000000,
                "httpOnly": True,
                "secure": True,
                "sameSite": "Lax",
            }],
            "origins": [{"origin": "https://example.com", "localStorage": []}],
        }

    def test_round_trip_is_authenticated_and_ciphertext_does_not_contain_plaintext(self):
        self.store.save(self.owner, self.account, self.host, self.state)
        path = self.store.path_for(self.owner, self.account, self.host)
        raw = path.read_bytes()
        self.assertNotIn(b"FAKE_PRIVATE_SESSION_COOKIE_VALUE", raw)
        self.assertEqual(self.store.load(self.owner, self.account, self.host), self.state)
        self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
        self.assertEqual(stat.S_IMODE(self.root.stat().st_mode), 0o700)

    def test_identity_is_bound_into_authenticated_encryption_context(self):
        self.store.save(self.owner, self.account, self.host, self.state)
        original = self.store.path_for(self.owner, self.account, self.host)
        other = self.store.path_for(self.owner, "different-account", self.host)
        other.parent.mkdir(mode=0o700, exist_ok=True)
        shutil.copyfile(original, other)
        os.chmod(other, 0o600)
        with self.assertRaisesRegex(SessionStoreError, "SESSION_STORE_AUTH_FAILED"):
            self.store.load(self.owner, "different-account", self.host)

    def test_tampered_ciphertext_is_rejected(self):
        self.store.save(self.owner, self.account, self.host, self.state)
        path = self.store.path_for(self.owner, self.account, self.host)
        envelope = json.loads(path.read_text(encoding="ascii"))
        ciphertext = bytearray(base64.b64decode(envelope["ciphertext"], validate=True))
        ciphertext[len(ciphertext) // 2] ^= 0x01
        envelope["ciphertext"] = base64.b64encode(ciphertext).decode("ascii")
        path.write_text(json.dumps(envelope, sort_keys=True, separators=(",", ":")), encoding="ascii")
        os.chmod(path, 0o600)
        with self.assertRaisesRegex(SessionStoreError, "SESSION_STORE_AUTH_FAILED"):
            self.store.load(self.owner, self.account, self.host)

    def test_group_or_world_readable_state_is_rejected(self):
        self.store.save(self.owner, self.account, self.host, self.state)
        path = self.store.path_for(self.owner, self.account, self.host)
        os.chmod(path, 0o644)
        with self.assertRaisesRegex(SessionStoreError, "SESSION_STORE_PERMISSIONS_INVALID"):
            self.store.load(self.owner, self.account, self.host)

    def test_symlink_state_path_is_rejected(self):
        target = Path(self.temp.name) / "outside"
        target.write_text("not a state file", encoding="utf-8")
        path = self.store.path_for(self.owner, self.account, self.host)
        path.symlink_to(target)
        with self.assertRaisesRegex(SessionStoreError, "SESSION_STORE_PATH_UNSAFE"):
            self.store.load(self.owner, self.account, self.host)

    def test_missing_state_is_a_normal_first_run(self):
        self.assertIsNone(self.store.load(self.owner, self.account, self.host))

    def test_delete_removes_only_the_bound_session_file(self):
        self.store.save(self.owner, self.account, self.host, self.state)
        other_state = {"cookies": [], "origins": []}
        self.store.save(self.owner, "another-account", self.host, other_state)
        self.assertTrue(self.store.delete(self.owner, self.account, self.host))
        self.assertIsNone(self.store.load(self.owner, self.account, self.host))
        self.assertEqual(self.store.load(self.owner, "another-account", self.host), other_state)

    def test_invalid_key_length_is_rejected(self):
        with self.assertRaisesRegex(SessionStoreError, "SESSION_STORE_KEY_INVALID"):
            EncryptedSessionStore(self.root / "bad", base64.b64encode(b"short").decode())

    def test_invalid_identity_is_rejected(self):
        with self.assertRaisesRegex(SessionStoreError, "SESSION_STORE_IDENTITY_INVALID"):
            self.store.path_for(self.owner, "../other-account", self.host)


if __name__ == "__main__":
    unittest.main()
