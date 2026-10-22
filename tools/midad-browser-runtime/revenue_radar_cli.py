"""Offline JSON adapter: Revenue Radar candidates -> Browser Mesh plans + qualification."""
import argparse
import json
import sys
from pathlib import Path
from revenue_radar import browser_targets, candidate_from_opportunity, deduplicate_candidates, qualify_candidate

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", nargs="?", help="JSON array or {candidates:[...]} file; stdin if omitted")
    parser.add_argument("--min-gross-usd", type=float, default=100.0)
    parser.add_argument("--min-net-usd", type=float, default=75.0)
    parser.add_argument("--min-expected-net-usd", type=float, default=50.0)
    args = parser.parse_args()
    raw = Path(args.input).read_text(encoding="utf-8") if args.input else sys.stdin.read()
    payload = json.loads(raw)
    rows = payload.get("candidates", []) if isinstance(payload, dict) else payload
    if not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows):
        raise SystemExit("input must be a JSON array or an object with a candidates array")
    normalized = [candidate_from_opportunity(row) if ("evidence" in row or "offer" in row) else row for row in rows]
    kept, duplicates = deduplicate_candidates(normalized)
    decisions = [qualify_candidate(row, min_gross_usd=args.min_gross_usd,
                                   min_net_usd=args.min_net_usd,
                                   min_expected_net_usd=args.min_expected_net_usd) for row in kept]
    decisions.sort(key=lambda item: (item["decision"] == "READY_FOR_REVIEW", item["priority_score"]), reverse=True)
    print(json.dumps({
        "mode": "offline_read_only_plan", "paid_provider_used": False,
        "browser_jobs_created": 0, "external_actions_performed": 0,
        "summary": {"input_count": len(rows), "unique_count": len(kept),
                    "duplicates_dropped": len(duplicates),
                    "ready_for_review": sum(x["decision"] == "READY_FOR_REVIEW" for x in decisions),
                    "blocked": sum(x["decision"] == "BLOCKED" for x in decisions)},
        "decisions": decisions, "duplicates": duplicates, "browser_targets": browser_targets(kept),
    }, ensure_ascii=False, indent=2))

if __name__ == "__main__":
    main()
