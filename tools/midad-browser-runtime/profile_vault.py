"""Private, persistent Chromium profile metadata and URL/request policy for MIDAD.

Browser cookies and session material stay inside Chromium's user-data directory.
They are never exported into the registry, source control, Supabase, or logs.
"""
from __future__ import annotations

from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
import ipaddress
import json
import os
from pathlib import Path
import re
import tempfile
import threading
from urllib.parse import urlsplit, urlunsplit


class ProfileError(ValueError):
    """A profile or browser navigation violated the local security contract."""


_PROFILE_ID = re.compile(r"^[a-z0-9](?:[a-z0-9_-]{0,62})$")
_LABEL = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$")
_METHODS_BY_MODE = {
    "setup": frozenset({"GET", "HEAD", "OPTIONS", "POST"}),
    "agent_read_only": frozenset({"GET", "HEAD", "OPTIONS"}),
}


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def default_profile_home() -> Path:
    configured = os.environ.get("MIDAD_BROWSER_PROFILE_HOME")
    if configured:
        return Path(configured).expanduser()
    if os.name == "nt":
        base = Path(os.environ.get("LOCALAPPDATA", str(Path.home() / "AppData" / "Local")))
        return base / "MIDAD" / "BrowserProfiles"
    base = Path(os.environ.get("XDG_DATA_HOME", str(Path.home() / ".local" / "share")))
    return base / "midad" / "browser-profiles"


def normalize_allowed_hosts(hosts) -> frozenset[str]:
    if isinstance(hosts, (str, bytes)):
        raise ProfileError("allow-host must be repeated as exact hostnames, not passed as one string")
    try:
        values = list(hosts)
    except TypeError as exc:
        raise ProfileError("allow-host list required") from exc
    if not values:
        raise ProfileError("at least one exact allowed hostname is required")
    normalized: set[str] = set()
    for raw in values:
        if not isinstance(raw, str):
            raise ProfileError("invalid allowed hostname")
        host = raw.strip().lower().rstrip(".")
        if (
            not host
            or "*" in host
            or "://" in host
            or "/" in host
            or "@" in host
            or ":" in host
            or any(ch.isspace() for ch in host)
        ):
            raise ProfileError("exact hostnames only; schemes, ports, paths and wildcards are forbidden")
        try:
            addr = ipaddress.ip_address(host)
        except ValueError:
            addr = None
        if addr is not None:
            if not addr.is_global:
                raise ProfileError("private or non-public IP hosts are forbidden")
        else:
            if len(host) > 253 or ".." in host:
                raise ProfileError("invalid hostname")
            labels = host.split(".")
            if len(labels) < 2 or any(not _LABEL.fullmatch(label) for label in labels):
                raise ProfileError("public DNS hostnames are required; localhost and single-label hosts are forbidden")
            if host in {"localhost", "localhost.localdomain"} or host.endswith(
                (".localhost", ".local", ".internal", ".test", ".invalid")
            ):
                raise ProfileError("local or reserved hosts are forbidden")
        normalized.add(host)
    return frozenset(normalized)


def validate_profile_url(raw_url: str, allowed_hosts) -> str:
    """Validate URL syntax and exact host scope without storing or logging its query."""
    hosts = normalize_allowed_hosts(allowed_hosts)
    if not isinstance(raw_url, str) or not raw_url.strip() or any(ord(ch) < 32 for ch in raw_url):
        raise ProfileError("invalid URL")
    try:
        parsed = urlsplit(raw_url.strip())
        port = parsed.port
    except ValueError as exc:
        raise ProfileError("invalid URL") from exc
    if parsed.scheme.lower() != "https":
        raise ProfileError("HTTPS_REQUIRED")
    if parsed.username is not None or parsed.password is not None:
        raise ProfileError("URL_CREDENTIALS_FORBIDDEN")
    if not parsed.hostname or port not in (None, 443):
        raise ProfileError("INVALID_HOST_OR_PORT")
    host = parsed.hostname.lower().rstrip(".")
    if host not in hosts:
        raise ProfileError("HOST_NOT_ALLOWLISTED")
    # Also reject non-public literals if hostname validation was bypassed upstream.
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        address = None
    if address is not None and not address.is_global:
        raise ProfileError("NON_PUBLIC_HOST")
    return urlunsplit(("https", host, parsed.path or "/", parsed.query, parsed.fragment))


def request_policy(raw_url: str, method: str, allowed_hosts, *, mode: str) -> bool:
    """Return whether a request is in the mode's explicitly permitted URL/method scope."""
    if mode not in _METHODS_BY_MODE:
        return False
    if str(method or "").upper() not in _METHODS_BY_MODE[mode]:
        return False
    try:
        validate_profile_url(raw_url, allowed_hosts)
    except ProfileError:
        return False
    return True


@dataclass(frozen=True)
class ProfileRecord:
    profile_id: str
    status: str
    allowed_hosts: tuple[str, ...]
    start_host: str
    created_at: str
    last_setup_confirmed_at: str | None
    profile_dir: Path
    user_data_dir: Path

    def to_public_dict(self) -> dict:
        """Safe status view: no absolute filesystem paths, cookies, or full URLs."""
        return {
            "profile_id": self.profile_id,
            "status": self.status,
            "allowed_hosts": list(self.allowed_hosts),
            "start_host": self.start_host,
            "created_at": self.created_at,
            "last_setup_confirmed_at": self.last_setup_confirmed_at,
        }


class ProfileStore:
    """Stores profile metadata locally; Chromium owns all session/cookie persistence."""

    def __init__(self, root: str | Path | None = None):
        self.root = Path(root).expanduser() if root is not None else default_profile_home()
        self._thread_lock = threading.RLock()
        self._ensure_root()

    @property
    def registry_path(self) -> Path:
        return self.root / "registry.json"

    def _ensure_root(self) -> None:
        if self.root.exists() and self.root.is_symlink():
            raise ProfileError("profile home must not be a symbolic link")
        self.root.mkdir(mode=0o700, parents=True, exist_ok=True)
        if self.root.is_symlink() or not self.root.is_dir():
            raise ProfileError("profile home must be a private directory")
        try:
            os.chmod(self.root, 0o700)
        except OSError:
            pass
        if self.registry_path.is_symlink():
            raise ProfileError("profile registry must not be a symbolic link")

    @contextmanager
    def _file_lock(self):
        lock_path = self.root / ".registry.lock"
        if lock_path.is_symlink():
            raise ProfileError("profile registry lock must not be a symbolic link")
        fd = os.open(str(lock_path), os.O_CREAT | os.O_RDWR, 0o600)
        try:
            try:
                os.chmod(lock_path, 0o600)
            except OSError:
                pass
            if os.name == "nt":
                import msvcrt
                os.lseek(fd, 0, os.SEEK_SET)
                msvcrt.locking(fd, msvcrt.LK_LOCK, 1)
            else:
                import fcntl
                fcntl.flock(fd, fcntl.LOCK_EX)
            yield
        finally:
            try:
                if os.name == "nt":
                    import msvcrt
                    os.lseek(fd, 0, os.SEEK_SET)
                    msvcrt.locking(fd, msvcrt.LK_UNLCK, 1)
                else:
                    import fcntl
                    fcntl.flock(fd, fcntl.LOCK_UN)
            finally:
                os.close(fd)

    def _read_records(self) -> dict[str, dict]:
        path = self.registry_path
        if path.is_symlink():
            raise ProfileError("profile registry must not be a symbolic link")
        if not path.exists():
            return {}
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError) as exc:
            raise ProfileError("profile registry cannot be read safely") from exc
        if not isinstance(raw, dict) or raw.get("schema_version") != 1 or not isinstance(raw.get("profiles"), dict):
            raise ProfileError("unsupported or invalid profile registry")
        records = raw["profiles"]
        for profile_id, record in records.items():
            if not _PROFILE_ID.fullmatch(profile_id) or not isinstance(record, dict):
                raise ProfileError("invalid profile registry entry")
        return records

    def _write_records(self, records: dict[str, dict]) -> None:
        payload = json.dumps({"schema_version": 1, "profiles": records}, ensure_ascii=True, indent=2) + "\n"
        fd, temp_name = tempfile.mkstemp(prefix=".registry-", suffix=".tmp", dir=str(self.root))
        try:
            try:
                os.fchmod(fd, 0o600)
            except (AttributeError, OSError):
                pass
            with os.fdopen(fd, "w", encoding="utf-8") as stream:
                stream.write(payload)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temp_name, self.registry_path)
            try:
                os.chmod(self.registry_path, 0o600)
            except OSError:
                pass
        finally:
            if os.path.exists(temp_name):
                try:
                    os.unlink(temp_name)
                except OSError:
                    pass

    def _record(self, profile_id: str, value: dict) -> ProfileRecord:
        profile_dir = self.root / profile_id
        return ProfileRecord(
            profile_id=profile_id,
            status=value["status"],
            allowed_hosts=tuple(value["allowed_hosts"]),
            start_host=value["start_host"],
            created_at=value["created_at"],
            last_setup_confirmed_at=value.get("last_setup_confirmed_at"),
            profile_dir=profile_dir,
            user_data_dir=profile_dir / "chromium",
        )

    def create_pending(self, profile_id: str, start_url: str, allowed_hosts) -> ProfileRecord:
        if not isinstance(profile_id, str) or not _PROFILE_ID.fullmatch(profile_id):
            raise ProfileError("profile id must be a lowercase slug of letters, numbers, hyphens or underscores")
        hosts = normalize_allowed_hosts(allowed_hosts)
        normalized_url = validate_profile_url(start_url, hosts)
        start_host = urlsplit(normalized_url).hostname
        with self._thread_lock, self._file_lock():
            records = self._read_records()
            if profile_id in records or (self.root / profile_id).exists():
                raise ProfileError("profile already exists; it will not be overwritten")
            profile_dir = self.root / profile_id
            try:
                profile_dir.mkdir(mode=0o700)
                os.chmod(profile_dir, 0o700)
                (profile_dir / "chromium").mkdir(mode=0o700)
                os.chmod(profile_dir / "chromium", 0o700)
                records[profile_id] = {
                    "status": "setup_pending",
                    "allowed_hosts": sorted(hosts),
                    "start_host": start_host,
                    "created_at": _utc_now(),
                    "last_setup_confirmed_at": None,
                }
                self._write_records(records)
            except Exception:
                import shutil
                shutil.rmtree(profile_dir, ignore_errors=True)
                raise
            return self._record(profile_id, records[profile_id])

    def confirm_setup(self, profile_id: str, final_url: str) -> ProfileRecord:
        if not isinstance(profile_id, str) or not _PROFILE_ID.fullmatch(profile_id):
            raise ProfileError("invalid profile id")
        with self._thread_lock, self._file_lock():
            records = self._read_records()
            value = records.get(profile_id)
            if value is None:
                raise ProfileError("profile not found")
            if value.get("status") != "setup_pending":
                raise ProfileError("only a pending setup can be confirmed")
            validate_profile_url(final_url, value.get("allowed_hosts", []))
            value["status"] = "ready_user_confirmed"
            value["last_setup_confirmed_at"] = _utc_now()
            self._write_records(records)
            return self._record(profile_id, value)

    def get(self, profile_id: str) -> ProfileRecord:
        if not isinstance(profile_id, str) or not _PROFILE_ID.fullmatch(profile_id):
            raise ProfileError("invalid profile id")
        with self._thread_lock, self._file_lock():
            value = self._read_records().get(profile_id)
            if value is None:
                raise ProfileError("profile not found")
            return self._record(profile_id, value)

    def require_ready(self, profile_id: str) -> ProfileRecord:
        record = self.get(profile_id)
        if record.status != "ready_user_confirmed":
            raise ProfileError("profile setup is not user-confirmed")
        return record

    def list_profiles(self) -> list[ProfileRecord]:
        with self._thread_lock, self._file_lock():
            records = self._read_records()
            return [self._record(profile_id, value) for profile_id, value in sorted(records.items())]
