"""Encrypted, provider-agnostic session profiles for trusted MIDAD runtimes.

Passwords are never accepted by this module. A user-driven setup adapter returns
Playwright-compatible storage state; the core encrypts it and never returns it
through the agent-facing execute() result.
"""
from __future__ import annotations

import base64
import hmac
import inspect
import ipaddress
import json
import os
import re
import secrets
import stat
import time
from pathlib import Path
from typing import Any, Callable, Mapping
from urllib.parse import urlsplit, urlunsplit

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM


SCHEMA_VERSION = 1
MAX_STATE_BYTES = 4 * 1024 * 1024
MAX_ENVELOPE_BYTES = 8 * 1024 * 1024
MAX_PROFILE_TTL_SECONDS = 90 * 24 * 60 * 60
MAX_GRANT_TTL_SECONDS = 24 * 60 * 60
PROFILE_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{1,63}$")
PLATFORM_KEY_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{1,63}$")
AGENT_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{1,127}$")
HOST_LABEL_RE = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$")
ALLOWED_SCOPES = frozenset({"session:read", "browser:submit", "browser:publish"})
OPERATION_SCOPE = {
    "read_only": "session:read",
    "submit": "browser:submit",
    "publish": "browser:publish",
}
SAFE_RESULT_KEYS = frozenset({
    "status", "url", "title", "http_status", "content_sha256", "text",
    "elapsed_ms", "attempts", "reason_code", "next_action",
})


class SessionCoreError(RuntimeError):
    """Base class for safe, machine-readable session-core failures."""


class ProfilePolicyError(SessionCoreError):
    """Profile, origin, state or target violates policy."""


class ProfileNotFound(SessionCoreError):
    pass


class ProfileAlreadyExists(SessionCoreError):
    pass


class SessionIntegrityError(SessionCoreError):
    """The encrypted profile is invalid, truncated or not decryptable."""


class GrantRejected(SessionCoreError):
    pass


class PolicyDenied(SessionCoreError):
    pass


class HumanGateRequired(SessionCoreError):
    pass


class SessionExecutionError(SessionCoreError):
    pass


def _b64encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def _b64decode(value: str) -> bytes:
    if not isinstance(value, str) or not value or not re.fullmatch(r"[A-Za-z0-9_-]+", value):
        raise ValueError("invalid base64url value")
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def load_key_from_env(name: str) -> bytes:
    """Load a key provisioned by a secret manager; never creates or logs keys."""
    encoded = os.environ.get(name, "")
    if not encoded:
        raise SessionCoreError("REQUIRED_SECRET_MISSING")
    try:
        key = _b64decode(encoded)
    except Exception:
        raise SessionCoreError("INVALID_SECRET_FORMAT") from None
    if len(key) != 32:
        raise SessionCoreError("INVALID_SECRET_LENGTH")
    return key


def _validate_identifier(value: str, pattern: re.Pattern[str], code: str) -> str:
    if not isinstance(value, str) or not pattern.fullmatch(value):
        raise ProfilePolicyError(code)
    return value


def _canonical_host(value: str) -> str:
    if not isinstance(value, str) or not value or value != value.strip():
        raise ProfilePolicyError("INVALID_HOST")
    host = value.lower().rstrip(".")
    if not host or any(ch in host for ch in ("*", "/", "\\", "@", ":", " ", "\t", "\n")):
        raise ProfilePolicyError("EXACT_HOST_REQUIRED")
    if host in {"localhost", "localhost.localdomain"} or host.endswith((".local", ".internal", ".localhost")):
        raise ProfilePolicyError("NON_PUBLIC_HOST")
    try:
        ipaddress.ip_address(host)
    except ValueError:
        pass
    else:
        raise ProfilePolicyError("IP_LITERAL_HOST_FORBIDDEN")
    labels = host.split(".")
    if len(labels) < 2 or any(not HOST_LABEL_RE.fullmatch(label) for label in labels):
        raise ProfilePolicyError("INVALID_HOST")
    return host


def normalize_origin(raw_origin: str) -> str:
    if not isinstance(raw_origin, str) or not raw_origin.strip():
        raise ProfilePolicyError("HTTPS_ORIGIN_REQUIRED")
    try:
        parsed = urlsplit(raw_origin.strip())
        port = parsed.port
    except ValueError:
        raise ProfilePolicyError("INVALID_ORIGIN") from None
    if parsed.scheme.lower() != "https" or not parsed.hostname:
        raise ProfilePolicyError("HTTPS_ORIGIN_REQUIRED")
    if parsed.username is not None or parsed.password is not None:
        raise ProfilePolicyError("ORIGIN_CREDENTIALS_FORBIDDEN")
    if port not in (None, 443) or parsed.path not in ("", "/") or parsed.query or parsed.fragment:
        raise ProfilePolicyError("ORIGIN_MUST_BE_EXACT_ORIGIN")
    host = _canonical_host(parsed.hostname)
    return "https://" + host


def normalize_allowed_hosts(hosts: Any, required_host: str | None = None) -> list[str]:
    if isinstance(hosts, (str, bytes)) or not isinstance(hosts, (list, tuple, set, frozenset)):
        raise ProfilePolicyError("ALLOWED_HOSTS_MUST_BE_LIST")
    normalized = sorted({_canonical_host(host) for host in hosts})
    if not normalized:
        raise ProfilePolicyError("ALLOWED_HOSTS_REQUIRED")
    if required_host is not None and required_host not in normalized:
        raise ProfilePolicyError("ORIGIN_HOST_NOT_ALLOWED")
    return normalized


def validate_target_url(raw_url: str, allowed_hosts: Any) -> str:
    if not isinstance(raw_url, str) or not raw_url.strip():
        raise ProfilePolicyError("TARGET_URL_REQUIRED")
    try:
        parsed = urlsplit(raw_url.strip())
        port = parsed.port
    except ValueError:
        raise ProfilePolicyError("INVALID_TARGET_URL") from None
    if parsed.scheme.lower() != "https" or not parsed.hostname:
        raise ProfilePolicyError("HTTPS_TARGET_REQUIRED")
    if parsed.username is not None or parsed.password is not None:
        raise ProfilePolicyError("TARGET_CREDENTIALS_FORBIDDEN")
    if port not in (None, 443):
        raise ProfilePolicyError("TARGET_PORT_FORBIDDEN")
    host = _canonical_host(parsed.hostname)
    allowed = normalize_allowed_hosts(allowed_hosts)
    if host not in allowed:
        raise ProfilePolicyError("TARGET_HOST_NOT_ALLOWED")
    return urlunsplit(("https", host, parsed.path or "/", parsed.query, ""))


def _validate_storage_state(storage_state: Any, allowed_hosts: list[str]) -> dict[str, Any]:
    if not isinstance(storage_state, dict) or set(storage_state) - {"cookies", "origins"}:
        raise ProfilePolicyError("INVALID_STORAGE_STATE_SHAPE")
    cookies = storage_state.get("cookies", [])
    origins = storage_state.get("origins", [])
    if not isinstance(cookies, list) or not isinstance(origins, list):
        raise ProfilePolicyError("INVALID_STORAGE_STATE_SHAPE")
    for cookie in cookies:
        if not isinstance(cookie, dict):
            raise ProfilePolicyError("INVALID_COOKIE_RECORD")
        if not isinstance(cookie.get("name"), str) or not isinstance(cookie.get("value"), str):
            raise ProfilePolicyError("INVALID_COOKIE_RECORD")
        domain = cookie.get("domain")
        cookie_url = cookie.get("url")
        if domain is not None:
            if not isinstance(domain, str):
                raise ProfilePolicyError("INVALID_COOKIE_DOMAIN")
            canonical = _canonical_host(domain.lstrip("."))
            if canonical not in allowed_hosts:
                raise ProfilePolicyError("COOKIE_DOMAIN_NOT_ALLOWED")
        elif cookie_url is not None:
            validate_target_url(cookie_url, allowed_hosts)
        else:
            raise ProfilePolicyError("COOKIE_DOMAIN_REQUIRED")
    for origin_record in origins:
        if not isinstance(origin_record, dict) or not isinstance(origin_record.get("origin"), str):
            raise ProfilePolicyError("INVALID_STORAGE_ORIGIN")
        origin = normalize_origin(origin_record["origin"])
        host = urlsplit(origin).hostname
        if host not in allowed_hosts:
            raise ProfilePolicyError("STORAGE_ORIGIN_NOT_ALLOWED")
        local_storage = origin_record.get("localStorage", [])
        if not isinstance(local_storage, list):
            raise ProfilePolicyError("INVALID_LOCAL_STORAGE")
        for item in local_storage:
            if not isinstance(item, dict) or not isinstance(item.get("name"), str) or not isinstance(item.get("value"), str):
                raise ProfilePolicyError("INVALID_LOCAL_STORAGE")
    try:
        encoded = json.dumps(storage_state, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")
    except (TypeError, ValueError):
        raise ProfilePolicyError("STORAGE_STATE_NOT_JSON") from None
    if len(encoded) > MAX_STATE_BYTES:
        raise ProfilePolicyError("STORAGE_STATE_TOO_LARGE")
    return json.loads(encoded.decode("utf-8"))


def _normalize_profile_metadata(
    profile_id: str,
    platform_key: str,
    origin: str,
    allowed_hosts: Any,
    created_at: int,
    expires_at: int | None,
) -> dict[str, Any]:
    _validate_identifier(profile_id, PROFILE_ID_RE, "INVALID_PROFILE_ID")
    _validate_identifier(platform_key, PLATFORM_KEY_RE, "INVALID_PLATFORM_KEY")
    canonical_origin = normalize_origin(origin)
    origin_host = urlsplit(canonical_origin).hostname
    canonical_hosts = normalize_allowed_hosts(allowed_hosts, required_host=origin_host)
    if isinstance(created_at, bool) or not isinstance(created_at, int) or created_at <= 0:
        raise ProfilePolicyError("INVALID_CREATED_AT")
    if expires_at is not None:
        if isinstance(expires_at, bool) or not isinstance(expires_at, int) or expires_at <= created_at:
            raise ProfilePolicyError("INVALID_EXPIRES_AT")
        if expires_at - created_at > MAX_PROFILE_TTL_SECONDS:
            raise ProfilePolicyError("PROFILE_TTL_TOO_LONG")
    return {
        "schema_version": SCHEMA_VERSION,
        "profile_id": profile_id,
        "platform_key": platform_key,
        "origin": canonical_origin,
        "allowed_hosts": canonical_hosts,
        "created_at": created_at,
        "expires_at": expires_at,
    }


def _aad(metadata: Mapping[str, Any]) -> bytes:
    bound = {
        key: metadata[key]
        for key in ("schema_version", "profile_id", "platform_key", "origin", "allowed_hosts", "created_at", "expires_at")
    }
    return json.dumps(bound, sort_keys=True, separators=(",", ":")).encode("utf-8")


def _safe_result(value: Any, allowed_hosts: list[str]) -> dict[str, Any]:
    if not isinstance(value, Mapping):
        return {"status": "UNRECOGNIZED_RESULT"}
    output: dict[str, Any] = {}
    for key in SAFE_RESULT_KEYS:
        item = value.get(key)
        if item is None:
            continue
        if key == "url":
            try:
                output[key] = validate_target_url(item, allowed_hosts)
            except ProfilePolicyError:
                continue
        elif key in {"title", "text", "reason_code", "next_action"} and isinstance(item, str):
            limit = 30_000 if key == "text" else 500
            output[key] = item[:limit]
        elif key == "status" and isinstance(item, str):
            normalized = item.strip().upper()[:40]
            output[key] = "UNVERIFIED_PAYMENT_CLAIM" if normalized == "PAID" else normalized
        elif key == "content_sha256" and isinstance(item, str) and re.fullmatch(r"[a-fA-F0-9]{64}", item):
            output[key] = item.lower()
        elif key == "http_status" and isinstance(item, int) and not isinstance(item, bool) and 100 <= item <= 599:
            output[key] = item
        elif key in {"elapsed_ms", "attempts"} and isinstance(item, int) and not isinstance(item, bool):
            upper = 3 if key == "attempts" else 3_600_000
            lower = 1 if key == "attempts" else 0
            if lower <= item <= upper:
                output[key] = item
    return output


class EncryptedFileSessionStore:
    """Single-host encrypted store. Use a shared transactional adapter for multi-host workers."""

    def __init__(self, root: str | os.PathLike[str], encryption_key: bytes):
        if not isinstance(encryption_key, bytes) or len(encryption_key) != 32:
            raise SessionCoreError("INVALID_ENCRYPTION_KEY")
        self.root = Path(root).expanduser()
        if self.root.exists() and self.root.is_symlink():
            raise SessionCoreError("SESSION_ROOT_SYMLINK_FORBIDDEN")
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        os.chmod(self.root, 0o700)
        self._cipher = AESGCM(encryption_key)

    def _path(self, profile_id: str) -> Path:
        _validate_identifier(profile_id, PROFILE_ID_RE, "INVALID_PROFILE_ID")
        return self.root / (profile_id + ".session.json")

    def save(
        self,
        *,
        profile_id: str,
        platform_key: str,
        origin: str,
        allowed_hosts: Any,
        storage_state: Any,
        created_at: int,
        expires_at: int | None,
        replace: bool = False,
    ) -> dict[str, Any]:
        metadata = _normalize_profile_metadata(profile_id, platform_key, origin, allowed_hosts, created_at, expires_at)
        state = _validate_storage_state(storage_state, metadata["allowed_hosts"])
        path = self._path(profile_id)
        if path.is_symlink():
            raise SessionIntegrityError("PROFILE_SYMLINK_FORBIDDEN")
        if path.exists() and not replace:
            raise ProfileAlreadyExists("PROFILE_ALREADY_EXISTS")
        plain = json.dumps(state, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")
        if len(plain) > MAX_STATE_BYTES:
            raise ProfilePolicyError("STORAGE_STATE_TOO_LARGE")
        nonce = secrets.token_bytes(12)
        encrypted = self._cipher.encrypt(nonce, plain, _aad(metadata))
        envelope = {
            **metadata,
            "nonce": _b64encode(nonce),
            "ciphertext": _b64encode(encrypted),
        }
        raw = json.dumps(envelope, sort_keys=True, separators=(",", ":")).encode("utf-8")
        self._atomic_write(path, raw, replace=replace)
        return dict(metadata)

    def _atomic_write(self, path: Path, raw: bytes, *, replace: bool) -> None:
        temporary = self.root / ("." + path.name + "." + secrets.token_hex(8) + ".tmp")
        fd = None
        try:
            fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, "wb", closefd=True) as stream:
                fd = None
                stream.write(raw)
                stream.flush()
                os.fsync(stream.fileno())
            if replace:
                os.replace(temporary, path)
            else:
                try:
                    os.link(temporary, path)
                except FileExistsError:
                    raise ProfileAlreadyExists("PROFILE_ALREADY_EXISTS") from None
                finally:
                    if temporary.exists():
                        temporary.unlink()
            os.chmod(path, 0o600)
            try:
                dir_fd = os.open(self.root, os.O_RDONLY)
                try:
                    os.fsync(dir_fd)
                finally:
                    os.close(dir_fd)
            except OSError:
                pass
        finally:
            if fd is not None:
                os.close(fd)
            try:
                temporary.unlink(missing_ok=True)
            except OSError:
                pass

    def load(self, profile_id: str) -> tuple[dict[str, Any], dict[str, Any]]:
        path = self._path(profile_id)
        if not path.exists():
            raise ProfileNotFound("PROFILE_NOT_FOUND")
        if path.is_symlink():
            raise SessionIntegrityError("PROFILE_SYMLINK_FORBIDDEN")
        try:
            flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
            fd = os.open(path, flags)
            with os.fdopen(fd, "rb", closefd=True) as stream:
                if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
                    raise SessionIntegrityError("PROFILE_FILE_NOT_REGULAR")
                raw = stream.read(MAX_ENVELOPE_BYTES + 1)
            if len(raw) > MAX_ENVELOPE_BYTES:
                raise SessionIntegrityError("PROFILE_ENVELOPE_TOO_LARGE")
            envelope = json.loads(raw.decode("utf-8"))
            required = {
                "schema_version", "profile_id", "platform_key", "origin", "allowed_hosts",
                "created_at", "expires_at", "nonce", "ciphertext",
            }
            if not isinstance(envelope, dict) or set(envelope) != required:
                raise SessionIntegrityError("INVALID_PROFILE_ENVELOPE")
            metadata = _normalize_profile_metadata(
                envelope["profile_id"], envelope["platform_key"], envelope["origin"],
                envelope["allowed_hosts"], envelope["created_at"], envelope["expires_at"],
            )
            if envelope["schema_version"] != SCHEMA_VERSION or metadata["profile_id"] != profile_id:
                raise SessionIntegrityError("PROFILE_METADATA_MISMATCH")
            nonce = _b64decode(envelope["nonce"])
            ciphertext = _b64decode(envelope["ciphertext"])
            if len(nonce) != 12 or len(ciphertext) < 16:
                raise SessionIntegrityError("INVALID_PROFILE_CIPHERTEXT")
            plain = self._cipher.decrypt(nonce, ciphertext, _aad(metadata))
            if len(plain) > MAX_STATE_BYTES:
                raise SessionIntegrityError("STORAGE_STATE_TOO_LARGE")
            state = _validate_storage_state(json.loads(plain.decode("utf-8")), metadata["allowed_hosts"])
            return metadata, state
        except (InvalidTag, UnicodeError, json.JSONDecodeError, ValueError, TypeError, KeyError, OSError):
            raise SessionIntegrityError("PROFILE_DECRYPTION_OR_VALIDATION_FAILED") from None

    def delete(self, profile_id: str) -> None:
        path = self._path(profile_id)
        if path.is_symlink():
            raise SessionIntegrityError("PROFILE_SYMLINK_FORBIDDEN")
        try:
            path.unlink()
        except FileNotFoundError:
            return


class GrantAuthority:
    """Signs short-lived, host-scoped agent grants; keep this authority off agent-facing APIs."""

    def __init__(self, signing_key: bytes):
        if not isinstance(signing_key, bytes) or len(signing_key) != 32:
            raise SessionCoreError("INVALID_GRANT_SIGNING_KEY")
        self._key = bytes(signing_key)

    def issue(
        self,
        *,
        profile_id: str,
        agent_id: str,
        allowed_hosts: Any,
        scopes: Any,
        ttl_seconds: int,
        now: int | None = None,
    ) -> str:
        _validate_identifier(profile_id, PROFILE_ID_RE, "INVALID_PROFILE_ID")
        _validate_identifier(agent_id, AGENT_ID_RE, "INVALID_AGENT_ID")
        hosts = normalize_allowed_hosts(allowed_hosts)
        if isinstance(ttl_seconds, bool) or not isinstance(ttl_seconds, int) or not 1 <= ttl_seconds <= MAX_GRANT_TTL_SECONDS:
            raise GrantRejected("INVALID_GRANT_TTL")
        if isinstance(scopes, (str, bytes)) or not isinstance(scopes, (list, tuple, set, frozenset)):
            raise GrantRejected("INVALID_GRANT_SCOPES")
        scope_set = sorted(set(scopes))
        if not scope_set or any(not isinstance(scope, str) or scope not in ALLOWED_SCOPES for scope in scope_set):
            raise GrantRejected("UNSUPPORTED_GRANT_SCOPE")
        issued_at = int(time.time() if now is None else now)
        payload = {
            "v": 1,
            "profile_id": profile_id,
            "agent_id": agent_id,
            "allowed_hosts": hosts,
            "scopes": scope_set,
            "iat": issued_at,
            "exp": issued_at + ttl_seconds,
            "nonce": secrets.token_urlsafe(16),
        }
        body = _b64encode(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8"))
        signature = _b64encode(hmac.new(self._key, body.encode("ascii"), "sha256").digest())
        return body + "." + signature

    def verify(self, token: str, *, now: int | None = None) -> dict[str, Any]:
        try:
            if not isinstance(token, str) or token.count(".") != 1:
                raise ValueError
            body, signature = token.split(".", 1)
            expected = hmac.new(self._key, body.encode("ascii"), "sha256").digest()
            if not hmac.compare_digest(expected, _b64decode(signature)):
                raise ValueError
            payload = json.loads(_b64decode(body).decode("utf-8"))
            if set(payload) != {"v", "profile_id", "agent_id", "allowed_hosts", "scopes", "iat", "exp", "nonce"} or payload["v"] != 1:
                raise ValueError
            _validate_identifier(payload["profile_id"], PROFILE_ID_RE, "INVALID_PROFILE_ID")
            _validate_identifier(payload["agent_id"], AGENT_ID_RE, "INVALID_AGENT_ID")
            hosts = normalize_allowed_hosts(payload["allowed_hosts"])
            scopes = payload["scopes"]
            if not isinstance(scopes, list) or not scopes or any(s not in ALLOWED_SCOPES for s in scopes) or scopes != sorted(set(scopes)):
                raise ValueError
            if isinstance(payload["iat"], bool) or not isinstance(payload["iat"], int):
                raise ValueError
            if isinstance(payload["exp"], bool) or not isinstance(payload["exp"], int):
                raise ValueError
            current = int(time.time() if now is None else now)
            if payload["iat"] > current + 60 or payload["exp"] <= current:
                raise ValueError
            if payload["exp"] <= payload["iat"] or payload["exp"] - payload["iat"] > MAX_GRANT_TTL_SECONDS:
                raise ValueError
            if not isinstance(payload["nonce"], str) or len(payload["nonce"]) < 16:
                raise ValueError
            payload["allowed_hosts"] = hosts
            return payload
        except Exception:
            raise GrantRejected("INVALID_OR_EXPIRED_AGENT_GRANT") from None


class SessionCore:
    """Agent-facing entry point. Raw storage state is passed only to a trusted executor."""

    def __init__(
        self,
        store: EncryptedFileSessionStore,
        grant_authority: GrantAuthority,
        *,
        clock: Callable[[], float] = time.time,
        approval_validator: Callable[..., bool] | None = None,
    ):
        self.store = store
        self.grant_authority = grant_authority
        self.clock = clock
        self.approval_validator = approval_validator or (lambda *_args: False)

    async def setup_login(
        self,
        *,
        profile_id: str,
        platform_key: str,
        origin: str,
        allowed_hosts: Any,
        setup_driver: Callable[..., Any],
        expires_in_seconds: int = 30 * 24 * 60 * 60,
        replace: bool = False,
    ) -> dict[str, Any]:
        """Run a user-driven login adapter once; credentials never enter this interface."""
        canonical_origin = normalize_origin(origin)
        hosts = normalize_allowed_hosts(allowed_hosts, required_host=urlsplit(canonical_origin).hostname)
        now = int(self.clock())
        if isinstance(expires_in_seconds, bool) or not isinstance(expires_in_seconds, int):
            raise ProfilePolicyError("INVALID_PROFILE_TTL")
        if not 1 <= expires_in_seconds <= MAX_PROFILE_TTL_SECONDS:
            raise ProfilePolicyError("INVALID_PROFILE_TTL")
        try:
            captured = setup_driver(origin=canonical_origin, allowed_hosts=tuple(hosts))
            if inspect.isawaitable(captured):
                captured = await captured
        except Exception:
            raise SessionExecutionError("LOGIN_SETUP_FAILED") from None
        metadata = self.store.save(
            profile_id=profile_id,
            platform_key=platform_key,
            origin=canonical_origin,
            allowed_hosts=hosts,
            storage_state=captured,
            created_at=now,
            expires_at=now + expires_in_seconds,
            replace=replace,
        )
        return metadata

    async def execute(
        self,
        *,
        profile_id: str,
        grant_token: str,
        target_url: str,
        operation: str,
        executor: Callable[..., Any],
        human_approval_id: str | None = None,
    ) -> dict[str, Any]:
        normalized_operation = operation.strip().lower() if isinstance(operation, str) else ""
        if normalized_operation == "financial":
            raise PolicyDenied("FINANCIAL_OPERATIONS_DISABLED")
        if normalized_operation not in OPERATION_SCOPE:
            raise PolicyDenied("OPERATION_NOT_ALLOWED")

        metadata, storage_state = self.store.load(profile_id)
        now = int(self.clock())
        if metadata["expires_at"] is not None and metadata["expires_at"] <= now:
            raise ProfilePolicyError("PROFILE_EXPIRED")

        grant = self.grant_authority.verify(grant_token, now=now)
        if grant["profile_id"] != profile_id:
            raise GrantRejected("GRANT_PROFILE_MISMATCH")
        target = validate_target_url(target_url, metadata["allowed_hosts"])
        host = urlsplit(target).hostname
        if host not in grant["allowed_hosts"]:
            raise GrantRejected("TARGET_HOST_OUTSIDE_GRANT")
        required_scope = OPERATION_SCOPE[normalized_operation]
        if required_scope not in grant["scopes"]:
            raise GrantRejected("GRANT_SCOPE_MISSING")

        if normalized_operation != "read_only":
            if not isinstance(human_approval_id, str) or not human_approval_id.strip():
                raise HumanGateRequired("HUMAN_APPROVAL_REQUIRED")
            try:
                approved = self.approval_validator(
                    human_approval_id.strip(), profile_id, grant["agent_id"], normalized_operation
                )
                if inspect.isawaitable(approved):
                    approved = await approved
            except Exception:
                approved = False
            if approved is not True:
                raise HumanGateRequired("HUMAN_APPROVAL_NOT_VERIFIED")

        try:
            result = executor(
                profile=dict(metadata),
                storage_state=storage_state,
                target_url=target,
                operation=normalized_operation,
                allowed_hosts=tuple(metadata["allowed_hosts"]),
            )
            if inspect.isawaitable(result):
                result = await result
        except Exception:
            raise SessionExecutionError("SESSION_EXECUTION_FAILED") from None

        return {
            "status": "OK",
            "profile_id": profile_id,
            "platform_key": metadata["platform_key"],
            "agent_id": grant["agent_id"],
            "operation": normalized_operation,
            "result": _safe_result(result, metadata["allowed_hosts"]),
        }
