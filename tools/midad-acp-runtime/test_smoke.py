import asyncio
import os
import tempfile
import unittest
from pathlib import Path

from smoke import (
    ACPPolicyError,
    MidadACPClient,
    build_agent_environment,
    run_echo_smoke,
    validate_workspace,
)


class ACPReadOnlySmokeTests(unittest.IsolatedAsyncioTestCase):
    async def test_echo_agent_negotiates_streams_and_finishes(self):
        result = await run_echo_smoke()

        self.assertEqual(result["state"], "VERIFIED")
        self.assertEqual(result["stop_reason"], "end_turn")
        self.assertIn("MIDAD_ACP_PROTOCOL_OK", result["text"])
        self.assertTrue(result["session_id"])

    async def test_permission_requests_are_cancelled_by_default(self):
        client = MidadACPClient()
        response = await client.request_permission("session-1", None, [])

        self.assertEqual(response.outcome.outcome, "cancelled")

    def test_client_does_not_offer_filesystem_or_terminal_capabilities(self):
        client = MidadACPClient()

        self.assertFalse(client.capabilities.fs.read_text_file)
        self.assertFalse(client.capabilities.fs.write_text_file)
        self.assertFalse(client.capabilities.terminal)

    def test_agent_environment_excludes_inherited_secrets(self):
        env = build_agent_environment({
            "PATH": "/usr/bin",
            "HOME": "/tmp/midad-home",
            "MIDAD_APMIX_API_KEY": "must-not-pass",
            "OPENAI_API_KEY": "must-not-pass",
            "SUPABASE_SERVICE_ROLE_KEY": "must-not-pass",
            "TELEGRAM_BOT_TOKEN": "must-not-pass",
        })

        self.assertEqual(env["PATH"], "/usr/bin")
        self.assertEqual(env["HOME"], "/tmp/midad-home")
        self.assertNotIn("MIDAD_APMIX_API_KEY", env)
        self.assertNotIn("OPENAI_API_KEY", env)
        self.assertNotIn("SUPABASE_SERVICE_ROLE_KEY", env)
        self.assertNotIn("TELEGRAM_BOT_TOKEN", env)

    def test_workspace_must_resolve_inside_the_approved_root(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspaces"
            allowed = root / "read-only-smoke"
            allowed.mkdir(parents=True)

            resolved = validate_workspace(allowed, root)
            self.assertEqual(resolved, allowed.resolve())

    def test_workspace_symlink_escape_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            root = base / "workspaces"
            outside = base / "outside"
            root.mkdir()
            outside.mkdir()
            link = root / "escape"
            try:
                link.symlink_to(outside, target_is_directory=True)
            except (OSError, NotImplementedError):
                self.skipTest("symlinks are unavailable on this runner")

            with self.assertRaises(ACPPolicyError):
                validate_workspace(link, root)


if __name__ == "__main__":
    unittest.main()
