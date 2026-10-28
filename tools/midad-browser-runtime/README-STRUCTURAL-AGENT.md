# MIDAD Structural Browser Agent (foundation)

This layer adds deterministic task decomposition and account metadata to the isolated Playwright runtime. It is an extensible foundation, not a claim of fully autonomous general intelligence.

## Account metadata and secrets

- Keep account metadata in a reviewed profile file: account alias, exact hostname, username, login URL, selectors, and a reference such as `MIDAD_EXAMPLE_COM_PASSWORD`.
- The reference is an alias, never the actual password. Store real secrets only in an approved secret manager or protected CI environment secret. Never commit passwords, cookies, refresh tokens, MFA seeds, or browser storage state.
- Restrict secret access to trusted branches and workflows. Never echo secrets into logs or command-line arguments.
- Each profile must use an exact hostname already approved by the operator. Redirects to other hosts remain blocked.
- Prefer dedicated low-privilege accounts. CAPTCHA, MFA and anti-bot controls must be completed through legitimate supported flows, not bypassed.

## Structural planning

`agent_policy.make_plan` starts by observing current state, optionally identifies a login step, then verifies a postcondition. Site adapters should use accessible labels and explicit success conditions. Page content is untrusted data, never instructions to the agent. If selectors fail, re-observe and produce sanitized diagnostics rather than blindly repeating the same action.

## Automatic vs. gated actions

Inspection, navigation and reading are permitted only on exact allowlisted hosts. Generic form filling and clicking are gated until a task-specific adapter defines allowed controls and a verifiable outcome. Submissions, downloads, deletion, payments, withdrawals and signing remain disabled. Authenticated access does not imply permission to perform financial actions.

## Run tests

```sh
cd tools/midad-browser-runtime
python -m unittest -v test_runner.py test_public_target_probe.py test_agent_policy.py
```


## Host-scoped secret provider

`secret_provider.EnvironmentSecretProvider` maps the tuple `(account_id, exact_host)` to a named environment-secret alias. It returns a secret only when both account and host match; unknown bindings, duplicate mappings, invalid aliases, and missing values fail closed. The provider stores no secret values and has no disk/database persistence.

Example wiring (use a protected CI environment secret or deployment secret manager; never commit the value):

```python
from secret_provider import EnvironmentSecretProvider, SecretBinding

provider = EnvironmentSecretProvider([
    SecretBinding("work-account", "example.com", "MIDAD_WORK_ACCOUNT_SECRET")
])
# Keep returned values in memory only; never log or serialize them.
secret_value = provider.resolve("work-account", "example.com")
```

The profile JSON stores only the alias. Configure real values in repository/environment Secrets with branch/environment restrictions. Do not put credentials in workflow inputs. This provider is a local adapter for secrets injected by the host environment; it is not itself a remote vault or encrypted persistent database.
