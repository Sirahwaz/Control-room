"""Long-running single-consumer worker for queued operator browser commands.

Only jobs with input_data.operator_command are processed. The worker keeps browser
contexts in memory and polls the existing authenticated MIDAD Browser Agent Gateway.
"""
from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path

from account_registry import AccountRegistry
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
        if not isinstance(command, dict) and isinstance(data, dict) and isinstance(data.get("operator_hint"), str):
            command = build_operator_request(data["operator_hint"][:500], self._profiles())
        if not isinstance(command, dict):
            return {"job_id": job_id, "status": "IGNORED", "reason": "NOT_AN_OPERATOR_COMMAND"}
        if job_id in self._processed_ids:
            return {"job_id": job_id, "status": "DUPLICATE_SKIPPED"}
        self._processed_ids.add(job_id)
        current_url = job.get("current_url")
        try:
            profile = self._profile_for(command)
            validated = validate_operator_command(command, profile, set(self.config.allowed_hosts))
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
        try:
            while not self._stopping.is_set():
                try:
                    await self.poll_once()
                except Exception:
                    # Never log gateway payloads, secrets, page text, or credentials.
                    pass
                try:
                    await asyncio.wait_for(self._stopping.wait(), timeout=self.poll_interval)
                except asyncio.TimeoutError:
                    pass
        finally:
            await self.session_pool.close_all()

def main() -> int:
    config = BrowserConfig.from_env()
    owner = os.environ.get("MIDAD_OPERATOR_OWNER_USER_ID", "").strip()
    registry_path = os.environ.get(
        "MIDAD_BROWSER_ACCOUNT_REGISTRY",
        "/var/lib/midad-browser/accounts.json",
    )
    registry = AccountRegistry(registry_path, set(config.allowed_hosts))
    worker = OperatorWorker(config, owner, registry,
                            poll_interval=float(os.environ.get("MIDAD_OPERATOR_POLL_SECONDS", "3")))
    try:
        asyncio.run(worker.run_forever())
    except KeyboardInterrupt:
        worker.stop()
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
