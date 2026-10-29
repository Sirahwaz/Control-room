"""Offline tests for task planning and account policy."""
import unittest
from unittest.mock import patch
from agent_policy import Action, decide_action, make_plan, validate_profile

class AgentPolicyTests(unittest.TestCase):
    def setUp(self):
        self.dns=patch("runner.socket.getaddrinfo",return_value=[(2,1,6,"",("93.184.216.34",443))])
        self.dns.start()
        self.addCleanup(self.dns.stop)

    def test_planner_observes_before_login_and_verifies_after(self):
        plan=make_plan("login to the approved account")
        self.assertEqual([s.action for s in plan],[Action.INSPECT,Action.LOGIN,Action.READ])

    def test_blank_goal_is_rejected(self):
        with self.assertRaisesRegex(ValueError,"GOAL_REQUIRED"): make_plan("  ")

    def test_non_allowlisted_account_profile_is_rejected(self):
        with self.assertRaisesRegex(ValueError,"PROFILE_HOST_NOT_ALLOWLISTED"):
            validate_profile({"host":"evil.example","account_id":"a","username":"u","password_secret_ref":"MIDAD_EXAMPLE_PASSWORD"},{"example.com"})

    def test_profile_contains_secret_reference_not_secret(self):
        profile={"host":"example.com","account_id":"demo","username":"user","password_secret_ref":"MIDAD_ACCOUNT_PASSWORD"}
        self.assertEqual(validate_profile(profile,{"example.com"})["password_secret_ref"],"MIDAD_ACCOUNT_PASSWORD")
        self.assertNotIn("password",str(profile.get("password","")))

    def test_financial_and_submission_actions_are_blocked(self):
        for action in (Action.PAYMENT,Action.WITHDRAWAL,Action.SIGN,Action.SUBMIT,Action.DELETE):
            decision=decide_action(action,"https://example.com/",{"example.com"})
            self.assertFalse(decision.allowed)
            self.assertTrue(decision.requires_human_approval)

    def test_login_allowed_only_on_allowlisted_host(self):
        self.assertTrue(decide_action(Action.LOGIN,"https://example.com/login",{"example.com"}).allowed)
        self.assertFalse(decide_action(Action.LOGIN,"https://evil.example/login",{"example.com"}).allowed)

if __name__=="__main__": unittest.main()
