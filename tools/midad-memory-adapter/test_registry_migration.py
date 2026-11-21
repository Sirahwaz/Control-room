"""Structural regression tests for MMA Registry v1 SQL migration."""
import pathlib, re, unittest
SQL = pathlib.Path(__file__).parents[2] / "supabase/migrations/20261121150000_midad_memory_authorization_registry_v1.sql"
class RegistryMigrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sql = SQL.read_text()
    def test_binding_dimensions_required(self):
        for field in ("owner_user_id uuid NOT NULL", "project_id text NOT NULL", "agent_id text NOT NULL", "run_id text NOT NULL"):
            self.assertIn(field, self.sql)
    def test_capability_allowlist(self):
        self.assertIn("ARRAY['create','search']::text[]", self.sql)
    def test_expiry_and_revocation_enforced(self):
        self.assertIn("g.revoked_at IS NULL", self.sql)
        self.assertIn("g.expires_at > now()", self.sql)
    def test_rpc_binding_matches_all_dimensions(self):
        for predicate in ("g.owner_user_id = p_owner_user_id", "g.project_id = p_project_id", "g.agent_id = p_agent_id", "g.run_id = p_run_id"):
            self.assertIn(predicate, self.sql)
    def test_client_roles_denied(self):
        self.assertRegex(self.sql, r"REVOKE ALL ON public\.midad_memory_authorization_grants FROM PUBLIC, anon, authenticated")
        self.assertRegex(self.sql, r"REVOKE ALL ON FUNCTION public\.midad_memory_authorization_check_v1\(uuid,text,text,text\) FROM PUBLIC, anon, authenticated")
    def test_service_role_only_rpc(self):
        self.assertIn("TO service_role", self.sql)
if __name__ == "__main__": unittest.main()
