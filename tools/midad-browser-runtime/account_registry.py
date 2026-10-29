"""Persistent non-secret account metadata registry with strict host validation."""
from __future__ import annotations
import json
import os
import tempfile
from pathlib import Path
from agent_policy import validate_profile

class AccountRegistryError(RuntimeError):
    pass

_SENSITIVE_KEYS = {"password", "secret_value", "secret", "cookie", "token",
                   "access_token", "refresh_token", "api_key", "authorization",
                   "session", "private_key"}

def _strip_secret_fields(value):
    if isinstance(value, dict):
        return {k: _strip_secret_fields(v) for k, v in value.items()
                if str(k).lower() not in _SENSITIVE_KEYS}
    if isinstance(value, list):
        return [_strip_secret_fields(item) for item in value]
    return value

class AccountRegistry:
    """Store account profiles only; secret material must remain in a secret provider."""
    def __init__(self, path: str | Path, allowed_hosts: set[str]):
        self.path = Path(path)
        self.allowed_hosts = {h.strip().lower().rstrip(".") for h in allowed_hosts}
        if not self.allowed_hosts or any(not h or "*" in h for h in self.allowed_hosts):
            raise AccountRegistryError("EXACT_HOST_ALLOWLIST_REQUIRED")

    def list_profiles(self) -> list[dict]:
        if not self.path.exists():
            return []
        try:
            raw = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise AccountRegistryError("REGISTRY_UNREADABLE") from exc
        if not isinstance(raw, dict) or not isinstance(raw.get("profiles"), list):
            raise AccountRegistryError("INVALID_REGISTRY_SCHEMA")
        result = []
        seen = set()
        for profile in raw["profiles"]:
            if not isinstance(profile, dict):
                raise AccountRegistryError("INVALID_ACCOUNT_PROFILE")
            profile = _strip_secret_fields(profile)
            try:
                safe = validate_profile(profile, self.allowed_hosts)
            except (ValueError, TypeError) as exc:
                raise AccountRegistryError("INVALID_ACCOUNT_PROFILE") from exc
            if safe["account_id"] in seen:
                raise AccountRegistryError("DUPLICATE_ACCOUNT_ID")
            seen.add(safe["account_id"])
            result.append({**profile, **safe})
        return result

    def get_profile(self, account_id: str) -> dict:
        matches = [p for p in self.list_profiles() if p["account_id"] == account_id]
        if len(matches) != 1:
            raise AccountRegistryError("ACCOUNT_NOT_FOUND_OR_AMBIGUOUS")
        return matches[0]

    def save_profile(self, profile: dict) -> None:
        profile = _strip_secret_fields(profile)
        try:
            safe = validate_profile(profile, self.allowed_hosts)
        except (ValueError, TypeError) as exc:
            raise AccountRegistryError("INVALID_ACCOUNT_PROFILE") from exc
        profiles = [p for p in self.list_profiles() if p["account_id"] != safe["account_id"]]
        cleaned = _strip_secret_fields(profile)
        cleaned.update(safe)
        profiles.append(cleaned)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        fd, temp_name = tempfile.mkstemp(prefix=".midad-accounts-", suffix=".tmp", dir=self.path.parent)
        try:
            if os.name != "nt":
                os.fchmod(fd, 0o600)
            with os.fdopen(fd, "w", encoding="utf-8") as stream:
                json.dump({"profiles": profiles}, stream, ensure_ascii=False, indent=2)
                stream.write("\n")
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temp_name, self.path)
            if os.name != "nt":
                os.chmod(self.path, 0o600)
        except Exception:
            try: os.unlink(temp_name)
            except OSError: pass
            raise
