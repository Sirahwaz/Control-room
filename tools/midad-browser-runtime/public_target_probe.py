"""Bounded public HTTPS target probe; read-only, exact-host allowlist, no credentials or persistence."""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import os
import time
from urllib.parse import urlsplit

from runner import BrowserPolicyError, validate_navigation_url


async def probe(url: str, allowed_hosts: set[str], timeout_ms: int = 10000) -> dict:
    """Inspect one explicitly allowlisted public page and return metadata only."""
    if timeout_ms < 1000 or timeout_ms > 20000:
        raise ValueError("timeout must be between 1000 and 20000 ms")
    try:
        from playwright.async_api import async_playwright
    except ImportError as exc:
        raise RuntimeError("PLAYWRIGHT_DEPENDENCY_MISSING") from exc
    target = validate_navigation_url(url, allowed_hosts)
    blocked: list[str] = []
    started = time.monotonic()
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(
            headless=True,
            args=["--disable-background-networking", "--disable-sync", "--no-first-run"],
        )
        try:
            context = await browser.new_context(
                accept_downloads=False,
                service_workers="block",
                ignore_https_errors=False,
            )
            try:
                page = await context.new_page()
                page.set_default_navigation_timeout(timeout_ms)

                async def guard(route):
                    request = route.request
                    try:
                        validate_navigation_url(request.url, allowed_hosts)
                        if request.method.upper() not in {"GET", "HEAD"}:
                            raise BrowserPolicyError("READ_ONLY_METHOD_REQUIRED")
                        await route.continue_()
                    except BrowserPolicyError as exc:
                        blocked.append(str(exc))
                        await route.abort("blockedbyclient")

                await page.route("**/*", guard)
                response = await page.goto(target, wait_until="domcontentloaded", timeout=timeout_ms)
                final_url = validate_navigation_url(page.url, allowed_hosts)
                title = (await page.title())[:300]
                body = (await page.locator("body").inner_text(timeout=timeout_ms))[:5000]
                return {
                    "status": "PASS" if response and 200 <= response.status < 400 else "HTTP_ERROR",
                    "http_status": response.status if response else None,
                    "host": urlsplit(final_url).hostname,
                    "title": title,
                    "body_chars": len(body),
                    "body_sha256": hashlib.sha256(body.encode("utf-8")).hexdigest(),
                    "elapsed_ms": int((time.monotonic() - started) * 1000),
                    "blocked_requests": len(blocked),
                    "blocked_policy_codes": sorted(set(blocked))[:10],
                    "secrets_required": False,
                    "supabase_writes": False,
                    "external_actions": False,
                    "browser_cleanup": "closed_in_finally",
                }
            finally:
                await context.close()
        finally:
            await browser.close()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default=os.environ.get("MIDAD_PROBE_URL", ""))
    parser.add_argument("--allowed-host", default=os.environ.get("MIDAD_PROBE_ALLOWED_HOST", ""))
    parser.add_argument("--timeout-ms", type=int, default=10000)
    args = parser.parse_args()
    if not args.url or not args.allowed_host:
        parser.error("--url and --allowed-host are required")
    allowed = {part.strip().lower().rstrip(".") for part in args.allowed_host.split(",") if part.strip()}
    try:
        result = asyncio.run(probe(args.url, allowed, args.timeout_ms))
    except (BrowserPolicyError, ValueError) as exc:
        print(json.dumps({"status": "BLOCKED", "reason": str(exc), "secrets_required": False}, sort_keys=True))
        return 2
    print(json.dumps(result, sort_keys=True))
    return 0 if result["status"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
