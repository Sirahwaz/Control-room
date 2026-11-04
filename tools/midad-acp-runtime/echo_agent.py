"""Deterministic ACP fixture agent used only by the MIDAD protocol smoke test."""
from __future__ import annotations

import asyncio
from typing import Any

from acp import Agent, PromptResponse, run_agent, update_agent_message_text
from acp.interfaces import Client
from acp.schema import (
    ClientCapabilities,
    EmbeddedResourceContentBlock,
    HttpMcpServer,
    ImageContentBlock,
    Implementation,
    InitializeResponse,
    NewSessionResponse,
    ResourceContentBlock,
    SseMcpServer,
    TextContentBlock,
)


class MIDADSmokeEchoAgent(Agent):
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

    async def new_session(
        self,
        cwd: str,
        additional_directories: list[str] | None = None,
        mcp_servers: list[HttpMcpServer | SseMcpServer] | None = None,
        **kwargs: Any,
    ) -> NewSessionResponse:
        return NewSessionResponse(session_id="midad-acp-smoke-session")

    async def prompt(
        self,
        session_id: str,
        prompt: list[
            TextContentBlock | ImageContentBlock | ResourceContentBlock | EmbeddedResourceContentBlock
        ],
        **kwargs: Any,
    ) -> PromptResponse:
        await self._conn.session_update(
            session_id=session_id,
            update=update_agent_message_text("MIDAD_ACP_PROTOCOL_OK"),
        )
        return PromptResponse(stop_reason="end_turn")


async def main() -> None:
    await run_agent(MIDADSmokeEchoAgent())


if __name__ == "__main__":
    asyncio.run(main())
