"""MIDAD auth-binding resolver contract for the memory gateway."""
from __future__ import annotations
from typing import Any, Callable
from midad_memory_adapter import AdapterError, Principal

class MidadPrincipalResolver:
    def __init__(self, validate_session: Callable[[Any], dict | None], load_authorized_projects: Callable[[str,str,str], dict | None]):
        self._validate_session=validate_session
        self._load_projects=load_authorized_projects
    def __call__(self, auth_context: Any) -> Principal:
        try:
            binding=self._validate_session(auth_context)
            if not isinstance(binding,dict) or binding.get("verified") is not True:
                raise AdapterError("UNAUTHENTICATED","Verified session binding required")
            values=(binding.get("owner_scope"),binding.get("principal_id"),binding.get("agent_id"),binding.get("run_id"))
            if not all(isinstance(x,str) and x.strip() for x in values):
                raise AdapterError("UNAUTHENTICATED","Verified owner and agent binding required")
            owner_scope,principal_id,agent_id,run_id=values
            policy=self._load_projects(owner_scope,agent_id,run_id)
            if not isinstance(policy,dict) or policy.get("verified") is not True:
                raise AdapterError("FORBIDDEN","Verified project policy required")
            projects,capabilities=policy.get("allowed_projects"),policy.get("capabilities")
            if not isinstance(projects,(list,tuple,set)) or not projects or not all(isinstance(x,str) and x.strip() for x in projects):
                raise AdapterError("FORBIDDEN","Malformed or empty project authorization")
            if not isinstance(capabilities,(list,tuple,set)) or not capabilities or not all(x in {"create","search"} for x in capabilities):
                raise AdapterError("FORBIDDEN","Malformed or unsupported memory capabilities")
            return Principal(principal_id,owner_scope,frozenset(projects),agent_id,run_id,frozenset(capabilities),authenticated=True)
        except AdapterError: raise
        except Exception: raise AdapterError("UNAUTHENTICATED","MIDAD auth or policy binding failed") from None
