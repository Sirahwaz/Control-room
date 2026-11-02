import subprocess
import unittest
from unittest.mock import patch

from analyze_apk import run_tool, run_jadx, count_decompiled_sources


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



class JadxFallbackTests(unittest.TestCase):
    @patch("analyze_apk.run_tool")
    def test_retries_simple_mode_after_standard_decompilation_failure(self, mocked_run):
        mocked_run.side_effect = [
            {"status": "failed", "returncode": 1, "error": "JadxOverflowException"},
            {"status": "completed", "returncode": 0, "error": None},
        ]
        result = run_jadx("jadx", "sample.apk", "out/jadx")
        self.assertEqual(result["status"], "completed")
        self.assertEqual(result["strategy"], "simple_fallback")
        self.assertEqual(len(result["attempts"]), 2)
        fallback_command = mocked_run.call_args_list[1].args[0]
        self.assertIn("--decompilation-mode", fallback_command)
        self.assertIn("simple", fallback_command)
        self.assertIn("--no-inline-kotlin-lambda", fallback_command)

    @patch("analyze_apk.run_tool")
    def test_does_not_retry_when_standard_decompilation_succeeds(self, mocked_run):
        mocked_run.return_value = {"status": "completed", "returncode": 0, "error": None}
        result = run_jadx("jadx", "sample.apk", "out/jadx")
        self.assertEqual(result["strategy"], "standard")
        self.assertEqual(mocked_run.call_count, 1)

    def test_counts_partial_java_and_kotlin_outputs(self):
        from pathlib import Path
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "A.java").write_text("class A {}")
            (root / "B.kt").write_text("class B")
            (root / "nested").mkdir()
            (root / "nested" / "C.java").write_text("class C {}")
            self.assertEqual(count_decompiled_sources(root), 3)


    @patch("analyze_apk.run_tool")
    def test_preserves_partial_outputs_from_both_jadx_attempts_and_selects_best(self, mocked_run):
        from pathlib import Path
        import tempfile

        def failed_with_outputs(command, _tool_name):
            output = Path(command[command.index("-d") + 1])
            output.mkdir(parents=True, exist_ok=True)
            if "simple" in command:
                (output / "Fallback.java").write_text("class Fallback {}")
                return {"status": "failed", "returncode": 3, "error": "coroutine decode error"}
            (output / "Standard.java").write_text("class Standard {}")
            (output / "Standard2.kt").write_text("class Standard2")
            return {"status": "failed", "returncode": 3, "error": "coroutine decode error"}

        mocked_run.side_effect = failed_with_outputs
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "jadx"
            result = run_jadx("jadx", "sample.apk", str(root))
            self.assertEqual(result["status"], "failed")
            self.assertEqual(result["strategy"], "best_effort_partial")
            self.assertEqual(result["output_dir"], str(root / "attempts" / "standard"))
            self.assertEqual(result["source_file_count"], 2)
            self.assertTrue((root / "attempts" / "simple_fallback" / "Fallback.java").exists())
            self.assertTrue((root / "attempts" / "standard" / "Standard.java").exists())
