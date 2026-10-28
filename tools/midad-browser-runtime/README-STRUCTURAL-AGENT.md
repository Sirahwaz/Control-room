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
