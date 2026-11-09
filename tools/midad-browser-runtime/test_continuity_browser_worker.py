"""End-to-end orchestration tests using fake Cloudflare and Browser adapters."""
import base64
import json
import os
import signal
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from continuity_browser_worker_v2 import (
    ContinuityBrowserWorker,
    ContinuityWorkerConfig,
    ContinuityWorkerError,
    sanitize_browser_result,
    register_sigterm_handler,
    validate_browser_payload,
    validate_claimed_task,
)

CAPABILITIES = frozenset({
    "interactive-browser-execution",
    "persistent-browser-session",
    "encrypted-session-store",
})


class FakeLedgerClient:
    def __init__(self, payload, owner="00000000-0000-4000-8000-000000000001"):
        self.payload = payload
        self.owner = owner
        self.calls = []

    async def claim(self, lease_ttl_seconds=90):
        self.calls.append(("claim", lease_ttl_seconds))
        return {"ok": True, "task": {
            "task_id": "task-browser-001",
            "owner_id": self.owner,
            "workload": "BROWSER_SESSION",
            "payload": self.payload,
            "attempt": 1,
            "lease_token": "a" * 64,
        }}

    async def checkpoint(self, task_id, lease_token, checkpoint):
        self.calls.append(("checkpoint", task_id, checkpoint))
        return {"ok": True}

    async def complete(self, task_id, lease_token, result):
        self.calls.append(("complete", task_id, result))
        return {"ok": True, "state": "COMPLETED"}

    async def fail(self, task_id, lease_token, reason, retryable=False):
        self.calls.append(("fail", task_id, reason, retryable))
        return {"ok": True, "state": "RECONCILIATION_REQUIRED"}

    async def renew(self, task_id, lease_token, lease_ttl_seconds=90):
        self.calls.append(("renew", task_id))
        return {"ok": True}


class FakeOperator:
    def __init__(self, result):
        self.result = result
        self.jobs = []

    async def process_job(self, job):
        self.jobs.append(job)
        return {"job_id": job["id"], **self.result}


class FakeSessionPool:
    def __init__(self):
        self.closed = False

    async def close_all(self):
        self.closed = True


class ContinuityBrowserWorkerContractTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.owner = "00000000-0000-4000-8000-000000000001"
        self.registry_path = self.root / "accounts.json"
        profile = {
            "account_id": "example-account",
            "host": "example.com",
            "username": "operator@example.invalid",
            "password_secret_ref": "MIDAD_TEST_BROWSER_PASSWORD",
        }
        self.registry_path.write_text(json.dumps({"profiles": [profile]}), encoding="utf-8")
        os.chmod(self.registry_path, 0o600)
        self.config = ContinuityWorkerConfig(
            ledger_url="https://ledger.example.workers.dev",
            node_id="browser-node-1",
            node_token="b" * 64,
            owner_id=self.owner,
            allowed_hosts=frozenset({"example.com"}),
            account_registry_path=self.registry_path,
            session_store_path=self.root / "sessions",
            session_store_key_b64=base64.b64encode(bytes(range(32))).decode("ascii"),
            enrolled_capabilities=CAPABILITIES,
            cost_per_hour_usd=0.0,
            poll_seconds=3.0,
            heartbeat_seconds=15.0,
        )

    def test_sigterm_is_connected_to_graceful_worker_stop(self):
        class FakeLoop:
            def __init__(self):
                self.handlers = {}

            def add_signal_handler(self, signum, callback):
                self.handlers[signum] = callback

        class FakeWorker:
            def __init__(self):
                self.stopped = False

            def stop(self):
                self.stopped = True

        loop = FakeLoop()
        worker = FakeWorker()
        register_sigterm_handler(loop, worker)
        self.assertIn(signal.SIGTERM, loop.handlers)
        loop.handlers[signal.SIGTERM]()
        self.assertTrue(worker.stopped)

    def test_claim_is_owner_bound_and_requires_lease_token(self):
        claim = {"ok": True, "task": {
            "task_id": "task-1", "owner_id": self.owner, "workload": "BROWSER_SESSION",
            "payload": {"operator_hint": "inspect example"},
            "attempt": 1, "lease_token": "a" * 64,
        }}
        self.assertEqual(validate_claimed_task(claim, self.owner)["task_id"], "task-1")
        claim["task"]["owner_id"] = "another-owner"
        with self.assertRaisesRegex(ContinuityWorkerError, "TASK_OWNER_MISMATCH"):
            validate_claimed_task(claim, self.owner)

    def test_non_browser_workload_is_rejected_before_execution(self):
        claim = {"ok": True, "task": {
            "task_id": "task-1", "owner_id": self.owner, "workload": "PYTHON_JOB",
            "payload": {"operator_hint": "inspect example"},
            "attempt": 1, "lease_token": "a" * 64,
        }}
        with self.assertRaisesRegex(ContinuityWorkerError, "TASK_WORKLOAD_NOT_ALLOWED"):
            validate_claimed_task(claim, self.owner)

    def test_browser_v2_only_accepts_read_only_operator_actions(self):
        self.assertEqual(validate_browser_payload({"operator_hint": "inspect Example"})["action"], "inspect")
        self.assertEqual(validate_browser_payload({"operator_command": {"action": "navigate"}})["action"], "navigate")
        for action in ("click", "fill", "submit_form", "payment", "withdraw", "delete"):
            with self.subTest(action=action):
                with self.assertRaisesRegex(ContinuityWorkerError, "HUMAN_APPROVAL_REQUIRED|ACTION_NOT_ALLOWED"):
                    validate_browser_payload({"operator_command": {"action": action}})

    def test_sensitive_payload_is_rejected(self):
        with self.assertRaisesRegex(ContinuityWorkerError, "SENSITIVE_TASK_PAYLOAD_REJECTED"):
            validate_browser_payload({"operator_hint": "inspect example password=hunter2"})

    def test_result_contains_metadata_and_digest_but_not_page_text(self):
        page_text = "page body must not be uploaded"
        result = sanitize_browser_result({
            "status": "INSPECTED", "action": "inspect", "text_preview": page_text,
            "session_storage": "encrypted_at_rest", "password": "hidden",
        })
        self.assertIn("text_sha256", result)
        self.assertNotIn("text_preview", result)
        self.assertNotIn("password", result)
        self.assertNotIn(page_text, str(result))

    def test_result_url_drops_query_and_fragment(self):
        result = sanitize_browser_result({
            "url": "https://example.com/dashboard?access_token=not-real#id_token=also-not-real"
        })
        self.assertEqual(result.get("url"), "https://example.com/dashboard")
        self.assertNotIn("access_token", str(result))
        self.assertNotIn("id_token", str(result))

    def test_result_url_redacts_sensitive_path_segments(self):
        result = sanitize_browser_result({
            "url": "https://example.com/reset/opaque-secret-token-0123456789abcdef"
        })
        self.assertNotIn("opaque-secret-token", str(result))
        self.assertNotIn("reset", result.get("url", ""))

    async def test_read_only_browser_task_completes_with_digest_not_page_text(self):
        client = FakeLedgerClient({"operator_hint": "inspect example"})
        operator = FakeOperator({
            "status": "INSPECTED", "action": "inspect",
            "account_id": "example-account", "platform_key": "example",
            "url": "https://example.com/dashboard", "title": "Dashboard",
            "text_preview": "page body must not be uploaded", "text_chars": 29,
            "session_storage": "encrypted_at_rest",
        })
        with patch.dict(os.environ, {"MIDAD_TEST_BROWSER_PASSWORD": "test-only-secret"}):
            worker = ContinuityBrowserWorker(
                self.config, client=client, operator=operator, session_pool=FakeSessionPool()
            )
        result = await worker.poll_once()
        self.assertEqual(result["status"], "INSPECTED")
        self.assertEqual(result["ledger_state"], "COMPLETED")
        complete = next(call for call in client.calls if call[0] == "complete")
        stored = complete[2]
        self.assertIn("text_sha256", stored)
        self.assertNotIn("text_preview", stored)
        self.assertNotIn("page body", str(stored))
        self.assertEqual(stored["session_storage"], "encrypted_at_rest")
        self.assertEqual(operator.jobs[0]["input_data"], {"operator_hint": "inspect example"})

    async def test_human_approval_action_is_not_dispatched_to_operator(self):
        client = FakeLedgerClient({"operator_command": {"action": "click", "account_id": "example-account"}})
        operator = FakeOperator({"status": "SHOULD_NOT_RUN"})
        with patch.dict(os.environ, {"MIDAD_TEST_BROWSER_PASSWORD": "test-only-secret"}):
            worker = ContinuityBrowserWorker(
                self.config, client=client, operator=operator, session_pool=FakeSessionPool()
            )
        result = await worker.poll_once()
        self.assertEqual(result["status"], "BLOCKED")
        self.assertEqual(result["code"], "HUMAN_APPROVAL_REQUIRED")
        self.assertEqual(operator.jobs, [])
        self.assertTrue(any(call[0] == "fail" for call in client.calls))
        self.assertFalse(any(call[0] == "complete" for call in client.calls))

    async def test_owner_mismatch_is_rejected_before_browser_execution(self):
        client = FakeLedgerClient({"operator_hint": "inspect example"}, owner="another-owner")
        operator = FakeOperator({"status": "SHOULD_NOT_RUN"})
        with patch.dict(os.environ, {"MIDAD_TEST_BROWSER_PASSWORD": "test-only-secret"}):
            worker = ContinuityBrowserWorker(
                self.config, client=client, operator=operator, session_pool=FakeSessionPool()
            )
        with self.assertRaisesRegex(ContinuityWorkerError, "TASK_OWNER_MISMATCH"):
            await worker.poll_once()
        self.assertEqual(operator.jobs, [])


if __name__ == "__main__":
    unittest.main()
