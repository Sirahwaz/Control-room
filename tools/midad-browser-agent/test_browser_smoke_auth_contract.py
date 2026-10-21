import re
import unittest
from pathlib import Path


MIGRATION = (
    Path(__file__).resolve().parents[2]
    / "supabase"
    / "migrations"
    / "20261022100000_midad_browser_smoke_auth_v1.sql"
)


class BrowserSmokeAuthMigrationContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sql = MIGRATION.read_text(encoding="utf-8")
        cls.normalized = re.sub(r"\s+", " ", cls.sql.lower())

    def test_token_table_stores_digest_not_plaintext_and_has_short_ttl(self):
        self.assertIn("token_sha256 text not null unique", self.normalized)
        self.assertIn("vault_secret_id uuid not null unique references vault.secrets(id)", self.normalized)
        self.assertIn("expires_at <= created_at + interval '10 minutes'", self.normalized)
        self.assertNotIn("token_plaintext", self.normalized)

    def test_direct_table_access_is_revoked_and_rls_forced(self):
        self.assertIn("enable row level security", self.normalized)
        self.assertIn("force row level security", self.normalized)
        self.assertIn("revoke all on table public.midad_browser_smoke_tokens from public, anon, authenticated, service_role", self.normalized)

    def test_authorization_is_one_shot_and_expiring(self):
        self.assertIn("midad_browser_smoke_authorize_v1", self.normalized)
        self.assertIn("t.expires_at > clock_timestamp()", self.normalized)
        self.assertIn("t.consumed_at is null", self.normalized)
        self.assertIn("set consumed_at = clock_timestamp()", self.normalized)
        self.assertIn("for update of t skip locked", self.normalized)

    def test_token_cleanup_deletes_vault_secret(self):
        self.assertIn("midad_browser_smoke_cleanup_token_v1", self.normalized)
        self.assertIn("delete from vault.secrets where id = v_secret_id", self.normalized)

    def test_job_cleanup_requires_marked_test_owner_and_exact_fixture(self):
        self.assertIn("midad_browser_smoke_cleanup_job_v1", self.normalized)
        self.assertIn("midad_browser_smoke_identity", self.normalized)
        self.assertIn("midad-browser-smoke-%@example.invalid", self.normalized)
        self.assertIn("midad_gateway_smoke", self.normalized)
        self.assertIn("midad browser gateway smoke test (temporary; safe to delete)", self.normalized)

    def test_rpc_execution_is_service_role_only(self):
        for function in (
            "midad_browser_smoke_authorize_v1",
            "midad_browser_smoke_cleanup_token_v1",
            "midad_browser_smoke_cleanup_job_v1",
        ):
            self.assertIn("revoke all on function public." + function, self.normalized)
            self.assertIn("grant execute on function public." + function, self.normalized)
        self.assertIn("to service_role", self.normalized)


if __name__ == "__main__":
    unittest.main()
