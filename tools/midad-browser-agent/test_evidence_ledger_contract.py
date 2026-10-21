import re
import unittest
from pathlib import Path


MIGRATION = (
    Path(__file__).resolve().parents[2]
    / "supabase"
    / "migrations"
    / "20261022080000_midad_browser_evidence_ledger_v1.sql"
)


class BrowserEvidenceLedgerMigrationContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sql = MIGRATION.read_text(encoding="utf-8")
        cls.normalized = re.sub(r"\s+", " ", cls.sql.lower())

    def test_adds_a_separate_append_only_evidence_ledger(self):
        self.assertIn("create table public.midad_browser_evidence_ledger", self.normalized)
        self.assertIn("unique (job_id, event_key)", self.normalized)
        self.assertIn("references public.midad_browser_jobs(id)", self.normalized)
        self.assertIn("references auth.users(id)", self.normalized)

    def test_evidence_table_is_rls_protected_and_not_directly_mutable(self):
        self.assertIn("enable row level security", self.normalized)
        self.assertIn("force row level security", self.normalized)
        self.assertRegex(self.normalized, r"revoke[^;]*update[^;]*delete[^;]*midad_browser_evidence_ledger")
        self.assertIn("grant select on table public.midad_browser_evidence_ledger to service_role", self.normalized)

    def test_security_definer_rpc_has_locked_search_path_and_service_role_only(self):
        self.assertIn("security definer", self.normalized)
        self.assertRegex(self.normalized, r"set search_path = pg_catalog, public")
        self.assertIn("revoke all on function public.midad_browser_record_evidence_v1", self.normalized)
        self.assertIn("grant execute on function public.midad_browser_record_evidence_v1", self.normalized)
        self.assertIn("to service_role", self.normalized)

    def test_idempotency_checked_before_state_mutation(self):
        self.assertIn("select l.id", self.normalized)
        self.assertIn("where l.job_id = p_job_id and l.event_key = p_event_key", self.normalized)
        self.assertLess(
            self.normalized.index("where l.job_id = p_job_id and l.event_key = p_event_key"),
            self.normalized.index("update public.midad_browser_jobs"),
        )

    def test_financial_paid_state_is_not_claimable_by_general_transition_rpc(self):
        self.assertIn("if v_target_state = 'paid' then", self.normalized)
        self.assertIn("requires a separate verified receipt workflow", self.normalized)

    def test_metadata_is_allowlisted_and_urls_cannot_store_query_or_credentials(self):
        self.assertIn("jsonb_each", self.normalized)
        self.assertIn("not in (", self.normalized)
        self.assertIn("position('?' in v_safe_url)", self.normalized)
        self.assertIn("position('#' in v_safe_url)", self.normalized)
        self.assertIn("v_authority like '%@%'", self.normalized)

    def test_valid_state_transition_matrix_is_explicit(self):
        for state in ("queued", "researching", "preparing", "running", "human_gate", "blocked", "submitted", "verifying", "failed", "completed", "cancelled"):
            self.assertIn("'" + state + "'", self.normalized)
        self.assertIn("invalid_browser_state_transition", self.normalized)


if __name__ == "__main__":
    unittest.main()
