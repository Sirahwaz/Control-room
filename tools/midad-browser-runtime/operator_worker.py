"""Long-running single-consumer worker for queued operator browser commands.

Jobs with input_data.operator_command or input_data.operator_hint are processed. The worker keeps browser
contexts in memory and polls the existing authenticated MIDAD Browser Agent Gateway.
"""
from __future__ import annotations

import asyncio
import json
import os
import uuid
from pathlib import Path
from urllib.parse import urlsplit

from account_registry import AccountRegistry
from automation_policy import evaluate_action
from operator_command_router import CommandRoutingError, build_operator_request, validate_operator_command
from persistent_session import BrowserSessionError, PersistentSessionPool
from runner import BrowserConfig, GatewayClient

class OperatorWorker:
    def __init__(self, config, owner_user_id: str, registry: AccountRegistry, gateway=None,
                 session_pool=None, poll_interval: float = 3.0):
        self.config = config
        self.owner_user_id = str(owner_user_id).strip()
        if not self.owner_user_id:
            raise ValueError("MIDAD_OPERATOR_OWNER_USER_ID_REQUIRED")
        self.registry = registry
        self.gateway = gateway or GatewayClient(config)
        self.session_pool = session_pool or PersistentSessionPool(set(config.allowed_hosts))
        self.poll_interval = max(1.0, min(float(poll_interval), 30.0))
        self._processed_ids: set[str] = set()
        self._last_heartbeat: float | None = None
        self._stopping = asyncio.Event()

    def stop(self):
        self._stopping.set()

    def _profiles(self):
        return self.registry.list_profiles()

    def _profile_for(self, command: dict):
        account_id = str(command.get("account_id") or "")
        profile = self.registry.get_profile(account_id)
        expected_platform = str(command.get("platform_key") or "").casefold().strip()
        actual_platform = str(profile.get("platform_key") or profile.get("display_name") or profile["host"]).casefold().strip()
        if expected_platform and expected_platform != actual_platform:
            raise CommandRoutingError("PLATFORM_PROFILE_MISMATCH")
        return profile

    def _evaluate_command_policy(self, job: dict, command: dict, profile: dict,
                                 current_url: str | None):
        """Apply owner/account/host/path policy before the legacy router or browser opens."""
        action = str(command.get("action") or "").strip().lower()
        declared_owner = str(profile.get("owner_user_id") or "").strip()
        if declared_owner and declared_owner != self.owner_user_id:
            raise CommandRoutingError("PROFILE_OWNER_MISMATCH")

        candidate_url = (
            command.get("target_url")
            or (profile.get("login_url") if action == "start_session" else None)
            or current_url
            or ("https://" + str(profile.get("host") or "") + "/")
        )
        try:
            parsed = urlsplit(str(candidate_url))
            host = (parsed.hostname or "").lower().rstrip(".")
            path = parsed.path or "/"
        except (TypeError, ValueError):
            raise CommandRoutingError("INVALID_TARGET_URL") from None

        configured = profile.get("automation_policy")
        if configured is None:
            # Legacy profiles are kept compatible for inspection, but writes and
            # login startup require an explicit profile-level autonomy declaration.
            resource_hosts = profile.get("resource_hosts", [])
            allowed_hosts = [profile.get("host")]
            if isinstance(resource_hosts, list):
                allowed_hosts.extend(resource_hosts)
            configured = {
                "mode": "read_only",
                "allowed_hosts": allowed_hosts,
                "allowed_paths": profile.get("allowed_paths", ["/"]),
                "allowed_actions": [
                    "inspect", "read", "navigate", "search",
                    "wait_for_selector", "capture_screenshot", "status", "stop_session",
                    "start_session", "click", "fill", "select", "upload", "download",
                    "create", "update", "submit_form",
                ],
            }

        policy_profile = {
            **profile,
            "owner_user_id": self.owner_user_id,
            "automation_policy": configured,
        }
        policy_request = {
            "owner_user_id": self.owner_user_id,
            "account_id": str(profile.get("account_id") or ""),
            "platform_key": str(profile.get("platform_key") or profile.get("display_name") or host),
            "host": host,
            "path": path,
            "task_id": str(job.get("id") or job.get("job_id") or ""),
            "action": action,
        }
        decision = evaluate_action(action, policy_profile, policy_request, approval=None)
        if not decision.allowed:
            raise CommandRoutingError(decision.reason)
        return decision

    async def _record(self, job: dict, event_type: str, state: str, current_url: str | None,
                     next_action: str, evidence: dict | None = None, reason: str | None = None):
        payload = {
            "job_id": str(job.get("id") or job.get("job_id")),
            "event_type": event_type,
            "state": state,
            "current_url": current_url,
            "next_action": next_action,
            "evidence": {"source_kind": "persistent_operator_worker", **(evidence or {})},
        }
        if reason:
            payload["reason"] = reason
        return await self.gateway.record_event(**payload)

    async def _complete_result(self, job: dict, result: dict, state: str = "COMPLETED"):
        job_id = str(job.get("id") or job.get("job_id"))
        await self.gateway.call("record_command_result", job_id=job_id, result=result)
        event_type = "error" if state == "FAILED" else ("policy_decision" if state == "BLOCKED" else "state_transition")
        await self._record(
            job, event_type, state, result.get("url") or job.get("current_url"),
            "await_next_operator_command" if state == "COMPLETED" else "operator_review_required",
            {
                "policy_code": result.get("code", "")[:100] or "COMMAND_COMPLETED",
                "http_status": result.get("http_status") if isinstance(result.get("http_status"), int) and 100 <= result["http_status"] <= 599 else None,
                "bytes_read": result.get("text_chars", 0) if isinstance(result.get("text_chars"), int) and result.get("text_chars", 0) >= 0 else 0,
            },
            reason=result.get("reason"),
        )

    async def process_job(self, job: dict) -> dict:
        job_id = str(job.get("id") or job.get("job_id") or "")
        if not job_id:
            raise ValueError("JOB_ID_REQUIRED")
        data = job.get("input_data")
        command = data.get("operator_command") if isinstance(data, dict) else None
        hint = data.get("operator_hint") if isinstance(data, dict) else None
        if not isinstance(command, dict) and not (isinstance(hint, str) and hint.strip()):
            return {"job_id": job_id, "status": "IGNORED", "reason": "NOT_AN_OPERATOR_COMMAND"}
        if job_id in self._processed_ids:
            return {"job_id": job_id, "status": "DUPLICATE_SKIPPED"}
        self._processed_ids.add(job_id)
        current_url = job.get("current_url")
        command = command if isinstance(command, dict) else {}
        try:
            if not command and isinstance(hint, str):
                command = build_operator_request(hint[:500], self._profiles())
            profile = self._profile_for(command)
            policy_decision = self._evaluate_command_policy(job, command, profile, current_url)
            policy_command = dict(command)
            # The profile policy supersedes the legacy per-command boolean.
            # Only a policy-approved reversible action may pass that older gate.
            if policy_decision.risk == "reversible":
                policy_command["action_approved"] = True
            validated = validate_operator_command(policy_command, profile, set(self.config.allowed_hosts))
            if current_url is None and validated.get("target_url"):
                current_url = validated["target_url"]
            await self._record(job, "state_transition", "RUNNING", current_url,
                               "execute_operator_command", {"policy_code": "COMMAND_ACCEPTED"})
            account_id = profile["account_id"]
            session = self.session_pool.sessions.get(account_id)
            if validated["action"] == "start_session":
                session = await self.session_pool.ensure(profile)
                result = {
                    "status": session.last_status,
                    "action": "start_session",
                    "platform_key": validated["platform_key"],
                    "account_id": account_id,
                    "host": profile["host"],
                    "authenticated": bool(session.authenticated),
                    "session_storage": "memory_only",
                }
            elif validated["action"] == "stop_session":
                if session is not None:
                    await session.close()
                    self.session_pool.sessions.pop(account_id, None)
                result = {"status": "STOPPED", "action": "stop_session", "account_id": account_id}
            elif validated["action"] == "status":
                result = {
                    "status": session.last_status if session else "NOT_STARTED",
                    "authenticated": bool(session and session.authenticated),
                    "action": "status", "account_id": account_id, "host": profile["host"],
                }
            else:
                session = await self.session_pool.ensure(profile)
                result = await session.execute(validated)
                result.update({"action": validated["action"], "account_id": account_id,
                               "platform_key": validated["platform_key"]})
            await self._complete_result(job, result, "COMPLETED")
            return {"job_id": job_id, **result}
        except BrowserSessionError as exc:
            session = self.session_pool.sessions.get(str(command.get("account_id") or ""))
            status = session.last_status if session else str(exc)
            gate = "HUMAN" in status or "CAPTCHA" in status or "VERIFICATION" in status
            result = {
                "status": "HUMAN_GATE" if gate else "FAILED",
                "action": str(command.get("action", "")),
                "code": status[:100],
                "reason": "Platform requires a supported human verification step." if gate else "Session action did not complete.",
                "account_id": command.get("account_id"),
            }
            await self._complete_result(job, result, "HUMAN_GATE" if gate else "FAILED")
            return {"job_id": job_id, **result}
        except (CommandRoutingError, ValueError) as exc:
            result = {
                "status": "BLOCKED", "action": str(command.get("action", "")),
                "code": str(exc)[:100], "reason": "Command rejected by operator policy.",
                "account_id": command.get("account_id"),
            }
            await self._complete_result(job, result, "BLOCKED")
            return {"job_id": job_id, **result}
        except Exception:
            result = {
                "status": "FAILED", "action": str(command.get("action", "")),
                "code": "OPERATOR_WORKER_FAILED", "reason": "Internal command failure; see sanitized worker diagnostics.",
                "account_id": command.get("account_id"),
            }
            try:
                await self._complete_result(job, result, "FAILED")
            except Exception:
                pass
            return {"job_id": job_id, **result}

    async def poll_once(self) -> list[dict]:
        now = asyncio.get_running_loop().time()
        if self._last_heartbeat is None or now - self._last_heartbeat >= 15.0:
            await self.gateway.call(
                "worker_heartbeat", owner_user_id=self.owner_user_id,
                worker_version="operator_worker_v1",
            )
            self._last_heartbeat = now
        response = await self.gateway.call(
            "list_jobs", owner_user_id=self.owner_user_id,
            states=["QUEUED", "PREPARING"], limit=50,
        )
        jobs = response.get("jobs", []) if isinstance(response, dict) else []
        results = []
        for job in jobs if isinstance(jobs, list) else []:
            data = job.get("input_data")
            command = data.get("operator_command") if isinstance(data, dict) else None
            hint = data.get("operator_hint") if isinstance(data, dict) else None
            if not isinstance(command, dict) and not (isinstance(hint, str) and hint.strip()):
                continue
            if self._stopping.is_set():
                break
            results.append(await self.process_job(job))
        return results

    async def run_forever(self):
        import sys
        failures = 0
        try:
            while not self._stopping.is_set():
                try:
                    await self.poll_once()
                    failures = 0
                    delay = self.poll_interval
                except Exception as exc:
                    # Log only the exception class; never expose payloads or configuration.
                    failures = min(failures + 1, 5)
                    delay = min(30.0, self.poll_interval * (2 ** failures))
                    print("operator_worker_poll_failed:" + type(exc).__name__, file=sys.stderr, flush=True)
                try:
                    await asyncio.wait_for(self._stopping.wait(), timeout=delay)
                except asyncio.TimeoutError:
                    pass
        finally:
            await self.session_pool.close_all()

async def resolve_owner_user_id(gateway, configured_owner: str = "") -> str:
    owner = str(configured_owner or "").strip()
    if not owner:
        identity = await gateway.call("worker_identity")
        owner = str(identity.get("owner_user_id") or "").strip() if isinstance(identity, dict) else ""
    try:
        uuid.UUID(owner)
    except (ValueError, TypeError, AttributeError) as exc:
        raise RuntimeError("MIDAD_OPERATOR_OWNER_ID_RESOLUTION_FAILED") from exc
    return owner


def main() -> int:
    config = BrowserConfig.from_env()
    gateway = GatewayClient(config)
    configured_owner = os.environ.get("MIDAD_OPERATOR_OWNER_USER_ID", "").strip()
    owner = asyncio.run(resolve_owner_user_id(gateway, configured_owner))
    registry_path = os.environ.get(
        "MIDAD_BROWSER_ACCOUNT_REGISTRY",
        "/var/lib/midad-browser/accounts.json",
    )
    registry = AccountRegistry(registry_path, set(config.allowed_hosts))
    worker = OperatorWorker(config, owner, registry, gateway=gateway,
                            poll_interval=float(os.environ.get("MIDAD_OPERATOR_POLL_SECONDS", "3")))
    try:
        asyncio.run(worker.run_forever())
    except KeyboardInterrupt:
        worker.stop()
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
