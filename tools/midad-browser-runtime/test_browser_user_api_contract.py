"""Contract tests for the authenticated browser bridge embedded in the existing gateway."""
import unittest
from pathlib import Path

SOURCE = Path(__file__).resolve().parents[2] / "supabase" / "functions" / "midad_browser_agent_gateway" / "index.ts"

class BrowserUserApiContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = SOURCE.read_text(encoding="utf-8")

    def test_browser_user_and_mcp_bridges_require_server_verified_sessions(self):
        self.assertIn('const userBridge = action === "user_bridge"', self.source)
        self.assertIn('const mcpBridge = body.jsonrpc === "2.0" && typeof body.method === "string"', self.source)
        self.assertRegex(self.source, r'if\s*\(!authorized\(req\)\s*&&\s*!userBridge\s*&&\s*!mcpBridge\s*&&\s*!githubOidcProxy\)')
        self.assertIn('const githubOidcProxy = action === "github_oidc_proxy"', self.source)
        self.assertIn('verifyGithubActionsOidc(token, GITHUB_OIDC_EXPECTED)', self.source)
        self.assertIn('const sessionToken = browserKey || bearer', self.source)
        self.assertIn('const auth = await resolveBrowserUserOwner(sb, sessionToken)', self.source)
        self.assertIn('browser_user_origin_not_allowed', self.source)

    def test_mcp_bridge_exposes_only_the_registered_browser_tool_allowlist(self):
        self.assertIn('midad_browser_capabilities', self.source)
        self.assertIn('midad_browser_list_sessions', self.source)
        self.assertIn('midad_browser_command', self.source)
        self.assertIn('midad_browser_get_result', self.source)
        self.assertIn('unknown_browser_tool', self.source)
        self.assertIn('user_bridge_action_not_allowed', self.source)

    def test_custom_session_is_hashed_and_requires_explicit_owner_binding(self):
        self.assertIn('control_room_sessions', self.source)
        self.assertIn('token_hash', self.source)
        self.assertIn('crypto.subtle.digest("SHA-256"', self.source)
        self.assertIn('validateOwnerSessionBinding(session)', self.source)
        self.assertIn('session_owner_binding_required', self.source)

    def test_owner_is_derived_only_from_the_authenticated_session_row(self):
        start = self.source.index("async function resolveBrowserUserOwner")
        end = self.source.index("Deno.serve", start)
        resolver = self.source[start:end]
        self.assertIn('select("id,active,created_at,owner_user_id")', resolver)
        self.assertIn('ownerUserId: ownerBinding.ownerUserId', resolver)
        self.assertNotIn('from("profiles")', resolver)
        self.assertNotIn("body.owner_user_id", resolver)

    def test_only_safe_subactions_are_exposed(self):
        self.assertIn('["capabilities", "list_sessions", "create_readonly_job", "command", "get_result"]', self.source)
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
