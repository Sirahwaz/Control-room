"""Contract tests for the browser user bridge embedded in the existing gateway."""
import unittest
from pathlib import Path

SOURCE = Path(__file__).resolve().parents[2] / "supabase" / "functions" / "midad_browser_agent_gateway" / "index.ts"

class BrowserUserApiContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = SOURCE.read_text(encoding="utf-8")

    def test_frontend_uses_existing_gateway_and_opaque_session_token(self):
        ui = (SOURCE.parents[3] / "midad-browser.js").read_text(encoding="utf-8")
        self.assertIn("/functions/v1/midad_browser_agent_gateway", ui)
        self.assertIn("session_token:token", ui)
        self.assertNotIn("midad_browser_user_api", ui)

    def test_custom_control_room_session_is_hashed_and_age_checked(self):
        self.assertIn("authorizeControlRoomSession", self.source)
        self.assertIn("control_room_sessions", self.source)
        self.assertIn("token_hash", self.source)
        self.assertIn('crypto.subtle.digest("SHA-256"', self.source)
        self.assertIn("30 * 24 * 60 * 60 * 1000", self.source)

    def test_owner_is_derived_from_single_profile_not_client_payload(self):
        self.assertIn('from("profiles").select("id").limit(2)', self.source)
        self.assertIn("profiles.data[0].id", self.source)
        self.assertNotIn("body.owner_user_id", self.source[self.source.index("async function authorizeControlRoomSession"):self.source.index("Deno.serve")])

    def test_only_four_browser_ui_actions_are_session_authenticated(self):
        for action in ('"ui_capabilities"', '"ui_list_sessions"', '"ui_command"', '"ui_get_result"'):
            self.assertIn(action, self.source)
        self.assertIn("UI_ACTIONS", self.source)
        self.assertIn("authorizeControlRoomSession", self.source)

    def test_private_gateway_actions_remain_ingest_or_service_authorized(self):
        self.assertIn("privateAuthorized", self.source)
        self.assertIn("if (!privateAuthorized && !isUiAction)", self.source)
        self.assertIn("x-midad-ingest-key", self.source)

    def test_worker_liveness_requires_fresh_heartbeat_for_same_owner(self):
        self.assertIn("midad_playwright_worker", self.source)
        self.assertIn("heartbeat_at", self.source)
        self.assertIn("45_000", self.source)
        self.assertIn("profile_ref", self.source)

    def test_ui_commands_are_owner_scoped_and_route_through_existing_queue(self):
        self.assertIn('action = "queue_operator_hint"', self.source)
        self.assertIn("owner_user_id: ownerUserId", self.source)
        self.assertIn("unsafeOperatorHint", self.source)
        self.assertIn("idempotency_key", self.source)

    def test_cors_and_body_size_are_bounded_for_ui_actions(self):
        self.assertIn("https://sirahwaz.github.io", self.source)
        self.assertIn("request_too_large", self.source)
        self.assertIn("cache-control", self.source)

if __name__ == "__main__":
    unittest.main()
