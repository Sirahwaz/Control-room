"""Browser-only Chromium smoke and adversarial routing tests; no secrets or Supabase writes."""
import asyncio
import hashlib
from playwright.async_api import (
    Error as PlaywrightError,
    TimeoutError as PlaywrightTimeoutError,
    async_playwright,
)
from runner import BrowserPolicyError, validate_navigation_url

ALLOWED = frozenset({"example.com"})
ATTACKER = "https://attacker.test/"


async def main():
    target = validate_navigation_url("https://example.com/", ALLOWED)
    blocked = []
    checks = {}

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, args=["--disable-background-networking"])
        try:
            # Real HTTPS page: browser install, TLS validation, navigation and content capture.
            context = await browser.new_context(
                accept_downloads=False, service_workers="block", ignore_https_errors=False
            )
            try:
                page = await context.new_page()

                async def public_guard(route):
                    request = route.request
                    try:
                        validate_navigation_url(request.url, ALLOWED)
                        if request.method.upper() not in {"GET", "HEAD"}:
                            raise BrowserPolicyError("READ_ONLY_METHOD_REQUIRED")
                        await route.continue_()
                    except BrowserPolicyError as exc:
                        blocked.append({"code": str(exc), "url": request.url})
                        await route.abort("blockedbyclient")

                await page.route("**/*", public_guard)
                response = await page.goto(target, wait_until="domcontentloaded", timeout=15000)
                assert response is not None and response.status == 200, "expected HTTP 200"
                title = await page.title()
                body = (await page.locator("body").inner_text(timeout=5000))[:2000]
                assert "Example Domain" in title or "Example Domain" in body, "unexpected example.com content"
                assert body.strip(), "empty body"
                digest = hashlib.sha256(body.encode()).hexdigest()
                checks["real_https_navigation"] = "PASS"
            finally:
                await context.close()
                assert page.is_closed(), "public page was not closed with its context"

            # Route fixtures simulate hostile redirects and subresources without contacting attacker.test.
            context = await browser.new_context(service_workers="block", ignore_https_errors=False)
            try:
                page = await context.new_page()
                intercepted = {"redirect": False, "script": False, "image": False}

                async def adversarial_routes(route):
                    url = route.request.url
                    if url == "https://example.com/redirect-fixture":
                        await route.fulfill(status=302, headers={"Location": ATTACKER + "landing"})
                        return
                    if url == "https://example.com/subresource-fixture":
                        html = '<html><body>fixture<script src="https://attacker.test/evil.js"></script><img src="https://attacker.test/pixel.png"></body></html>'
                        await route.fulfill(status=200, content_type="text/html", body=html)
                        return
                    try:
                        validate_navigation_url(url, ALLOWED)
                        if route.request.method.upper() not in {"GET", "HEAD"}:
                            raise BrowserPolicyError("READ_ONLY_METHOD_REQUIRED")
                        await route.continue_()
                    except BrowserPolicyError as exc:
                        host = route.request.url.split("/")[2] if "://" in route.request.url else "invalid"
                        blocked.append({"code": str(exc), "host": host})
                        if "redirect" in url or host == "attacker.test":
                            intercepted["redirect"] = True
                            if url.endswith("/evil.js"):
                                intercepted["script"] = True
                            if url.endswith("/pixel.png"):
                                intercepted["image"] = True
                        await route.abort("blockedbyclient")

                await page.route("**/*", adversarial_routes)
                try:
                    await page.goto("https://example.com/redirect-fixture", wait_until="domcontentloaded", timeout=2000)
                except PlaywrightError:
                    pass
                assert intercepted["redirect"], "non-allowlisted redirect destination was not blocked"
                response = await page.goto("https://example.com/subresource-fixture", wait_until="domcontentloaded", timeout=3000)
                assert response is not None and response.status == 200, "subresource fixture did not load"
                await page.wait_for_timeout(100)
                assert intercepted["script"], "non-allowlisted script subresource was not blocked"
                assert intercepted["image"], "non-allowlisted image subresource was not blocked"
                checks["redirect_blocked"] = "PASS"
                checks["script_subresource_blocked"] = "PASS"
                checks["image_subresource_blocked"] = "PASS"
            finally:
                await context.close()
                assert page.is_closed(), "adversarial test page was not closed"

            # Timeout test uses a route fixture that never resolves; no external host is contacted.
            context = await browser.new_context(service_workers="block")
            try:
                page = await context.new_page()
                hanging_started = asyncio.Event()

                async def hanging_route(route):
                    if route.request.url == "https://example.com/hang-fixture":
                        hanging_started.set()
                        await asyncio.Event().wait()
                    else:
                        await route.abort("blockedbyclient")

                await page.route("**/*", hanging_route)
                try:
                    await page.goto("https://example.com/hang-fixture", wait_until="domcontentloaded", timeout=250)
                except PlaywrightTimeoutError:
                    checks["navigation_timeout_bounded"] = "PASS"
                else:
                    raise AssertionError("navigation timeout was not enforced")
                assert hanging_started.is_set(), "timeout fixture was not reached"
            finally:
                await context.close()
                assert page.is_closed(), "timeout page was not closed"

            # Cancellation test: cancel an in-flight navigation, then prove browser resources close.
            context = await browser.new_context(service_workers="block")
            try:
                page = await context.new_page()
                cancel_started = asyncio.Event()

                async def cancellable_route(route):
                    cancel_started.set()
                    await asyncio.Event().wait()

                await page.route("**/*", cancellable_route)
                navigation = asyncio.create_task(
                    page.goto("https://example.com/cancel-fixture", wait_until="domcontentloaded", timeout=5000)
                )
                await asyncio.wait_for(cancel_started.wait(), timeout=1)
                navigation.cancel()
                try:
                    await navigation
                except asyncio.CancelledError:
                    checks["navigation_cancelled"] = "PASS"
                else:
                    raise AssertionError("navigation task was not cancelled")
            finally:
                await context.close()
                assert page.is_closed(), "cancelled page was not closed"

            # URL policy negatives are rejected before any network request.
            for url in (
                "http://example.com/",
                "https://example.com.attacker.test/",
                "https://example.com:8443/",
                "https://user:pass@example.com/",
                "https://127.0.0.1/",
                "https://localhost/",
            ):
                try:
                    validate_navigation_url(url, ALLOWED)
                except BrowserPolicyError:
                    continue
                raise AssertionError("unsafe URL was accepted: " + url)
            checks["url_policy_negatives"] = "PASS"
        finally:
            await browser.close()
            assert not browser.is_connected(), "browser process remained connected after cleanup"

    print({
        "status": "PASS",
        "checks": checks,
        "http_status": response.status if response else 200,
        "title": title[:120],
        "body_chars": len(body),
        "body_sha256": digest,
        "blocked_requests": len(blocked),
        "supabase_called": False,
        "secrets_required": False,
        "external_attacker_requests": 0,
        "browser_cleanup": "PASS",
    })


if __name__ == "__main__":
    asyncio.run(main())
