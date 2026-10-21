"""Manual, browser-only live smoke. No Supabase credentials or writes."""
import asyncio
import hashlib
from playwright.async_api import async_playwright
from runner import BrowserPolicyError, validate_navigation_url

ALLOWED = frozenset({"example.com"})

async def main():
    target = validate_navigation_url("https://example.com/", ALLOWED)
    blocked = []
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(
            accept_downloads=False,
            service_workers="block",
            ignore_https_errors=False,
        )
        page = await context.new_page()
        async def guard(route):
            request = route.request
            try:
                url = validate_navigation_url(request.url, ALLOWED)
                if request.method.upper() not in {"GET", "HEAD"}:
                    raise BrowserPolicyError("READ_ONLY_METHOD_REQUIRED")
                await route.continue_()
            except BrowserPolicyError as exc:
                blocked.append({"code": str(exc), "host": request.url.split("/")[2] if "://" in request.url else "invalid"})
                await route.abort("blockedbyclient")
        await page.route("**/*", guard)
        response = await page.goto(target, wait_until="domcontentloaded", timeout=15000)
        assert response is not None and response.status == 200, "expected HTTP 200"
        title = await page.title()
        body = (await page.locator("body").inner_text(timeout=5000))[:2000]
        assert "Example Domain" in title or "Example Domain" in body, "unexpected example.com content"
        assert len(body) > 0, "empty body"
        digest = hashlib.sha256(body.encode()).hexdigest()
        # Policy negatives: these must be rejected before a network request.
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
        await context.close()
        await browser.close()
    print({
        "status": "PASS",
        "http_status": response.status,
        "title": title[:120],
        "body_chars": len(body),
        "body_sha256": digest,
        "blocked_requests": len(blocked),
        "supabase_called": False,
        "secrets_required": False,
    })

if __name__ == "__main__":
    asyncio.run(main())
