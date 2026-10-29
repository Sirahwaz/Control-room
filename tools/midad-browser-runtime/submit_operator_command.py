"""Queue a conversational platform hint for the persistent MIDAD operator worker."""
from __future__ import annotations
import argparse
import asyncio
import json
import os
import uuid

from runner import BrowserConfig, GatewayClient

async def submit_hint(hint: str, config=None, registry=None, gateway=None, owner_user_id=None):
    # Registry is accepted for backwards-compatible callers; resolution is deliberately
    # performed by the trusted worker using its private account registry.
    del registry
    config = config or BrowserConfig.from_env()
    owner_user_id = str(owner_user_id or os.environ.get("MIDAD_OPERATOR_OWNER_USER_ID", "")).strip()
    if not owner_user_id:
        raise ValueError("MIDAD_OPERATOR_OWNER_USER_ID_REQUIRED")
    hint = str(hint or "").strip()
    if not hint:
        raise ValueError("OPERATOR_HINT_REQUIRED")
    if len(hint) > 500:
        raise ValueError("OPERATOR_HINT_TOO_LONG")
    response = await (gateway or GatewayClient(config)).call(
        "queue_operator_hint",
        owner_user_id=owner_user_id,
        agent_key="midad_operator_command_router",
        operator_hint=hint,
        idempotency_key="operator-hint:" + str(uuid.uuid4()),
    )
    job_id = response.get("job_id") if isinstance(response, dict) else None
    if response.get("ok") is not True or not job_id:
        raise RuntimeError("OPERATOR_JOB_NOT_CREATED")
    return {
        "ok": True,
        "job_id": str(job_id),
        "state": str(response.get("state") or "PREPARING"),
        "dispatch": "queued",
        "hint_length": len(hint),
    }

async def _main(hint: str):
    result = await submit_hint(hint)
    print(json.dumps(result, sort_keys=True))

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("hint", help='Example: "Taskmarket" queues session startup for the approved profile')
    args = parser.parse_args()
    try:
        asyncio.run(_main(args.hint))
    except Exception as exc:
        # Avoid printing exception objects that might accidentally contain configuration.
        print(json.dumps({"ok": False, "error": type(exc).__name__}, sort_keys=True))
        raise SystemExit(1)

if __name__ == "__main__":
    main()
