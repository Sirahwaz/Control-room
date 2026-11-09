"""Tests for scoped browser automation and one-shot high-impact authorization."""
import unittest

from automation_policy import evaluate_action


PROFILE = {
    "owner_user_id": "owner-1",
    "account_id": "github-main",
    "platform_key": "github",
    "host": "github.com",
    "resource_hosts": ["api.github.com"],
    "automation_policy": {
        "mode": "scoped_autonomy",
        "allowed_hosts": ["github.com", "api.github.com"],
        "allowed_paths": ["/owner/repo"],
        "allowed_actions": [
            "inspect", "read", "navigate", "search", "wait_for_selector",
            "click", "fill", "select", "upload", "download",
            "create", "update", "delete", "submit_form",
            "publish", "send", "deploy", "change_permissions",
            "use_secret",
        ],
    },
}


def request(action, **overrides):
    value = {
        "owner_user_id": "owner-1",
        "account_id": "github-main",
        "platform_key": "github",
        "host": "github.com",
        "path": "/owner/repo/settings",
        "task_id": "task-1",
        "action": action,
    }
    value.update(overrides)
    return value


def approval(action, **overrides):
    value = {
        "approval_id": "approval-1",
        "approved_by_owner": True,
        "owner_user_id": "owner-1",
        "account_id": "github-main",
        "platform_key": "github",
        "host": "github.com",
        "path": "/owner/repo/settings",
        "task_id": "task-1",
        "action": action,
        "expires_at": "2026-11-09T13:00:00+00:00",
        "consumed_at": None,
    }
    value.update(overrides)
    return value


class ScopedAutomationPolicyTests(unittest.TestCase):
    NOW = "2026-11-09T12:00:00+00:00"

    def decide(self, action, **kwargs):
        return evaluate_action(action, PROFILE, request(action, **kwargs),
                               now=self.NOW, **{k: v for k, v in kwargs.items() if k in {"approval"}})

    def test_scoped_autonomy_allows_reversible_updates_without_per_action_prompt(self):
        result = evaluate_action(
            "update", PROFILE, request("update"), now=self.NOW
        )
        self.assertTrue(result.allowed)
        self.assertEqual(result.risk, "reversible")
        self.assertFalse(result.requires_approval)

    def test_scoped_autonomy_allows_fill_and_select_within_profile_scope(self):
        for action in ("click", "fill", "select", "create"):
            with self.subTest(action=action):
                result = evaluate_action(action, PROFILE, request(action), now=self.NOW)
                self.assertTrue(result.allowed, result.reason)

    def test_assisted_mode_does_not_enable_unbounded_interactive_actions(self):
        profile = {**PROFILE, "automation_policy": {**PROFILE["automation_policy"], "mode": "assisted"}}
        result = evaluate_action("update", profile, request("update"), now=self.NOW)
        self.assertFalse(result.allowed)
        self.assertEqual(result.reason, "INTERACTION_APPROVAL_REQUIRED")

    def test_delete_requires_exact_one_time_owner_approval(self):
        denied = evaluate_action("delete", PROFILE, request("delete"), now=self.NOW)
        self.assertFalse(denied.allowed)
        self.assertTrue(denied.requires_approval)
        self.assertEqual(denied.reason, "HIGH_IMPACT_APPROVAL_REQUIRED")

        granted = evaluate_action(
            "delete", PROFILE, request("delete"), approval=approval("delete"), now=self.NOW
        )
        self.assertTrue(granted.allowed)
        self.assertEqual(granted.risk, "high_impact")

    def test_approval_cannot_be_replayed_or_reused_for_another_task(self):
        replayed = evaluate_action(
            "delete", PROFILE, request("delete"),
            approval=approval("delete", consumed_at="2026-11-09T11:59:00+00:00"),
            now=self.NOW,
        )
        wrong_task = evaluate_action(
            "delete", PROFILE, request("delete"),
            approval=approval("delete", task_id="task-other"),
            now=self.NOW,
        )
        self.assertFalse(replayed.allowed)
        self.assertEqual(replayed.reason, "APPROVAL_ALREADY_CONSUMED")
        self.assertFalse(wrong_task.allowed)
        self.assertEqual(wrong_task.reason, "APPROVAL_SCOPE_MISMATCH")

    def test_expired_approval_is_rejected(self):
        result = evaluate_action(
            "delete", PROFILE, request("delete"),
            approval=approval("delete", expires_at="2026-11-09T11:59:59+00:00"),
            now=self.NOW,
        )
        self.assertFalse(result.allowed)
        self.assertEqual(result.reason, "APPROVAL_EXPIRED")

    def test_wrong_host_and_out_of_scope_path_are_rejected(self):
        host = evaluate_action(
            "update", PROFILE, request("update", host="evil.example"), now=self.NOW
        )
        path = evaluate_action(
            "update", PROFILE, request("update", path="/owner/other-repo/settings"), now=self.NOW
        )
        self.assertFalse(host.allowed)
        self.assertEqual(host.reason, "HOST_NOT_ALLOWED")
        self.assertFalse(path.allowed)
        self.assertEqual(path.reason, "PATH_NOT_ALLOWED")

    def test_empty_path_scope_fails_closed(self):
        profile = {
            **PROFILE,
            "automation_policy": {
                **PROFILE["automation_policy"],
                "allowed_paths": [],
            },
        }
        result = evaluate_action("inspect", profile, request("inspect"), now=self.NOW)
        self.assertFalse(result.allowed)
        self.assertEqual(result.reason, "PATH_NOT_ALLOWED")

    def test_security_bypass_actions_are_never_authorized(self):
        for action in ("bypass_captcha", "bypass_mfa", "bypass_kyc", "bot_evasion"):
            with self.subTest(action=action):
                result = evaluate_action(
                    action, PROFILE, request(action),
                    approval=approval(action), now=self.NOW
                )
                self.assertFalse(result.allowed)
                self.assertEqual(result.reason, "PROHIBITED_ACTION")

    def test_read_only_mode_blocks_mutations(self):
        profile = {**PROFILE, "automation_policy": {**PROFILE["automation_policy"], "mode": "read_only"}}
        result = evaluate_action("update", profile, request("update"), now=self.NOW)
        self.assertFalse(result.allowed)
        self.assertEqual(result.reason, "READ_ONLY_MODE")

    def test_vault_use_requires_reference_and_never_accepts_plaintext(self):
        valid_profile = {
            **PROFILE,
            "secret_refs": ["vault://github-main/PAT"],
        }
        valid = evaluate_action(
            "use_secret", valid_profile,
            request("use_secret", secret_ref="vault://github-main/PAT"),
            now=self.NOW,
        )
        leaked = evaluate_action(
            "use_secret", valid_profile,
            request("use_secret", secret_ref="vault://github-main/PAT", value="ghp_plaintext"),
            now=self.NOW,
        )
        self.assertTrue(valid.allowed)
        self.assertFalse(leaked.allowed)
        self.assertEqual(leaked.reason, "RAW_SECRET_PAYLOAD_FORBIDDEN")

    def test_unknown_action_fails_closed(self):
        result = evaluate_action("execute_arbitrary_script", PROFILE,
                                 request("execute_arbitrary_script"), now=self.NOW)
        self.assertFalse(result.allowed)
        self.assertEqual(result.reason, "UNKNOWN_ACTION")


if __name__ == "__main__":
    unittest.main()
