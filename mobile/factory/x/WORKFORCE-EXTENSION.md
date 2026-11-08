# Neural++ Workforce Registry Extension

This change adds three **Factory X role templates**, not deployed autonomous workers.

- `wallet-behavior-agent`: public on-chain transaction feature extraction and paper backtesting only. It does not connect signing wallets, submit orders, or mirror transactions.
- `offer-negotiation-agent`: prepares non-binding offer/negotiation drafts. Pricing exceptions, legal commitments, scope changes, and high-value commitments remain human-gated.
- `media-production-agent`: orchestrates voice/audio/video/creative assets through provider adapters. Cost and rights evidence must be included; provider calls remain subject to budget and user brief.

The existing `max_parallel_agents: 32` cap is unchanged. No Supabase Agent Identity, capability row, service route, Edge Function, or runtime worker is activated by this registry update.
