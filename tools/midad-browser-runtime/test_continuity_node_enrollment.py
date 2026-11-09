"""Tests for the one-time Cloudflare node enrollment and secret-file boundary."""
import base64
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from continuity_browser_worker_v2 import ContinuityWorkerConfig, ContinuityWorkerError
from enroll_continuity_node import EnrollmentError, enroll_node, read_admin_key_file, validate_base_url


class FakeResponse:
    status = 201
    def __init__(self, payload):
        self.payload = json.dumps(payload).encode("utf-8")
    def __enter__(self):
        return self
    def __exit__(self, *_args):
        return False
    def getcode(self):
        return self.status
    def read(self, _size=-1):
        return self.payload


class FakeOpener:
    def __init__(self, payload):
        self.payload = payload
        self.request = None
    def open(self, request, timeout=0):
        self.request = request
        return FakeResponse(self.payload)


class NodeEnrollmentTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def test_enrollment_requires_explicit_consent_and_stores_one_time_token_privately(self):
        node_id = "midad-browser-node-a"
        owner_id = "00000000-0000-4000-8000-000000000001"
        token = "a" * 64
        opener = FakeOpener({
            "ok": True, "node_id": node_id, "enrollment_token": token,
            "token_delivery": "one_time_response_never_persisted_in_plaintext",
        })
        token_file = self.root / "secrets" / "node-token"
        result = enroll_node(
            "https://ledger.example.workers.dev", node_id, owner_id,
            "admin-key-" + "b" * 48, token_file, True, opener=opener,
        )
        self.assertTrue(result["token_saved"])
        self.assertEqual(token_file.read_text(encoding="ascii").strip(), token)
        self.assertEqual(token_file.stat().st_mode & 0o777, 0o600)
        self.assertNotIn(token, json.dumps(result))
        request_body = json.loads(opener.request.data.decode("utf-8"))
        self.assertTrue(request_body["consent_confirmed"])
        self.assertEqual(request_body["owner_id"], owner_id)
        self.assertNotIn("admin-key", opener.request.data.decode("utf-8"))

    def test_enrollment_without_consent_is_rejected_before_network(self):
        opener = FakeOpener({})
        with self.assertRaisesRegex(EnrollmentError, "EXPLICIT_OWNER_CONSENT_REQUIRED"):
            enroll_node(
                "https://ledger.example.workers.dev", "browser-node-a",
                "00000000-0000-4000-8000-000000000001",
                "admin-key-" + "b" * 48, self.root / "token", False, opener=opener,
            )
        self.assertIsNone(opener.request)

    def test_enrollment_never_overwrites_an_existing_token_without_explicit_rotation(self):
        path = self.root / "node-token"
        path.write_text("x" * 64, encoding="ascii")
        opener = FakeOpener({
            "ok": True, "node_id": "browser-node-a", "enrollment_token": "a" * 64,
            "token_delivery": "one_time_response_never_persisted_in_plaintext",
        })
        with self.assertRaisesRegex(EnrollmentError, "TOKEN_FILE_ALREADY_EXISTS"):
            enroll_node(
                "https://ledger.example.workers.dev", "browser-node-a",
                "00000000-0000-4000-8000-000000000001",
                "admin-key-" + "b" * 48, path, True, opener=opener,
            )
        self.assertIsNone(opener.request)
        self.assertEqual(path.read_text(encoding="ascii"), "x" * 64)

    def test_admin_key_is_read_from_private_file_and_not_command_argument(self):
        key_file = self.root / "admin-key"
        key_file.write_text("admin-key-" + "z" * 48 + "\n", encoding="ascii")
        os.chmod(key_file, 0o600)
        self.assertEqual(read_admin_key_file(str(key_file)), "admin-key-" + "z" * 48)

    def test_admin_key_file_rejects_group_or_world_permissions(self):
        key_file = self.root / "admin-key"
        key_file.write_text("admin-key-" + "z" * 48, encoding="ascii")
        os.chmod(key_file, 0o640)
        with self.assertRaisesRegex(EnrollmentError, "LEDGER_ADMIN_KEY_FILE_PERMISSIONS_INVALID"):
            read_admin_key_file(str(key_file))

    def test_admin_key_file_rejects_symlinks(self):
        target = self.root / "real-admin-key"
        target.write_text("admin-key-" + "z" * 48, encoding="ascii")
        os.chmod(target, 0o600)
        link = self.root / "admin-key-link"
        link.symlink_to(target)
        with self.assertRaisesRegex(EnrollmentError, "LEDGER_ADMIN_KEY_FILE_INVALID"):
            read_admin_key_file(str(link))

    def test_only_secure_worker_origin_is_accepted(self):
        with self.assertRaisesRegex(EnrollmentError, "LEDGER_URL_INVALID"):
            validate_base_url("http://ledger.example")


class WorkerNodeTokenFileTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.token_file = self.root / "node-token"
        self.token_file.write_text("c" * 64 + "\n", encoding="ascii")
        os.chmod(self.token_file, 0o600)

    def environment(self):
        return {
            "MIDAD_CONTINUITY_LEDGER_URL": "https://ledger.example.workers.dev",
            "MIDAD_CONTINUITY_NODE_ID": "midad-browser-node-a",
            "MIDAD_CONTINUITY_NODE_TOKEN_FILE": str(self.token_file),
            "MIDAD_CONTINUITY_OWNER_ID": "00000000-0000-4000-8000-000000000001",
            "MIDAD_BROWSER_ALLOWED_HOSTS": "example.com",
            "MIDAD_CONTINUITY_ENROLLED_CAPABILITIES": ",".join([
                "interactive-browser-execution", "persistent-browser-session", "encrypted-session-store"
            ]),
            "MIDAD_CONTINUITY_COST_ESTIMATE_VERIFIED": "true",
            "MIDAD_CONTINUITY_COST_PER_HOUR_USD": "0",
            "MIDAD_BROWSER_SESSION_MASTER_KEY_B64": base64.b64encode(bytes(range(32))).decode("ascii"),
            "MIDAD_BROWSER_ACCOUNT_REGISTRY": str(self.root / "accounts.json"),
            "MIDAD_BROWSER_SESSION_STORE_DIR": str(self.root / "sessions"),
        }

    def test_worker_reads_node_token_from_0600_file_without_admin_key(self):
        with patch.dict(os.environ, self.environment(), clear=True):
            config = ContinuityWorkerConfig.from_env()
        self.assertEqual(config.node_token, "c" * 64)

    def test_worker_rejects_group_or_world_readable_node_token_file(self):
        os.chmod(self.token_file, 0o644)
        with patch.dict(os.environ, self.environment(), clear=True):
            with self.assertRaisesRegex(ContinuityWorkerError, "NODE_TOKEN_FILE_PERMISSIONS_INVALID"):
                ContinuityWorkerConfig.from_env()

    def test_worker_rejects_two_ambiguous_token_sources(self):
        env = self.environment()
        env["MIDAD_CONTINUITY_NODE_TOKEN"] = "d" * 64
        with patch.dict(os.environ, env, clear=True):
            with self.assertRaisesRegex(ContinuityWorkerError, "SET_EXACTLY_ONE_NODE_TOKEN_SOURCE"):
                ContinuityWorkerConfig.from_env()


if __name__ == "__main__":
    unittest.main()
