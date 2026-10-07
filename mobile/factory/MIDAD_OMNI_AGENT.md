# MIDAD Omni Agent

## Position
A **new standalone mobile product** created through MIDAD Mobile Factory. It is not an add-on to MIDAD Human Bridge.

## Core architecture
**User Intent → Hybrid Agent Kernel → Policy Judge → Provider Router → Native/Browser/Knowledge/Media Tool → Human Gate if required → Resume → Evidence**

### Intelligence fabric
1. **Native Agent Engine** — local task state, allowlisted browser operations, retry/recovery and offline-safe queue.
2. **Cloud Reasoning Gateway** — Gemini via MIDAD server-side gateway. Current Gemini documentation identifies the Interactions API as the default interface for new projects and supports function calling and multimodal responses. cite not embedded in repo docs
3. **Gemini Notebook Bridge** — official NotebookLM/Gemini Notebook handoff for source-grounded research; optional Gemini Notebook Enterprise API integration can be enabled later.
4. **Multimodal Studio** — phone image input + server-side Gemini image generation/editing.
5. **Automation Recipe Fabric** — generate structured, reviewable, allowlisted recipes rather than arbitrary code execution.
6. **Provider Router** — MIDAD Native is primary; Gemini/Gemini Notebook specialize by capability; TinyFish is fallback only.
7. **Extension Fabric** — platform adapters are capability descriptors, not credential containers.
8. **Human Gate Bus** — CAPTCHA/KYC/2FA/signatures and other identity/auth checkpoints remain human-controlled.
9. **Trust Boundary UI** — continuously shows what MIDAD can/cannot do.

## Phone files
The APK exposes the Android system file picker through the app's file input surface. Images can be selected from the device and passed to the MIDAD AI gateway. The app does not require private keys or service secrets.

## Notebook strategy
The consumer Gemini Notebook product is exposed through a secure browser handoff. Where a Google Cloud environment supports Gemini Notebook Enterprise, MIDAD can add the documented notebook APIs (create/get/list/delete/share and source management) behind the server-side gateway. This keeps Google credentials out of the APK.

## TinyFish
Retained as a provider fallback. It must never become a hard dependency of this product.

## Safety
The app does not bypass CAPTCHA, KYC, 2FA, access controls or identity verification. It can inspect state, prepare data, open the official page and request a Human Gate. Financial live execution stays locked at this product layer.

## Factory separation
Product key: `midad-omni-agent`
App ID: `ai.midad.omni.agent`
Artifact: `MIDAD-Omni-Agent-v0.1.0`
