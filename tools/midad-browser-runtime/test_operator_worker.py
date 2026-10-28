"""Offline tests for command submission and the long-running queue consumer."""
import asyncio
import unittest
from types import SimpleNamespace

from operator_worker import OperatorWorker
from submit_operator_command import submit_hint

PROFILE = {
    "account_id": "example-account",
    "platform_key": "example",
    "display_name": "Example",
    "aliases": ["example.com"],
    "host": "example.com",
    "username": "operator@example.invalid",
    "password_secret_ref": "MIDAD_EXAMPLE_PASSWORD",
    "login_url": "https://example.com/login",
    "username_selector": "input[name='username']",
    "password_selector": "input[name='password']",
    "submit_selector": "button[type='submit']",
    "success_selector": "[data-testid='account-home']",
    "login_post_paths": ["/login"],
}

class FakeRegistry:
    def list_profiles(self):
        return [dict(PROFILE)]
    def get_profile(self, account_id):
        if account_id != PROFILE["account_id"]:
            raise ValueError("not found")
        return dict(PROFILE)

class FakeGateway:
    def __init__(self, jobs=None):
        self.jobs = jobs or []
        self.calls = []
        self.events = []
    async def call(self, action, **payload):
        self.calls.append((action, payload))
        if action == "queue_operator_hint":
            return {"ok": True, "job_id": "job-created", "state": "PREPARING"}
        if action == "create_job":
            return {"ok": True, "job": {"id": "job-created", "state": "PREPARING"}}
        if action == "list_jobs":
            return {"ok": True, "jobs": self.jobs}
        if action == "record_command_result":
            return {"ok": True}
        return {"ok": True}
    async def record_event(self, **payload):
        self.events.append(payload)
        return {"ok": True}

class FakeSession:
    last_status = "AUTHENTICATED_IN_MEMORY"
    authenticated = True
    async def execute(self, command):
        return {"status": "INSPECTED", "action": command["action"], "account_id": PROFILE["account_id"],
                "url": "https://example.com/", "title": "Example", "text_preview": "safe page",
                "text_chars": 10}

class FakePool:
    def __init__(self):
        self.sessions = {}
        self.session = FakeSession()
    async def ensure(self, profile):
        self.sessions[profile["account_id"]] = self.session
        return self.session
    async def close_all(self):
        self.sessions.clear()

class OperatorWorkerTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.config = SimpleNamespace(allowed_hosts=frozenset({"example.com"}))
        self.registry = FakeRegistry()
        self.gateway = FakeGateway()
        self.pool = FakePool()
        self.worker = OperatorWorker(self.config, "00000000-0000-4000-8000-000000000001",
                                     self.registry, gateway=self.gateway, session_pool=self.pool)

    async def test_submit_hint_queues_only_hint_for_private_worker_resolution(self):
        result = await submit_hint("Example", config=self.config, registry=self.registry,
                                   gateway=self.gateway, owner_user_id="00000000-0000-4000-8000-000000000001")
        self.assertTrue(result["ok"])
        self.assertEqual(result["dispatch"], "queued")
        action, payload = self.gateway.calls[-1]
        self.assertEqual(action, "queue_operator_hint")
        self.assertEqual(payload["operator_hint"], "Example")
        self.assertNotIn("password", str(payload).lower().replace("password_secret_ref", ""))

    async def test_process_inspect_command_records_result_and_completes(self):
        job = {
            "id": "job-inspect", "state": "PREPARING", "platform_key": "example",
            "current_url": "https://example.com/",
            "input_data": {"operator_command": {
                "version": 1, "action": "inspect", "platform_key": "example",
                "account_id": "example-account", "action_approved": False
            }},
        }
        result = await self.worker.process_job(job)
        self.assertEqual(result["status"], "INSPECTED")
        self.assertTrue(any(action == "record_command_result" for action, _ in self.gateway.calls))
        self.assertTrue(any(event["state"] == "RUNNING" for event in self.gateway.events))
        self.assertTrue(any(event["state"] == "COMPLETED" for event in self.gateway.events))

    async def test_plain_operator_hint_resolves_profile_in_worker(self):
        job = {
            "id": "job-hint", "state": "PREPARING", "platform_key": "operator_router",
            "input_data": {"operator_hint": "Example"},
        }
        result = await self.worker.process_job(job)
        self.assertEqual(result["status"], "AUTHENTICATED_IN_MEMORY")
        self.assertEqual(result["action"], "start_session")
        self.assertTrue(any(action == "record_command_result" for action, _ in self.gateway.calls))

    async def test_unknown_platform_hint_is_blocked_and_recorded_once(self):
        job = {
            "id": "job-unknown-hint", "state": "PREPARING", "platform_key": "operator_router",
            "input_data": {"operator_hint": "Some platform that is not configured"},
        }
        result = await self.worker.process_job(job)
        self.assertEqual(result["status"], "BLOCKED")
        self.assertTrue(any(action == "record_command_result" for action, _ in self.gateway.calls))
        again = await self.worker.process_job(job)
        self.assertEqual(again["status"], "DUPLICATE_SKIPPED")

    async def test_financial_command_is_blocked_and_not_executed(self):
        job = {
            "id": "job-financial", "state": "PREPARING", "platform_key": "example",
            "input_data": {"operator_command": {
                "version": 1, "action": "withdraw", "platform_key": "example",
                "account_id": "example-account", "action_approved": True
            }},
        }
        result = await self.worker.process_job(job)
        self.assertEqual(result["status"], "BLOCKED")
        self.assertFalse(self.pool.sessions)
        self.assertTrue(any(event["state"] == "BLOCKED" for event in self.gateway.events))

    async def test_poll_once_ignores_non_operator_jobs(self):
        self.gateway.jobs = [
            {"id": "unrelated", "input_data": {"task": "ordinary-browser-job"}},
            {"id": "operator-status", "state": "PREPARING", "platform_key": "example",
             "input_data": {"operator_command": {
                 "version": 1, "action": "status", "platform_key": "example",
                 "account_id": "example-account", "action_approved": False
             }}},
        ]
        result = await self.worker.poll_once()
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["action"], "status")
        self.assertEqual(result[0]["status"], "NOT_STARTED")

if __name__ == "__main__":
    unittest.main()
