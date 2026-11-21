import json
import os
import tempfile
import unittest
from unittest.mock import patch

from gateway import MidadMemoryGateway
from midad_memory_adapter import MemoryAdapter, InMemoryScopedBackend
from server import dispatch_request


OWNER = "123e4567-e89b-42d3-a456-426614174000"
RUN = "323e4567-e89b-42d3-a456-426614174000"
PROJECT = "midad-mobile"
SERVICE_KEY = "test-only-service-key-0123456789abcdef"


class MemoryServerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.backend = InMemoryScopedBackend()
        self.backend.seed({
            "owner_scope": "midad-owner:" + OWNER,
            "project_id": PROJECT,
            "content": "verified memory",
        })
        self.adapter = MemoryAdapter(
            self.backend,
            os.path.join(self.temp.name, "ledger.sqlite3"),
            enabled=True,
        )
        self.gateway = MidadMemoryGateway(self.adapter, __import__("server")._principal_from_context)
        self.principal = {
            "principal_id": OWNER,
            "owner_scope": "midad-owner:" + OWNER,
            "allowed_projects": [PROJECT],
            "agent_id": "factory-agent",
            "run_id": RUN,
            "capabilities": ["search"],
            "authenticated": True,
        }

    def tearDown(self):
        self.temp.cleanup()

    def envelope(self, principal=None, request=None):
        return json.dumps({
            "principal": self.principal if principal is None else principal,
            "request": request or {
                "request_id": "423e4567-e89b-42d3-a456-426614174000",
                "operation": "search",
                "project_id": PROJECT,
                "payload": {"query": "verified", "limit": 5},
                "idempotency_key": None,
            },
        }).encode()

    def test_rejects_missing_or_wrong_internal_service_key(self):
        status, body = dispatch_request("Bearer wrong", self.envelope(), SERVICE_KEY, self.gateway)
        self.assertEqual(status, 401)
        self.assertEqual(body["error"]["code"], "UNAUTHENTICATED")

    def test_valid_internal_request_executes_scoped_search(self):
        status, body = dispatch_request("Bearer " + SERVICE_KEY, self.envelope(), SERVICE_KEY, self.gateway)
        self.assertEqual(status, 200)
        self.assertEqual(body["status"], "OK")
        self.assertEqual(len(body["data"]["records"]), 1)
        self.assertEqual(body["data"]["records"][0]["owner_scope"], "midad-owner:" + OWNER)

    def test_rejects_unverified_principal_envelope(self):
        principal = dict(self.principal, authenticated=False)
        status, body = dispatch_request("Bearer " + SERVICE_KEY, self.envelope(principal), SERVICE_KEY, self.gateway)
        self.assertEqual(status, 401)
        self.assertEqual(body["error"]["code"], "UNAUTHENTICATED")

    def test_rejects_principal_with_mismatched_owner_scope(self):
        principal = dict(self.principal, owner_scope="midad-owner:other")
        status, body = dispatch_request("Bearer " + SERVICE_KEY, self.envelope(principal), SERVICE_KEY, self.gateway)
        self.assertEqual(status, 401)
        self.assertEqual(body["error"]["code"], "UNAUTHENTICATED")

    def test_malformed_operation_type_is_rejected_without_exception(self):
        request = {
            "request_id": "423e4567-e89b-42d3-a456-426614174000",
            "operation": ["search"],
            "project_id": PROJECT,
            "payload": {"query": "verified"},
            "idempotency_key": None,
        }
        status, body = dispatch_request("Bearer " + SERVICE_KEY, self.envelope(request=request), SERVICE_KEY, self.gateway)
        self.assertEqual(status, 400)
        self.assertEqual(body["error"]["code"], "INVALID_REQUEST")

    def test_oversized_internal_request_is_rejected(self):
        status, body = dispatch_request("Bearer " + SERVICE_KEY, b"x" * (64 * 1024 + 1), SERVICE_KEY, self.gateway)
        self.assertEqual(status, 413)
        self.assertEqual(body["error"]["code"], "REQUEST_TOO_LARGE")


    def test_service_can_start_dark_with_feature_flag_disabled(self):
        from server import main
        with patch.dict(os.environ, {
            "MIDAD_MEMORY_ADAPTER_ENABLED": "false",
            "MIDAD_MEMORY_ADAPTER_SERVICE_KEY": SERVICE_KEY,
            "MIDAD_MEMORY_ADAPTER_BIND": "127.0.0.1",
            "PORT": "0",
        }, clear=False), patch("server.BoundedThreadingHTTPServer") as http_server:
            main()
            http_server.assert_called_once()
            http_server.return_value.serve_forever.assert_called_once()


if __name__ == "__main__":
    unittest.main()
