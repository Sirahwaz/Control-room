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

    def test_intelligence_force_super_routes_leanrea_and_factory_separately(self):
        router = (SKILLS / "midad-intelligence-force-super" / "SKILL.md").read_text(encoding="utf-8")
        self.assertIn("leanrea", router)
        self.assertIn("replica-recon", router)
        self.assertIn("Mobile Factory", router)
        self.assertIn("midad-nanobot-runtime", router)
        self.assertIn("seen", router.lower())
        self.assertIn("three attempts", router.lower())

    def test_leanrea_import_has_authorization_override_and_evidence_gate(self):
        skill = (SKILLS / "leanrea" / "SKILL.md").read_text(encoding="utf-8")
        self.assertIn("MIDAD authorization and isolation override", skill)
        self.assertIn("explicitly authorized", skill)
        self.assertIn("Static analysis is not proof", skill)

    def test_router_enforces_authorization_and_bounded_retries(self):
        router = (SKILLS / "midad-replica-lab" / "SKILL.md").read_text(encoding="utf-8")
        self.assertIn("Authorization", router)
        self.assertIn("3 attempts per incident", router)
        self.assertIn("BLOCKED", router)

    def test_nanobot_runtime_is_registered_and_not_claimed_live(self):
        skill = (SKILLS / "midad-nanobot-runtime" / "SKILL.md").read_text(encoding="utf-8")
        guide = (SKILLS / "midad-replica-lab" / "NANOBOT_MIDAD_INTEGRATION.md").read_text(encoding="utf-8")
        router = (SKILLS / "midad-intelligence-force-super" / "SKILL.md").read_text(encoding="utf-8")
        self.assertIn("Python 3.11 or newer", skill)
        self.assertIn("NOT installed, hosted, deployed or connected", skill)
        self.assertIn("session_id is not user authentication", skill)
        self.assertIn("midad-nanobot-runtime", router)
        self.assertIn("OnDev Hermes", guide)
        self.assertIn("old Hermes checklist is retired", guide)
        self.assertIn("api.apiKey", guide)
        self.assertIn("read-only", guide.lower())

        with open(REPO_ROOT / "mobile" / "factory" / "x" / "plugins.registry.json", encoding="utf-8") as fh:
            plugins = json.load(fh)["plugins"]
        plugin = next((item for item in plugins if item["id"] == "nanobot-agent-runtime"), None)
        self.assertIsNotNone(plugin)
        self.assertIn("runtime_preflight", plugin["tests"])
        self.assertIn("not installed", plugin["policy"].lower())

        with open(REPO_ROOT / "mobile" / "factory" / "x" / "capabilities.registry.json", encoding="utf-8") as fh:
            capabilities = json.load(fh)["capabilities"]
        self.assertIn("self-hosted-agent-runtime", [item["id"] for item in capabilities])
        self.assertFalse((SKILLS / "midad-replica-lab" / "ONDEV_HERMES_NEXT_STEPS.md").exists())

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
