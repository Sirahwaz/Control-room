"""Offline contract tests for the Cloudflare Continuity Ledger client."""
import json
import unittest
from urllib.error import HTTPError

from continuity_ledger_client import ContinuityLedgerClient, ContinuityLedgerError


class FakeResponse:
    def __init__(self, payload, status=200):
        self.payload = json.dumps(payload).encode("utf-8")
        self.status = status

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self, size=-1):
        return self.payload[:size] if size >= 0 else self.payload

    def getcode(self):
        return self.status


class FakeOpener:
    def __init__(self, payload=None, error=None):
        self.payload = payload or {"ok": True}
        self.error = error
        self.request = None
        self.timeout = None

    def open(self, request, timeout=0):
        self.request = request
        self.timeout = timeout
        if self.error is not None:
            raise self.error
        return FakeResponse(self.payload)


class ContinuityLedgerClientTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.base = "https://midad-continuity.example.workers.dev"
        self.node_id = "midad-browser-node-a"
        self.token = "a" * 64

    def test_endpoint_must_be_https_origin_without_userinfo_path_or_query(self):
        for value in (
            "http://ledger.example",
            "https://user:pass@ledger.example",
            "https://ledger.example/path",
            "https://ledger.example?debug=true",
            "https://ledger.example#fragment",
            "https://ledger.example:8443",
        ):
            with self.subTest(value=value):
                with self.assertRaisesRegex(ContinuityLedgerError, "LEDGER_URL_INVALID"):
                    ContinuityLedgerClient(value, self.node_id, self.token)

    def test_node_identity_and_one_time_token_are_required(self):
        with self.assertRaisesRegex(ContinuityLedgerError, "NODE_ID_INVALID"):
            ContinuityLedgerClient(self.base, "../node", self.token)
        with self.assertRaisesRegex(ContinuityLedgerError, "NODE_TOKEN_INVALID"):
            ContinuityLedgerClient(self.base, self.node_id, "short")

    async def test_claim_uses_node_auth_headers_and_keeps_token_out_of_json(self):
        opener = FakeOpener({"ok": True, "task": {"task_id": "task-1"}})
        client = ContinuityLedgerClient(self.base, self.node_id, self.token, opener=opener)
        result = await client.claim(lease_ttl_seconds=90)
        self.assertEqual(result["task"]["task_id"], "task-1")
        self.assertEqual(opener.request.full_url, self.base + "/v1/tasks/claim")
        self.assertEqual(opener.request.get_header("Authorization"), "Bearer " + self.token)
        self.assertEqual(opener.request.get_header("X-midad-node-id"), self.node_id)
        self.assertEqual(json.loads(opener.request.data.decode()), {"lease_ttl_seconds": 90})
        self.assertNotIn(self.token.encode(), opener.request.data)
        self.assertEqual(opener.timeout, 10)

    async def test_checkpoint_and_complete_use_only_fixed_routes(self):
        opener = FakeOpener({"ok": True})
        client = ContinuityLedgerClient(self.base, self.node_id, self.token, opener=opener)
        await client.checkpoint("task-1", "b" * 64, {"stage": "claimed", "attempt": 1})
        self.assertEqual(opener.request.full_url, self.base + "/v1/tasks/checkpoint")
        self.assertEqual(json.loads(opener.request.data.decode())["checkpoint"]["stage"], "claimed")
        await client.complete("task-1", "b" * 64, {"status": "INSPECTED"})
        self.assertEqual(opener.request.full_url, self.base + "/v1/tasks/complete")

    async def test_lease_token_is_sent_only_in_authorized_request_body(self):
        opener = FakeOpener({"ok": True})
        client = ContinuityLedgerClient(self.base, self.node_id, self.token, opener=opener)
        lease = "c" * 64
        await client.renew("task-1", lease, lease_ttl_seconds=90)
        data = json.loads(opener.request.data.decode())
        self.assertEqual(data, {"task_id": "task-1", "lease_token": lease, "lease_ttl_seconds": 90})
        self.assertNotIn(self.token, opener.request.data.decode())

    async def test_non_ok_response_and_http_error_are_normalized_without_body_leak(self):
        opener = FakeOpener({"ok": False, "error": "LEASE_INVALID_OR_EXPIRED"})
        client = ContinuityLedgerClient(self.base, self.node_id, self.token, opener=opener)
        with self.assertRaisesRegex(ContinuityLedgerError, "LEDGER_REJECTED"):
            await client.heartbeat({"cpu_cores": 1})
        http_error = HTTPError(self.base, 503, "unavailable", {}, None)
        client = ContinuityLedgerClient(self.base, self.node_id, self.token, opener=FakeOpener(error=http_error))
        with self.assertRaisesRegex(ContinuityLedgerError, "LEDGER_HTTP_503"):
            await client.heartbeat({"cpu_cores": 1})

    async def test_invalid_json_response_is_rejected(self):
        class InvalidJsonResponse(FakeResponse):
            def __init__(self):
                super().__init__({})
            def read(self, size=-1):
                return b"<html>not json</html>"

        class InvalidJsonOpener:
            def open(self, request, timeout=0):
                return InvalidJsonResponse()

        client = ContinuityLedgerClient(self.base, self.node_id, self.token, opener=InvalidJsonOpener())
        with self.assertRaisesRegex(ContinuityLedgerError, "LEDGER_RESPONSE_INVALID"):
            await client.heartbeat({"cpu_cores": 1})


if __name__ == "__main__":
    unittest.main()
