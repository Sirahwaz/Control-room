"""Safe task-envelope and result contracts for the Cloudflare Browser participant."""
import hashlib
import unittest

from continuity_browser_worker_v2 import (
    ContinuityWorkerError,
    sanitize_browser_result,
    validate_browser_payload,
    validate_claimed_task,
)


class ContinuityBrowserWorkerContractTests(unittest.TestCase):
    def setUp(self):
        self.owner = "00000000-0000-4000-8000-000000000001"

    def test_claim_must_be_bound_to_configured_owner_and_live_lease(self):
        claim = {"task": {
            "task_id": "task-1", "owner_id": self.owner,
            "payload": {"operator_hint": "inspect example"},
            "attempt": 1, "lease_token": "a" * 64,
        }}
        result = validate_claimed_task(claim, self.owner)
        self.assertEqual(result["task_id"], "task-1")
        self.assertEqual(result["owner_id"], self.owner)
        self.assertEqual(result["attempt"], 1)
        self.assertEqual(result["lease_token"], "a" * 64)

    def test_claim_from_another_owner_is_rejected(self):
        claim = {"task": {
            "task_id": "task-1", "owner_id": "another-owner",
            "payload": {"operator_hint": "inspect example"},
            "attempt": 1, "lease_token": "a" * 64,
        }}
        with self.assertRaisesRegex(ContinuityWorkerError, "TASK_OWNER_MISMATCH"):
            validate_claimed_task(claim, self.owner)

    def test_claim_without_lease_token_or_task_id_is_rejected(self):
        for task in (
            {"owner_id": self.owner, "payload": {"operator_hint": "inspect example"}, "lease_token": "a" * 64},
            {"task_id": "task-1", "owner_id": self.owner, "payload": {"operator_hint": "inspect example"}},
        ):
            with self.subTest(task=task):
                with self.assertRaises(ContinuityWorkerError):
                    validate_claimed_task({"task": task}, self.owner)

    def test_only_bounded_operator_hint_or_command_payloads_are_accepted(self):
        self.assertEqual(validate_browser_payload({"operator_hint": "inspect Example"})["mode"], "hint")
        self.assertEqual(validate_browser_payload({"operator_command": {"action": "inspect"}})["mode"], "command")
        for payload in (
            {"password": "not-allowed"},
            {"operator_hint": "inspect example", "extra": "not-allowed"},
            {"operator_hint": "inspect example", "operator_command": {"action": "inspect"}},
            {"operator_hint": "x" * 501},
        ):
            with self.subTest(payload=payload):
                with self.assertRaises(ContinuityWorkerError):
                    validate_browser_payload(payload)

    def test_generic_fill_click_and_submit_require_separate_human_approval(self):
        for action in ("click", "fill", "submit_form", "payment", "withdraw", "delete"):
            with self.subTest(action=action):
                with self.assertRaisesRegex(ContinuityWorkerError, "HUMAN_APPROVAL_REQUIRED"):
                    validate_browser_payload({"operator_command": {"action": action}})

    def test_sensitive_hint_values_are_rejected(self):
        for hint in (
            "inspect example password=hunter2",
            "inspect example Bearer " + "a" * 40,
            "inspect example api_key=not-a-real-key",
        ):
            with self.subTest(hint=hint):
                with self.assertRaises(ContinuityWorkerError):
                    validate_browser_payload({"operator_hint": hint})

    def test_result_keeps_metadata_but_never_page_text_or_secret_fields(self):
        page_text = "private body text with token=example-secret-value"
        result = sanitize_browser_result({
            "status": "INSPECTED",
            "action": "inspect",
            "account_id": "example-account",
            "platform_key": "example",
            "url": "https://example.com/dashboard",
            "title": "Dashboard",
            "text_preview": page_text,
            "text_chars": len(page_text),
            "session_storage": "encrypted_at_rest",
            "password": "must-not-leak",
            "http_status": 200,
        })
        self.assertEqual(result["status"], "INSPECTED")
        self.assertEqual(result["text_sha256"], hashlib.sha256(page_text.encode()).hexdigest())
        self.assertNotIn("text_preview", result)
        self.assertNotIn("password", result)
        self.assertNotIn("example-secret-value", str(result))
        self.assertEqual(result["http_status"], 200)


if __name__ == "__main__":
    unittest.main()
