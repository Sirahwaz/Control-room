import unittest
from pathlib import Path
from unittest.mock import patch

from agent import collect_one


class BrowserPolicyIntegrationTests(unittest.TestCase):
    @patch("agent._safe_http_capture")
    @patch(
        "agent.evaluate_action",
        return_value={"status": "BLOCK", "code": "TEST_BLOCK", "reason": "blocked by test policy"},
    )
    @patch(
        "agent._target_record",
        return_value={
            "url": "https://taskmarket.dev/tasks",
            "hostname": "taskmarket.dev",
            "allowed_hosts": ["taskmarket.dev"],
            "label": "Taskmarket public tasks",
            "purpose": "Policy integration test",
        },
    )
    def test_policy_block_stops_capture_before_network(
        self, _target, _policy, capture
    ):
        with self.assertRaisesRegex(ValueError, "TEST_BLOCK"):
            collect_one(
                {"url": "https://taskmarket.dev/tasks"},
                1,
                Path("/tmp/midad-browser-policy-test"),
            )
        capture.assert_not_called()


if __name__ == "__main__":
    unittest.main()
