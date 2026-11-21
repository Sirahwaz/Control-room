import unittest
from resolver import MidadPrincipalResolver
from midad_memory_adapter import AdapterError
class ResolverTests(unittest.TestCase):
 def setUp(self):
  self.binding={"verified":True,"owner_scope":"owner-1","principal_id":"user-1","agent_id":"agent-1","run_id":"run-1"}
  self.policy={"verified":True,"allowed_projects":["p1"],"capabilities":["search"]}
 def test_verified_binding(self):
  calls=[]
  p=MidadPrincipalResolver(lambda c:self.binding,lambda *a:calls.append(a) or self.policy)({"session":"verified"})
  self.assertEqual(p.owner_scope,"owner-1");self.assertEqual(p.allowed_projects,frozenset({"p1"}));self.assertEqual(calls,[("owner-1","agent-1","run-1")])
 def test_unverified_session(self):
  with self.assertRaises(AdapterError):MidadPrincipalResolver(lambda c:{"verified":False},lambda *a:self.policy)(None)
 def test_unverified_policy(self):
  with self.assertRaises(AdapterError):MidadPrincipalResolver(lambda c:self.binding,lambda *a:{"verified":False})(None)
 def test_empty_projects_denied(self):
  with self.assertRaises(AdapterError):MidadPrincipalResolver(lambda c:self.binding,lambda *a:{**self.policy,"allowed_projects":[]})(None)
 def test_unsupported_capability_denied(self):
  with self.assertRaises(AdapterError):MidadPrincipalResolver(lambda c:self.binding,lambda *a:{**self.policy,"capabilities":["delete"]})(None)
 def test_client_claims_ignored(self):
  p=MidadPrincipalResolver(lambda c:self.binding,lambda *a:self.policy)({"owner_scope":"forged","projects":["p999"]})
  self.assertEqual(p.owner_scope,"owner-1");self.assertEqual(p.allowed_projects,frozenset({"p1"}))
if __name__=="__main__":unittest.main()
