"""Host-scoped secret reference resolver. Secret values are injected by the runtime."""
from __future__ import annotations
import os
import re
from dataclasses import dataclass

_ALIAS = re.compile(r"^MIDAD_[A-Z0-9_]{2,96}$")

class SecretProviderError(RuntimeError):
    pass

@dataclass(frozen=True)
class SecretBinding:
    account_id: str
    host: str
    secret_alias: str

class EnvironmentSecretProvider:
    """Read a secret only when account identity and exact host both match."""
    def __init__(self, bindings: list[SecretBinding], environ=None):
        self._env = os.environ if environ is None else environ
        self._bindings = {}
        for binding in bindings:
            host = binding.host.strip().lower().rstrip(".")
            alias = binding.secret_alias.strip()
            key = (binding.account_id.strip(), host)
            if not key[0] or not host or not _ALIAS.fullmatch(alias):
                raise SecretProviderError("INVALID_SECRET_BINDING")
            if key in self._bindings:
                raise SecretProviderError("DUPLICATE_SECRET_BINDING")
            self._bindings[key] = alias

    def resolve(self, account_id: str, host: str) -> str:
        key = (str(account_id).strip(), str(host).strip().lower().rstrip("."))
        alias = self._bindings.get(key)
        if alias is None:
            raise SecretProviderError("NO_SECRET_BINDING_FOR_ACCOUNT_HOST")
        value = self._env.get(alias)
        if not isinstance(value, str) or not value:
            raise SecretProviderError("SECRET_NOT_CONFIGURED")
        return value
