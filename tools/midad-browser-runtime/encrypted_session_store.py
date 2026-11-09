"""Authenticated encryption for owner-scoped Playwright storage state.

The encryption key is injected by the host secret manager. This module never
writes the key or plaintext browser state to disk.
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
import re
import stat
import tempfile
from pathlib import Path
from typing import Any

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM


class SessionStoreError(RuntimeError):
    """Stable, non-sensitive failure code for encrypted session persistence."""


class EncryptedSessionStore:
    SCHEMA_VERSION = 1
    ALGORITHM = "AES-256-GCM"
    MAX_STATE_BYTES = 2 * 1024 * 1024
    MAX_ENVELOPE_BYTES = 4 * 1024 * 1024

    def __init__(self, root: str | Path, master_key_b64: str, key_id: str = "v1"):
        if not isinstance(master_key_b64, str) or not master_key_b64.strip():
            raise SessionStoreError("SESSION_STORE_KEY_REQUIRED")
        if not isinstance(key_id, str) or not re.fullmatch(r"[A-Za-z0-9._-]{1,32}", key_id):
            raise SessionStoreError("SESSION_STORE_KEY_ID_INVALID")
        try:
            key = base64.b64decode(master_key_b64.strip(), validate=True)
        except Exception as exc:
            raise SessionStoreError("SESSION_STORE_KEY_INVALID") from exc
        if len(key) != 32:
            raise SessionStoreError("SESSION_STORE_KEY_INVALID")

        self._key = key
        self._key_id = key_id
        self.root = Path(root).expanduser()
        if not self.root.is_absolute():
            raise SessionStoreError("SESSION_STORE_ROOT_MUST_BE_ABSOLUTE")
        if self.root.is_symlink():
            raise SessionStoreError("SESSION_STORE_ROOT_UNSAFE")
        try:
            self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
            if not self.root.is_dir() or self.root.is_symlink():
                raise SessionStoreError("SESSION_STORE_ROOT_UNSAFE")
            os.chmod(self.root, 0o700)
        except SessionStoreError:
            raise
        except OSError as exc:
            raise SessionStoreError("SESSION_STORE_ROOT_UNAVAILABLE") from exc

    @staticmethod
    def _identity(owner_id: str, account_id: str, host: str) -> tuple[str, str, str]:
        values = (owner_id, account_id, host)
        if any(not isinstance(value, str) or not value.strip() for value in values):
            raise SessionStoreError("SESSION_STORE_IDENTITY_INVALID")
        owner, account, hostname = (value.strip() for value in values)
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,127}", owner):
            raise SessionStoreError("SESSION_STORE_IDENTITY_INVALID")
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,127}", account):
            raise SessionStoreError("SESSION_STORE_IDENTITY_INVALID")
        hostname = hostname.lower().rstrip(".")
        if len(hostname) > 253 or not re.fullmatch(
            r"[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?", hostname
        ) or ".." in hostname:
            raise SessionStoreError("SESSION_STORE_IDENTITY_INVALID")
        return owner, account, hostname

    def path_for(self, owner_id: str, account_id: str, host: str) -> Path:
        owner, account, hostname = self._identity(owner_id, account_id, host)
        identity = "\0".join((owner, account, hostname)).encode("utf-8")
        digest = hashlib.sha256(identity).hexdigest()
        return self.root / (digest + ".midad-session")

    def _aad(self, owner_id: str, account_id: str, host: str) -> bytes:
        owner, account, hostname = self._identity(owner_id, account_id, host)
        return json.dumps(
            {
                "schema_version": self.SCHEMA_VERSION,
                "key_id": self._key_id,
                "owner_id": owner,
                "account_id": account,
                "host": hostname,
            },
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")

    @staticmethod
    def _validate_state(state: Any) -> bytes:
        if not isinstance(state, dict):
            raise SessionStoreError("SESSION_STORE_STATE_INVALID")
        if set(state) - {"cookies", "origins"}:
            raise SessionStoreError("SESSION_STORE_STATE_INVALID")
        if not isinstance(state.get("cookies", []), list) or not isinstance(state.get("origins", []), list):
            raise SessionStoreError("SESSION_STORE_STATE_INVALID")
        try:
            raw = json.dumps(state, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        except (TypeError, ValueError) as exc:
            raise SessionStoreError("SESSION_STORE_STATE_INVALID") from exc
        if len(raw) > EncryptedSessionStore.MAX_STATE_BYTES:
            raise SessionStoreError("SESSION_STORE_STATE_TOO_LARGE")
        return raw

    def save(self, owner_id: str, account_id: str, host: str, state: dict) -> dict:
        path = self.path_for(owner_id, account_id, host)
        plaintext = self._validate_state(state)
        nonce = os.urandom(12)
        try:
            ciphertext = AESGCM(self._key).encrypt(
                nonce, plaintext, self._aad(owner_id, account_id, host)
            )
        except Exception as exc:
            raise SessionStoreError("SESSION_STORE_ENCRYPTION_FAILED") from exc
        envelope = {
            "schema_version": self.SCHEMA_VERSION,
            "algorithm": self.ALGORITHM,
            "key_id": self._key_id,
            "nonce": base64.b64encode(nonce).decode("ascii"),
            "ciphertext": base64.b64encode(ciphertext).decode("ascii"),
        }
        raw = json.dumps(envelope, sort_keys=True, separators=(",", ":")).encode("ascii")
        if len(raw) > self.MAX_ENVELOPE_BYTES:
            raise SessionStoreError("SESSION_STORE_ENVELOPE_TOO_LARGE")

        temporary_path = None
        try:
            fd, temporary_name = tempfile.mkstemp(prefix=".session-", suffix=".tmp", dir=self.root)
            temporary_path = Path(temporary_name)
            try:
                os.fchmod(fd, 0o600)
                with os.fdopen(fd, "wb", closefd=True) as stream:
                    stream.write(raw)
                    stream.flush()
                    os.fsync(stream.fileno())
            except Exception:
                try:
                    os.close(fd)
                except OSError:
                    pass
                raise
            os.replace(temporary_path, path)
            temporary_path = None
            os.chmod(path, 0o600)
            try:
                dir_fd = os.open(self.root, os.O_RDONLY)
                try:
                    os.fsync(dir_fd)
                finally:
                    os.close(dir_fd)
            except OSError:
                pass
        except OSError as exc:
            raise SessionStoreError("SESSION_STORE_WRITE_FAILED") from exc
        finally:
            if temporary_path is not None:
                try:
                    temporary_path.unlink(missing_ok=True)
                except OSError:
                    pass
        return {"ok": True, "key_id": self._key_id, "encrypted": True}

    def load(self, owner_id: str, account_id: str, host: str) -> dict | None:
        path = self.path_for(owner_id, account_id, host)
        try:
            flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
            fd = os.open(path, flags)
        except FileNotFoundError:
            return None
        except OSError as exc:
            raise SessionStoreError("SESSION_STORE_PATH_UNSAFE") from exc
        try:
            info = os.fstat(fd)
            if not stat.S_ISREG(info.st_mode) or (stat.S_IMODE(info.st_mode) & 0o077):
                raise SessionStoreError("SESSION_STORE_PERMISSIONS_INVALID")
            if hasattr(os, "getuid") and info.st_uid != os.getuid():
                raise SessionStoreError("SESSION_STORE_OWNER_INVALID")
            if info.st_size <= 0 or info.st_size > self.MAX_ENVELOPE_BYTES:
                raise SessionStoreError("SESSION_STORE_ENVELOPE_INVALID")
            chunks = []
            total = 0
            while True:
                chunk = os.read(fd, 65536)
                if not chunk:
                    break
                total += len(chunk)
                if total > self.MAX_ENVELOPE_BYTES:
                    raise SessionStoreError("SESSION_STORE_ENVELOPE_TOO_LARGE")
                chunks.append(chunk)
            raw = b"".join(chunks)
        finally:
            os.close(fd)

        try:
            envelope = json.loads(raw.decode("ascii"))
            if not isinstance(envelope, dict) or envelope.get("schema_version") != self.SCHEMA_VERSION:
                raise ValueError("schema")
            if envelope.get("algorithm") != self.ALGORITHM or envelope.get("key_id") != self._key_id:
                raise ValueError("algorithm_or_key")
            nonce = base64.b64decode(envelope["nonce"], validate=True)
            ciphertext = base64.b64decode(envelope["ciphertext"], validate=True)
            if len(nonce) != 12 or len(ciphertext) < 16:
                raise ValueError("ciphertext")
            plaintext = AESGCM(self._key).decrypt(
                nonce, ciphertext, self._aad(owner_id, account_id, host)
            )
            if len(plaintext) > self.MAX_STATE_BYTES:
                raise ValueError("state_size")
            state = json.loads(plaintext.decode("utf-8"))
            self._validate_state(state)
            return state
        except InvalidTag as exc:
            raise SessionStoreError("SESSION_STORE_AUTH_FAILED") from exc
        except SessionStoreError:
            raise
        except Exception as exc:
            raise SessionStoreError("SESSION_STORE_ENVELOPE_INVALID") from exc

    def delete(self, owner_id: str, account_id: str, host: str) -> bool:
        path = self.path_for(owner_id, account_id, host)
        try:
            info = path.lstat()
        except FileNotFoundError:
            return False
        except OSError as exc:
            raise SessionStoreError("SESSION_STORE_DELETE_FAILED") from exc
        if stat.S_ISLNK(info.st_mode) or not stat.S_ISREG(info.st_mode):
            raise SessionStoreError("SESSION_STORE_PATH_UNSAFE")
        try:
            path.unlink()
            return True
        except OSError as exc:
            raise SessionStoreError("SESSION_STORE_DELETE_FAILED") from exc
