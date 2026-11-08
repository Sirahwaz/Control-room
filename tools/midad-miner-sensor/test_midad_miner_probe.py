import unittest
from datetime import datetime, timezone

from midad_miner_probe import is_valid_restart_approval, is_valid_midad_endpoint


class RestartApprovalContractTests(unittest.TestCase):
    def setUp(self):
        self.now = datetime(2026, 11, 8, 20, 0, tzinfo=timezone.utc)
        self.command = {
            "action_id": "action-123",
            "operation": "restart",
            "approval": {
                "id": "approval-456",
                "status": "approved",
                "expires_at": "2026-11-08T20:05:00Z",
            },
            "safety": {
                "cloud_approval": True,
                "local_policy_required": True,
                "reversible": False,
            },
        }

    def test_accepts_restart_with_current_per_action_approval_and_both_safety_gates(self):
        self.assertTrue(is_valid_restart_approval(self.command, now=self.now))

    def test_accepts_approval_without_expiry_when_cloud_record_has_no_expiry(self):
        command = {
            **self.command,
            "approval": {**self.command["approval"], "expires_at": None},
        }
        self.assertTrue(is_valid_restart_approval(command, now=self.now))

    def test_rejects_restart_without_action_identity(self):
        command = {**self.command}
        command.pop("action_id")
        self.assertFalse(is_valid_restart_approval(command, now=self.now))

    def test_rejects_restart_without_approval_record(self):
        command = {**self.command, "approval": None}
        self.assertFalse(is_valid_restart_approval(command, now=self.now))

    def test_rejects_pending_or_rejected_approval(self):
        for status in ("pending", "rejected", "expired", ""):
            with self.subTest(status=status):
                command = {
                    **self.command,
                    "approval": {**self.command["approval"], "status": status},
                }
                self.assertFalse(is_valid_restart_approval(command, now=self.now))

    def test_rejects_expired_approval(self):
        command = {
            **self.command,
            "approval": {
                **self.command["approval"],
                "expires_at": "2026-11-08T19:59:59Z",
            },
        }
        self.assertFalse(is_valid_restart_approval(command, now=self.now))

    def test_rejects_malformed_or_timezone_ambiguous_expiry(self):
        for expires_at in ("not-a-date", "2026-11-08T20:05:00"):
            with self.subTest(expires_at=expires_at):
                command = {
                    **self.command,
                    "approval": {**self.command["approval"], "expires_at": expires_at},
                }
                self.assertFalse(is_valid_restart_approval(command, now=self.now))

    def test_rejects_missing_cloud_approval_marker(self):
        command = {
            **self.command,
            "safety": {**self.command["safety"], "cloud_approval": False},
        }
        self.assertFalse(is_valid_restart_approval(command, now=self.now))

    def test_rejects_missing_local_policy_requirement(self):
        command = {
            **self.command,
            "safety": {**self.command["safety"], "local_policy_required": False},
        }
        self.assertFalse(is_valid_restart_approval(command, now=self.now))

    def test_does_not_treat_diagnostic_as_a_restart_approval(self):
        command = {**self.command, "operation": "diagnostic"}
        self.assertFalse(is_valid_restart_approval(command, now=self.now))



class MinerEndpointPolicyTests(unittest.TestCase):
    def test_accepts_only_the_exact_midad_telemetry_endpoint_on_supabase_https(self):
        self.assertTrue(is_valid_midad_endpoint(
            "https://abcdefghijklmnopqrst.supabase.co/functions/v1/midad_miner_telemetry_ingest",
            "midad_miner_telemetry_ingest",
        ))

    def test_accepts_only_the_exact_midad_repair_endpoint_on_supabase_https(self):
        self.assertTrue(is_valid_midad_endpoint(
            "https://abcdefghijklmnopqrst.supabase.co/functions/v1/midad_miner_repair_bridge",
            "midad_miner_repair_bridge",
        ))

    def test_rejects_plain_http(self):
        self.assertFalse(is_valid_midad_endpoint(
            "http://abcdefghijklmnopqrst.supabase.co/functions/v1/midad_miner_telemetry_ingest",
            "midad_miner_telemetry_ingest",
        ))

    def test_rejects_non_supabase_hosts_and_subdomains(self):
        for url in (
            "https://evil.example/functions/v1/midad_miner_telemetry_ingest",
            "https://abcdefghijklmnopqrst.supabase.co.evil.example/functions/v1/midad_miner_telemetry_ingest",
            "https://api.subdomain.abcdefghijklmnopqrst.supabase.co/functions/v1/midad_miner_telemetry_ingest",
        ):
            with self.subTest(url=url):
                self.assertFalse(is_valid_midad_endpoint(url, "midad_miner_telemetry_ingest"))

    def test_rejects_wrong_edge_function_path(self):
        self.assertFalse(is_valid_midad_endpoint(
            "https://abcdefghijklmnopqrst.supabase.co/functions/v1/other_function",
            "midad_miner_telemetry_ingest",
        ))

    def test_rejects_unexpected_function_names(self):
        self.assertFalse(is_valid_midad_endpoint(
            "https://abcdefghijklmnopqrst.supabase.co/functions/v1/other_function",
            "other_function",
        ))

    def test_rejects_userinfo_nonstandard_ports_query_and_fragment(self):
        urls = (
            "https://user@abcdefghijklmnopqrst.supabase.co/functions/v1/midad_miner_telemetry_ingest",
            "https://abcdefghijklmnopqrst.supabase.co:8443/functions/v1/midad_miner_telemetry_ingest",
            "https://abcdefghijklmnopqrst.supabase.co/functions/v1/midad_miner_telemetry_ingest?next=https://evil.example",
            "https://abcdefghijklmnopqrst.supabase.co/functions/v1/midad_miner_telemetry_ingest#fragment",
        )
        for url in urls:
            with self.subTest(url=url):
                self.assertFalse(is_valid_midad_endpoint(url, "midad_miner_telemetry_ingest"))

    def test_rejects_malformed_urls(self):
        for url in ("", "not-a-url", "https://", "https://[::1]/functions/v1/midad_miner_telemetry_ingest"):
            with self.subTest(url=url):
                self.assertFalse(is_valid_midad_endpoint(url, "midad_miner_telemetry_ingest"))

if __name__ == "__main__":
    unittest.main()
