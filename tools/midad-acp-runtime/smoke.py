"""Local ACP v1 stdio protocol smoke only; not a production coding-agent worker."""
from __future__ import annotations

import asyncio
import os
import sys
import tempfile
from pathlib import Path
from typing import Any, Mapping

from acp import (
    PROTOCOL_VERSION,
    Agent,
    Client,
    PromptResponse,
    RequestError,
    spawn_agent_process,
    text_block,
    update_agent_message_text,
)
from acp.schema import (
    ClientCapabilities,
    DeclineElicitationResponse,
    DeniedOutcome,
    FileSystemCapabilities,
    Implementation,
    InitializeResponse,
    NewSessionResponse,
    RequestPermissionResponse,
    TextContentBlock,
    ToolCallUpdate,
)

MAX_OUTPUT_CHARS = 16_384
MAX_UPDATE_COUNT = 100
PROMPT_TIMEOUT_SECONDS = 10
_ALLOWED_ENV = frozenset({"PATH", "HOME", "USER", "LOGNAME", "LANG", "LC_ALL", "TMPDIR", "TEMP", "SYSTEMROOT"})


class ACPPolicyError(ValueError):
    """A request does not satisfy the local smoke policy."""


def build_agent_environment(source: Mapping[str, str] | None = None) -> dict[str, str]:
    """Build a small child environment; never inherit provider or MIDAD secrets."""
    source = os.environ if source is None else source
    return {key: value for key, value in source.items() if key in _ALLOWED_ENV and isinstance(value, str)}


def validate_workspace(workspace: str | Path, approved_root: str | Path) -> Path:
    """Resolve symlinks and ensure a workspace remains below its approved root."""
    try:
        root = Path(approved_root).resolve(strict=True)
        candidate = Path(workspace).resolve(strict=True)
    except (OSError, RuntimeError) as exc:
        raise ACPPolicyError("WORKSPACE_PATH_INVALID") from exc

    if not root.is_dir() or not candidate.is_dir():
        raise ACPPolicyError("WORKSPACE_DIRECTORY_REQUIRED")
    if candidate == root or root not in candidate.parents:
        raise ACPPolicyError("WORKSPACE_OUTSIDE_APPROVED_ROOT")
    return candidate


class MidadACPClient(Client):
    """Minimal client for smoke tests. All permissions and tool surfaces fail closed."""

    def __init__(self) -> None:
        self.capabilities = ClientCapabilities(
            fs=FileSystemCapabilities(read_text_file=False, write_text_file=False),
            terminal=False,
        )
        self.messages: list[str] = []
        self.update_count = 0
        self.output_truncated = False

    async def request_permission(
        self, session_id: str, tool_call: ToolCallUpdate, options: list[Any], **kwargs: Any
    ) -> RequestPermissionResponse:
        return RequestPermissionResponse(outcome=DeniedOutcome(outcome="cancelled"))

    async def session_update(self, session_id: str, update: Any, **kwargs: Any) -> None:
        self.update_count += 1
        if self.update_count > MAX_UPDATE_COUNT:
            self.output_truncated = True
            return
        content = getattr(update, "content", None)
        if isinstance(content, TextContentBlock):
            text = content.text
            remaining = MAX_OUTPUT_CHARS - sum(len(item) for item in self.messages)
            if remaining <= 0:
                self.output_truncated = True
                return
            self.messages.append(text[:remaining])
            if len(text) > remaining:
                self.output_truncated = True

    async def write_text_file(self, session_id: str, path: str, content: str, **kwargs: Any) -> None:
        raise RequestError.method_not_found("fs/write_text_file")

    async def read_text_file(
        self, session_id: str, path: str, line: int | None = None, limit: int | None = None, **kwargs: Any
    ) -> None:
        raise RequestError.method_not_found("fs/read_text_file")

    async def create_terminal(
        self,
        session_id: str,
        command: str,
        args: list[str] | None = None,
        env: list[Any] | None = None,
        cwd: str | None = None,
        output_byte_limit: int | None = None,
        **kwargs: Any,
    ) -> None:
        raise RequestError.method_not_found("terminal/create")

    async def terminal_output(self, session_id: str, terminal_id: str, **kwargs: Any) -> None:
        raise RequestError.method_not_found("terminal/output")

    async def release_terminal(self, session_id: str, terminal_id: str, **kwargs: Any) -> None:
        raise RequestError.method_not_found("terminal/release")

    async def wait_for_terminal_exit(self, session_id: str, terminal_id: str, **kwargs: Any) -> None:
        raise RequestError.method_not_found("terminal/wait_for_exit")

    async def kill_terminal(self, session_id: str, terminal_id: str, **kwargs: Any) -> None:
        raise RequestError.method_not_found("terminal/kill")

    async def create_elicitation(self, message: str, mode: Any, **kwargs: Any) -> DeclineElicitationResponse:
        return DeclineElicitationResponse(action="decline")

    async def complete_elicitation(self, elicitation_id: str, **kwargs: Any) -> None:
        return None

    async def ext_method(self, method: str, params: dict[str, Any]) -> dict[str, Any]:
        raise RequestError.method_not_found(method)

    async def ext_notification(self, method: str, params: dict[str, Any]) -> None:
        raise RequestError.method_not_found(method)


class EchoAgent(Agent):
    """A fixture agent with no tools, filesystem access, terminal, or network."""

    def on_connect(self, conn: Client) -> None:
        self._conn = conn

    async def initialize(
        self,
        protocol_version: int,
        client_capabilities: ClientCapabilities | None = None,
        client_info: Implementation | None = None,
        **kwargs: Any,
    ) -> InitializeResponse:
        return InitializeResponse(protocol_version=protocol_version)

    async def new_session(self, cwd: str, **kwargs: Any) -> NewSessionResponse:
        return NewSessionResponse(session_id="midad-acp-smoke-session")

    async def prompt(self, session_id: str, prompt: list[Any], **kwargs: Any) -> PromptResponse:
        await self._conn.session_update(
            session_id=session_id,
            update=update_agent_message_text("MIDAD_ACP_PROTOCOL_OK"),
        )
        return PromptResponse(stop_reason="end_turn")


async def _run_echo_agent() -> dict[str, Any]:
    client = MidadACPClient()
    script = Path(__file__).with_name("echo_agent.py").resolve()

    with tempfile.TemporaryDirectory(prefix="midad-acp-smoke-") as temp_dir:
        root = Path(temp_dir)
        workspace = root / "workspace"
        workspace.mkdir(mode=0o700)
        approved_workspace = validate_workspace(workspace, root)

        async with spawn_agent_process(
            client,
            sys.executable,
            str(script),
            env=build_agent_environment(),
            cwd=approved_workspace,
        ) as (connection, process):
            await connection.initialize(
                protocol_version=PROTOCOL_VERSION,
                client_capabilities=client.capabilities,
                client_info=Implementation(
                    name="midad-acp-smoke",
                    title="MIDAD ACP Read-only Protocol Smoke",
                    version="0.1.0",
                ),
            )
            session = await connection.new_session(cwd=str(approved_workspace), mcp_servers=[])
            response = await asyncio.wait_for(
                connection.prompt(
                    session_id=session.session_id,
                    prompt=[text_block("Return the fixed protocol smoke marker.")],
                ),
                timeout=PROMPT_TIMEOUT_SECONDS,
            )
            result = {
                "state": "VERIFIED",
                "session_id": session.session_id,
                "stop_reason": response.stop_reason,
                "text": "".join(client.messages),
                "updates": client.update_count,
                "output_truncated": client.output_truncated,
            }
            if process.returncode not in (None, 0):
                raise RuntimeError("ACP_ECHO_AGENT_EXITED_NONZERO")
            if "MIDAD_ACP_PROTOCOL_OK" not in result["text"] or result["stop_reason"] != "end_turn":
                raise RuntimeError("ACP_PROTOCOL_SMOKE_ASSERTION_FAILED")
            return result


async def run_echo_smoke() -> dict[str, Any]:
    """Run an in-process fixture through the real ACP Python SDK stdio transport."""
    return await _run_echo_agent()
