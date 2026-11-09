"""Deployment/configuration contracts for MIDAD Browser Worker v2."""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RUNTIME = ROOT / "tools" / "midad-browser-runtime"
REQUIREMENTS = RUNTIME / "requirements.txt"
ENV_EXAMPLE = RUNTIME / "deploy" / "worker-v2.env.example"
UNIT = RUNTIME / "deploy" / "midad-continuity-browser-worker-v2.service"
README = RUNTIME / "README-CLOUDFLARE-WORKER-V2.md"
PARTICIPANT = ROOT / "mobile" / "factory" / "native" / "midad-browser" / "ANDROID_PARTICIPANT_V1.md"
ENROLLER = RUNTIME / "enroll_continuity_node.py"


class WorkerV2DeploymentContractTests(unittest.TestCase):
    def test_browser_and_crypto_dependencies_are_exactly_pinned(self):
        lines = [line.strip() for line in REQUIREMENTS.read_text(encoding="utf-8").splitlines() if line.strip()]
        self.assertIn("playwright==1.64.1", lines)
        self.assertIn("cryptography==46.0.4", lines)
        self.assertFalse(any(line.startswith("playwright>=") for line in lines))

    def test_environment_template_is_inert_and_keeps_cost_gate_closed(self):
        source = ENV_EXAMPLE.read_text(encoding="utf-8")
        self.assertIn("MIDAD_CONTINUITY_COST_ESTIMATE_VERIFIED=false", source)
        self.assertIn("MIDAD_CONTINUITY_NODE_TOKEN_FILE=/etc/midad-browser/node-token", source)
        self.assertIn("SET_IN_PRIVATE_HOST_SECRET_STORE", source)
        self.assertNotRegex(source, r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----")
        self.assertNotRegex(source, r"\bgh[pousr]_[A-Za-z0-9]{20,}\b")
        self.assertNotRegex(source, r"\bsk-[A-Za-z0-9_-]{20,}\b")
        self.assertNotIn("MIDAD_LEDGER_ADMIN_KEY=", source)

    def test_systemd_service_is_non_root_and_keeps_chromium_jit_compatible(self):
        source = UNIT.read_text(encoding="utf-8")
        self.assertRegex(source, r"(?m)^User=midad-browser$")
        self.assertRegex(source, r"(?m)^Group=midad-browser$")
        self.assertRegex(source, r"(?m)^NoNewPrivileges=true$")
        self.assertRegex(source, r"(?m)^UMask=0077$")
        self.assertRegex(source, r"(?m)^ReadWritePaths=/var/lib/midad-browser$")
        self.assertRegex(source, r"(?m)^MemoryDenyWriteExecute=false$")
        self.assertNotIn("--no-sandbox", source)

    def test_readme_does_not_claim_cloudflare_or_android_participant_is_live(self):
        source = README.read_text(encoding="utf-8")
        self.assertIn("has not been enrolled or started against a live Cloudflare account", source)
        self.assertIn("P4 Android Participant", source)
        self.assertIn("Central encrypted Vault broker", source)
        self.assertIn("Do not", source)

    def test_android_participant_contract_blocks_admin_key_in_apk(self):
        source = PARTICIPANT.read_text(encoding="utf-8")
        self.assertIn("BLOCKED", source)
        self.assertIn("MIDAD_LEDGER_ADMIN_KEY", source)
        self.assertIn("Android Keystore", source)
        self.assertIn("OFFLINE", source)
        self.assertIn("REVOKED", source)

    def test_enrollment_tool_never_prints_one_time_token(self):
        source = ENROLLER.read_text(encoding="utf-8")
        self.assertIn("--confirm-owner-consent", source)
        self.assertIn("token_file", source)
        self.assertNotRegex(source, r"print\([^\n]*token")
        self.assertNotIn("MIDAD_LEDGER_ADMIN_KEY=", source)


if __name__ == "__main__":
    unittest.main()
