import asyncio
import json
import os
import tempfile
import unittest
from pathlib import Path

from session_core import (
    EncryptedFileSessionStore,
    GrantAuthority,
    GrantRejected,
    HumanGateRequired,
    PolicyDenied,
    ProfileAlreadyExists,
    ProfilePolicyError,
    SessionCore,
    SessionIntegrityError,
)

NOW = 1_800_000_000
ENC_KEY = b"E" * 32
GRANT_KEY = b"G" * 32
STATE = {
    "cookies": [{
        "name": "session_id",
        "value": "never-print-this-session-token",
        "domain": "taskmarket.dev",
        "path": "/",
        "expires": -1,
        "httpOnly": True,
        "secure": True,
        "sameSite": "Lax",
    }],
    "origins": [{
        "origin": "https://taskmarket.dev",
        "localStorage": [{"name": "theme", "value": "dark"}],
    }],
}


class SessionCoreContractTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name) / "vault"
        self.store = EncryptedFileSessionStore(self.root, ENC_KEY)
        self.authority = GrantAuthority(GRANT_KEY)
        self.now = NOW
        self.approved = set()
        self.core = SessionCore(
            self.store,
            self.authority,
            clock=lambda: self.now,
            approval_validator=lambda approval_id, profile_id, agent_id, operation:
                (approval_id, profile_id, agent_id, operation) in self.approved,
        )

    async def create_profile(self, profile_id="taskmarket-main", state=None, expires_in=3600):
        async def manual_login(*, origin, allowed_hosts):
            self.assertEqual(origin, "https://taskmarket.dev")
            self.assertIn("taskmarket.dev", allowed_hosts)
            return state if state is not None else STATE

        return await self.core.setup_login(
            profile_id=profile_id,
            platform_key="taskmarket",
            origin="https://taskmarket.dev/",
            allowed_hosts=["taskmarket.dev"],
            setup_driver=manual_login,
            expires_in_seconds=expires_in,
        )

    def grant(self, profile_id="taskmarket-main", scopes=None, hosts=None, ttl=600):
        return self.authority.issue(
            profile_id=profile_id,
            agent_id="revenue-researcher",
            allowed_hosts=hosts or ["taskmarket.dev"],
            scopes=scopes or ["session:read"],
            ttl_seconds=ttl,
            now=self.now,
        )

    async def test_setup_login_encrypts_state_and_returns_metadata_only(self):
        summary = await self.create_profile()
        self.assertEqual(summary["profile_id"], "taskmarket-main")
        self.assertEqual(summary["platform_key"], "taskmarket")
        self.assertNotIn("cookies", summary)
        self.assertNotIn("storage_state", summary)

        encrypted_file = self.root / "taskmarket-main.session.json"
        raw = encrypted_file.read_text(encoding="utf-8")
        self.assertNotIn("never-print-this-session-token", raw)
        self.assertNotIn('"localStorage"', raw)
        self.assertEqual(os.stat(encrypted_file).st_mode & 0o777, 0o600)
        self.assertEqual(os.stat(self.root).st_mode & 0o777, 0o700)

    async def test_read_grant_executes_inside_runtime_and_scrubs_output(self):
        await self.create_profile()
        calls = []

        async def executor(**kwargs):
            calls.append(kwargs)
            return {
                "status": "CAPTURED",
                "url": "https://taskmarket.dev/tasks?token=one-time-secret#fragment",
                "title": "Public task list",
                "text": "Evidence only",
                "cookies": STATE["cookies"],
                "storage_state": STATE,
                "authorization": "must-not-escape",
            }

        result = await self.core.execute(
            profile_id="taskmarket-main",
            grant_token=self.grant(),
            target_url="https://taskmarket.dev/tasks",
            operation="read_only",
            executor=executor,
        )
        self.assertEqual(result["status"], "OK")
        self.assertEqual(result["result"]["text"], "Evidence only")
        self.assertEqual(result["result"]["url"], "https://taskmarket.dev/tasks")
        self.assertNotIn("one-time-secret", json.dumps(result["result"]))
        self.assertNotIn("cookies", result["result"])
        self.assertNotIn("storage_state", result["result"])
        self.assertNotIn("authorization", result["result"])
        self.assertEqual(calls[0]["storage_state"], STATE)
        self.assertEqual(calls[0]["target_url"], "https://taskmarket.dev/tasks")

    async def test_profile_cannot_be_overwritten_without_explicit_rotation(self):
        await self.create_profile()
        with self.assertRaises(ProfileAlreadyExists):
            self.store.save(
                profile_id="taskmarket-main",
                platform_key="taskmarket",
                origin="https://taskmarket.dev",
                allowed_hosts=["taskmarket.dev"],
                storage_state=STATE,
                created_at=NOW,
                expires_at=NOW + 3600,
            )

    async def test_wrong_encryption_key_fails_closed(self):
        await self.create_profile()
        wrong_store = EncryptedFileSessionStore(self.root, b"X" * 32)
        with self.assertRaises(SessionIntegrityError):
            wrong_store.load("taskmarket-main")

    async def test_tampered_ciphertext_fails_closed(self):
        await self.create_profile()
        path = self.root / "taskmarket-main.session.json"
        envelope = json.loads(path.read_text(encoding="utf-8"))
        envelope["origin"] = "https://attacker.example"
        path.write_text(json.dumps(envelope), encoding="utf-8")
        with self.assertRaises((SessionIntegrityError, ProfilePolicyError)):
            self.store.load("taskmarket-main")

    async def test_grant_for_another_profile_is_rejected(self):
        await self.create_profile()
        with self.assertRaises(GrantRejected):
            await self.core.execute(
                profile_id="taskmarket-main",
                grant_token=self.grant(profile_id="different-profile"),
                target_url="https://taskmarket.dev/tasks",
                operation="read_only",
                executor=lambda **kwargs: {"status": "SHOULD_NOT_RUN"},
            )

    async def test_target_host_outside_profile_allowlist_is_rejected_before_execution(self):
        await self.create_profile()
        called = False

        async def executor(**kwargs):
            nonlocal called
            called = True
            return {"status": "CAPTURED"}

        with self.assertRaises(ProfilePolicyError):
            await self.core.execute(
                profile_id="taskmarket-main",
                grant_token=self.grant(),
                target_url="https://unapproved.example/",
                operation="read_only",
                executor=executor,
            )
        self.assertFalse(called)

    async def test_expired_agent_grant_is_rejected(self):
        await self.create_profile()
        token = self.grant(ttl=30)
        self.now += 31
        with self.assertRaises(GrantRejected):
            await self.core.execute(
                profile_id="taskmarket-main",
                grant_token=token,
                target_url="https://taskmarket.dev/tasks",
                operation="read_only",
                executor=lambda **kwargs: {"status": "SHOULD_NOT_RUN"},
            )

    async def test_expired_profile_is_rejected(self):
        await self.create_profile(expires_in=10)
        self.now += 11
        with self.assertRaises(ProfilePolicyError):
            await self.core.execute(
                profile_id="taskmarket-main",
                grant_token=self.grant(),
                target_url="https://taskmarket.dev/tasks",
                operation="read_only",
                executor=lambda **kwargs: {"status": "SHOULD_NOT_RUN"},
            )

    async def test_submit_requires_a_matching_human_approval(self):
        await self.create_profile()
        token = self.grant(scopes=["browser:submit"])
        async def executor(**kwargs):
            return {"status": "SUBMITTED", "text": "accepted"}

        with self.assertRaises(HumanGateRequired):
            await self.core.execute(
                profile_id="taskmarket-main",
                grant_token=token,
                target_url="https://taskmarket.dev/tasks",
                operation="submit",
                executor=executor,
                human_approval_id="approval-1",
            )

        self.approved.add(("approval-1", "taskmarket-main", "revenue-researcher", "submit"))
        result = await self.core.execute(
            profile_id="taskmarket-main",
            grant_token=token,
            target_url="https://taskmarket.dev/tasks",
            operation="submit",
            executor=executor,
            human_approval_id="approval-1",
        )
        self.assertEqual(result["result"]["status"], "SUBMITTED")

    async def test_financial_operation_is_never_enabled_by_session_grant(self):
        await self.create_profile()
        with self.assertRaises(PolicyDenied):
            await self.core.execute(
                profile_id="taskmarket-main",
                grant_token=self.grant(scopes=["session:read"]),
                target_url="https://taskmarket.dev/tasks",
                operation="financial",
                executor=lambda **kwargs: {"status": "SHOULD_NOT_RUN"},
            )

    async def test_cookie_or_origin_outside_allowlist_is_rejected(self):
        bad_state = {
            "cookies": [{
                "name": "x", "value": "secret", "domain": "attacker.example",
                "path": "/", "expires": -1, "httpOnly": True, "secure": True, "sameSite": "Lax",
            }],
            "origins": [],
        }
        with self.assertRaises(ProfilePolicyError):
            await self.create_profile(state=bad_state)

    async def test_wildcard_and_non_https_origin_are_rejected(self):
        async def setup_driver(**kwargs):
            return STATE
        with self.assertRaises(ProfilePolicyError):
            await self.core.setup_login(
                profile_id="bad-wildcard",
                platform_key="taskmarket",
                origin="https://taskmarket.dev",
                allowed_hosts=["*.taskmarket.dev"],
                setup_driver=setup_driver,
            )
        with self.assertRaises(ProfilePolicyError):
            await self.core.setup_login(
                profile_id="bad-http",
                platform_key="taskmarket",
                origin="http://taskmarket.dev",
                allowed_hosts=["taskmarket.dev"],
                setup_driver=setup_driver,
            )


if __name__ == "__main__":
    unittest.main(verbosity=2)
