"""Contract tests for the operator result relay in the Supabase browser gateway."""
import re
import unittest
from pathlib import Path

GATEWAY = Path(__file__).resolve().parents[2] / "supabase" / "functions" / "midad_browser_agent_gateway" / "index.ts"

class OperatorGatewayContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = GATEWAY.read_text(encoding="utf-8")

    def test_result_action_is_restricted_to_operator_jobs(self):
        self.assertIn('action === "record_command_result"', self.source)
        self.assertIn("not_an_operator_command_job", self.source)
        self.assertIn('inputData.operator_command', self.source)

    def test_result_preview_is_bounded_and_redacted(self):
        self.assertIn("safeOperatorPreview(source.text_preview, 1400)", self.source)
        self.assertIn("safeOperatorPreview(source.title, 200)", self.source)
        self.assertIn("[REDACTED]", self.source)
        self.assertIn("page_content_is_untrusted: true", self.source)

    def test_result_schema_does_not_accept_credentials_or_arbitrary_fields(self):
        function = self.source[self.source.index("function sanitizeOperatorResult"):self.source.index("function safeCode")]
        for forbidden in ("password", "secret_value", "cookie", "access_token", "refresh_token"):
            self.assertNotIn(forbidden, function)
        self.assertIn("text_preview", function)
        self.assertIn("session_storage", function)

    def test_result_is_written_to_job_evidence_and_agent_event(self):
        start = self.source.index('if (action === "record_command_result")')
        end = self.source.index('if (action === "get_job")', start)
        branch = self.source[start:end]
        self.assertIn('evidence: { ...currentEvidence, operator_result: result }', branch)
        self.assertIn('event_type: "operator_command_result"', branch)

if __name__ == "__main__":
    unittest.main()
