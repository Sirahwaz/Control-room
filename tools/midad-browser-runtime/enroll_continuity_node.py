#!/usr/bin/env python3
"""One-time, owner-consented Cloudflare Continuity node enrollment.

The admin key is read only from the host environment. The returned node token
is written once to a private file and is never printed or returned to stdout.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import stat
import tempfile
import uuid
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener


CAPABILITIES = [
    "interactive-browser-execution",
    "persistent-browser-session",
    "encrypted-session-store",
]


class EnrollmentError(RuntimeError):
    pass


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def validate_base_url(value: str) -> str:
    try:
        parts = urlsplit(str(value or "").strip())
        port = parts.port
    except (TypeError, ValueError) as exc:
        raise EnrollmentError("LEDGER_URL_INVALID") from exc
    if (
        parts.scheme.lower() != "https" or not parts.hostname
        or parts.username is not None or parts.password is not None
        or port not in (None, 443) or parts.path not in ("", "/")
        or parts.query or parts.fragment
    ):
        raise EnrollmentError("LEDGER_URL_INVALID")
    return "https://" + parts.hostname.lower()


def validate_token_destination(path: Path, replace_existing: bool = False) -> None:
    if not path.is_absolute() or path.is_symlink():
        raise EnrollmentError("TOKEN_FILE_PATH_INVALID")
    parent = path.parent
    parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    if parent.is_symlink() or not parent.is_dir():
        raise EnrollmentError("TOKEN_FILE_PARENT_UNSAFE")
    if os.name != "nt":
        os.chmod(parent, 0o700)
        if parent.stat().st_mode & 0o077:
            raise EnrollmentError("TOKEN_FILE_PARENT_PERMISSIONS_INVALID")
    if path.exists() and not replace_existing:
        raise EnrollmentError("TOKEN_FILE_ALREADY_EXISTS")
    if path.exists():
        if path.is_symlink() or not path.is_file():
            raise EnrollmentError("TOKEN_FILE_PATH_INVALID")
    try:
        fd, name = tempfile.mkstemp(prefix=".node-token-preflight-", dir=str(parent))
        os.close(fd)
        os.unlink(name)
    except OSError as exc:
        raise EnrollmentError("TOKEN_FILE_PARENT_NOT_WRITABLE") from exc


def write_private_token(path: Path, token: str, replace_existing: bool = False) -> None:
    if not path.is_absolute() or path.is_symlink():
        raise EnrollmentError("TOKEN_FILE_PATH_INVALID")
    if not re.fullmatch(r"[a-fA-F0-9]{64}", token):
        raise EnrollmentError("ENROLLMENT_TOKEN_INVALID")
    parent = path.parent
    parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    if parent.is_symlink() or not parent.is_dir():
        raise EnrollmentError("TOKEN_FILE_PARENT_UNSAFE")
    if os.name != "nt":
        os.chmod(parent, 0o700)
        if parent.stat().st_mode & 0o077:
            raise EnrollmentError("TOKEN_FILE_PARENT_PERMISSIONS_INVALID")
    if path.exists() and not replace_existing:
        raise EnrollmentError("TOKEN_FILE_ALREADY_EXISTS")
    if path.exists() and path.is_symlink():
        raise EnrollmentError("TOKEN_FILE_PATH_INVALID")

    temp_path = None
    try:
        fd, name = tempfile.mkstemp(prefix=".node-token-", dir=str(parent))
        temp_path = Path(name)
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w", encoding="ascii") as stream:
            stream.write(token + "\n")
            stream.flush()
            os.fsync(stream.fileno())
        if not replace_existing and path.exists():
            raise EnrollmentError("TOKEN_FILE_ALREADY_EXISTS")
        os.replace(temp_path, path)
        temp_path = None
        os.chmod(path, 0o600)
        try:
            dir_fd = os.open(parent, os.O_RDONLY)
            try:
                os.fsync(dir_fd)
            finally:
                os.close(dir_fd)
        except OSError:
            pass
    except EnrollmentError:
        raise
    except OSError as exc:
        raise EnrollmentError("TOKEN_FILE_WRITE_FAILED") from exc
    finally:
        if temp_path is not None:
            try:
                temp_path.unlink(missing_ok=True)
            except OSError:
                pass


def enroll_node(base_url: str, node_id: str, owner_id: str, admin_key: str,
                token_file: Path, confirm_owner_consent: bool,
                replace_token_file: bool = False, opener=None) -> dict:
    if not confirm_owner_consent:
        raise EnrollmentError("EXPLICIT_OWNER_CONSENT_REQUIRED")
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,127}", node_id or ""):
        raise EnrollmentError("NODE_ID_INVALID")
    try:
        uuid.UUID(owner_id)
    except (ValueError, TypeError, AttributeError) as exc:
        raise EnrollmentError("OWNER_ID_INVALID") from exc
    if not isinstance(admin_key, str) or len(admin_key) < 32:
        raise EnrollmentError("LEDGER_ADMIN_KEY_REQUIRED")
    validate_token_destination(token_file, replace_token_file)
    origin = validate_base_url(base_url)
    payload = {
        "node_id": node_id,
        "owner_id": owner_id,
        "consent_confirmed": True,
        "capabilities": CAPABILITIES,
    }
    request = Request(
        origin + "/v1/nodes/enroll",
        data=json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8"),
        method="POST",
        headers={
            "content-type": "application/json",
            "accept": "application/json",
            "authorization": "Bearer " + admin_key,
        },
    )
    client = opener or build_opener(NoRedirect())
    try:
        with client.open(request, timeout=10) as response:
            status = response.getcode()
            raw = response.read(1024 * 1024 + 1)
    except HTTPError as exc:
        raise EnrollmentError("LEDGER_ENROLL_HTTP_" + str(int(exc.code))) from exc
    except (URLError, TimeoutError, OSError) as exc:
        raise EnrollmentError("LEDGER_ENROLL_TRANSPORT_FAILED") from exc
    if status != 201 or len(raw) > 1024 * 1024:
        raise EnrollmentError("LEDGER_ENROLL_REJECTED")
    try:
        result = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, ValueError) as exc:
        raise EnrollmentError("LEDGER_ENROLL_RESPONSE_INVALID") from exc
    if not isinstance(result, dict) or result.get("ok") is not True:
        raise EnrollmentError("LEDGER_ENROLL_REJECTED")
    if result.get("node_id") != node_id or result.get("token_delivery") != "one_time_response_never_persisted_in_plaintext":
        raise EnrollmentError("LEDGER_ENROLL_RESPONSE_INVALID")
    token = result.get("enrollment_token")
    write_private_token(token_file, token if isinstance(token, str) else "", replace_token_file)
    return {"ok": True, "node_id": node_id, "token_file": str(token_file), "token_saved": True}


def main() -> int:
    parser = argparse.ArgumentParser(description="Enroll one explicitly approved MIDAD Browser node.")
    parser.add_argument("--ledger-url", default=os.environ.get("MIDAD_CONTINUITY_LEDGER_URL", ""))
    parser.add_argument("--node-id", required=True)
    parser.add_argument("--owner-id", required=True)
    parser.add_argument("--token-file", required=True, type=Path)
    parser.add_argument("--confirm-owner-consent", action="store_true")
    parser.add_argument("--replace-token-file", action="store_true")
    args = parser.parse_args()
    try:
        result = enroll_node(
            args.ledger_url, args.node_id, args.owner_id,
            os.environ.get("MIDAD_LEDGER_ADMIN_KEY", ""),
            args.token_file, args.confirm_owner_consent,
            args.replace_token_file,
        )
    except EnrollmentError as exc:
        parser.exit(2, "MIDAD_NODE_ENROLLMENT_BLOCKED:" + str(exc) + "\n")
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
