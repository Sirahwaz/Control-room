"""Zero-static-secret, GitHub OIDC-authenticated public read-only Browser worker."""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import time
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from urllib.request import Request, build_opener

from runner import BrowserConfig, BrowserJobRunner


class GithubOidcGatewayClient:
    def __init__(self, config, opener=None, token_requester=None, worker_id=None):
        self.config = config
        self._opener = opener or build_opener()
        self._token_requester = token_requester
        run_id = str(os.environ.get("GITHUB_RUN_ID", "")).strip()
        run_attempt = str(os.environ.get("GITHUB_RUN_ATTEMPT", "1")).strip()
        self.worker_id = str(worker_id or f"gh-{run_id}-{run_attempt}").strip()
        if not run_id and worker_id is None:
            raise ValueError("GITHUB_RUN_ID_REQUIRED")
        if not self.worker_id or len(self.worker_id) > 120 or not all(
            char.isalnum() or char in "_.:-" for char in self.worker_id
        ):
            raise ValueError("GITHUB_WORKER_ID_INVALID")
        self._cached_token = ""
        self._cached_exp = 0

    def _request_oidc_token_sync(self):
        if self._token_requester:
            return self._token_requester()
        endpoint = os.environ.get("ACTIONS_ID_TOKEN_REQUEST_URL", "").strip()
        request_token = os.environ.get("ACTIONS_ID_TOKEN_REQUEST_TOKEN", "").strip()
        if not endpoint or not request_token:
            raise RuntimeError("GITHUB_OIDC_ENVIRONMENT_MISSING")
        parts = urlsplit(endpoint)
        query = [(key, value) for key, value in parse_qsl(parts.query, keep_blank_values=True)
                 if key != "audience"]
        query.append(("audience", "midad-browser-worker"))
        url = urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), parts.fragment))
        request = Request(url, headers={"authorization": "Bearer " + request_token, "accept": "application/json"})
        try:
            with self._opener.open(request, timeout=10) as response:
                data = json.loads(response.read(200000).decode("utf-8"))
        except (HTTPError, URLError, TimeoutError, OSError, ValueError) as exc:
            raise RuntimeError("GITHUB_OIDC_TOKEN_REQUEST_FAILED") from exc
        token = str(data.get("value") or "").strip()
        if not token:
            raise RuntimeError("GITHUB_OIDC_TOKEN_EMPTY")
        return token

    @staticmethod
    def _token_exp(token: str) -> int:
        try:
            import base64
            payload = token.split(".")[1]
            payload += "=" * ((4 - len(payload) % 4) % 4)
            decoded = base64.urlsafe_b64decode(payload.encode("ascii"))
            return int(json.loads(decoded.decode("utf-8")).get("exp") or 0)
        except Exception:
            return 0

    async def _get_token(self) -> str:
        if self._cached_token and self._cached_exp > int(time.time()) + 60:
            return self._cached_token
        token = await asyncio.to_thread(self._request_oidc_token_sync)
        self._cached_token = token
        self._cached_exp = self._token_exp(token)
        return token

    def _post_sync(self, token: str, action: str, payload: dict):
        url = self.config.supabase_url.rstrip("/") + "/functions/v1/midad_browser_agent_gateway"
        request = Request(
            url,
            data=json.dumps({"action": "github_oidc_proxy", "payload": {"action": action, **payload}}).encode("utf-8"),
            method="POST",
            headers={
                "content-type": "application/json",
                "authorization": "Bearer " + token,
                "accept": "application/json",
            },
        )
        try:
            with self._opener.open(request, timeout=15) as response:
                data = json.loads(response.read(1000000).decode("utf-8"))
        except (HTTPError, URLError, TimeoutError, OSError, ValueError) as exc:
            raise RuntimeError("github_browser_proxy_request_failed") from exc
        if not isinstance(data, dict) or data.get("ok") is not True:
            code = str(data.get("error") or "invalid_response")[:100] if isinstance(data, dict) else "invalid_response"
            raise RuntimeError("github_browser_proxy_rejected_" + code)
        return data

    async def call(self, action: str, **payload):
        token = await self._get_token()
        return await asyncio.to_thread(self._post_sync, token, action, payload)

    async def record_event(self, **payload):
        return await self.call("record_event", **payload)


async def run_worker(
    config=None,
    gateway=None,
    runner=None,
    *,
    max_seconds: int = 240,
    idle_timeout_seconds: int = 20,
    max_jobs: int = 1,
    sleep=asyncio.sleep,
    clock=time.monotonic,
):
    if not 1 <= int(max_seconds) <= 240:
        raise ValueError("MAX_SECONDS_OUT_OF_RANGE")
    if not 1 <= int(idle_timeout_seconds) <= 60:
        raise ValueError("IDLE_TIMEOUT_OUT_OF_RANGE")
    if not 1 <= int(max_jobs) <= 3:
        raise ValueError("MAX_JOBS_OUT_OF_RANGE")

    if config is None and (gateway is None or runner is None):
        config = BrowserConfig.from_env()
    if gateway is None:
        gateway = GithubOidcGatewayClient(config)
    if runner is None:
        runner = BrowserJobRunner(config, gateway=gateway)
    worker_id = gateway.worker_id
    started = clock()
    last_job_at = started
    outcomes = []

    await gateway.call("worker_heartbeat")

    while clock() - started < max_seconds and len(outcomes) < max_jobs:
        claim = await gateway.call("claim_readonly_jobs")
        jobs = claim.get("jobs") if isinstance(claim, dict) else []
        jobs = jobs if isinstance(jobs, list) else []
        if not jobs:
            if clock() - last_job_at >= idle_timeout_seconds:
                break
            await sleep(min(5, max(0.1, idle_timeout_seconds - (clock() - last_job_at))))
            continue

        job = jobs[0]
        job_id = str(job.get("id") or "")
        lease_token = str(job.get("lease_token") or "")
        if not job_id or not lease_token:
            outcomes.append({"status": "BLOCKED", "reason": "CLAIM_RESPONSE_INVALID"})
            break

        try:
            outcome = await runner.run(job, lease={"lease_token": lease_token})
            outcomes.append(outcome)
        except Exception:
            outcomes.append({"job_id": job_id, "status": "FAILED", "error": "worker_execution_failed"})
        finally:
            try:
                await gateway.call(
                    "release_operator_lease",
                    job_id=job_id,
                    lease_token=lease_token,
                )
            except Exception:
                pass
        last_job_at = clock()

    return {
        "worker_id": worker_id,
        "processed_count": len(outcomes),
        "outcomes": [
            {key: value for key, value in item.items() if key not in {"text", "text_excerpt", "cookies"}}
            for item in outcomes
        ],
        "elapsed_seconds": round(clock() - started, 2),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--max-seconds", type=int, default=240)
    parser.add_argument("--idle-timeout-seconds", type=int, default=20)
    parser.add_argument("--max-jobs", type=int, default=1)
    args = parser.parse_args()
    result = asyncio.run(run_worker(
        max_seconds=args.max_seconds,
        idle_timeout_seconds=args.idle_timeout_seconds,
        max_jobs=args.max_jobs,
    ))
    print(json.dumps(result, sort_keys=True))
    return 0 if all(item.get("status") in {"CAPTURED", "SKIPPED", "DEFERRED"} for item in result["outcomes"]) else 1


if __name__ == "__main__":
    raise SystemExit(main())
