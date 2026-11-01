"""Contract tests for the authenticated browser bridge embedded in the existing gateway."""
import unittest
from pathlib import Path

SOURCE = Path(__file__).resolve().parents[2] / "supabase" / "functions" / "midad_browser_agent_gateway" / "index.ts"

class BrowserUserApiContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = SOURCE.read_text(encoding="utf-8")

    def test_user_bridge_is_the_only_publicly_authenticated_action(self):
        self.assertIn('const userBridge = action === "user_bridge"', self.source)
        self.assertIn('if (!authorized(req) && !userBridge)', self.source)
        self.assertIn('browser_user_origin_not_allowed', self.source)

    def test_custom_session_is_hashed_and_age_checked(self):
        self.assertIn('control_room_sessions', self.source)
        self.assertIn('token_hash', self.source)
        self.assertIn('crypto.subtle.digest("SHA-256"', self.source)
        self.assertIn('30 * 24 * 60 * 60 * 1000', self.source)

    def test_owner_is_derived_from_one_server_side_profile(self):
        self.assertIn('from("profiles").select("id").limit(2)', self.source)
        self.assertIn('ownerUserId: String(profiles.data[0].id)', self.source)
        self.assertNotIn('body.owner_user_id', self.source)

    def test_only_safe_subactions_are_exposed(self):
        self.assertIn('["capabilities", "list_sessions", "command", "get_result"]', self.source)
        self.assertIn('user_bridge_action_not_allowed', self.source)

    def test_worker_liveness_requires_fresh_heartbeat_for_same_owner(self):
        self.assertIn('midad_playwright_worker', self.source)
        self.assertIn('heartbeat_at', self.source)
        self.assertIn('45_000', self.source)
        self.assertIn('eq("profile_ref", ownerUserId)', self.source)

    def test_owner_scoped_jobs_and_private_gateway_calls(self):
        self.assertIn('eq("owner_user_id", ownerUserId)', self.source)
        self.assertIn('x-midad-ingest-key', self.source)
        self.assertIn('SUPABASE_SERVICE_ROLE_KEY', self.source)

if __name__ == "__main__":
    unittest.main()
