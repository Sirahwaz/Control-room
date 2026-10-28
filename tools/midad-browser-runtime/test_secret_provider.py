"""Offline tests for host-scoped secret provider."""
import unittest
from secret_provider import EnvironmentSecretProvider, SecretBinding, SecretProviderError

class EnvironmentSecretProviderTests(unittest.TestCase):
    def test_resolves_only_exact_account_and_host_binding(self):
        provider = EnvironmentSecretProvider(
            [SecretBinding("work", "Example.com", "MIDAD_WORK_PASSWORD")],
            environ={"MIDAD_WORK_PASSWORD": "test-only-value"})
        self.assertEqual(provider.resolve("work", "example.com"), "test-only-value")

    def test_rejects_same_account_on_another_host(self):
        provider = EnvironmentSecretProvider(
            [SecretBinding("work", "example.com", "MIDAD_WORK_PASSWORD")],
            environ={"MIDAD_WORK_PASSWORD": "test-only-value"})
        with self.assertRaisesRegex(SecretProviderError, "NO_SECRET_BINDING"):
            provider.resolve("work", "evil.example")

    def test_rejects_unknown_account(self):
        provider = EnvironmentSecretProvider(
            [SecretBinding("work", "example.com", "MIDAD_WORK_PASSWORD")],
            environ={"MIDAD_WORK_PASSWORD": "test-only-value"})
        with self.assertRaisesRegex(SecretProviderError, "NO_SECRET_BINDING"):
            provider.resolve("other", "example.com")

    def test_missing_secret_has_generic_error(self):
        provider = EnvironmentSecretProvider(
            [SecretBinding("work", "example.com", "MIDAD_WORK_PASSWORD")], environ={})
        with self.assertRaisesRegex(SecretProviderError, "SECRET_NOT_CONFIGURED"):
            provider.resolve("work", "example.com")

    def test_rejects_non_midad_alias(self):
        with self.assertRaisesRegex(SecretProviderError, "INVALID_SECRET_BINDING"):
            EnvironmentSecretProvider([SecretBinding("work", "example.com", "PASSWORD")], environ={})

    def test_duplicate_binding_rejected(self):
        binding = SecretBinding("work", "example.com", "MIDAD_WORK_PASSWORD")
        with self.assertRaisesRegex(SecretProviderError, "DUPLICATE_SECRET_BINDING"):
            EnvironmentSecretProvider([binding, binding], environ={})

if __name__ == "__main__":
    unittest.main()
