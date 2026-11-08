"""Read-only source contracts for the live MIDAD Human Bridge v10."""
import unittest
from pathlib import Path

SOURCE = Path(__file__).resolve().parents[2] / "supabase" / "functions" / "midad_human_bridge" / "index.ts"

class HumanBridgeContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = SOURCE.read_text(encoding="utf-8")

    def test_bridge_tokens_are_random_and_only_hashes_are_stored(self):
        self.assertIn('new Uint8Array(32)', self.source)
        self.assertIn('crypto.subtle.digest("SHA-256"', self.source)
        self.assertIn('token_hash:await sha256(raw)', self.source)
        self.assertIn('eq("token_hash",hash)', self.source)

    def test_pair_start_is_internal_only_and_short_lived(self):
        start = self.source.index('if(action==="pair_start")')
        end = self.source.index('if(action==="pair_from_control_room")', start)
        block = self.source[start:end]
        self.assertIn('if(!(await internal(req)))', block)
        self.assertIn('Date.now()+10*60*1000', block)
        self.assertIn('code_hash:hash', block)

    def test_control_room_pairing_requires_active_hashed_session_and_unique_owner(self):
        start = self.source.index('if(action==="pair_from_control_room")')
        end = self.source.index('if(action==="pair_complete")', start)
        block = self.source[start:end]
        self.assertIn('crypto.subtle.digest("SHA-256"', block)
        self.assertIn('.eq("active",true)', block)
        self.assertIn('30*24*60*60*1000', block)
        self.assertIn('ownerIds.length!==1', block)
        self.assertIn('owner_identity_ambiguous', block)

    def test_pairing_code_is_single_use_and_expires(self):
        start = self.source.index('if(action==="pair_complete")')
        end = self.source.index('const raw=clip(req.headers.get("x-midad-bridge-token")', start)
        block = self.source[start:end]
        self.assertIn('.eq("status","OPEN")', block)
        self.assertIn('pairing_code_expired', block)
        self.assertIn('status:"USED"', block)
        self.assertIn('30*24*60*60*1000', block)

    def test_every_device_action_requires_active_unexpired_hashed_session(self):
        self.assertIn('const raw=clip(req.headers.get("x-midad-bridge-token")||body.bridge_token,500)', self.source)
        self.assertIn('getSession(sb,raw)', self.source)
        self.assertIn('data.status!=="ACTIVE"', self.source)
        self.assertIn('expires_at', self.source)

    def test_tasks_and_browser_jobs_are_owner_scoped(self):
        self.assertIn('.eq("user_id",session.owner_user_id)', self.source)
        self.assertIn('.eq("owner_user_id",session.owner_user_id)', self.source)
        self.assertIn('list_browser_jobs', self.source)

    def test_session_can_be_revoked(self):
        self.assertIn('if(action==="revoke_session")', self.source)
        self.assertIn('status:"REVOKED"', self.source)
        self.assertIn('revoked_at:new Date().toISOString()', self.source)

if __name__ == "__main__":
    unittest.main()
