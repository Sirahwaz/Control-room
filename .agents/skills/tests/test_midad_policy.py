from pathlib import Path
import json
import unittest

REPO_ROOT = Path(__file__).resolve().parents[3]
SKILLS = REPO_ROOT / ".agents" / "skills"

UPSTREAM_SKILLS = [
    "replica-recon", "replica-architect", "replica-design", "replica-build",
    "replica-backend", "replica-test", "replica-diff", "replica-entrepreneur",
    "replica-brand", "replica-launch", "replica-deploy",
]


class MidadReplicaPolicyTests(unittest.TestCase):
    def test_all_eleven_upstream_skills_are_present(self):
        missing = [name for name in UPSTREAM_SKILLS if not (SKILLS / name / "SKILL.md").is_file()]
        self.assertEqual([], missing, f"Missing imported skill files: {missing}")

    def test_router_enforces_authorization_and_bounded_retries(self):
        router = (SKILLS / "midad-replica-lab" / "SKILL.md").read_text(encoding="utf-8")
        self.assertIn("Authorization", router)
        self.assertIn("3 attempts per incident", router)
        self.assertIn("BLOCKED", router)

    def test_deployment_skill_blocks_live_financial_actions(self):
        deploy = (SKILLS / "replica-deploy" / "SKILL.md").read_text(encoding="utf-8").lower()
        self.assertIn("midad policy override", deploy)
        self.assertIn("live financial", deploy)
        self.assertIn("real purchase", deploy)
        self.assertIn("wallet signing", deploy)

    def test_factory_handoff_does_not_claim_live_dispatch(self):
        handoff = (REPO_ROOT / "mobile" / "factory" / "REPLICA_SKILL_INTEGRATION.md").read_text(encoding="utf-8")
        self.assertIn("does not claim that direct dispatch", handoff)
        self.assertIn("at most 3 attempts", handoff)
        self.assertIn("artifact SHA-256", handoff)

    def test_handoff_json_is_valid_and_finance_is_disabled(self):
        sample = SKILLS / "midad-replica-lab" / "assets" / "factory-handoff.example.json"
        contract = json.loads(sample.read_text(encoding="utf-8"))
        self.assertEqual(3, contract["execution"]["max_attempts_per_incident"])
        self.assertFalse(contract["safety"]["live_financial_actions"])
        self.assertFalse(contract["safety"]["production_publish"])

    def test_no_client_secret_or_live_action_is_authorized_by_example(self):
        sample = SKILLS / "midad-replica-lab" / "assets" / "factory-handoff.example.json"
        text = sample.read_text(encoding="utf-8").lower()
        self.assertIn('"secrets_in_client": false', text)
        self.assertIn('"signing": false', text)


if __name__ == "__main__":
    unittest.main()
