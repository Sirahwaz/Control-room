import os
import tempfile
import unittest

from gateway import MidadMemoryGateway
from midad_memory_adapter import AdapterError, MemoryAdapter, MemoryRequest, Principal, InMemoryScopedBackend


class MidadMemoryGatewayTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.adapter = MemoryAdapter(
            InMemoryScopedBackend(),
            os.path.join(self.temp.name, "intent-ledger.sqlite3"),
            enabled=True,
        )
        self.principal = Principal(
            principal_id="trusted-subject",
            owner_scope="owner-a",
            allowed_projects=frozenset({"project-a"}),
            agent_id="agent-7",
            run_id="run-9",
            capabilities=frozenset({"search"}),
            authenticated=True,
        )
        self.request = MemoryRequest("request-1", "search", "project-a", {"query": "x"}, "search-1")

    def tearDown(self):
        self.temp.cleanup()

    def test_gateway_derives_principal_only_from_injected_server_resolver(self):
        seen = []
        gateway = MidadMemoryGateway(self.adapter, lambda auth_context: seen.append(auth_context) or self.principal)
        result = gateway.execute({"verified_session": object()}, self.request)
        self.assertEqual(seen[0].keys(), {"verified_session"})
        self.assertEqual(result["status"], "OK")

    def test_missing_principal_fails_closed(self):
        gateway = MidadMemoryGateway(self.adapter, lambda _context: None)
        with self.assertRaisesRegex(AdapterError, "UNAUTHENTICATED"):
            gateway.execute(object(), self.request)

    def test_resolver_failure_is_sanitized_and_fails_closed(self):
        def broken(_context):
            raise RuntimeError("sensitive auth provider internals")
        gateway = MidadMemoryGateway(self.adapter, broken)
        with self.assertRaisesRegex(AdapterError, "UNAUTHENTICATED"):
            gateway.execute(object(), self.request)

    def test_resolver_cannot_return_unverified_principal(self):
        unverified = Principal(**{**self.principal.__dict__, "authenticated": False})
        gateway = MidadMemoryGateway(self.adapter, lambda _context: unverified)
        with self.assertRaisesRegex(AdapterError, "UNAUTHENTICATED"):
            gateway.execute(object(), self.request)

    def test_client_payload_cannot_override_resolved_owner_scope(self):
        gateway = MidadMemoryGateway(self.adapter, lambda _context: self.principal)
        forged = MemoryRequest("request-2", "search", "project-a", {
            "query": "x", "owner_scope": "owner-b"
        }, "search-2")
        with self.assertRaisesRegex(AdapterError, "VALIDATION_ERROR"):
            gateway.execute({"verified_session": True}, forged)


if __name__ == "__main__":
    unittest.main()
