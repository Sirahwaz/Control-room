import subprocess
import unittest
from unittest.mock import patch

from analyze_apk import run_tool


class RunToolResilienceTests(unittest.TestCase):
    @patch("analyze_apk.subprocess.run")
    def test_success_returns_completed_status(self, mocked_run):
        mocked_run.return_value = subprocess.CompletedProcess(["jadx"], 0, "OK", None)
        result = run_tool(["jadx"], "jadx")
        self.assertEqual(result["status"], "completed")
        self.assertEqual(result["returncode"], 0)

    @patch("analyze_apk.subprocess.run")
    def test_nonzero_exit_is_reported_without_raising(self, mocked_run):
        mocked_run.side_effect = subprocess.CalledProcessError(
            1, ["jadx"], output="decode failed: unsupported opcode"
        )
        result = run_tool(["jadx"], "jadx")
        self.assertEqual(result["status"], "failed")
        self.assertEqual(result["returncode"], 1)
        self.assertIn("unsupported opcode", result["error"])

    @patch("analyze_apk.subprocess.run")
    def test_timeout_is_reported_without_raising(self, mocked_run):
        mocked_run.side_effect = subprocess.TimeoutExpired(["jadx"], 300, output="working")
        result = run_tool(["jadx"], "jadx")
        self.assertEqual(result["status"], "timeout")
        self.assertIn("300", result["error"])

    @patch("analyze_apk.subprocess.run")
    def test_error_output_is_bounded(self, mocked_run):
        mocked_run.side_effect = subprocess.CalledProcessError(2, ["jadx"], output="x" * 20000)
        result = run_tool(["jadx"], "jadx")
        self.assertLessEqual(len(result["error"]), 4096)


if __name__ == "__main__":
    unittest.main()
