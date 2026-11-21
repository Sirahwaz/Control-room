"""Trusted server-side composition boundary for MIDAD Memory Adapter."""
from __future__ import annotations

from typing import Any, Callable

from midad_memory_adapter import AdapterError, MemoryAdapter, MemoryRequest, Principal


class MidadMemoryGateway:
    """Resolve a verified MIDAD auth context before every memory operation.

    `principal_resolver` must be an internal server-side integration with
    MIDAD's existing authentication and authorization services. It must never
    accept caller-supplied owner, project, role, or capability claims.
    """

    def __init__(
        self,
        adapter: MemoryAdapter,
        principal_resolver: Callable[[Any], Principal | None],
    ):
        if not callable(principal_resolver):
            raise AdapterError("UNAUTHENTICATED", "Trusted MIDAD principal resolver is required")
        self._adapter = adapter
        self._principal_resolver = principal_resolver

    def execute(self, verified_auth_context: Any, request: MemoryRequest) -> dict[str, Any]:
        try:
            principal = self._principal_resolver(verified_auth_context)
        except Exception:
            # Never surface auth provider internals, token state, or policy details.
            raise AdapterError("UNAUTHENTICATED", "MIDAD authentication could not be verified") from None
        if not isinstance(principal, Principal) or not principal.authenticated:
            raise AdapterError("UNAUTHENTICATED", "Authenticated MIDAD principal required")
        return self._adapter.execute(principal, request)
