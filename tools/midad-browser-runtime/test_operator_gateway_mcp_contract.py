"""Contract tests for the MCP bridge deployed in MIDAD Browser Gateway v16."""
import unittest
from pathlib import Path

GATEWAY = (
    Path(__file__).resolve().parents[2]
    / "supabase" / "functions" / "midad_browser_agent_gateway" / "index.ts"
)

class BrowserMcpGatewayContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = GATEWAY.read_text(encoding="utf-8")

    def test_mcp_json_rpc_bridge_requires_existing_owner_session(self):
        self.assertIn('const mcpBridge = body.jsonrpc === "2.0" && typeof body.method === "string";', self.source)
        self.assertIn('const browserKey = req.headers.get("x-midad-browser-key") || "";', self.source)
        self.assertIn('const auth = await resolveBrowserUserOwner(sb, sessionToken);', self.source)

        start = self.source.index("if (mcpBridge) {")
        end = self.source.index("\\n    if (userBridge)", start)
        bridge = self.source[start:end]
        self.assertIn("resolveBrowserUserOwner(sb, sessionToken)", bridge)
        self.assertNotIn("SUPABASE_SERVICE_ROLE_KEY", bridge)
        self.assertNotIn("MIDAD_INGEST_KEY", bridge)

    def test_mcp_tool_list_is_bounded_to_four_browser_operations(self):
        start = self.source.index('if (mcpMethod === "tools/list")')
        end = self.source.index('if (mcpMethod !== "tools/call")', start)
        tool_list = self.source[start:end]
        for name in (
            "midad_browser_capabilities",
            "midad_browser_list_sessions",
            "midad_browser_command",
            "midad_browser_get_result",
        ):
            self.assertIn('name: "' + name + '"', tool_list)
        self.assertEqual(tool_list.count("{ name:"), 4)

    def test_mcp_commands_use_the_authenticated_user_bridge(self):
        start = self.source.index("if (mcpBridge) {")
        end = self.source.index("\\n    if (userBridge)", start)
        bridge = self.source[start:end]
        self.assertIn("unknown_browser_tool", bridge)
        self.assertIn('body: JSON.stringify({ action: "user_bridge", subaction, token: sessionToken, ...extra })', bridge)
        self.assertIn("isError: !upstream.ok || result?.ok !== true", bridge)
        self.assertIn("request_id", bridge)
        self.assertIn("job_id", bridge)

if __name__ == "__main__":
    unittest.main()
