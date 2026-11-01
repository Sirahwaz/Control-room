"""Contract tests for safe Wispbyte worker bootstrap behavior."""
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent / "deploy" / "start_worker.sh"
ENV_EXAMPLE = Path(__file__).resolve().parent / "deploy" / ".env.example"

class WorkerDeployContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.script = SCRIPT.read_text(encoding="utf-8")
        cls.env = ENV_EXAMPLE.read_text(encoding="utf-8")

    def test_private_dotenv_is_loaded_before_required_environment_checks(self):
        self.assertIn('if [ -f .env ]', self.script)
        self.assertIn('. ./.env', self.script)
        self.assertLess(self.script.index('. ./.env'), self.script.index(': "${SUPABASE_URL'))

    def test_owner_uuid_is_not_a_startup_prerequisite(self):
        self.assertNotIn('MIDAD_OPERATOR_OWNER_USER_ID:?', self.script)
        self.assertIn('worker_identity', (Path(__file__).resolve().parent / "operator_worker.py").read_text(encoding="utf-8"))

    def test_safe_example_profile_bootstraps_only_when_exact_host_is_allowed(self):
        self.assertIn('MIDAD_BROWSER_ALLOWED_HOSTS:=example.com', self.script)
        self.assertIn('cp accounts.example.json', self.script)
        self.assertIn('grep -q ', self.script)

    def test_environment_template_contains_no_real_secrets(self):
        self.assertIn('MIDAD_INGEST_KEY=SET_IN_PRIVATE_HOST_ENVIRONMENT', self.env)
        self.assertNotIn('sk-', self.env)
        self.assertNotIn('eyJ', self.env)

if __name__ == "__main__":
    unittest.main()
