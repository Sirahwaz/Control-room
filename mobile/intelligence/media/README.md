# MIDAD Media Studio — Cost and Rights Gate

This package prepares media job plans. It does not call OpenArt or HeyGen and cannot generate or charge for an asset.

## Existing inputs
- Nine active reusable creative templates exist in `public.creative_templates`; they require original wording, scenes and calls to action.
- The active owner voice profile is Arabic, professional/confident, with no false certainty and no invented commitments.
- Current HeyGen workspace is on the Free plan. The connector reports both premium and add-on credit balances as `null`, with no verified speech unit quote; all HeyGen synthesis remains blocked until cost and quota are independently measurable.
- OpenArt workspace is on the Free plan with 25 credits (verified 2026-11-08). The live default catalog shows image options from 10 credits (Kling 3 Omni) and several 15-credit image modes; the cheapest available video mode is 50 credits (PixVerse V6), so no video mode is currently affordable.
- Provider prices and affordability are volatile. Always refresh the account balance and model catalog immediately before preparing a production job; these figures are a point-in-time snapshot, not hard-coded planner rules.

## Gate behavior
- Requires a production brief and explicit rights confirmation.
- Uses live provider catalog pricing supplied to the planner; never assumes a default cost.
- Keeps provider credit units separate from HeyGen quota units.
- Blocks when a quote/quota is unknown, when cost exceeds the budget, or when there is no affordable mode.
- Even a valid plan remains `PENDING_SPEND_APPROVAL` unless an explicit spend approval flag is provided.
- `executionAllowed` remains false; a separate caller must perform its own authorization and invoke the provider.

## Boundaries
No content was generated, no asset was uploaded, and no credits or speech quota were consumed by this change. Rights, voice likeness and provider terms remain explicit gates.
