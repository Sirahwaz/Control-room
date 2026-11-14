import unittest
from datetime import datetime, timezone

from revenue_radar_eval import evaluate_cases

FIXED_NOW = datetime(2026, 11, 14, 12, 0, tzinfo=timezone.utc)


def candidate(**overrides):
    item = {
        "source": "bounties_sh",
        "source_url": "https://bounties.sh/bounty/synthetic-1",
        "listing_id": "synthetic-1",
        "title": "Synthetic evidence-backed task",
        "gross_usd": 800,
        "asset": "USDC",
        "network": "Base",
        "payment_mode": "crypto_only",
        "official_payout_terms_url": "https://bounties.sh/faqs",
        "listing_payment_evidence_url": "https://bounties.sh/bounty/synthetic-1",
        "listing_content_sha256": "a" * 64,
        "terms_content_sha256": "b" * 64,
        "evidence_checked_at": "2026-11-14T11:30:00Z",
        "funded": True,
        "platform_fee_usd": 40,
        "network_fee_usd": 1,
        "claim_fee_usd": 0,
        "upfront_cost_usd": 0,
        "region_eligible": True,
        "kyc_status": "eligible_or_not_required",
        "automation_allowed": True,
        "estimated_minutes": 240,
        "acceptance_probability": 0.65,
        "payout_confidence": 0.9,
        "expires_at": "2099-01-01T00:00:00Z",
    }
    item.update(overrides)
    return item


class RevenueRadarEvaluationTests(unittest.TestCase):
    def test_scores_correct_ready_and_blocked_decisions(self):
        cases = [
            {
                "id": "synthetic-ready",
                "candidate": candidate(),
                "expected_decision": "READY_FOR_REVIEW",
            },
            {
                "id": "synthetic-unfunded",
                "candidate": candidate(funded=False),
                "expected_decision": "BLOCKED",
                "expected_blockers": ["funding_not_verified"],
            },
        ]

        report = evaluate_cases(cases, now=FIXED_NOW, dataset_id="unit-test-v1")

        self.assertEqual(report["gate_status"], "PASS")
        self.assertEqual(report["metrics"]["total"], 2)
        self.assertEqual(report["metrics"]["correct"], 2)
        self.assertEqual(report["metrics"]["accuracy"], 1.0)
        self.assertEqual(report["metrics"]["true_ready"], 1)
        self.assertEqual(report["metrics"]["true_blocked"], 1)
        self.assertEqual(report["metrics"]["false_ready"], 0)
        self.assertEqual(report["metrics"]["false_blocked"], 0)

    def test_flags_false_ready_as_a_gate_failure(self):
        cases = [{
            "id": "false-ready",
            "candidate": candidate(),
            "expected_decision": "BLOCKED",
            "expected_blockers": ["funding_not_verified"],
        }]

        report = evaluate_cases(cases, now=FIXED_NOW)

        self.assertEqual(report["gate_status"], "REVIEW")
        self.assertEqual(report["metrics"]["false_ready"], 1)
        self.assertEqual(report["cases"][0]["missing_expected_blockers"], ["funding_not_verified"])

    def test_rejects_empty_suite_and_invalid_expected_label(self):
        with self.assertRaises(ValueError):
            evaluate_cases([], now=FIXED_NOW)
        with self.assertRaises(ValueError):
            evaluate_cases([{
                "id": "invalid-label",
                "candidate": candidate(),
                "expected_decision": "PAID",
            }], now=FIXED_NOW)

    def test_evaluation_is_explicitly_offline_and_never_authorizes_actions(self):
        report = evaluate_cases([{
            "id": "read-only",
            "candidate": candidate(),
            "expected_decision": "READY_FOR_REVIEW",
        }], now=FIXED_NOW)

        self.assertEqual(report["mode"], "offline_read_only_evaluation")
        self.assertFalse(report["paid_provider_used"])
        self.assertEqual(report["browser_jobs_created"], 0)
        self.assertEqual(report["external_actions_performed"], 0)
        self.assertFalse(report["action_authorized"])
        self.assertFalse(report["cases"][0]["action_authorized"])


    def test_committed_synthetic_suite_has_zero_false_ready_classifications(self):
        from revenue_radar_eval import evaluate_suite, load_suite

        suite = load_suite()
        report = evaluate_suite(suite)

        self.assertEqual(suite["dataset_id"], "midad-revenue-radar-synthetic")
        self.assertEqual(report["gate_status"], "PASS")
        self.assertEqual(report["metrics"]["total"], 14)
        self.assertEqual(report["metrics"]["correct"], 14)
        self.assertEqual(report["metrics"]["false_ready"], 0)
        self.assertEqual(report["metrics"]["false_blocked"], 0)
        self.assertTrue(report["metrics"]["blocker_assertions_passed"])
        self.assertEqual(report["metrics"]["safety_violations"], 0)


if __name__ == "__main__":
    unittest.main()
