import asyncio
import base64
import json
import unittest
from unittest.mock import patch

from ephemeral_readonly_worker import GithubOidcGatewayClient, run_worker


def fake_jwt(exp):
    header = base64.urlsafe_b64encode(b'{"alg":"RS256","typ":"JWT","kid":"test"}').decode().rstrip("=")
    payload = base64.urlsafe_b64encode(json.dumps({"exp": exp}).encode()).decode().rstrip("=")
    return header + "." + payload + ".signature"


class FakeGateway:
    worker_id = "gh-123456789-1"

    def __init__(self, jobs=None):
        self.jobs = list(jobs or [])
        self.calls = []

    async def call(self, action, **payload):
        self.calls.append((action, payload))
        if action == "claim_readonly_jobs":
            if self.jobs:
                return {"ok": True, "jobs": [self.jobs.pop(0)]}
            return {"ok": True, "jobs": []}
        return {"ok": True}


class FakeRunner:
    def __init__(self, outcome=None, error=None):
        self.outcome = outcome or {"status": "CAPTURED", "job_id": "job-1"}
        self.error = error
        self.calls = []

    async def run(self, job, lease=None):
        self.calls.append((job, lease))
        if self.error:
            raise self.error
        return self.outcome


class EphemeralWorkerTests(unittest.IsolatedAsyncioTestCase):
    async def test_claims_one_readonly_job_passes_lease_and_releases_it(self):
        job = {
            "id": "job-1",
            "state": "PREPARING",
            "current_url": "https://example.com/",
            "attempt_count": 0,
            "lease_token": "a" * 64,
        }
        gateway = FakeGateway([job])
        runner = FakeRunner()
        result = await run_worker(gateway=gateway, runner=runner, max_jobs=1)

        self.assertEqual(result["processed_count"], 1)
        self.assertEqual(result["outcomes"][0]["status"], "CAPTURED")
        self.assertEqual(runner.calls[0][1], {"lease_token": "a" * 64})
        actions = [action for action, _ in gateway.calls]
        self.assertEqual(actions[0], "worker_heartbeat")
        self.assertIn("claim_readonly_jobs", actions)
        self.assertIn("release_operator_lease", actions)
        release = [payload for action, payload in gateway.calls if action == "release_operator_lease"][0]
        self.assertEqual(release["job_id"], "job-1")
        self.assertEqual(release["lease_token"], "a" * 64)

    async def test_releases_lease_even_when_browser_runner_throws(self):
        job = {
            "id": "job-2",
            "state": "PREPARING",
            "current_url": "https://example.com/",
            "attempt_count": 0,
            "lease_token": "b" * 64,
        }
        gateway = FakeGateway([job])
        runner = FakeRunner(error=RuntimeError("simulated browser failure"))
        result = await run_worker(gateway=gateway, runner=runner, max_jobs=1)

        self.assertEqual(result["processed_count"], 1)
        self.assertEqual(result["outcomes"][0]["status"], "FAILED")
        self.assertTrue(any(action == "release_operator_lease" for action, _ in gateway.calls))

    async def test_exits_when_queue_stays_idle(self):
        gateway = FakeGateway()
        runner = FakeRunner()
        now = [0.0]

        async def fake_sleep(seconds):
            now[0] += seconds

        result = await run_worker(
            gateway=gateway,
            runner=runner,
            max_seconds=60,
            idle_timeout_seconds=2,
            max_jobs=1,
            sleep=fake_sleep,
            clock=lambda: now[0],
        )
        self.assertEqual(result["processed_count"], 0)
        self.assertEqual(sum(1 for action, _ in gateway.calls if action == "claim_readonly_jobs"), 2)

    async def test_rejects_unsafe_runtime_bounds(self):
        gateway = FakeGateway()
        with self.assertRaises(ValueError):
            await run_worker(gateway=gateway, runner=FakeRunner(), max_seconds=300)


class GithubOidcClientTests(unittest.IsolatedAsyncioTestCase):
    async def test_oidc_token_is_cached_until_near_expiry(self):
        calls = []
        token = fake_jwt(4_000_000_000)

        def token_requester():
            calls.append(True)
            return token

        config = type("Config", (), {"supabase_url": "https://project.supabase.co"})()
        client = GithubOidcGatewayClient(
            config,
            token_requester=token_requester,
            worker_id="gh-123456789-1",
        )
        first = await client._get_token()
        second = await client._get_token()
        self.assertEqual(first, token)
        self.assertEqual(second, token)
        self.assertEqual(len(calls), 1)

    async def test_worker_id_is_required_when_not_in_github_run_environment(self):
        config = type("Config", (), {"supabase_url": "https://project.supabase.co"})()
        with patch.dict("os.environ", {"GITHUB_RUN_ID": "", "GITHUB_RUN_ATTEMPT": "1"}):
            with self.assertRaises(ValueError):
                GithubOidcGatewayClient(config, token_requester=lambda: "token", worker_id=None)


if __name__ == "__main__":
    unittest.main()
