"""Read-only source contracts for the live MIDAD Account Factory v17."""
import unittest
from pathlib import Path

SOURCE = Path(__file__).resolve().parents[2] / "supabase" / "functions" / "midad_account_factory" / "index.ts"

class AccountFactoryContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = SOURCE.read_text(encoding="utf-8")

    def test_endpoint_is_private_before_action_dispatch(self):
        auth = self.source.index('if (!await authorized(req))')
        dispatch = self.source.index('const action = clean(body.action || "capabilities"')
        self.assertLess(auth, dispatch)
        self.assertIn('SUPABASE_SERVICE_ROLE_KEY', self.source)
        self.assertIn('MIDAD_INGEST_KEY', self.source)

    def test_factory_exposes_existing_account_lifecycle_actions(self):
        for action in (
            "capabilities", "list_platforms", "assess_platform", "prepare_profile",
            "register_agent_identity", "list_agent_eligible_listings",
            "inspect_agent_listing", "queue_onboarding", "list_accounts", "list_runs",
        ):
            self.assertIn('"' + action + '"', self.source)

    def test_policy_gate_rejects_unverified_identity_and_automation(self):
        for code in (
            "GOVERNMENT_ID_REQUIRED", "IDENTITY_POLICY_UNVERIFIED",
            "REGION_NOT_SUPPORTED", "REGION_ELIGIBILITY_UNVERIFIED",
            "HUMAN_CHECKPOINT_REQUIRED", "AUTOMATION_NOT_ALLOWED",
            "REGISTRATION_AUTOMATION_NOT_VERIFIED",
        ):
            self.assertIn(code, self.source)
        self.assertIn("eligible_for_automated_onboarding", self.source)

    def test_external_agent_registration_requires_explicit_approval(self):
        self.assertIn('if (body.owner_approved !== true)', self.source)
        self.assertIn('platformKey !== "superteam_fun"', self.source)
        self.assertIn('https://superteam.fun/api/agents', self.source)

    def test_uncertain_registration_is_reconciled_not_repeated(self):
        for marker in (
            "agent_registration_attempted_at",
            "prior_registration_attempt_requires_reconciliation",
            "REGISTRATION_RESULT_UNCERTAIN",
            "reconcile_superteam_agent_before_retry",
            "duplicate_creation_allowed: false",
        ):
            self.assertIn(marker, self.source)

    def test_platform_secrets_use_vault_rpc_and_references(self):
        self.assertIn('db.rpc("midad_store_platform_secret"', self.source)
        self.assertIn('db.rpc("midad_read_platform_secret"', self.source)
        self.assertIn("credential_vault_ref", self.source)
        self.assertIn("claim_code_vault_ref", self.source)

    def test_browser_onboarding_requires_ready_profiled_provider(self):
        start = self.source.index('if (action === "queue_onboarding")')
        end = self.source.index('if (action === "list_accounts")', start)
        block = self.source[start:end]
        self.assertIn('.eq("status", "ready")', block)
        self.assertIn('!browserProvider.profile_ref', block)
        self.assertIn("BROWSER_PROVIDER_NOT_READY", block)
        self.assertIn('registration_boundary: "prepare_only_stop_before_final_terms_or_submit"', block)
        self.assertIn('idempotency_key: "midad-account:" + platformKey + ":midad_ai:v1"', block)

if __name__ == "__main__":
    unittest.main()
