"""Submit a typed operator hint to the existing MIDAD Browser Agent Gateway."""
from __future__ import annotations
import argparse
import asyncio
import json
import os
import uuid

from account_registry import AccountRegistry
from operator_command_router import build_operator_request
from runner import BrowserConfig, GatewayClient

async def submit_hint(hint: str, config=None, registry=None, gateway=None, owner_user_id=None):
    config = config or BrowserConfig.from_env()
    owner_user_id = str(owner_user_id or os.environ.get("MIDAD_OPERATOR_OWNER_USER_ID", "")).strip()
    if not owner_user_id:
        raise ValueError("MIDAD_OPERATOR_OWNER_USER_ID_REQUIRED")
    if registry is None:
        path = os.environ.get("MIDAD_BROWSER_ACCOUNT_REGISTRY", "/var/lib/midad-browser/accounts.json")
        registry = AccountRegistry(path, set(config.allowed_hosts))
    command = build_operator_request(hint, registry.list_profiles())
    objective = "Operator command: " + command["action"] + " on " + command["platform_key"]
    response = await (gateway or GatewayClient(config)).call(
        "create_job",
        owner_user_id=owner_user_id,
        agent_key="midad_operator_command_router",
        platform_key=command["platform_key"],
        objective=objective[:3000],
        current_url=command.get("target_url"),
        input_data={"operator_command": command},
        idempotency_key="operator:" + str(uuid.uuid4()),
    )
    job = response.get("job") if isinstance(response, dict) else None
    if not isinstance(job, dict) or not job.get("id"):
        raise RuntimeError("OPERATOR_JOB_NOT_CREATED")
    return {
        "ok": True,
        "job_id": str(job["id"]),
        "state": str(job.get("state") or "PREPARING"),
        "platform_key": command["platform_key"],
        "action": command["action"],
    }

async def _main(hint: str):
    result = await submit_hint(hint)
    print(json.dumps(result, sort_keys=True))

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("hint", help='Example: "Taskmarket" starts its approved session')
    args = parser.parse_args()
    try:
        asyncio.run(_main(args.hint))
    except Exception as exc:
        # Avoid printing exception objects that might accidentally contain configuration.
        print(json.dumps({"ok": False, "error": type(exc).__name__}, sort_keys=True))
        raise SystemExit(1)

if __name__ == "__main__":
    main()
