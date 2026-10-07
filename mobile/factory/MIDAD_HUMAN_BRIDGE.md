# MIDAD Human Bridge — Architecture v1

## Purpose

MIDAD Human Bridge is the human-intervention surface of MIDAD: a mobile Android application that receives human-gated tasks from MIDAD Core, opens the relevant platform page in a managed WebView, helps with safe deterministic browser work, and reports completion back to the originating agent.

## Runtime contract

MIDAD Core → Human Task → Human Bridge → Managed WebView → Human Checkpoint → Resume → MIDAD Core

The bridge is not a privileged finance surface.

## Core capabilities

- Human Task Inbox with priority, risk, reason, evidence, agent and target URL.
- One-time device pairing followed by a revocable 30-day bridge session.
- Managed browser WebView with persistent site data isolated from the MIDAD application layer.
- URL navigation events and DOM Page Inspector.
- Safe Autofill of general profile fields only.
- Local notification when a newly detected human task arrives while the app is active.
- Public wallet/address finder from MIDAD's registered public wallet registry.
- Connector visibility and future connection-request surface.
- Local event log for explainability and recovery.

## Security boundary

Never store or request:
- Supabase service-role keys;
- exchange API secrets;
- bot tokens;
- private keys or seed phrases;
- passwords;
- OTP/2FA codes.

The APK is a client surface. Server-side privileged actions remain behind MIDAD Core.

## Human checkpoints

The following always remain human-gated:
- CAPTCHA / anti-bot challenges;
- KYC and identity assertions;
- 2FA / OTP;
- legal acceptance;
- external signature prompts;
- irreversible finance actions.

The bridge may detect these states and present the page to the user. It does not solve or bypass them.

## Agentic browser worker

The first worker is intentionally deterministic:
1. inspect page;
2. identify safe inputs;
3. optionally fill safe profile values;
4. never submit;
5. capture evidence;
6. escalate when a human checkpoint appears.

A later native browser worker can add richer action planning without changing the Human Bridge API contract.

## Provider portability

The app surface is provider-neutral. The managed WebView currently uses @capgo/capacitor-inappbrowser because its current v8 line supports Capacitor 8 and exposes WebView messaging, JavaScript execution, URL change events, and runtime browser control. A different provider can be introduced behind the same MIDAD Human Bridge contract.

## Wallet and connector layer

The first release is read-only:
- search registered public receiving addresses;
- inspect wallet connector capabilities;
- start a future human-gated connection flow.

Adding a wallet or exchange never grants unrestricted signing authority to the APK.

## Recovery

Every task has a stable task ID and the server keeps the current browser job state. The app should reopen the current task rather than restart the original workflow.

## Factory

Product key: midad-human-bridge
App ID: ai.midad.human.bridge

The Factory builds this product from the same MIDAD Mobile shell and does not clone backend services.
