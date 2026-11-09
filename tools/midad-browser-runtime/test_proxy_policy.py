import copy
import unittest

from proxy_policy import ProxyPolicyError, build_playwright_proxy, resolve_proxy_route


def make_config():
    return {
        "contract_version": "midad.network-access/v1",
        "proxy_profiles": [
            {
                "profile_id": "proxy-eu-01",
                "mode": "HTTPS",
                "enabled": True,
                "endpoint": {"kind": "NETWORK", "host": "proxy.example.net", "port": 8443},
                "auth_secret_ref": "vault://proxy/eu-01/auth",
                "health_policy": {"on_failure": "BLOCK", "max_attempts": 1},
            }
        ],
        "routing_rules": [
            {
                "rule_id": "browser-example",
                "priority": 100,
                "scopes": ["BROWSER"],
                "hosts": ["example.com"],
                "action": "USE_PROXY",
                "proxy_profile_id": "proxy-eu-01",
                "allow_direct_fallback": False,
            },
            {
                "rule_id": "automation-example",
                "priority": 100,
                "scopes": ["AUTOMATION"],
                "hosts": ["example.com"],
                "action": "BLOCK",
            },
        ],
        "credential_bindings": [],
        "defaults": {
            "on_no_match": "BLOCK",
            "on_route_failure": "BLOCK",
            "allow_direct_fallback": False,
            "max_failover_attempts": 0,
        },
    }


class ProxyPolicyTests(unittest.TestCase):
    def test_selects_exact_host_route_for_matching_scope(self):
        route = resolve_proxy_route(make_config(), "https://example.com/dashboard", "BROWSER")
        self.assertEqual(route["action"], "USE_PROXY")
        self.assertEqual(route["profile"]["profile_id"], "proxy-eu-01")

    def test_does_not_reuse_browser_route_for_automation_scope(self):
        with self.assertRaisesRegex(ProxyPolicyError, "ROUTE_BLOCKED"):
            resolve_proxy_route(make_config(), "https://example.com/", "AUTOMATION")

    def test_subdomain_does_not_match_an_exact_host_rule(self):
        with self.assertRaisesRegex(ProxyPolicyError, "NO_ROUTE_MATCH"):
            resolve_proxy_route(make_config(), "https://sub.example.com/", "BROWSER")

    def test_missing_route_fails_closed_by_default(self):
        with self.assertRaisesRegex(ProxyPolicyError, "NO_ROUTE_MATCH"):
            resolve_proxy_route(make_config(), "https://other.example/", "BROWSER")

    def test_direct_route_requires_an_explicit_matching_rule(self):
        config = make_config()
        config["routing_rules"][0] = {
            "rule_id": "explicit-direct",
            "priority": 100,
            "scopes": ["BROWSER"],
            "hosts": ["example.com"],
            "action": "DIRECT",
            "allow_direct_fallback": False,
        }
        route = resolve_proxy_route(config, "example.com", "BROWSER")
        self.assertEqual(route["action"], "DIRECT")

    def test_disabled_proxy_is_rejected_without_direct_fallback(self):
        config = make_config()
        config["proxy_profiles"][0]["enabled"] = False
        with self.assertRaisesRegex(ProxyPolicyError, "PROXY_PROFILE_DISABLED"):
            resolve_proxy_route(config, "example.com", "BROWSER")

    def test_same_priority_matching_rules_are_rejected_as_ambiguous(self):
        config = make_config()
        config["routing_rules"].append({
            "rule_id": "browser-example-duplicate",
            "priority": 100,
            "scopes": ["BROWSER"],
            "hosts": ["example.com"],
            "action": "BLOCK",
        })
        with self.assertRaisesRegex(ProxyPolicyError, "ROUTE_RULE_AMBIGUOUS"):
            resolve_proxy_route(config, "example.com", "BROWSER")

    def test_playwright_proxy_uses_vault_reference_and_keeps_credentials_out_of_server_url(self):
        profile = make_config()["proxy_profiles"][0]
        original = copy.deepcopy(profile)
        settings = build_playwright_proxy(
            profile,
            secret_resolver=lambda ref: {"username": "proxy-user", "password": "test-only-password"},
        )
        self.assertEqual(settings["server"], "https://proxy.example.net:8443")
        self.assertEqual(settings["username"], "proxy-user")
        self.assertEqual(settings["password"], "test-only-password")
        self.assertNotIn("@", settings["server"])
        self.assertEqual(profile, original)

    def test_authenticated_proxy_fails_closed_without_secret_resolver(self):
        profile = make_config()["proxy_profiles"][0]
        with self.assertRaisesRegex(ProxyPolicyError, "VAULT_RESOLVER_REQUIRED"):
            build_playwright_proxy(profile)

    def test_proxy_auth_secret_must_resolve_to_bounded_username_and_password(self):
        profile = make_config()["proxy_profiles"][0]
        with self.assertRaisesRegex(ProxyPolicyError, "PROXY_AUTH_SECRET_INVALID"):
            build_playwright_proxy(profile, secret_resolver=lambda _ref: {"username": "user"})

    def test_wireguard_requires_a_tunnel_adapter_not_a_fake_playwright_proxy(self):
        profile = make_config()["proxy_profiles"][0]
        profile["mode"] = "WIREGUARD"
        with self.assertRaisesRegex(ProxyPolicyError, "TUNNEL_ADAPTER_REQUIRED"):
            build_playwright_proxy(profile, secret_resolver=lambda _ref: {})


if __name__ == "__main__":
    unittest.main()
