#!/usr/bin/env python3
"""Publish the KNOTS research article to DEV.to only when a pre-existing repo secret is configured.

This script never logs credentials, never calls paid publishing APIs, and never submits to Taskmarket.
It also leaves X/Bluesky as a prepared draft because no verified zero-cost authenticated publisher is configured.
"""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

TITLE = "KNOTS: a simple rewards loop, with one important caveat"
ARTICLE_PATH = Path("research/knots-analysis-2026-10-20.md")
STATUS_PATH = Path("research/knots-publishing-status.json")
SOCIAL_DRAFT_PATH = Path("research/knots-x-post-draft.md")
IMAGE_URL = "https://raw.githubusercontent.com/Sirahwaz/Control-room/main/assets/knots-research-infographic.png"
PAGES_URL = "https://sirahwaz.github.io/Control-room/knots-analysis.html"
SVG_URL = "https://sirahwaz.github.io/Control-room/assets/knots-research-infographic.svg"


def set_output(name: str, value: str) -> None:
    path = os.environ.get("GITHUB_OUTPUT")
    if path:
        with open(path, "a", encoding="utf-8") as stream:
            stream.write(name + "=" + value.replace("\n", " ") + "\n")


def add_summary(markdown: str) -> None:
    path = os.environ.get("GITHUB_STEP_SUMMARY")
    if path:
        with open(path, "a", encoding="utf-8") as stream:
            stream.write(markdown.rstrip() + "\n\n")


def api_json(url: str, api_key: str, method: str = "GET", payload: dict[str, Any] | None = None) -> Any:
    body = None if payload is None else json.dumps(payload, ensure_ascii=False).encode("utf-8")
    headers = {"api-key": api_key, "Accept": "application/json"}
    if body is not None:
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=35) as response:
            raw = response.read()
            if len(raw) > 4_000_000:
                raise RuntimeError("API response exceeded the configured safety bound.")
            return json.loads(raw.decode("utf-8"))
    except urllib.error.HTTPError as exc:
        # Deliberately do not print the response body or request headers.
        raise RuntimeError("DEV.to API returned HTTP " + str(exc.code)) from None
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise RuntimeError("DEV.to API network request failed (" + type(exc).__name__ + ").") from None


def public_image_ready() -> bool:
    request = urllib.request.Request(IMAGE_URL, headers={"User-Agent": "MIDAD-KNOTS-publication-check/1.0"}, method="GET")
    for attempt in range(1, 7):
        try:
            with urllib.request.urlopen(request, timeout=10) as response:
                return response.status == 200 and "image/png" in response.headers.get("Content-Type", "").lower()
        except Exception:
            if attempt < 6:
                time.sleep(2)
    return False


def main() -> int:
    source = ARTICLE_PATH.read_text(encoding="utf-8")
    lines = source.splitlines()
    if not lines or not lines[0].startswith("# "):
        raise RuntimeError("Expected the KNOTS article H1 was not found.")
    title = lines[0][2:].strip()
    if title != TITLE:
        raise RuntimeError("Article title changed; review the publisher's duplicate guard.")
    if "AI-created for a Mycelium Finance bounty" not in source:
        raise RuntimeError("Required bounty disclosure is missing.")
    if "myceliumfinance.com/api/mycelium-allocation" not in source:
        raise RuntimeError("Timestamped allocation source link is missing.")
    if "displayed “n/a”" not in source:
        raise RuntimeError("Current payout-counter caveat is missing.")

    api_key = os.environ.get("DEVTO_API_KEY", "").strip()
    article_url = ""
    status = "BLOCKED_MISSING_DEVTO_API_KEY"

    if not api_key:
        add_summary(
            "## DEV.to publication: BLOCKED\n"
            "No DEVTO_API_KEY repository secret is configured. No external article was published. "
            "No credentials were requested, revealed, or written to the repository."
        )
        print("DEV.to blocked: required repository secret is absent; no publication attempted.")
    else:
        try:
            if not public_image_ready():
                raise RuntimeError("Public PNG image URL was not confirmed reachable; refusing to publish with a broken image.")
            published = api_json("https://dev.to/api/articles/me/published?per_page=100", api_key)
            if not isinstance(published, list):
                raise RuntimeError("DEV.to published-article response had an unexpected shape.")
            existing = next((item for item in published if str(item.get("title", "")).strip() == TITLE), None)

            if existing and existing.get("url"):
                article_url = str(existing["url"])
                status = "ALREADY_PUBLISHED"
                add_summary("## DEV.to publication: already exists\n" + article_url + "\nThe duplicate guard prevented a second article.")
                print("DEV.to existing article found; duplicate prevented.")
            else:
                body_lines = lines[1:]
                body = "\n".join(body_lines).strip()
                if IMAGE_URL not in body:
                    marker = "**Research note · 20 October 2026 · AI-created for a Mycelium Finance bounty**"
                    if marker not in body:
                        raise RuntimeError("Disclosure marker not found; refusing to publish.")
                    body = body.replace(marker, marker + "\n\n![KNOTS holder-reward infographic](" + IMAGE_URL + ")", 1)
                article = {
                    "title": TITLE,
                    "description": "KNOTS' holder-reward mechanism and a timestamped Mycelium Strategy allocation snapshot—what is documented and what remains unverified.",
                    "body_markdown": body,
                    "published": True,
                    "tags": ["solana", "crypto", "web3", "research"],
                    "main_image": IMAGE_URL,
                }
                response = api_json("https://dev.to/api/articles", api_key, method="POST", payload={"article": article})
                if not isinstance(response, dict) or not response.get("url"):
                    raise RuntimeError("DEV.to returned no public article URL.")
                article_url = str(response["url"])
                status = "PUBLISHED"
                add_summary(
                    "## DEV.to publication: PUBLISHED\n" + article_url +
                    "\nThe article includes the original infographic, source links, the timestamped Mycelium allocation snapshot, "
                    "the current payout-data caveat, and the required AI disclosure."
                )
                print("DEV.to article published; public URL recorded.")
        except Exception as exc:
            message = str(exc)
            if message.startswith("DEV.to API returned HTTP "):
                status = "FAILED_" + message.replace(" ", "_").replace("(", "").replace(")", "")
            elif "Public PNG image URL" in message:
                status = "BLOCKED_IMAGE_NOT_PUBLIC"
            else:
                status = "FAILED_" + type(exc).__name__.upper()
            add_summary("## DEV.to publication: " + status + "\n" + message + "\nNo key or secret was logged.")
            print("DEV.to publication did not complete: " + message)

    # Do not use X's potentially metered API or browser credits. Prepare the post for an explicitly
    # authorized free publisher, and preserve the full draft without claiming it was posted.
    x_status = "BLOCKED_NO_VERIFIED_ZERO_COST_PUBLISHER"
    if article_url:
        x_draft = (
            "$KNOTS: 3% transfer-tax rewards in STONK; official payout counters showed “n/a” on 20 Oct. "
            "Mycelium’s 17:32 UTC snapshot listed $7,466.04 across two pools. "
            "@KnotsOnStonk @myceliumfinance $MYC " + article_url +
            " AI-created for a Mycelium Finance bounty."
        )
    else:
        x_draft = (
            "PENDING ARTICLE URL — $KNOTS describes a 3% transfer-tax reward in STONK; official payout counters showed “n/a” "
            "on 20 Oct. Mycelium’s 17:32 UTC snapshot listed $7,466.04 across two pools. "
            "@KnotsOnStonk @myceliumfinance $MYC [DEV.to article URL] AI-created for a Mycelium Finance bounty."
        )
    set_output("article_url", article_url)
    set_output("devto_status", status)
    set_output("x_status", x_status)

    current = {
        "updated_at_utc": datetime.now(timezone.utc).isoformat(),
        "article_title": TITLE,
        "github_pages_article": PAGES_URL,
        "github_pages_infographic": SVG_URL,
        "devto_status": status,
        "devto_url": article_url or None,
        "x_bluesky_status": x_status,
        "x_post_url": None,
        "x_bluesky_copy_ready": bool(article_url),
        "x_bluesky_draft": x_draft,
        "taskmarket_submission": "NOT_SUBMITTED_SIGNATURE_AND_LEGAL_ACCEPTANCE_NOT_PERFORMED",
        "revenue": "NOT_EARNED_UNTIL_TASK_AWARDED_AND_RECEIPT_RECONCILED",
        "no_paid_tools_used": True,
    }
    STATUS_PATH.write_text(json.dumps(current, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    SOCIAL_DRAFT_PATH.write_text(
        "# KNOTS social summary — prepared, not posted\n\n"
        "**Status:** " + x_status + "\n\n"
        + x_draft + "\n\n"
        + "No X/Bluesky API or metered browser automation was used. A post is not published until a public post URL is recorded.\n",
        encoding="utf-8",
    )
    add_summary(
        "## X / Bluesky summary: " + x_status + "\n"
        "No post was sent through a paid or unverified channel. A copy-ready draft is stored at "
        "[research/knots-x-post-draft.md](../blob/main/research/knots-x-post-draft.md)."
    )
    print("Publication status and copy-ready social draft saved; no secrets stored.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
