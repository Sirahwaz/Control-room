import unittest
from revenue_radar import (
    SOURCE_REGISTRY, browser_targets, candidate_from_opportunity,
    deduplicate_candidates, qualify_candidate,
)

def candidate(**overrides):
    item = {
        "source": "bounties_sh", "source_url": "https://bounties.sh/bounty/abc123",
        "listing_id": "abc123", "title": "Build a verified payment reconciliation adapter",
        "gross_usd": 800, "asset": "USDC", "network": "Base", "payment_mode": "crypto_only",
        "official_payout_terms_url": "https://bounties.sh/faqs",
        "listing_payment_evidence_url": "https://bounties.sh/bounty/abc123",
        "funded": True, "min_payout_usd": 10, "platform_fee_usd": 40,
        "network_fee_usd": 1, "claim_fee_usd": 0, "upfront_cost_usd": 0,
        "region_eligible": True, "kyc_status": "eligible_or_not_required",
        "automation_allowed": True, "estimated_minutes": 240,
        "acceptance_probability": 0.65, "payout_confidence": 0.9,
        "expires_at": "2099-01-01T00:00:00Z",
    }
    item.update(overrides)
    return item

class RevenueRadarTests(unittest.TestCase):
    def test_accepts_high_value_fully_evidenced_crypto_listing_and_scores_net_velocity(self):
        result = qualify_candidate(candidate())
        self.assertEqual(result["decision"], "READY_FOR_REVIEW")
        self.assertEqual(result["net_usd"], 759.0)
        self.assertGreater(result["priority_score"], 0)
        self.assertEqual(result["payout_state"], "verified_listing_evidence")
        self.assertFalse(result["action_authorized"])

    def test_rejects_platform_crypto_claim_without_listing_level_payout_evidence(self):
        result = qualify_candidate(candidate(listing_payment_evidence_url=""))
        self.assertEqual(result["decision"], "BLOCKED")
        self.assertIn("listing_payment_evidence_missing", result["blockers"])

    def test_rejects_fiat_only_even_if_amount_is_large(self):
        result = qualify_candidate(candidate(payment_mode="fiat_only", asset="USD"))
        self.assertEqual(result["decision"], "BLOCKED")
        self.assertIn("crypto_payout_not_proven", result["blockers"])

    def test_rejects_unfunded_reward_pool(self):
        self.assertIn("funding_not_verified", qualify_candidate(candidate(funded=False))["blockers"])

    def test_rejects_upfront_cost_and_noneligible_region(self):
        result = qualify_candidate(candidate(upfront_cost_usd=25, region_eligible=False))
        self.assertIn("upfront_cost_forbidden", result["blockers"])
        self.assertIn("region_eligibility_unverified_or_denied", result["blockers"])

    def test_rejects_unknown_network_and_nonofficial_urls(self):
        result = qualify_candidate(candidate(network="", official_payout_terms_url="https://fake-bounties.example/terms"))
        self.assertIn("asset_or_network_missing", result["blockers"])
        self.assertIn("official_payout_terms_not_allowlisted", result["blockers"])

    def test_filters_small_opportunities_by_net_value(self):
        result = qualify_candidate(candidate(gross_usd=90, platform_fee_usd=20, network_fee_usd=1))
        self.assertIn("below_minimum_net_value", result["blockers"])

    def test_deduplicates_same_listing_across_sources(self):
        kept, dropped = deduplicate_candidates([
            candidate(source="bounties_sh"),
            candidate(source="taskmarket", source_url="https://api.taskmarket.dev/tasks/abc123"),
        ])
        self.assertEqual(len(kept), 1)
        self.assertEqual(dropped[0]["reason"], "duplicate_listing_id")

    def test_deduplicates_normalized_title_and_same_canonical_host(self):
        kept, dropped = deduplicate_candidates([
            candidate(listing_id="", title="  Build a verified PAYMENT reconciliation adapter! "),
            candidate(source="bounties_sh", source_url="https://bounties.sh/other", listing_id="",
                      title="build a verified payment reconciliation adapter"),
        ])
        self.assertEqual(len(kept), 1)
        self.assertEqual(dropped[0]["reason"], "duplicate_normalized_title")

    def test_browser_targets_only_include_registered_https_sources(self):
        targets = browser_targets([candidate(), candidate(source="unregistered", source_url="https://example.org/task")])
        self.assertEqual(len(targets), 1)
        self.assertEqual(targets[0]["allowed_hosts"], ["bounties.sh"])
        self.assertFalse(targets[0]["creates_browser_job"])
        self.assertIn("bounties_sh", SOURCE_REGISTRY)

    def test_never_ready_if_deadline_expired_or_automation_disallowed(self):
        expired = qualify_candidate(candidate(expires_at="2000-01-01T00:00:00Z"))
        automation = qualify_candidate(candidate(automation_allowed=False))
        self.assertIn("listing_expired", expired["blockers"])
        self.assertIn("automation_not_permitted", automation["blockers"])

    def test_existing_opportunity_row_is_not_upgraded_from_payment_coin_or_funded_signal(self):
        row = {
            "source": "ugig", "title": "High value automation project", "expected_value": 1500,
            "evidence": {"source_url": "https://ugig.net/gigs/abc", "payment_coin": "USDC"},
            "offer": {"action_url": "https://ugig.net/gigs/abc", "reward_usd": 1500},
            "metadata": {"funded_signal": True, "payment_coin": "USDC", "payout_gate_status": "BLOCKED"},
            "confidence": 0.8,
        }
        result = qualify_candidate(candidate_from_opportunity(row))
        self.assertEqual(result["decision"], "BLOCKED")
        self.assertIn("official_payout_terms_not_allowlisted", result["blockers"])
        self.assertIn("funding_not_verified", result["blockers"])
        self.assertIn("crypto_payout_not_proven", result["blockers"])

if __name__ == "__main__":
    unittest.main()
