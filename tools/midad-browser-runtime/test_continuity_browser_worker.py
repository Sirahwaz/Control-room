"""End-to-end orchestration tests using fake Cloudflare and Browser adapters."""
import asyncio
import base64
import json
import os
import signal
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from continuity_browser_worker_v2 import (
    ContinuityBrowserWorker,
    ContinuityWorkerConfig,
    ContinuityWorkerError,
    sanitize_browser_result,
    register_sigterm_handler,
    validate_browser_payload,
    validate_browser_action_plan,
    validate_claimed_task,
    build_action_checkpoint,
    validate_action_checkpoint,
    action_checkpoint_resume_decision,
    _ResultSink,
)

CAPABILITIES = frozenset({
    "interactive-browser-execution",
    "persistent-browser-session",
    "encrypted-session-store",
})


class FakeLedgerClient:
    def __init__(self, payload, owner="00000000-0000-4000-8000-000000000001", checkpoint=None):
        self.payload = payload
        self.owner = owner
        self.claim_checkpoint = checkpoint
        self.calls = []

    async def claim(self, lease_ttl_seconds=90):
        self.calls.append(("claim", lease_ttl_seconds))
        return {"ok": True, "task": {
            "task_id": "task-browser-001",
            "owner_id": self.owner,
            "workload": "BROWSER_SESSION",
            "payload": self.payload,
            "checkpoint": self.claim_checkpoint,
            "attempt": 1,
            "lease_token": "a" * 64,
        }}

    async def checkpoint(self, task_id, lease_token, checkpoint):
        required = {"taskId", "profileId", "state", "updatedAt", "evidenceRefs"}
        if set(checkpoint) not in (required, required | {"action"}, required | {"actions", "action_cursor"}):
            raise AssertionError("BROWSER_CHECKPOINT_SCHEMA_MISMATCH")
        if checkpoint["taskId"] != task_id or checkpoint["state"] != "running":
            raise AssertionError("BROWSER_CHECKPOINT_IDENTITY_OR_STATE_MISMATCH")
        if not isinstance(checkpoint["profileId"], str) or not checkpoint["profileId"]:
            raise AssertionError("BROWSER_CHECKPOINT_PROFILE_REQUIRED")
        if not isinstance(checkpoint["updatedAt"], int) or checkpoint["updatedAt"] <= 0:
            raise AssertionError("BROWSER_CHECKPOINT_TIMESTAMP_INVALID")
        if not isinstance(checkpoint["evidenceRefs"], list) or len(checkpoint["evidenceRefs"]) > 20:
            raise AssertionError("BROWSER_CHECKPOINT_EVIDENCE_INVALID")
        if "action" in checkpoint and not isinstance(checkpoint["action"], dict):
            raise AssertionError("ACTION_CHECKPOINT_INVALID")
        if "actions" in checkpoint and (not isinstance(checkpoint["actions"], list) or not isinstance(checkpoint.get("action_cursor"), int)):
            raise AssertionError("ACTION_PLAN_CHECKPOINT_INVALID")
        self.claim_checkpoint = checkpoint
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

    def _profiles(self):
        return [{
            "account_id": "example-account",
            "host": "example.com",
            "platform_key": "example",
            "password_secret_ref": "MIDAD_TEST_BROWSER_PASSWORD",
        }]

    async def process_job(self, job):
        self.jobs.append(job)
        return {"job_id": job["id"], **self.result}


class FakeBrowserSession:
    last_status = "READY"
    authenticated = False
    session_storage = "memory_only"

    async def execute(self, command):
        return {
            "status": "INSPECTED",
            "action": command["action"],
            "url": "https://example.com/dashboard",
            "title": "Dashboard",
        }


class FakeSessionPool:
    def __init__(self):
        self.closed = False
        self.sessions = {}
        self.session_store = None

    async def ensure(self, profile):
        session = FakeBrowserSession()
        self.sessions[profile["account_id"]] = session
        return session

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
            "platform_key": "example",
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
            "payload": {"profile_id": "example-account", "operator_hint": "inspect example"},
            "attempt": 1, "lease_token": "a" * 64,
        }}
        self.assertEqual(validate_claimed_task(claim, self.owner)["task_id"], "task-1")
        checkpoint = {
            "taskId": "task-1", "profileId": "example-account", "state": "paused",
            "updatedAt": 1730000000000, "evidenceRefs": ["evidence:step-1"],
        }
        claim["task"]["checkpoint"] = checkpoint
        self.assertEqual(validate_claimed_task(claim, self.owner)["checkpoint"], checkpoint)
        claim["task"]["owner_id"] = "another-owner"
        with self.assertRaisesRegex(ContinuityWorkerError, "TASK_OWNER_MISMATCH"):
            validate_claimed_task(claim, self.owner)

    def test_non_browser_workload_is_rejected_before_execution(self):
        claim = {"ok": True, "task": {
            "task_id": "task-1", "owner_id": self.owner, "workload": "PYTHON_JOB",
            "payload": {"profile_id": "example-account", "operator_hint": "inspect example"},
            "attempt": 1, "lease_token": "a" * 64,
        }}
        with self.assertRaisesRegex(ContinuityWorkerError, "TASK_WORKLOAD_NOT_ALLOWED"):
            validate_claimed_task(claim, self.owner)

    def test_browser_v2_only_accepts_read_only_operator_actions(self):
        self.assertEqual(validate_browser_payload({"profile_id": "example-account", "operator_hint": "inspect Example"})["action"], "inspect")
        self.assertEqual(validate_browser_payload({"profile_id": "example-account", "operator_command": {"action": "navigate", "account_id": "example-account"}})["action"], "navigate")
        for action in ("click", "fill", "submit_form", "payment", "withdraw", "delete"):
            with self.subTest(action=action):
                with self.assertRaisesRegex(ContinuityWorkerError, "HUMAN_APPROVAL_REQUIRED|ACTION_NOT_ALLOWED"):
                    validate_browser_payload({"profile_id": "example-account", "operator_command": {"action": action, "account_id": "example-account"}})


    def test_multi_action_plan_accepts_bounded_typed_read_only_commands(self):
        payload = {
            "profile_id": "example-account",
            "action_plan": [
                {"action_id": "step-status", "operator_command": {"action": "status", "account_id": "example-account"}},
                {"action_id": "step-inspect", "operator_command": {"action": "inspect", "account_id": "example-account"}},
                {"action_id": "step-wait", "operator_command": {"action": "wait_for_selector", "account_id": "example-account", "selector": "#ready"}},
            ],
        }
        plan = validate_browser_action_plan(payload)
        self.assertEqual(plan["mode"], "plan")
        self.assertEqual([step["action_id"] for step in plan["actions"]], ["step-status", "step-inspect", "step-wait"])

    def test_multi_action_plan_rejects_duplicate_ids_unsafe_actions_and_untyped_hints(self):
        duplicate = {"profile_id": "example-account", "action_plan": [
            {"action_id": "same", "operator_command": {"action": "status", "account_id": "example-account"}},
            {"action_id": "same", "operator_command": {"action": "inspect", "account_id": "example-account"}},
        ]}
        unsafe = {"profile_id": "example-account", "action_plan": [
            {"action_id": "submit", "operator_command": {"action": "submit_form", "account_id": "example-account"}},
        ]}
        untyped = {"profile_id": "example-account", "action_plan": [
            {"action_id": "hint", "operator_hint": "inspect my account"},
        ]}
        oversized = {"profile_id": "example-account", "action_plan": [
            {"action_id": f"step-{i}", "operator_command": {"action": "status", "account_id": "example-account"}}
            for i in range(9)
        ]}
        for payload in (duplicate, unsafe, untyped, oversized):
            with self.subTest(payload=payload):
                with self.assertRaises(ContinuityWorkerError):
                    validate_browser_action_plan(payload)

    def test_credential_binding_ids_are_accepted_as_non_secret_task_policy_metadata(self):
        payload = {
            "profile_id": "example-account",
            "operator_hint": "inspect example",
            "credential_binding_ids": ["proxy-binding-01"],
        }
        parsed = validate_browser_payload(payload)
        self.assertEqual(parsed["action"], "inspect")
        self.assertEqual(parsed["credential_binding_ids"], ["proxy-binding-01"])
        self.assertEqual(parsed["value"], "inspect example")

    def test_credential_binding_ids_are_bounded_unique_and_identifier_only(self):
        valid = {"profile_id": "example-account", "operator_hint": "inspect example", "credential_binding_ids": ["proxy-binding-01"]}
        self.assertEqual(validate_browser_payload(valid)["credential_binding_ids"], ["proxy-binding-01"])
        invalid_payloads = [
            {"profile_id": "example-account", "operator_hint": "inspect example", "credential_binding_ids": ["../secret"]},
            {"profile_id": "example-account", "operator_hint": "inspect example", "credential_binding_ids": ["proxy-binding-01", "proxy-binding-01"]},
            {"profile_id": "example-account", "operator_hint": "inspect example", "credential_binding_ids": ["a" * 129]},
            {"profile_id": "example-account", "operator_hint": "inspect example", "credential_binding_ids": ["proxy-binding-01"], "password": "no"},
            {"profile_id": "example-account", "operator_hint": "inspect example", "operator_command": {"action": "inspect"}},
        ]
        for payload in invalid_payloads:
            with self.subTest(payload=payload):
                with self.assertRaises(ContinuityWorkerError):
                    validate_browser_payload(payload)

    def test_sensitive_payload_is_rejected(self):
        with self.assertRaisesRegex(ContinuityWorkerError, "SENSITIVE_TASK_PAYLOAD_REJECTED"):
            validate_browser_payload({"profile_id": "example-account", "operator_hint": "inspect example password=hunter2"})

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

    async def test_claimed_browser_checkpoint_is_quarantined_without_replaying_operator_actions(self):
        checkpoint = {
            "taskId": "task-browser-001", "profileId": "example-account", "state": "running",
            "updatedAt": 1730000000000, "evidenceRefs": [],
        }
        client = FakeLedgerClient(
            {"profile_id": "example-account", "operator_hint": "inspect example"},
            checkpoint=checkpoint,
        )
        operator = FakeOperator({"status": "SHOULD_NOT_RUN"})
        with patch.dict(os.environ, {"MIDAD_TEST_BROWSER_PASSWORD": "test-only-secret"}):
            worker = ContinuityBrowserWorker(
                self.config, client=client, operator=operator, session_pool=FakeSessionPool()
            )
        result = await worker.poll_once()
        self.assertEqual(result["status"], "BLOCKED")
        self.assertEqual(result["code"], "BROWSER_CHECKPOINT_REQUIRES_RECONCILIATION")
        self.assertEqual(operator.jobs, [])
        self.assertTrue(any(
            call[0] == "fail" and call[2] == "BROWSER_CHECKPOINT_REQUIRES_RECONCILIATION" and call[3] is False
            for call in client.calls
        ))
        self.assertFalse(any(call[0] == "checkpoint" for call in client.calls))

    async def test_read_only_browser_task_completes_with_digest_not_page_text(self):
        client = FakeLedgerClient({"profile_id": "example-account", "operator_hint": "inspect example"})
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
        self.assertEqual(operator.jobs[0]["worker_id"], self.config.node_id)
        self.assertEqual(operator.jobs[0]["owner_user_id"], self.owner)
        self.assertEqual(operator.jobs[0]["lease_token"], "a" * 64)

    async def test_human_approval_action_is_not_dispatched_to_operator(self):
        client = FakeLedgerClient({"profile_id": "example-account", "operator_command": {"action": "click", "account_id": "example-account"}})
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
        client = FakeLedgerClient({"profile_id": "example-account", "operator_hint": "inspect example"}, owner="another-owner")
        operator = FakeOperator({"status": "SHOULD_NOT_RUN"})
        with patch.dict(os.environ, {"MIDAD_TEST_BROWSER_PASSWORD": "test-only-secret"}):
            worker = ContinuityBrowserWorker(
                self.config, client=client, operator=operator, session_pool=FakeSessionPool()
            )
        with self.assertRaisesRegex(ContinuityWorkerError, "TASK_OWNER_MISMATCH"):
            await worker.poll_once()
        self.assertEqual(operator.jobs, [])


    async def test_central_vault_context_is_task_bound_but_binding_ids_never_reach_operator_or_checkpoint(self):
        class FakeCentralRuntime:
            central_mode = True

            def __init__(self):
                self.contexts = []
                self.ended = 0
                self.lost = asyncio.Event()

            def set_task_context(self, context):
                self.contexts.append(dict(context))

            async def wait_for_lease_loss(self):
                await self.lost.wait()

            async def end_task(self):
                self.ended += 1

        bindings = ["proxy-binding-01"]
        client = FakeLedgerClient({
            "profile_id": "example-account",
            "operator_hint": "inspect example",
            "credential_binding_ids": bindings,
        })
        operator = FakeOperator({
            "status": "INSPECTED",
            "action": "inspect",
            "account_id": "example-account",
            "url": "https://example.com/dashboard",
            "session_storage": "encrypted_at_rest",
        })
        pool = FakeSessionPool()
        runtime = FakeCentralRuntime()
        with patch.dict(os.environ, {"MIDAD_TEST_BROWSER_PASSWORD": "test-only-secret"}):
            worker = ContinuityBrowserWorker(
                self.config,
                client=client,
                operator=operator,
                session_pool=pool,
                proxy_runtime=runtime,
            )

        result = await worker.poll_once()

        self.assertEqual(result["status"], "INSPECTED")
        self.assertEqual(runtime.contexts, [{
            "task_id": "task-browser-001",
            "lease_token": "a" * 64,
            "credential_binding_ids": bindings,
        }])
        self.assertEqual(operator.jobs[0]["input_data"], {"operator_hint": "inspect example"})
        checkpoint = next(call for call in client.calls if call[0] == "checkpoint")[2]
        self.assertNotIn("credential_binding_ids", str(checkpoint))
        self.assertNotIn("a" * 64, str(checkpoint))
        self.assertTrue(pool.closed)
        self.assertEqual(runtime.ended, 1)

    async def test_central_vault_lease_loss_cancels_browser_task_and_requires_reconciliation(self):
        class LostRuntime:
            central_mode = True

            def __init__(self):
                self.lost = asyncio.Event()
                self.ended = 0

            def set_task_context(self, _context):
                asyncio.get_running_loop().call_soon(self.lost.set)

            async def wait_for_lease_loss(self):
                await self.lost.wait()

            async def end_task(self):
                self.ended += 1

        class WaitingOperator:
            def __init__(self):
                self.cancelled = False

            async def process_job(self, _job):
                try:
                    await asyncio.sleep(10)
                except asyncio.CancelledError:
                    self.cancelled = True
                    raise

        client = FakeLedgerClient({
            "profile_id": "example-account",
            "operator_hint": "inspect example",
            "credential_binding_ids": ["proxy-binding-01"],
        })
        operator = WaitingOperator()
        pool = FakeSessionPool()
        runtime = LostRuntime()
        with patch.dict(os.environ, {"MIDAD_TEST_BROWSER_PASSWORD": "test-only-secret"}):
            worker = ContinuityBrowserWorker(
                self.config, client=client, operator=operator,
                session_pool=pool, proxy_runtime=runtime,
            )
        result = await worker.poll_once()
        self.assertEqual(result["code"], "VAULT_LEASE_LOST_DURING_BROWSER_TASK")
        self.assertTrue(operator.cancelled)
        self.assertTrue(pool.closed)
        self.assertEqual(runtime.ended, 1)
        self.assertTrue(any(call[0] == "fail" and call[2] == "VAULT_LEASE_LOST_DURING_BROWSER_TASK" for call in client.calls))



    async def test_real_operator_worker_executes_through_continuity_lease_adapter(self):
        client = FakeLedgerClient({
            "profile_id": "example-account",
            "operator_hint": "inspect example",
        })
        pool = FakeSessionPool()
        with patch.dict(os.environ, {"MIDAD_TEST_BROWSER_PASSWORD": "test-only-secret"}):
            worker = ContinuityBrowserWorker(
                self.config,
                client=client,
                operator=None,
                session_pool=pool,
                proxy_runtime=SimpleNamespace(central_mode=False),
            )
        result = await worker.poll_once()
        self.assertEqual(result["status"], "INSPECTED")
        self.assertEqual(result["ledger_state"], "COMPLETED")
        self.assertTrue(any(call[0] == "complete" for call in client.calls))
        self.assertTrue(pool.sessions)

    async def test_legacy_operator_adapter_accepts_continuity_lease_renewal(self):
        result = await _ResultSink().call(
            "renew_operator_lease",
            job_id="task-browser-001",
            worker_id=self.config.node_id,
            owner_user_id=self.owner,
            lease_token="a" * 64,
        )
        self.assertIs(result.get("renewed"), True)


    async def test_multi_action_plan_executes_in_order_and_persists_each_completed_step(self):
        client = FakeLedgerClient({
            "profile_id": "example-account",
            "action_plan": [
                {"action_id": "step-1", "operator_command": {
                    "action": "status", "account_id": "example-account",
                }},
                {"action_id": "step-2", "operator_command": {
                    "action": "inspect", "account_id": "example-account",
                }},
            ],
        })
        operator = FakeOperator({"status": "INSPECTED", "title": "Dashboard"})
        with patch.dict(os.environ, {"MIDAD_TEST_BROWSER_PASSWORD": "test-only-secret"}):
            worker = ContinuityBrowserWorker(
                self.config, client=client, operator=operator, session_pool=FakeSessionPool()
            )
        result = await worker.poll_once()
        self.assertEqual(result["ledger_state"], "COMPLETED")
        self.assertEqual(len(operator.jobs), 2)
        self.assertEqual(
            [job["input_data"]["operator_command"]["action"] for job in operator.jobs],
            ["status", "inspect"],
        )
        plan_checkpoints = [
            call[2] for call in client.calls
            if call[0] == "checkpoint" and "actions" in call[2]
        ]
        self.assertEqual(len(plan_checkpoints), 4)
        self.assertEqual([cp["action_cursor"] for cp in plan_checkpoints], [0, 1, 1, 2])
        self.assertEqual(
            [item["status"] for item in plan_checkpoints[-1]["actions"]],
            ["succeeded", "succeeded"],
        )


    async def test_multi_action_running_checkpoint_is_quarantined_without_replay(self):
        payload = {
            "profile_id": "example-account",
            "action_plan": [
                {"action_id": "step-1", "operator_command": {"action": "status", "account_id": "example-account"}},
                {"action_id": "step-2", "operator_command": {"action": "inspect", "account_id": "example-account"}},
            ],
        }
        running = build_action_checkpoint(
            "task-browser-001", "example-account", "step-1", "status",
            "running", 1730000000000,
        )
        pending = build_action_checkpoint(
            "task-browser-001", "example-account", "step-2", "inspect",
            "pending", 1730000000000,
        )
        checkpoint = {
            "taskId": "task-browser-001", "profileId": "example-account",
            "state": "running", "updatedAt": 1730000000000,
            "evidenceRefs": [], "actions": [running, pending], "action_cursor": 0,
        }
        client = FakeLedgerClient(payload, checkpoint=checkpoint)
        operator = FakeOperator({"status": "MUST_NOT_REPLAY"})
        with patch.dict(os.environ, {"MIDAD_TEST_BROWSER_PASSWORD": "test-only-secret"}):
            worker = ContinuityBrowserWorker(
                self.config, client=client, operator=operator, session_pool=FakeSessionPool()
            )
        result = await worker.poll_once()
        self.assertEqual(result["status"], "BLOCKED")
        self.assertEqual(result["code"], "ACTION_PLAN_IN_FLIGHT_REQUIRES_RECONCILIATION")
        self.assertEqual(operator.jobs, [])
        self.assertTrue(any(
            call[0] == "fail" and call[2] == "ACTION_PLAN_IN_FLIGHT_REQUIRES_RECONCILIATION"
            and call[3] is False for call in client.calls
        ))


    async def test_invalid_multi_action_plan_is_quarantined_without_claim_leak(self):
        client = FakeLedgerClient({
            "profile_id": "example-account",
            "action_plan": [
                {"action_id": "unsafe", "operator_command": {
                    "action": "transfer", "account_id": "example-account",
                }},
            ],
        })
        operator = FakeOperator({"status": "MUST_NOT_RUN"})
        with patch.dict(os.environ, {"MIDAD_TEST_BROWSER_PASSWORD": "test-only-secret"}):
            worker = ContinuityBrowserWorker(
                self.config, client=client, operator=operator, session_pool=FakeSessionPool()
            )
        result = await worker.poll_once()
        self.assertEqual(result["status"], "BLOCKED")
        self.assertEqual(result["code"], "BROWSER_ACTION_PLAN_OPERATION_NOT_ALLOWED")
        self.assertEqual(operator.jobs, [])
        self.assertTrue(any(
            call[0] == "fail" and call[2] == "BROWSER_ACTION_PLAN_OPERATION_NOT_ALLOWED" and call[3] is False
            for call in client.calls
        ))


if __name__ == "__main__":
    unittest.main()
