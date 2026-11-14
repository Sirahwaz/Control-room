"""Deterministic offline evaluation for the existing MIDAD Revenue Radar."""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from revenue_radar import qualify_candidate

DEFAULT_FIXTURE_PATH = Path(__file__).with_name("revenue_radar_eval_fixtures.json")
ALLOWED_DECISIONS = frozenset({"READY_FOR_REVIEW", "BLOCKED"})


def _parse_time(value: str | datetime | None) -> datetime:
    if value is None:
        return datetime.now(timezone.utc)
    if isinstance(value, datetime):
        parsed = value
    else:
        try:
            parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except ValueError as exc:
            raise ValueError("reference time must be a valid ISO-8601 timestamp") from exc
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _ratio(numerator: int, denominator: int) -> float | None:
    return round(numerator / denominator, 4) if denominator else None


def evaluate_cases(
    cases: list[dict[str, Any]],
    *,
    now: datetime | None = None,
    dataset_id: str = "ad_hoc",
    dataset_version: str = "1",
) -> dict[str, Any]:
    """Score expected decisions against the existing qualification function.

    This function is deterministic when a reference time is supplied. It performs
    no network calls, browser jobs, submissions, database writes, or financial actions.
    """
    if not isinstance(cases, list) or not cases:
        raise ValueError("evaluation cases must be a non-empty list")
    if not isinstance(dataset_id, str) or not dataset_id.strip():
        raise ValueError("dataset_id must be a non-empty string")

    reference_time = _parse_time(now)
    seen_ids: set[str] = set()
    evaluated: list[dict[str, Any]] = []
    true_ready = false_ready = false_blocked = true_blocked = 0
    blocker_assertions_passed = True
    safety_violations = 0

    for index, case in enumerate(cases):
        if not isinstance(case, dict):
            raise ValueError(f"case {index} must be an object")
        case_id = str(case.get("id", "")).strip()
        candidate = case.get("candidate")
        expected = case.get("expected_decision")
        expected_blockers = case.get("expected_blockers", [])

        if not case_id:
            raise ValueError(f"case {index} requires a non-empty id")
        if case_id in seen_ids:
            raise ValueError(f"duplicate case id: {case_id}")
        seen_ids.add(case_id)
        if not isinstance(candidate, dict):
            raise ValueError(f"case {case_id} requires a candidate object")
        if expected not in ALLOWED_DECISIONS:
            raise ValueError(f"case {case_id} has unsupported expected_decision")
        if not isinstance(expected_blockers, list) or any(
            not isinstance(value, str) or not value for value in expected_blockers
        ):
            raise ValueError(f"case {case_id} expected_blockers must be a list of strings")

        result = qualify_candidate(candidate, now=reference_time)
        actual = result.get("decision")
        if expected == "READY_FOR_REVIEW" and actual == "READY_FOR_REVIEW":
            true_ready += 1
        elif expected == "BLOCKED" and actual == "READY_FOR_REVIEW":
            false_ready += 1
        elif expected == "READY_FOR_REVIEW" and actual == "BLOCKED":
            false_blocked += 1
        elif expected == "BLOCKED" and actual == "BLOCKED":
            true_blocked += 1

        actual_blockers = set(result.get("blockers", []))
        missing_blockers = sorted(set(expected_blockers) - actual_blockers)
        action_authorized = result.get("action_authorized") is not False
        if missing_blockers:
            blocker_assertions_passed = False
        if action_authorized:
            safety_violations += 1

        passed = actual == expected and not missing_blockers and not action_authorized
        evaluated.append({
            "id": case_id,
            "expected_decision": expected,
            "actual_decision": actual,
            "passed": passed,
            "expected_blockers": sorted(set(expected_blockers)),
            "actual_blockers": sorted(actual_blockers),
            "missing_expected_blockers": missing_blockers,
            "action_authorized": action_authorized,
            "net_usd": result.get("net_usd"),
            "expected_net_usd": result.get("expected_net_usd"),
        })

    total = len(evaluated)
    decision_correct = sum(
        1 for item in evaluated
        if item["actual_decision"] == item["expected_decision"]
    )
    fully_passed = sum(1 for item in evaluated if item["passed"])
    return {
        "schema_version": 1,
        "mode": "offline_read_only_evaluation",
        "dataset_id": dataset_id,
        "dataset_version": str(dataset_version),
        "reference_time": reference_time.isoformat().replace("+00:00", "Z"),
        "engine": "revenue_radar.qualify_candidate",
        "gate_status": "PASS" if fully_passed == total and safety_violations == 0 else "REVIEW",
        "paid_provider_used": False,
        "browser_jobs_created": 0,
        "external_actions_performed": 0,
        "action_authorized": False,
        "metrics": {
            "total": total,
            "correct": decision_correct,
            "incorrect": total - decision_correct,
            "accuracy": _ratio(decision_correct, total),
            "fully_passed": fully_passed,
            "case_failures": total - fully_passed,
            "true_ready": true_ready,
            "false_ready": false_ready,
            "false_blocked": false_blocked,
            "true_blocked": true_blocked,
            "precision_ready": _ratio(true_ready, true_ready + false_ready),
            "recall_ready": _ratio(true_ready, true_ready + false_blocked),
            "specificity_blocked": _ratio(true_blocked, true_blocked + false_ready),
            "false_ready_rate": _ratio(false_ready, false_ready + true_blocked),
            "blocker_assertions_passed": blocker_assertions_passed,
            "safety_violations": safety_violations,
        },
        "cases": evaluated,
    }


def load_suite(path: str | Path = DEFAULT_FIXTURE_PATH) -> dict[str, Any]:
    """Load and minimally validate a versioned JSON evaluation suite."""
    try:
        suite = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"cannot load evaluation suite: {exc}") from exc
    if not isinstance(suite, dict):
        raise ValueError("evaluation suite root must be an object")
    if not isinstance(suite.get("dataset_id"), str) or not suite["dataset_id"].strip():
        raise ValueError("evaluation suite requires dataset_id")
    if not isinstance(suite.get("cases"), list) or not suite["cases"]:
        raise ValueError("evaluation suite requires a non-empty cases array")
    return suite


def evaluate_suite(
    suite: dict[str, Any],
    *,
    now: datetime | None = None,
) -> dict[str, Any]:
    reference_time = now or _parse_time(suite.get("reference_time"))
    report = evaluate_cases(
        suite["cases"],
        now=reference_time,
        dataset_id=suite["dataset_id"],
        dataset_version=str(suite.get("dataset_version", "1")),
    )
    report["description"] = str(suite.get("description", ""))[:500]
    return report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fixtures", default=str(DEFAULT_FIXTURE_PATH))
    parser.add_argument("--output", help="write JSON report to a local path; stdout if omitted")
    parser.add_argument("--now", help="override suite reference time with ISO-8601")
    parser.add_argument("--fail-on-review", action="store_true")
    args = parser.parse_args(argv)

    suite = load_suite(args.fixtures)
    reference_time = _parse_time(args.now) if args.now else None
    report = evaluate_suite(suite, now=reference_time)
    rendered = json.dumps(report, ensure_ascii=False, indent=2) + "\n"

    if args.output:
        output_path = Path(args.output)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(rendered, encoding="utf-8")
    else:
        sys.stdout.write(rendered)

    if args.fail_on_review and report["gate_status"] != "PASS":
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
