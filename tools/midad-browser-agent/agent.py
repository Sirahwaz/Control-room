#!/usr/bin/env python3
"""Public-page research runner. No login, cookie import, form submission, or payment actions."""

from __future__ import annotations

import argparse
import hashlib
import html
import ipaddress
import json
import socket
import time
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

from action_policy import evaluate_action

MAX_TARGETS = 25
MAX_RESPONSE_BYTES = 2_000_000
MAX_TEXT_CHARS = 60_000
USER_AGENT = "MIDAD-Free-Research-Agent/1.0 (+public-evidence; no-login; contact via repository)"


def resolve_public_host(hostname: str) -> list[str]:
    """Resolve a host and reject literal/private/reserved/non-routable addresses."""
    try:
        literal = ipaddress.ip_address(hostname)
        addresses = [str(literal)]
    except ValueError:
        try:
            addresses = sorted({item[4][0].split("%", 1)[0] for item in socket.getaddrinfo(
                hostname, 443, type=socket.SOCK_STREAM
            )})
        except OSError as exc:
            raise ValueError(f"DNS resolution failed for {hostname}: {exc}") from exc
    if not addresses:
        raise ValueError(f"No DNS addresses returned for {hostname}")
    parsed = [ipaddress.ip_address(address) for address in addresses]
    if any(not address.is_global for address in parsed):
        raise ValueError(f"Host {hostname} resolves to a non-public address")
    return addresses


def validate_target(raw_url: str, allowed_hosts: set[str] | None = None) -> dict[str, str]:
    """Validate a public HTTPS URL and its hostname allowlist before network access."""
    if not isinstance(raw_url, str) or not raw_url.strip():
        raise ValueError("URL must be a non-empty string")
    raw_url = raw_url.strip()
    parts = urlsplit(raw_url)
    if parts.scheme.lower() != "https":
        raise ValueError("Only HTTPS targets are allowed")
    if parts.username is not None or parts.password is not None:
        raise ValueError("URLs containing embedded credentials are forbidden")
    if not parts.hostname:
        raise ValueError("URL must contain a hostname")
    if parts.port not in (None, 443):
        raise ValueError("Only the default HTTPS port is allowed")
    hostname = parts.hostname.lower().rstrip(".")
    if hostname in {"localhost", "localhost.localdomain"} or hostname.endswith((".local", ".internal", ".localhost")):
        raise ValueError("Local and internal hostnames are forbidden")
    if allowed_hosts is not None:
        normalized_allowlist = {host.lower().rstrip(".") for host in allowed_hosts if isinstance(host, str)}
        if hostname not in normalized_allowlist:
            raise ValueError(f"Host {hostname} is not in the explicit allowlist")
    resolve_public_host(hostname)
    normalized = parts._replace(scheme="https", netloc=hostname + (":443" if parts.port == 443 else ""))
    return {"url": normalized.geturl(), "hostname": hostname}


class _VisibleTextParser(HTMLParser):
    """Extract readable text while discarding scripts, styles, and hidden metadata."""

    SKIP = {"script", "style", "noscript", "svg", "canvas", "template"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self._skip_depth = 0

    def handle_starttag(self, tag: str, attrs) -> None:
        if tag.lower() in self.SKIP:
            self._skip_depth += 1
        elif tag.lower() in {"br", "p", "div", "li", "h1", "h2", "h3", "tr", "section"} and not self._skip_depth:
            self.parts.append(" ")

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() in self.SKIP and self._skip_depth:
            self._skip_depth -= 1
        elif tag.lower() in {"br", "p", "div", "li", "h1", "h2", "h3", "tr", "section"} and not self._skip_depth:
            self.parts.append(" ")

    def handle_data(self, data: str) -> None:
        if not self._skip_depth:
            self.parts.append(data)


def extract_visible_text(document: str) -> str:
    parser = _VisibleTextParser()
    parser.feed(document or "")
    parser.close()
    return " ".join(" ".join(parser.parts).split())[:MAX_TEXT_CHARS]


def _normalized_allowlist(target: dict) -> set[str]:
    raw_hosts = target.get("allowed_hosts") or []
    if not isinstance(raw_hosts, list) or any(not isinstance(host, str) or not host.strip() for host in raw_hosts):
        raise ValueError("allowed_hosts must be a list of hostnames")
    allowed = {host.lower().strip().rstrip(".") for host in raw_hosts}
    if len(allowed) > 20:
        raise ValueError("A target may allow at most 20 resource hosts")
    return allowed


def _target_record(raw: str | dict) -> dict:
    if isinstance(raw, str):
        raw = {"url": raw}
    if not isinstance(raw, dict) or not isinstance(raw.get("url"), str):
        raise ValueError("Each target must be a URL string or an object containing url")
    allowed = _normalized_allowlist(raw)
    checked = validate_target(raw["url"], allowed_hosts=allowed or None)
    allowed.add(checked["hostname"])
    # Resolve every explicit resource host now. A misspelled/internal host fails closed.
    for host in allowed:
        if host != checked["hostname"]:
            resolve_public_host(host)
    label = str(raw.get("label") or checked["hostname"])[:120]
    purpose = str(raw.get("purpose") or "Public-page evidence capture")[:300]
    return {"url": checked["url"], "hostname": checked["hostname"], "label": label, "purpose": purpose,
            "allowed_hosts": sorted(allowed)}


def _guard_request_url(url: str, allowed_hosts: set[str]) -> None:
    parts = urlsplit(url)
    if parts.scheme.lower() != "https" or not parts.hostname or parts.port not in (None, 443):
        raise ValueError("Blocked non-HTTPS or non-standard-port request")
    hostname = parts.hostname.lower().rstrip(".")
    if hostname not in allowed_hosts:
        raise ValueError(f"Blocked out-of-allowlist request to {hostname}")
    resolve_public_host(hostname)


def _safe_slug(index: int, hostname: str) -> str:
    safe = "".join(char if char.isalnum() or char in "-_" else "-" for char in hostname)[:55]
    return f"{index:02d}-{safe or 'target'}"


def require_read_only_method(method: str) -> str:
    """Allow only idempotent HTTP methods for all outbound network requests."""
    normalized = str(method or "").upper()
    if normalized not in {"GET", "HEAD"}:
        raise ValueError(f"Blocked state-changing HTTP method: {normalized or '<missing>'}")
    return normalized


def _render_local_evidence_screenshot(title: str, source_url: str, text: str, screenshot_path: Path) -> None:
    """Render a local text-only evidence sheet; Chromium never navigates to the target site."""
    from playwright.sync_api import sync_playwright

    safe_title = html.escape((title or "Public page capture")[:500])
    safe_url = html.escape(source_url[:2000])
    safe_text = html.escape((text or "[No visible text extracted]")[:MAX_TEXT_CHARS])
    document = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>MIDAD public evidence capture</title>
<style>
*{{box-sizing:border-box}}body{{margin:0;padding:28px;background:#101723;color:#edf4fc;font:16px/1.55 system-ui,sans-serif}}
header{{border-bottom:1px solid #46566b;padding-bottom:16px;margin-bottom:18px}}
.kicker{{color:#9fd8ff;font-size:12px;font-weight:700;letter-spacing:.08em}}
h1{{font-size:24px;line-height:1.3;margin:8px 0}}.url{{color:#bac7d8;overflow-wrap:anywhere;font-size:12px}}
pre{{white-space:pre-wrap;overflow-wrap:anywhere;font:15px/1.6 system-ui,sans-serif;background:#182435;border:1px solid #34445a;border-radius:12px;padding:18px;margin:0}}
footer{{color:#bac7d8;font-size:12px;margin-top:14px}}
</style></head><body>
<header><div class="kicker">MIDAD · READ-ONLY PUBLIC EVIDENCE</div><h1>{safe_title}</h1>
<div class="url">Source: {safe_url}</div></header>
<pre>{safe_text}</pre><footer>Captured text only. This is a local report rendering, not a screenshot of the original website.</footer>
</body></html>"""
    screenshot_path.parent.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        try:
            page = browser.new_page(viewport={"width": 1365, "height": 900}, device_scale_factor=1)
            # Set the content locally; no remote URL is opened and all network requests are aborted.
            page.route("**/*", lambda route: route.abort())
            page.set_content(document, wait_until="domcontentloaded", timeout=8_000)
            page.screenshot(path=str(screenshot_path), full_page=False, animations="disabled")
        finally:
            browser.close()


class _SafeRedirectHandler(HTTPRedirectHandler):
    def __init__(self, allowed_hosts: set[str]):
        super().__init__()
        self.allowed_hosts = allowed_hosts

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        # This handler runs before urllib follows each redirect hop.
        require_read_only_method(req.get_method())
        destination = urljoin(req.full_url, newurl)
        _guard_request_url(destination, self.allowed_hosts)
        return super().redirect_request(req, fp, code, msg, headers, destination)


def _safe_http_capture(target: dict) -> dict:
    allowed = set(target["allowed_hosts"])
    _guard_request_url(target["url"], allowed)
    request = Request(target["url"], headers={"User-Agent": USER_AGENT, "Accept": "text/html,text/plain;q=0.9"}, method=require_read_only_method("GET"))
    opener = build_opener(_SafeRedirectHandler(allowed))
    try:
        with opener.open(request, timeout=18) as response:
            payload = response.read(MAX_RESPONSE_BYTES + 1)
            if len(payload) > MAX_RESPONSE_BYTES:
                raise ValueError("Response exceeded the 2 MB safety limit")
            content_type = response.headers.get_content_type()
            charset = response.headers.get_content_charset() or "utf-8"
            raw = payload.decode(charset, errors="replace")
            text = extract_visible_text(raw) if "html" in content_type else " ".join(raw.split())[:MAX_TEXT_CHARS]
            final_url = response.geturl()
            _guard_request_url(final_url, allowed)
            status_code = response.status
            title_match = None
            import re
            match = re.search(r"<title\b[^>]*>(.*?)</title\s*>", raw, flags=re.I | re.S)
            if match:
                title_match = " ".join(html.unescape(re.sub(r"<[^>]+>", " ", match.group(1))).split())[:500]
            return {"capture_method": "safe_http_get", "http_status": status_code,
                    "title": title_match or "", "final_url": final_url, "text": text, "screenshot": None,
                    "status": "CAPTURED" if status_code < 400 else "HTTP_ERROR"}
    except HTTPError as exc:
        snippet = exc.read(5000).decode("utf-8", errors="replace")
        return {"capture_method": "urllib_fallback", "http_status": exc.code, "title": "",
                "final_url": exc.geturl(), "text": extract_visible_text(snippet), "screenshot": None,
                "status": "HTTP_ERROR", "warning": str(exc)}
    except (URLError, TimeoutError, OSError) as exc:
        raise RuntimeError(f"Fallback fetch failed: {exc}") from exc


def collect_one(raw_target: str | dict, index: int, output_dir: Path, attempts: int = 3) -> dict:
    target = _target_record(raw_target)
    policy = evaluate_action("navigate", target["url"], target["allowed_hosts"])
    if policy["status"] != "ALLOW":
        raise ValueError(f"Action blocked by policy ({policy['code']}): {policy['reason']}")
    slug = _safe_slug(index, target["hostname"])
    screenshot = output_dir / "screenshots" / f"{slug}.png"
    errors = []
    capture = None
    for attempt in range(1, attempts + 1):
        try:
            # Network I/O is handled only by urllib GET with a redirect guard.
            capture = _safe_http_capture(target)
            break
        except Exception as exc:
            errors.append(f"safe HTTP GET attempt {attempt}: {type(exc).__name__}: {str(exc)[:400]}")
            if attempt < attempts:
                time.sleep(min(2 ** (attempt - 1), 4))
    if capture is None:
        capture = {"capture_method": "none", "http_status": None, "title": "", "final_url": target["url"],
                   "text": "", "screenshot": None, "screenshot_type": None, "status": "FAILED"}
    elif capture.get("status") == "CAPTURED":
        try:
            _render_local_evidence_screenshot(str(capture.get("title") or target["label"]),
                                              str(capture.get("final_url") or target["url"]),
                                              str(capture.get("text") or ""), screenshot)
            capture["screenshot"] = str(screenshot)
            capture["screenshot_type"] = "local_text_report"
        except Exception as exc:
            capture["screenshot"] = None
            capture["screenshot_type"] = None
            errors.append(f"local screenshot rendering unavailable: {type(exc).__name__}: {str(exc)[:300]}")
    text = str(capture.pop("text", ""))[:MAX_TEXT_CHARS]
    fetched_at = datetime.now(timezone.utc).isoformat()
    digest = hashlib.sha256(text.encode("utf-8")).hexdigest()
    output_dir.mkdir(parents=True, exist_ok=True)
    text_path = output_dir / "text" / f"{slug}.txt"
    text_path.parent.mkdir(parents=True, exist_ok=True)
    text_path.write_text(text, encoding="utf-8")
    record = {
        "label": target["label"], "purpose": target["purpose"], "requested_url": target["url"],
        **capture, "fetched_at": fetched_at, "text_sha256": digest, "text_file": str(text_path),
        "errors": errors, "interaction_policy": "read-only; no login, cookies, clicks, forms, or submissions",
    }
    evidence_path = output_dir / "evidence" / f"{slug}.json"
    evidence_path.parent.mkdir(parents=True, exist_ok=True)
    evidence_path.write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8")
    record["evidence_file"] = str(evidence_path)
    return record


def load_targets(targets_path: Path, urls_json: str | None) -> list:
    if urls_json:
        targets = json.loads(urls_json)
    else:
        targets = json.loads(targets_path.read_text(encoding="utf-8"))
    if not isinstance(targets, list):
        raise ValueError("Targets input must be a JSON array")
    if not targets:
        raise ValueError("No targets configured; provide at least one public HTTPS URL")
    if len(targets) > MAX_TARGETS:
        raise ValueError(f"At most {MAX_TARGETS} targets per run")
    return targets


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--targets", type=Path, default=Path(__file__).with_name("targets.json"))
    parser.add_argument("--urls-json", help="JSON array of URL strings or target objects")
    parser.add_argument("--out", type=Path, default=Path(__file__).with_name("output"))
    args = parser.parse_args()

    try:
        targets = load_targets(args.targets, args.urls_json)
    except Exception as exc:
        parser.error(str(exc))

    records = []
    for index, raw in enumerate(targets, start=1):
        try:
            record = collect_one(raw, index, args.out)
        except Exception as exc:
            record = {"target": str(raw)[:300], "status": "FAILED",
                      "error": f"{type(exc).__name__}: {str(exc)[:500]}"}
        records.append(record)
        print(f"[{record.get('status', 'FAILED')}] {record.get('label', record.get('target', 'target'))}")

    report = {
        "schema_version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "agent": "MIDAD Free Browser Research Agent",
        "read_only": True,
        "counts": {
            "total": len(records),
            "captured": sum(item.get("status") == "CAPTURED" for item in records),
            "http_errors": sum(item.get("status") == "HTTP_ERROR" for item in records),
            "failed": sum(item.get("status") == "FAILED" for item in records),
        },
        "results": records,
    }
    args.out.mkdir(parents=True, exist_ok=True)
    report_path = args.out / "report.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Report: {report_path}")
    print(json.dumps(report["counts"], ensure_ascii=False))
    return 0 if report["counts"]["captured"] > 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
