"""Contract tests for the authenticated MIDAD Browser user bridge."""
import unittest
from pathlib import Path

SOURCE = Path(__file__).resolve().parents[2] / "supabase" / "functions" / "midad_browser_user_api" / "index.ts"

class BrowserUserApiContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = SOURCE.read_text(encoding="utf-8")

    def test_custom_control_room_session_is_hashed_and_age_checked(self):
        self.assertIn('control_room_sessions', self.source)
        self.assertIn('token_hash', self.source)
        self.assertIn('crypto.subtle.digest("SHA-256"', self.source)
        self.assertIn('30 * 24 * 60 * 60 * 1000', self.source)

    def test_owner_is_derived_from_single_profile_not_client_payload(self):
        self.assertIn('from("profiles").select("id").limit(2)', self.source)
        self.assertIn('ownerUserId: String(profiles.data[0].id)', self.source)
        self.assertNotIn('body.owner_user_id', self.source)

    def test_only_safe_browser_actions_are_exposed(self):
        for action in ('"capabilities"', '"list_sessions"', '"command"', '"get_result"'):
            self.assertIn(action, self.source)
        for forbidden in ('"record_event"', '"record_command_result"', '"create_job"', '"list_jobs"'):
            self.assertNotIn('action === ' + forbidden, self.source)

    def test_operator_hint_is_sent_only_to_private_gateway(self):
        self.assertIn('queue_operator_hint', self.source)
        self.assertIn('x-midad-ingest-key', self.source)
        self.assertIn('SUPABASE_SERVICE_ROLE_KEY', self.source)

    def test_worker_liveness_requires_fresh_heartbeat_for_same_owner(self):
        self.assertIn('midad_playwright_worker', self.source)
        self.assertIn('heartbeat_at', self.source)
        self.assertIn('45_000', self.source)
        self.assertIn('profile_ref', self.source)

    def test_cors_is_limited_to_control_room_pages_and_responses_are_no_store(self):
        self.assertIn('https://sirahwaz.github.io', self.source)
        self.assertIn('"cache-control": "no-store"', self.source)

if __name__ == "__main__":
    unittest.main()
