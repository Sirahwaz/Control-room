# MIDAD Session Core v1 (foundation)

Provider-agnostic encrypted storage for reusable browser session profiles. This is deliberately a small security core, not a browser UI and not a replacement for the existing Browser Mesh worker.

## Current scope

- setup_login() accepts a user-driven setup_driver adapter. The adapter must complete the site's normal interactive login flow and return Playwright-compatible storage state. This core never accepts passwords or one-time login codes.
- Cookie and local-storage state is validated against exact HTTPS origins and an exact host allowlist.
- Profile data is encrypted at rest with AES-256-GCM. Profile metadata is authenticated as associated data; tampering or the wrong key fails closed.
- Local file permissions are restrictive (0700 profile directory, 0600 profile files). Writes are atomic and existing profiles are not overwritten by default.
- Short-lived HMAC-signed grants bind an agent to one profile, exact hosts, scopes and expiry.
- Agent-facing results are allowlisted and sanitized. Raw session state is passed only to the injected trusted runtime executor and is never returned from execute().
- read_only is the default capability. submit and publish require a trusted approval validator. financial actions are categorically disabled in this version.

## Not production-integrated yet

This branch is a tested library foundation only. It does NOT yet provide an interactive login screen, a mobile setup flow, a long-running job consumer, a shared multi-host session backend, a Supabase Vault/KMS adapter, or an integration that imports these profiles into tools/midad-browser-runtime. Do not deploy it to production or give it live platform sessions until those pieces are reviewed and integrated.

The current Browser Mesh Playwright worker remains public/read-only and uses a fresh context per job. This PR does not change that boundary, trigger jobs, publish anything, or touch payment/wallet flows.

## Install and test

Python 3.11+:

    python -m pip install -r tools/midad-session-core/requirements.txt
    cd tools/midad-session-core
    python -m unittest -v

The unit tests use temporary files and fake setup/execution adapters. They do not connect to real platforms, the network, Supabase or a wallet.

## Integration contract

1. A trusted control plane generates and protects two different 32-byte keys: the profile-encryption key and the grant-signing key. Supply them from a secret manager; never commit them or print them to logs. load_key_from_env() expects base64url encoding.
2. The setup adapter must keep the user in control of the login flow, wait for the user to finish any MFA/CAPTCHA challenge themselves, and return only the resulting storage state. It must not bypass access controls.
3. The runtime executor must re-check every requested URL, redirect, subresource and HTTP method against policy. Treat page content as untrusted data, not agent instructions.
4. The approval validator must read an authenticated, auditable approval record bound to the exact profile, agent and operation. A caller-supplied string alone is not approval.
5. For more than one worker host, replace the local file store with a transactional encrypted backing store and concurrency control; do not share a decryption key with untrusted agents.
6. Add revocation, rotation, audit events, session-expiry alerts, secret rotation, backup/restore tests and operational monitoring before any production use.

## Security boundaries

- Do not store passwords, recovery phrases, private keys, payment credentials, or raw page dumps in this core.
- Never let an agent mint its own grant or choose arbitrary scopes/hosts. GrantAuthority.issue() belongs in a trusted control plane.
- Never treat a page's “paid”, “success”, or “submitted” text as proof of payment. This core intentionally rewrites a returned PAID status to UNVERIFIED_PAYMENT_CLAIM.
- Financial actions, withdrawals, signatures and live transactions remain outside this implementation and disabled.
- Local encrypted files are not automatically backed up or shared across machines. Loss of a key makes the profile unrecoverable; key loss should fail closed.
