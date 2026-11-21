import json
import unittest
from unittest.mock import patch

from memora_api_backend import MemoraApiBackend
from midad_memory_adapter import AdapterError


class FakeResponse:
    def __init__(self, payload, status=200):
        self.payload = payload
        self.status = status

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def read(self, limit=-1):
        data = json.dumps(self.payload).encode()
        return data[:limit] if limit >= 0 else data


class FakeOpener:
    def __init__(self, responses):
        self.responses = list(responses)
        self.requests = []

    def open(self, request, timeout=None):
        self.requests.append((request, timeout))
        response = self.responses.pop(0)
        return FakeResponse(response)


class MemoraApiBackendTests(unittest.TestCase):
    def setUp(self):
        self.route = {"owner-a": {"store": "owner_a", "token_env": "MIDAD_MEMORA_API_TOKEN_OWNER_A"}}
        self.env = {"MIDAD_MEMORA_API_TOKEN_OWNER_A": "test-only-bearer"}
        self.health = {
            "status": "ok", "store": "owner_a", "api_version": "v1",
            "contract_version": "1.0.1", "writes": "transactional",
            "projects": ["project-a"], "mode": "hybrid-v1", "supervisor": None,
        }

    def test_owner_route_and_bearer_are_server_configured(self):
        opener = FakeOpener([self.health])
        backend = MemoraApiBackend(
            "https://memora.example", self.route, environ=self.env, opener=opener
        )
        backend.check_health("owner-a", require_writes=False)
        request, _ = opener.requests[0]
        self.assertEqual(request.full_url, "https://memora.example/api/v1/owner_a/health")
        self.assertEqual(request.get_header("Authorization"), "Bearer test-only-bearer")

    def test_missing_owner_route_fails_closed(self):
        backend = MemoraApiBackend("https://memora.example", self.route, environ=self.env,
                                   opener=FakeOpener([]))
        with self.assertRaisesRegex(AdapterError, "SCOPE_NOT_FOUND"):
            backend.search("owner-b", "project-a", "hello", 5)

    def test_missing_server_token_fails_closed(self):
        backend = MemoraApiBackend("https://memora.example", self.route, environ={},
                                   opener=FakeOpener([]))
        with self.assertRaisesRegex(AdapterError, "UPSTREAM_UNAVAILABLE"):
            backend.check_health("owner-a", require_writes=False)

    def test_create_requires_transactional_memora_health(self):
        unsupported = dict(self.health, writes="unsupported")
        opener = FakeOpener([unsupported])
        backend = MemoraApiBackend("https://memora.example", self.route,
                                   environ=self.env, opener=opener)
        with self.assertRaisesRegex(AdapterError, "CAPABILITY_UNAVAILABLE"):
            backend.create({
                "owner_scope": "owner-a", "project_id": "project-a",
                "content": "safe", "source_ref": "test://source",
                "memory_type": "fact", "sensitivity": "internal",
                "retention_class": "standard", "confidence": 0.8,
                "verification_state": "PENDING", "created_by_agent": "agent-1",
                "run_id": "run-1",
            }, "a" * 64)
        self.assertEqual(len(opener.requests), 1)

    def test_create_posts_project_scoped_absorb_with_idempotency(self):
        opener = FakeOpener([self.health, {
            "status": "done", "created": 1, "superseded": 0, "skipped": 0,
            "linked": 0, "memory_ids": [42], "took_ms": 3,
        }])
        backend = MemoraApiBackend("https://memora.example", self.route,
                                   environ=self.env, opener=opener)
        record = {
            "owner_scope": "owner-a", "project_id": "project-a", "content": "safe",
            "source_ref": "test://source", "memory_type": "fact",
            "sensitivity": "internal", "retention_class": "standard",
            "confidence": 0.8, "verification_state": "PENDING",
            "created_by_agent": "agent-1", "run_id": "run-1",
        }
        self.assertEqual(backend.create(record, "a" * 64), "42")
        absorb_request = opener.requests[1][0]
        body = json.loads(absorb_request.data.decode())
        self.assertEqual(absorb_request.full_url, "https://memora.example/api/v1/owner_a/absorb")
        self.assertEqual(body["idempotency_key"], "a" * 64)
        self.assertEqual(body["project"], "project-a")
        self.assertEqual(body["facts"], ["safe"])
        self.assertEqual(body["metadata"]["owner_scope"], "owner-a")

    def test_search_passes_project_filter_and_marks_scope_from_server_route(self):
        opener = FakeOpener([self.health, {
            "count": 1, "mode": "hybrid-v1", "embedding_model": "test",
            "results": [{"id": 42, "created_at": None, "tags": ["project-a"],
                         "preview": "safe result", "cosine": 0.8, "fused": 0.03, "rank": 1}],
            "unscored": 0, "took_ms": 2,
        }])
        backend = MemoraApiBackend("https://memora.example", self.route,
                                   environ=self.env, opener=opener)
        rows = backend.search("owner-a", "project-a", "safe", 5)
        body = json.loads(opener.requests[1][0].data.decode())
        self.assertEqual(body["project"], "project-a")
        self.assertEqual(rows[0]["owner_scope"], "owner-a")
        self.assertEqual(rows[0]["project_id"], "project-a")
        self.assertEqual(rows[0]["content"], "safe result")


if __name__ == "__main__":
    unittest.main()
