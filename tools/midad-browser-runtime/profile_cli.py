#!/usr/bin/env python3
"""MIDAD Browser profiles: set up a persistent login once, or inspect profile status."""
from __future__ import annotations

import argparse
import asyncio
import json
import sys

from profile_runtime import setup_login
from profile_vault import ProfileError, ProfileStore, normalize_allowed_hosts, validate_profile_url


def _parser():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--profile-home",
        help="private persistent profile directory (defaults to MIDAD_BROWSER_PROFILE_HOME or the OS data directory)",
    )
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("list", help="list profile names and status without exposing session data")

    setup = sub.add_parser("setup-login", help="open a visible Chromium browser for manual sign-in")
    setup.add_argument("--profile-id", required=True, help="lowercase profile slug, e.g. taskmarket")
    setup.add_argument("--url", required=True, help="HTTPS entry URL; URL query values are not stored")
    setup.add_argument(
        "--allow-host",
        action="append",
        required=True,
        dest="allowed_hosts",
        help="exact hostname allowed for setup navigation; repeat for explicit OAuth/login hosts",
    )
    return parser


async def _setup(args, store):
    hosts = normalize_allowed_hosts(args.allowed_hosts)
    target = validate_profile_url(args.url, hosts)
    print("Starting MIDAD SetupLogin in a visible, persistent Chromium profile.")
    print("Enter credentials only in the opened website; never type them into this terminal or ChatGPT.")
    print("Only the exact HTTPS hosts listed with --allow-host are reachable.")
    print("Downloads and non-login write methods are blocked; MIDAD will not read form fields, cookies, or page storage.")
    try:
        record = await setup_login(store, args.profile_id, target, hosts)
    except ProfileError as exc:
        print(f"SetupLogin stopped safely: {exc}", file=sys.stderr)
        return 2
    except Exception:
        # Avoid printing exception text that could contain URLs or page details.
        print("SetupLogin failed. No sign-in success is claimed; inspect local runtime configuration.", file=sys.stderr)
        return 2
    print(json.dumps(record.to_public_dict(), ensure_ascii=False, indent=2))
    print("Profile state means the user confirmed setup. It is not an independent proof that the site accepted the login.")
    return 0


def main():
    args = _parser().parse_args()
    try:
        store = ProfileStore(args.profile_home)
        if args.command == "list":
            print(json.dumps([row.to_public_dict() for row in store.list_profiles()], ensure_ascii=False, indent=2))
            return 0
        if args.command == "setup-login":
            return asyncio.run(_setup(args, store))
    except ProfileError as exc:
        print(f"Profile operation stopped safely: {exc}", file=sys.stderr)
        return 2
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
