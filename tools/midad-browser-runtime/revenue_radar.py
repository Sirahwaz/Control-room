"""Offline-first Revenue Radar qualification for MIDAD Browser Mesh; no side effects."""
from datetime import datetime, timezone
from hashlib import sha256
import re
from urllib.parse import urlsplit

SOURCE_REGISTRY = {
    "j4c": {"hosts": ("www.j4c.app", "j4c.app"), "terms_urls": ()},
    "bounties_sh": {"hosts": ("bounties.sh", "www.bounties.sh"), "terms_urls": ("https://bounties.sh/faqs", "https://bounties.sh/faqs?filter=receiving-and-managing-payments")},
    "cryptotask": {"hosts": ("www.cryptotask.org", "cryptotask.org"), "terms_urls": ()},
    "taskmarket": {"hosts": ("api.taskmarket.dev", "taskmarket.dev", "www.taskmarket.dev", "docs.taskmarket.dev"), "terms_urls": ("https://docs.taskmarket.dev/concepts/fees-payments", "https://docs.taskmarket.dev/reference/payments")},
    "bountybook": {"hosts": ("api.bountybook.ai", "bountybook.ai", "www.bountybook.ai"), "terms_urls": ()},
    "basedagents": {"hosts": ("api.basedagents.ai", "basedagents.ai", "www.basedagents.ai"), "terms_urls": ("https://basedagents.ai/docs", "https://basedagents.ai/docs/getting-started", "https://basedagents.ai/docs/agents")},
    "ugig": {"hosts": ("ugig.net", "www.ugig.net"), "terms_urls": ()},
    "superteam": {"hosts": ("earn.superteam.fun", "superteam.fun", "www.superteam.fun"), "terms_urls": ()},
}
DEFAULT_MIN_GROSS_USD, DEFAULT_MIN_NET_USD, DEFAULT_MIN_EXPECTED_NET_USD = 100.0, 75.0, 50.0
CRYPTO_ASSETS = {"USDC", "USDT", "BTC", "ETH", "SOL", "DAI", "EURC"}

def _number(value, default=0.0):
    try:
        n = float(value)
        return n if n >= 0 else default
    except (TypeError, ValueError):
        return default

def _official_url(url, source):
    if not isinstance(url, str) or not url.strip(): return False
    try:
        p = urlsplit(url.strip()); host = (p.hostname or "").lower().rstrip("."); port = p.port
    except ValueError:
        return False
    return p.scheme.lower() == "https" and not p.username and not p.password and port in (None, 443) and host in SOURCE_REGISTRY.get(str(source), {}).get("hosts", ())

def _expired(value, now=None):
    if not value: return False
    try:
        d = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if d.tzinfo is None: d = d.replace(tzinfo=timezone.utc)
        return d <= (now or datetime.now(timezone.utc))
    except (ValueError, TypeError):
        return False

def qualify_candidate(candidate, *, min_gross_usd=DEFAULT_MIN_GROSS_USD, min_net_usd=DEFAULT_MIN_NET_USD, min_expected_net_usd=DEFAULT_MIN_EXPECTED_NET_USD, now=None):
    item = dict(candidate or {}); source = str(item.get("source", "")); blockers = []
    terms_url = str(item.get("official_payout_terms_url", "")).strip()
    listing_evidence_url = item.get("listing_payment_evidence_url", "")
    if source not in SOURCE_REGISTRY: blockers.append("source_not_registered")
    if not _official_url(item.get("source_url", ""), source): blockers.append("listing_url_not_official_https")
    if not _official_url(terms_url, source) or terms_url not in SOURCE_REGISTRY.get(source, {}).get("terms_urls", ()): blockers.append("official_payout_terms_not_allowlisted")
    if not _official_url(listing_evidence_url, source): blockers.append("listing_payment_evidence_missing")
    digest = re.compile(r"^[a-fA-F0-9]{64}$")
    if not digest.fullmatch(str(item.get("listing_content_sha256", ""))): blockers.append("listing_content_hash_missing")
    if not digest.fullmatch(str(item.get("terms_content_sha256", ""))): blockers.append("payout_terms_content_hash_missing")
    try:
        checked = datetime.fromisoformat(str(item.get("evidence_checked_at", "")).replace("Z", "+00:00"))
        if checked.tzinfo is None: checked = checked.replace(tzinfo=timezone.utc)
        age = ((now or datetime.now(timezone.utc)) - checked).total_seconds() / 3600
        if age < 0 or age > 24: blockers.append("evidence_stale_or_future_dated")
    except (ValueError, TypeError):
        blockers.append("evidence_timestamp_missing_or_invalid")
    asset = str(item.get("asset", "")).strip().upper(); network = str(item.get("network", "")).strip()
    mode = str(item.get("payment_mode", "")).strip().lower()
    if mode not in {"crypto_only", "crypto_available"} or asset not in CRYPTO_ASSETS: blockers.append("crypto_payout_not_proven")
    if not network: blockers.append("asset_or_network_missing")
    if item.get("funded") is not True: blockers.append("funding_not_verified")
    if _number(item.get("upfront_cost_usd")) > 0 or _number(item.get("claim_fee_usd")) > 0: blockers.append("upfront_cost_forbidden")
    if item.get("region_eligible") is not True: blockers.append("region_eligibility_unverified_or_denied")
    if str(item.get("kyc_status", "")).lower() not in {"eligible_or_not_required", "eligible", "not_required"}: blockers.append("kyc_eligibility_unverified_or_denied")
    if item.get("automation_allowed") is not True: blockers.append("automation_not_permitted")
    if _expired(item.get("expires_at"), now): blockers.append("listing_expired")
    gross = _number(item.get("gross_usd")); platform = _number(item.get("platform_fee_usd")); network_fee = _number(item.get("network_fee_usd")); claim_fee = _number(item.get("claim_fee_usd"))
    net = round(max(0.0, gross-platform-network_fee-claim_fee), 2)
    acceptance = min(1.0, _number(item.get("acceptance_probability"))); confidence = min(1.0, _number(item.get("payout_confidence")))
    expected = round(net*acceptance*confidence, 2); minutes = max(1.0, _number(item.get("estimated_minutes"), 1.0))
    priority = round(expected/(minutes/60.0), 4)
    if gross < min_gross_usd or net < min_net_usd or expected < min_expected_net_usd: blockers.append("below_minimum_net_value")
    return {"decision": "READY_FOR_REVIEW" if not blockers else "BLOCKED",
            "payout_state": "verified_listing_evidence" if not blockers else "unverified_or_blocked",
            "source": source, "source_url": item.get("source_url", ""), "listing_id": str(item.get("listing_id", "")).strip(),
            "title": str(item.get("title", ""))[:240], "asset": asset, "network": network,
            "gross_usd": round(gross, 2), "net_usd": net, "expected_net_usd": expected,
            "priority_score": priority, "estimated_minutes": int(minutes),
            "evidence_urls": [u for u in (terms_url, listing_evidence_url) if u],
            "evidence_checked_at": item.get("evidence_checked_at"), "blockers": sorted(set(blockers)),
            "action_authorized": False}

def _normalized_title(title):
    return re.sub(r"[^a-z0-9]+", " ", str(title or "").lower()).strip()

def deduplicate_candidates(candidates):
    kept, dropped, ids, urls, titles = [], [], set(), set(), set()
    for raw in candidates or []:
        item = dict(raw or {}); source = str(item.get("source", "")); lid = str(item.get("listing_id", "")).strip().lower()
        url = str(item.get("source_url", "")).strip().rstrip("/").lower()
        host = (urlsplit(url).hostname or "").lower() if url else ""; title = (_normalized_title(item.get("title")), host)
        key = reason = None
        if lid and lid in ids: key, reason = lid, "duplicate_listing_id"
        elif url and url in urls: key, reason = url, "duplicate_listing_url"
        elif title[0] and title in titles: key, reason = "|".join(title), "duplicate_normalized_title"
        if reason:
            dropped.append({"source": source, "listing_id": lid, "reason": reason, "duplicate_key_sha256": sha256(key.encode()).hexdigest()}); continue
        kept.append(item)
        if lid: ids.add(lid)
        if url: urls.add(url)
        if title[0]: titles.add(title)
    return kept, dropped

def browser_targets(candidates):
    targets, seen = [], set()
    for raw in candidates or []:
        item = dict(raw or {}); source = str(item.get("source", "")); url = str(item.get("source_url", "")).strip()
        if source not in SOURCE_REGISTRY or not _official_url(url, source): continue
        host = (urlsplit(url).hostname or "").lower()
        if (source, url) in seen: continue
        seen.add((source, url))
        targets.append({"source": source, "listing_id": str(item.get("listing_id", "")).strip(), "url": url,
                        "allowed_hosts": [host], "method": "GET", "purpose": "verify_public_listing_and_payout_evidence",
                        "side_effects": False, "creates_browser_job": False})
    return targets

def candidate_from_opportunity(row):
    row = dict(row or {}); evidence = row.get("evidence") if isinstance(row.get("evidence"), dict) else {}
    offer = row.get("offer") if isinstance(row.get("offer"), dict) else {}; meta = row.get("metadata") if isinstance(row.get("metadata"), dict) else {}
    payout = meta.get("payout") if isinstance(meta.get("payout"), dict) else {}; raw = str(row.get("source", "")).lower()
    aliases = {"bounties.sh":"bounties_sh", "bounties_sh":"bounties_sh", "cryptotask.org":"cryptotask",
               "taskmarket":"taskmarket", "bountybook":"bountybook", "basedagents":"basedagents", "ugig":"ugig",
               "j4c":"j4c", "superteam_web":"superteam", "superteam_agent_api":"superteam"}
    return {"source": aliases.get(raw, raw), "source_url": evidence.get("source_url") or offer.get("action_url") or "",
            "listing_id": evidence.get("listing_id") or evidence.get("gig_id") or offer.get("external_id") or "",
            "title": row.get("title", ""), "gross_usd": offer.get("reward_usd", payout.get("gross_usd", 0)),
            "asset": payout.get("asset") or evidence.get("payout_asset") or "",
            "network": payout.get("network") or evidence.get("payout_network") or "",
            "payment_mode": payout.get("mode") or evidence.get("payment_mode") or "",
            "official_payout_terms_url": payout.get("official_terms_url") or evidence.get("official_payout_terms_url") or "",
            "listing_payment_evidence_url": payout.get("listing_payment_evidence_url") or evidence.get("listing_payment_evidence_url") or "",
            "listing_content_sha256": payout.get("listing_content_sha256") or evidence.get("listing_content_sha256") or "",
            "terms_content_sha256": payout.get("terms_content_sha256") or evidence.get("terms_content_sha256") or "",
            "evidence_checked_at": payout.get("evidence_checked_at") or evidence.get("evidence_checked_at") or "",
            "funded": payout.get("funded") is True or evidence.get("funded") is True,
            "min_payout_usd": payout.get("min_payout_usd", evidence.get("min_payout_usd", 0)),
            "platform_fee_usd": payout.get("platform_fee_usd", evidence.get("platform_fee_usd", 0)),
            "network_fee_usd": payout.get("network_fee_usd", evidence.get("network_fee_usd", 0)),
            "claim_fee_usd": payout.get("claim_fee_usd", evidence.get("claim_fee_usd", 0)),
            "upfront_cost_usd": payout.get("upfront_cost_usd", evidence.get("upfront_cost_usd", 0)),
            "region_eligible": payout.get("region_eligible") is True,
            "kyc_status": payout.get("kyc_status", "unverified"),
            "automation_allowed": payout.get("automation_allowed") is True,
            "estimated_minutes": meta.get("estimated_minutes", 0),
            "acceptance_probability": meta.get("acceptance_probability", row.get("confidence", 0)),
            "payout_confidence": payout.get("payout_confidence", 0),
            "expires_at": evidence.get("expires_at") or offer.get("expires_at")}
