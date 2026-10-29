"""Offline tests for platform hint routing and command policy."""
import unittest
from operator_command_router import (
    CommandRoutingError, build_operator_request, infer_hint_action,
    resolve_platform_hint, validate_operator_command,
)

class OperatorCommandRouterTests(unittest.TestCase):
    def setUp(self):
        self.profiles = [
            {
                "account_id": "taskmarket-main",
                "platform_key": "taskmarket",
                "display_name": "Taskmarket",
                "aliases": ["task market", "taskmarket.dev"],
                "host": "taskmarket.dev",
                "login_url": "https://taskmarket.dev/login",
                "password_secret_ref": "MIDAD_TASKMARKET_PASSWORD",
                "username": "operator@example.invalid",
                "username_selector": "input[name='email']",
                "password_selector": "input[name='password']",
                "submit_selector": "button[type='submit']",
                "success_selector": "[data-testid='account-home']",
                "login_post_paths": ["/login"],
            },
            {
                "account_id": "bounties-main",
                "platform_key": "bounties",
                "display_name": "Bounties",
                "aliases": ["bounties.sh"],
                "host": "bounties.sh",
                "login_url": "https://bounties.sh/login",
                "password_secret_ref": "MIDAD_BOUNTIES_PASSWORD",
                "username": "operator@example.invalid",
                "login_post_paths": ["/login"],
            },
        ]

    def test_bare_platform_hint_defaults_to_start_session(self):
        request = build_operator_request("Taskmarket", self.profiles)
        self.assertEqual(request["action"], "start_session")
        self.assertEqual(request["account_id"], "taskmarket-main")
        self.assertEqual(request["target_url"], "https://taskmarket.dev/login")
        self.assertNotIn("password", str(request).lower().replace("password_secret_ref", ""))

    def test_sign_in_is_treated_as_login_not_financial_signature(self):
        request = build_operator_request("sign in to Taskmarket", self.profiles)
        self.assertEqual(request["action"], "start_session")

    def test_read_hint_routes_to_inspect(self):
        self.assertEqual(build_operator_request("inspect Taskmarket", self.profiles)["action"], "inspect")

    def test_financial_hint_is_blocked_before_routing(self):
        with self.assertRaisesRegex(CommandRoutingError, "FINANCIAL_OR_DESTRUCTIVE"):
            build_operator_request("withdraw from Taskmarket", self.profiles)

    def test_ambiguous_alias_is_rejected(self):
        profiles = [dict(self.profiles[0], aliases=["work portal"]), dict(self.profiles[1], aliases=["work portal"])]
        with self.assertRaisesRegex(CommandRoutingError, "AMBIGUOUS"):
            resolve_platform_hint("open work portal", profiles)

    def test_unknown_platform_is_not_guessed(self):
        with self.assertRaisesRegex(CommandRoutingError, "NO_APPROVED_PLATFORM_MATCH"):
            resolve_platform_hint("some unknown platform", self.profiles)

    def test_rejects_command_for_different_account(self):
        with self.assertRaisesRegex(CommandRoutingError, "ACCOUNT_PROFILE_MISMATCH"):
            validate_operator_command({"action": "inspect", "account_id": "other"}, self.profiles[0], {"taskmarket.dev"})

    def test_generic_fill_requires_explicit_approval_and_cannot_target_password(self):
        command = {"action": "fill", "account_id": "taskmarket-main", "selector": "input[name='email']", "value": "safe", "action_approved": False}
        with self.assertRaisesRegex(CommandRoutingError, "ACTION_APPROVAL_REQUIRED"):
            validate_operator_command(command, self.profiles[0], {"taskmarket.dev"})
        command["action_approved"] = True
        command["selector"] = self.profiles[0]["password_selector"]
        with self.assertRaisesRegex(CommandRoutingError, "PASSWORD_FIELD"):
            validate_operator_command(command, self.profiles[0], {"taskmarket.dev"})

    def test_navigation_requires_profile_host(self):
        with self.assertRaisesRegex(CommandRoutingError, "TARGET_HOST_NOT_PROFILE_ALLOWED"):
            validate_operator_command({"action": "navigate", "account_id": "taskmarket-main", "target_url": "https://evil.example/"}, self.profiles[0], {"taskmarket.dev"})

    def test_direct_click_hint_creates_approved_typed_command(self):
        command = build_operator_request("click Taskmarket selector=button[data-testid=tasks]", self.profiles)
        self.assertEqual(command["action"], "click")
        self.assertEqual(command["selector"], "button[data-testid=tasks]")
        self.assertTrue(command["action_approved"])

    def test_direct_fill_hint_requires_explicit_safe_selector_and_value(self):
        command = build_operator_request(
            "fill Taskmarket selector=input[name=email] value=operator@example.invalid",
            self.profiles,
        )
        self.assertEqual(command["action"], "fill")
        self.assertEqual(command["selector"], "input[name=email]")
        self.assertEqual(command["value"], "operator@example.invalid")
        self.assertTrue(command["action_approved"])

    def test_click_hint_without_selector_is_rejected(self):
        with self.assertRaisesRegex(CommandRoutingError, "SELECTOR_REQUIRED"):
            build_operator_request("click Taskmarket", self.profiles)

    def test_fill_hint_cannot_target_password_or_token_fields(self):
        for selector in ("input[name=password]", "input[name=access_token]", "input[name=secret]"):
            with self.subTest(selector=selector):
                with self.assertRaisesRegex(CommandRoutingError, "SENSITIVE_FIELD"):
                    build_operator_request(
                        f"fill Taskmarket selector={selector} value=example", self.profiles
                    )

    def test_direct_wait_hint_does_not_need_interaction_approval(self):
        command = build_operator_request(
            "wait for Taskmarket selector=[data-testid=account-home]", self.profiles
        )
        self.assertEqual(command["action"], "wait_for_selector")
        self.assertFalse(command["action_approved"])
        self.assertEqual(command["selector"], "[data-testid=account-home]")

    def test_high_impact_action_is_never_routed(self):
        with self.assertRaisesRegex(CommandRoutingError, "ACTION_BLOCKED"):
            validate_operator_command({"action": "withdraw", "account_id": "taskmarket-main", "action_approved": True}, self.profiles[0], {"taskmarket.dev"})

if __name__ == "__main__":
    unittest.main()
