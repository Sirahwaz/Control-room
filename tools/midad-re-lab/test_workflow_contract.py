from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[2]
WORKFLOWS = ROOT / ".github" / "workflows"


class AndroidReleaseAnalysisWorkflowContractTests(unittest.TestCase):
    def test_current_release_analysis_is_not_pinned_to_an_old_run(self):
        workflow = (WORKFLOWS / "midad-re-lab.yml").read_text(encoding="utf-8")
        self.assertNotIn("android-current-omni-agent:", workflow)
        self.assertNotIn("run-id: 43571141640", workflow)

    def test_release_analysis_consumes_the_apk_from_its_own_build_job(self):
        workflow = (WORKFLOWS / "midad-omni-agent-android.yml").read_text(encoding="utf-8")
        self.assertIn("analyze-omni-agent-release:", workflow)
        job = workflow.split("  analyze-omni-agent-release:", 1)[1]
        self.assertIn("needs: build-omni-agent", job)
        self.assertIn("actions/download-artifact@v4", job)
        self.assertIn("name: ${{ needs.build-omni-agent.outputs.artifact_name }}-release", job)
        self.assertNotIn("run-id:", job)
        self.assertIn("tools/midad-re-lab/analyze_apk.py", job)


if __name__ == "__main__":
    unittest.main()
