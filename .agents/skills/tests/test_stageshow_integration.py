from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]


class StageShowIntegrationTests(unittest.TestCase):
    def test_skill_has_one_valid_frontmatter_and_upstream_workflow(self):
        skill = (ROOT / "stageshow" / "SKILL.md").read_text(encoding="utf-8")
        self.assertTrue(skill.startswith("---\n"))
        self.assertEqual(skill.count("\nname: stageshow\n"), 1)
        self.assertIn("## Workflow", skill)
        self.assertIn("## The kit", skill)

    def test_midad_adapter_keeps_visuals_separate_from_lab_evidence(self):
        guide = (ROOT / "stageshow" / "MIDAD_INTEGRATION.md").read_text(encoding="utf-8")
        self.assertIn("not an APK/web analyzer", guide)
        self.assertIn("runtime evidence", guide)
        self.assertIn("pending isolated dependency review", guide)

    def test_lab_and_top_level_router_register_stageshow(self):
        lab = (ROOT / "midad-replica-lab" / "SKILL.md").read_text(encoding="utf-8")
        router = (ROOT / "midad-intelligence-force-super" / "SKILL.md").read_text(encoding="utf-8")
        self.assertIn("`stageshow`", lab)
        self.assertIn("`stageshow`", router)


if __name__ == "__main__":
    unittest.main()
