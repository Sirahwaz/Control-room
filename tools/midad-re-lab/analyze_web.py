from __future__ import annotations
import argparse, ipaddress, json, socket, time
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

MAX_BODY = 1_000_000
ALLOWED_METHODS = {"GET", "HEAD"}

def _public_addresses(host: str, resolver=socket.getaddrinfo) -> set[str]:
    records = resolver(host, None, type=socket.SOCK_STREAM)
    addresses = {record[4][0] for record in records}
    if not addresses or any(not ipaddress.ip_address(value).is_global for value in addresses):
        raise ValueError("TARGET_HOST_NOT_PUBLIC")
    return addresses

def validate_target_url(raw: str, expected_host: str | None = None, resolver=socket.getaddrinfo) -> str:
    parts = urlsplit(raw)
    if parts.scheme != "https" or not parts.hostname or parts.username or parts.password:
        raise ValueError("HTTPS_PUBLIC_URL_REQUIRED")
    if parts.port not in (None, 443):
        raise ValueError("NON_DEFAULT_PORT_BLOCKED")
    host = parts.hostname.lower().rstrip(".")
    if expected_host and host != expected_host:
        raise ValueError("CROSS_HOST_REDIRECT_BLOCKED")
    _public_addresses(host, resolver)
    return host

class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

def fetch_same_host(url: str, host: str, limit=MAX_BODY):
    opener = build_opener(_NoRedirect)
    current = url
    for _ in range(4):
        validate_target_url(current, host)
        request = Request(current, headers={"User-Agent": "MIDAD-Authorized-ReadOnly-Audit/1.0"})
        try:
            response = opener.open(request, timeout=15)
        except HTTPError as exc:
            response = exc
        status = getattr(response, "status", response.code)
        if status in (301, 302, 303, 307, 308):
            location = response.headers.get("Location")
            response.close()
            if not location:
                raise ValueError("REDIRECT_WITHOUT_LOCATION")
            current = urljoin(current, location)
            continue
        body = response.read(limit + 1)
        headers = dict(response.headers.items())
        response.close()
        return {"url": current, "status": status, "headers": headers, "body": body[:limit]}
    raise ValueError("REDIRECT_LIMIT_EXCEEDED")

async def inspect_page(target: str, host: str):
    from playwright.async_api import async_playwright
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(accept_downloads=False, ignore_https_errors=False)
        page = await context.new_page()
        blocked = {"count": 0}
        async def guard(route):
            req = route.request
            try:
                validate_target_url(req.url, host)
                if req.method not in ALLOWED_METHODS:
                    raise ValueError("METHOD_BLOCKED")
                await route.continue_()
            except Exception:
                blocked["count"] += 1
                await route.abort()
        await page.route("**/*", guard)
        response = await page.goto(target, wait_until="domcontentloaded", timeout=25000)
        snapshot = await page.evaluate("""() => ({
          title: document.title || "",
          headings: Array.from(document.querySelectorAll("h1")).slice(0,30).map(x => (x.innerText || "").slice(0,300)),
          links: Array.from(document.querySelectorAll("a[href]")).slice(0,250).map(x => x.href),
          scripts: Array.from(document.querySelectorAll("script[src]")).slice(0,150).map(x => x.src),
          meta: Array.from(document.querySelectorAll("meta[name],meta[property]")).slice(0,80).map(x => ({name:x.name || x.getAttribute("property"),content:(x.content || "").slice(0,300)})),
          forms: Array.from(document.forms).slice(0,30).map(f => ({method:(f.method || "get").toUpperCase(), action:f.action, fields:Array.from(f.querySelectorAll("input,select,textarea,button")).slice(0,30).map(e => ({tag:e.tagName.toLowerCase(),type:e.type || "",name:e.name || "",autocomplete:e.autocomplete || ""}))}))
        })""")
        result = {"http_status": response.status if response else None,
                  "final_url": page.url, "title": snapshot["title"],
                  "headings": snapshot["headings"],
                  "same_host_links": [x for x in snapshot["links"] if urlsplit(x).hostname == host][:150],
                  "same_host_scripts": [x for x in snapshot["scripts"] if urlsplit(x).hostname == host][:100],
                  "meta": snapshot["meta"], "forms_metadata_only": snapshot["forms"],
                  "blocked_cross_host_or_non_get_requests": blocked["count"],
                  "response_headers": response.headers if response else {}}
        await context.close()
        await browser.close()
        return result

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True)
    parser.add_argument("--out", default="artifacts/web")
    args = parser.parse_args()
    host = validate_target_url(args.url)
    robots = fetch_same_host(f"https://{host}/robots.txt", host)
    sitemap = fetch_same_host(f"https://{host}/sitemap.xml", host)
    import asyncio
    page = asyncio.run(inspect_page(args.url, host))
    report = {"schema": "midad-web-surface-v1", "generated_at": datetime.now(timezone.utc).isoformat(),
              "scope": {"target": args.url, "host": host, "mode": "read_only_same_host_get_head",
                        "no_login": True, "no_form_submission": True, "no_captcha_or_evasion": True},
              "page": page,
              "robots": {"status": robots["status"], "text_preview": robots["body"].decode("utf-8", "replace")[:8000]},
              "sitemap": {"status": sitemap["status"], "content_type": sitemap["headers"].get("Content-Type", ""),
                          "bytes": len(sitemap["body"])}}
    output = Path(args.out); output.mkdir(parents=True, exist_ok=True)
    (output / "web-surface-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print("WEB_SURFACE_REPORT_READY", output / "web-surface-report.json")

if __name__ == "__main__":
    main()
