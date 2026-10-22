"""Offline-first qualification and deduplication for MIDAD Browser Mesh / Revenue Radar.

Pure Python only: no network, browser launch, DB write, account action, paid-provider
call, or financial operation. Browser targets are plans for the existing read-only
worker, not created jobs.
"""
from __future__ import annotations
from datetime import datetime, timezone
from hashlib import sha256
import re
from urllib.parse import urlsplit

SOURCE_REGISTRY = {
    "j4c": {"hosts": ("www.j4c.app", "j4c.app")},
    "bounties_sh": {"hosts": ("bounties.sh", "www.bounties.sh")},
    "cryptotask": {"hosts": ("www.cryptotask.org", "cryptotask.org")},
    "taskmarket": {"hosts": ("api.taskmarket.dev", "taskmarket.dev", "www.taskmarket.dev")},
    "bountybook": {"hosts": ("api.bountybook.ai", "bountybook.ai", "www.bountybook.ai")},
    "basedagents": {"hosts": ("api.basedagents.ai", "basedagents.ai", "www.basedagents.ai")},
    "ugig": {"hosts": ("ugig.net", "www.ugig.net")},
    "superteam": {"hosts": ("earn.superteam.fun", "superteam.fun", "www.superteam.fun")},
}
DEFAULT_MIN_GROSS_USD = 100.0
DEFAULT_MIN_NET_USD = 75.0
DEFAULT_MIN_EXPECTED_NET_USD = 50.0
CRYPTO_ASSETS = {"USDC", "USDT", "BTC", "ETH", "SOL", "DAI", "EURC"}

def _number(value, default=0.0):
    try:
        number = float(value)
        return number if number >= 0 else default
    except (TypeError, ValueError):
        return default

def _official_url(url, source):
    if not isinstance(url, str) or not url.strip():
        return False
    try:
        parsed = urlsplit(url.strip())
        host = (parsed.hostname or "").lower().rstrip(".")
        port = parsed.port
    except ValueError:
        return False
    allowed = SOURCE_REGISTRY.get(str(source), {}).get("hosts", ())
    return parsed.scheme.lower() == "https" and not parsed.username and not parsed.password and port in (None, 443) and host in allowed

def _expired(value, now=None):
    if not value:
        return False
    try:
        deadline = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if deadline.tzinfo is None:
            deadline = deadline.replace(tzinfo=timezone.utc)
        return deadline <= (now or datetime.now(timezone.utc))
    except (ValueError, TypeError):
        return False

def qualify_candidate(candidate, *, min_gross_usd=DEFAULT_MIN_GROSS_USD,
                      min_net_usd=DEFAULT_MIN_NET_USD,
                      min_expected_net_usd=DEFAULT_MIN_EXPECTED_NET_USD, now=None):
    """Return an auditable fail-closed decision with net value and blockers."""
    item = dict(candidate or {})
    source = str(item.get("source", ""))
    blockers = []
    if source not in SOURCE_REGISTRY:
        blockers.append("source_not_registered")
    if not _official_url(item.get("source_url", ""), source):
        blockers.append("listing_url_not_official_https")
    if not _official_url(item.get("official_payout_terms_url", ""), source):
        blockers.append("official_payout_terms_not_allowlisted")
    if not _official_url(item.get("listing_payment_evidence_url", ""), source):
        blockers.append("listing_payment_evidence_missing")
    asset = str(item.get("asset", "")).strip().upper()
    network = str(item.get("network", "")).strip()
    mode = str(item.get("payment_mode", "")).strip().lower()
    if mode not in {"crypto_only", "crypto_available"} or asset not in CRYPTO_ASSETS:
        blockers.append("crypto_payout_not_proven")
    if not network:
        blockers.append("asset_or_network_missing")
    if item.get("funded") is not True:
        blockers.append("funding_not_verified")
    if _number(item.get("upfront_cost_usd")) > 0 or _number(item.get("claim_fee_usd")) > 0:
        blockers.append("upfront_cost_forbidden")
    if item.get("region_eligible") is not True:
        blockers.append("region_eligibility_unverified_or_denied")
    if str(item.get("kyc_status", "")).lower() not in {"eligible_or_not_required", "eligible", "not_required"}:
        blockers.append("kyc_eligibility_unverified_or_denied")
    if item.get("automation_allowed") is not True:
        blockers.append("automation_not_permitted")
    if _expired(item.get("expires_at"), now=now):
        blockers.append("listing_expired")

    gross = _number(item.get("gross_usd"))
    platform_fee = _number(item.get("platform_fee_usd"))
    network_fee = _number(item.get("network_fee_usd"))
    claim_fee = _number(item.get("claim_fee_usd"))
    net = round(max(0.0, gross - platform_fee - network_fee - claim_fee), 2)
    acceptance = min(1.0, _number(item.get("acceptance_probability")))
    payout_confidence = min(1.0, _number(item.get("payout_confidence")))
    expected_net = round(net * acceptance * payout_confidence, 2)
    minutes = max(1.0, _number(item.get("estimated_minutes"), 1.0))
    priority = round(expected_net / (minutes / 60.0), 4)
    if gross < min_gross_usd or net < min_net_usd or expected_net < min_expected_net_usd:
        blockers.append("below_minimum_net_value")
    return {
        "decision": "READY_FOR_REVIEW" if not blockers else "BLOCKED",
        "payout_state": "verified_listing_evidence" if not blockers else "unverified_or_blocked",
        "source": source, "source_url": item.get("source_url", ""),
        "listing_id": str(item.get("listing_id", "")).strip(),
        "title": str(item.get("title", ""))[:240], "asset": asset, "network": network,
        "gross_usd": round(gross, 2), "net_usd": net, "expected_net_usd": expected_net,
        "priority_score": priority, "estimated_minutes": int(minutes),
        "evidence_urls": [u for u in (item.get("official_payout_terms_url"), item.get("listing_payment_evidence_url")) if u],
        "blockers": sorted(set(blockers)), "action_authorized": False,
    }

def _normalized_title(title):
    return re.sub(r"[^a-z0-9]+", " ", str(title or "").lower()).strip()

def deduplicate_candidates(candidates):
    """Keep first occurrence; collapse same listing IDs, URLs, or normalized title+host."""
    kept, dropped, seen_ids, seen_urls, seen_titles = [], [], set(), set(), set()
    for original in candidates or []:
        item = dict(original or {})
        source = str(item.get("source", ""))
        listing_id = str(item.get("listing_id", "")).strip().lower()
        url = str(item.get("source_url", "")).strip().rstrip("/").lower()
        host = (urlsplit(url).hostname or "").lower() if url else ""
        title_key = (_normalized_title(item.get("title")), host)
        key = reason = None
        if listing_id and listing_id in seen_ids:
            key, reason = listing_id, "duplicate_listing_id"
        elif url and url in seen_urls:
            key, reason = url, "duplicate_listing_url"
        elif title_key[0] and title_key in seen_titles:
            key, reason = "|".join(title_key), "duplicate_normalized_title"
        if reason:
            dropped.append({"source": source, "listing_id": listing_id, "reason": reason,
                            "duplicate_key_sha256": sha256(key.encode()).hexdigest()})
            continue
        kept.append(item)
        if listing_id: seen_ids.add(listing_id)
        if url: seen_urls.add(url)
        if title_key[0]: seen_titles.add(title_key)
    return kept, dropped

def browser_targets(candidates):
    """Create safe exact-host GET-only plans; does not create browser jobs."""
    targets, seen = [], set()
    for candidate in candidates or []:
        item = dict(candidate or {})
        source, url = str(item.get("source", "")), str(item.get("source_url", "")).strip()
        if source not in SOURCE_REGISTRY or not _official_url(url, source):
            continue
        host = (urlsplit(url).hostname or "").lower()
        if (source, url) in seen: continue
        seen.add((source, url))
        targets.append({"source": source, "listing_id": str(item.get("listing_id", "")).strip(),
                        "url": url, "allowed_hosts": [host], "method": "GET",
                        "purpose": "verify_public_listing_and_payout_evidence",
                        "side_effects": False, "creates_browser_job": False})
    return targets

def candidate_from_opportunity(row):
    """Map an existing public.opportunities-shaped row without upgrading weak evidence."""
    row = dict(row or {})
    evidence = row.get("evidence") if isinstance(row.get("evidence"), dict) else {}
    offer = row.get("offer") if isinstance(row.get("offer"), dict) else {}
    metadata = row.get("metadata") if isinstance(row.get("metadata"), dict) else {}
    payout = metadata.get("payout") if isinstance(metadata.get("payout"), dict) else {}
    raw_source = str(row.get("source", "")).lower()
    source_map = {"bounties.sh": "bounties_sh", "bounties_sh": "bounties_sh",
                  "cryptotask.org": "cryptotask", "cryptotask": "cryptotask",
                  "taskmarket": "taskmarket", "bountybook": "bountybook", "basedagents": "basedagents",
                  "ugig": "ugig", "j4c": "j4c", "superteam_web": "superteam",
                  "superteam_agent_api": "superteam"}
    source = source_map.get(raw_source, raw_source)
    return {
        "source": source, "source_url": evidence.get("source_url") or offer.get("action_url") or "",
        "listing_id": evidence.get("listing_id") or evidence.get("gig_id") or offer.get("external_id") or "",
        "title": row.get("title", ""), "gross_usd": offer.get("reward_usd", payout.get("gross_usd", 0)),
        "asset": payout.get("asset") or evidence.get("payout_asset") or "",
        "network": payout.get("network") or evidence.get("payout_network") or "",
        "payment_mode": payout.get("mode") or evidence.get("payment_mode") or "",
        "official_payout_terms_url": payout.get("official_terms_url") or evidence.get("official_payout_terms_url") or "",
        "listing_payment_evidence_url": payout.get("listing_payment_evidence_url") or evidence.get("listing_payment_evidence_url") or "",
        "funded": payout.get("funded") is True or evidence.get("funded") is True,
        "min_payout_usd": payout.get("min_payout_usd", evidence.get("min_payout_usd", 0)),
        "platform_fee_usd": payout.get("platform_fee_usd", evidence.get("platform_fee_usd", 0)),
        "network_fee_usd": payout.get("network_fee_usd", evidence.get("network_fee_usd", 0)),
        "claim_fee_usd": payout.get("claim_fee_usd", evidence.get("claim_fee_usd", 0)),
        "upfront_cost_usd": payout.get("upfront_cost_usd", evidence.get("upfront_cost_usd", 0)),
        "region_eligible": payout.get("region_eligible") is True,
        "kyc_status": payout.get("kyc_status", "unverified"),
        "automation_allowed": payout.get("automation_allowed") is True,
        "estimated_minutes": metadata.get("estimated_minutes", 0),
        "acceptance_probability": metadata.get("acceptance_probability", row.get("confidence", 0)),
        "payout_confidence": payout.get("payout_confidence", 0),
        "expires_at": evidence.get("expires_at") or offer.get("expires_at"),
    }
