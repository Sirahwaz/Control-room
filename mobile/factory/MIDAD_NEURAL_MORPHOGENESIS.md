# MIDAD Neural Morphogenesis — Architecture

## The differentiator

MIDAD Mobile introduces a Mission Capsule: a temporary, task-shaped workspace generated from a natural-language objective.

The user does not first choose a product, station, agent, or workflow. The user states the outcome.

Example: أريد زيادة الدخل من فرصة AI قابلة للتنفيذ

MIDAD converts that intent into:

OBJECTIVE → CAPABILITIES → ROUTES → ACTIONS → RISK GATE → CAPSULE

The visible result is a focused surface containing the most relevant stations and the next actions required to move the task forward.

## Why this is different from ordinary AI chat

A chat interface answers inside a conversation.

A Mission Capsule changes the operating surface itself:
- the capability graph identifies the task domain;
- adjacent capabilities are blended instead of using one classifier only;
- stations are ranked and physically reordered in the mobile workspace;
- actions are emitted as an explainable execution queue;
- risk is surfaced before the user enters a consequential domain;
- the capsule is stored locally for continuity.

This creates an adaptive application layer rather than another chatbot panel.

## Hybrid intelligence

The first layer is local and deterministic:
- zero network dependency for basic morphing;
- fast response;
- safe fallback registry;
- no client-side secrets.

The second layer is intentionally server-side:
- private model routing;
- evidence retrieval;
- user/session memory;
- deeper planning;
- opportunity scoring;
- domain-specific agents;
- policy and approval evaluation.

The client-side engine exposes an event boundary (midad:morph) so a future Neural Planner can enrich or replace the local plan without changing the Mobile shell.

## Safety model

Mission Capsules are navigation and planning surfaces, not privileged execution channels.

The engine emits:
- risk;
- approval_gate;
- explainability text;
- suggested routes.

A high-risk capsule is marked HUMAN_APPROVAL_REQUIRED. It does not grant an execution privilege to the APK.

## Factory model

Every future product can reuse the same shell and choose its own capability registry.

The Factory therefore evolves from:

template → build

to:

intent → product surface → validated build

The registry is data-driven so a specialized client app can ship a narrower capability graph without cloning MIDAD services.

