import unittest

from action_policy import evaluate_action


class BrowserActionPolicyTests(unittest.TestCase):
    def decide(self, action, **overrides):
        args = {
            "action": action,
            "target_url": "https://taskmarket.dev/tasks",
            "allowed_hosts": {"taskmarket.dev"},
        }
        args.update(overrides)
        return evaluate_action(**args)

    def test_public_observation_is_allowed_on_exact_allowlisted_https_host(self):
        for action in ("navigate", "read_dom", "extract_text", "screenshot"):
            with self.subTest(action=action):
                decision = self.decide(action)
                self.assertEqual(decision["status"], "ALLOW")
                self.assertEqual(decision["code"], "READ_ONLY_ALLOWED")

    def test_http_is_blocked(self):
        decision = self.decide("navigate", target_url="http://taskmarket.dev/tasks")
        self.assertEqual(decision["status"], "BLOCK")
        self.assertEqual(decision["code"], "HTTPS_REQUIRED")

    def test_embedded_credentials_are_blocked(self):
        decision = self.decide("navigate", target_url="https://user:secret@taskmarket.dev/tasks")
        self.assertEqual(decision["status"], "BLOCK")
        self.assertEqual(decision["code"], "URL_CREDENTIALS_FORBIDDEN")

    def test_host_must_match_allowlist_exactly(self):
        decision = self.decide("navigate", target_url="https://evil-taskmarket.dev/tasks")
        self.assertEqual(decision["status"], "BLOCK")
        self.assertEqual(decision["code"], "HOST_NOT_ALLOWLISTED")

    def test_private_ip_is_blocked(self):
        decision = self.decide("navigate", target_url="https://127.0.0.1/admin", allowed_hosts={"127.0.0.1"})
        self.assertEqual(decision["status"], "BLOCK")
        self.assertEqual(decision["code"], "NON_PUBLIC_HOST")

    def test_interaction_requires_explicit_approval(self):
        decision = self.decide("click")
        self.assertEqual(decision["status"], "BLOCK")
        self.assertEqual(decision["code"], "ACTION_APPROVAL_REQUIRED")

    def test_approved_interaction_is_allowed(self):
        decision = self.decide("click", action_approved=True)
        self.assertEqual(decision["status"], "ALLOW")
        self.assertEqual(decision["code"], "APPROVED_INTERACTION_ALLOWED")

    def test_authenticated_action_requires_confirmed_session(self):
        decision = self.decide("read_dom", requires_session=True, session_confirmed=False)
        self.assertEqual(decision["status"], "BLOCK")
        self.assertEqual(decision["code"], "SESSION_NOT_CONFIRMED")

    def test_external_submission_requires_explicit_approval(self):
        decision = self.decide("submit_form", action_approved=False, session_confirmed=True, requires_session=True)
        self.assertEqual(decision["status"], "BLOCK")
        self.assertEqual(decision["code"], "ACTION_APPROVAL_REQUIRED")

    def test_financial_actions_stay_disabled_by_default(self):
        for action in ("wallet_sign", "transfer", "withdraw"):
            with self.subTest(action=action):
                decision = self.decide(action, action_approved=True, session_confirmed=True, requires_session=True)
                self.assertEqual(decision["status"], "BLOCK")
                self.assertEqual(decision["code"], "FINANCIAL_GATE_DISABLED")

    def test_financial_action_requires_both_explicit_approval_and_gate(self):
        decision = self.decide(
            "transfer",
            action_approved=True,
            financial_gate_enabled=True,
            session_confirmed=True,
            requires_session=True,
        )
        self.assertEqual(decision["status"], "ALLOW")
        self.assertEqual(decision["code"], "APPROVED_FINANCIAL_ACTION_ALLOWED")

    def test_human_verification_bypass_is_always_blocked(self):
        for action in ("captcha_bypass", "human_verification_bypass", "mfa_bypass", "bot_evasion"):
            with self.subTest(action=action):
                decision = self.decide(
                    action,
                    action_approved=True,
                    financial_gate_enabled=True,
                    session_confirmed=True,
                    requires_session=True,
                )
                self.assertEqual(decision["status"], "BLOCK")
                self.assertEqual(decision["code"], "SECURITY_CONTROL_BYPASS_PROHIBITED")

    def test_unknown_action_fails_closed(self):
        decision = self.decide("do_magic")
        self.assertEqual(decision["status"], "BLOCK")
        self.assertEqual(decision["code"], "UNKNOWN_ACTION")


if __name__ == "__main__":
    unittest.main()
