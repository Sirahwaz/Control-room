# MIDAD Media Studio — Cost and Rights Gate

This package prepares media job plans. It does not call OpenArt or HeyGen and cannot generate or charge for an asset.

## Existing inputs
- Nine active reusable creative templates exist in `public.creative_templates`; they require original wording, scenes and calls to action.
- The active owner voice profile is Arabic, professional/confident, with no false certainty and no invented commitments.
- Public Arabic HeyGen voices are available in the catalog. Their remaining quota and per-request cost were not exposed by the connector in this audit.
- OpenArt account balance observed 2026-11-08: 25 credits. Current catalog showed image options from 15 credits, but no video mode affordable at this balance; the cheapest video mode listed was 50 credits.

## Gate behavior
- Requires a production brief and explicit rights confirmation.
- Uses live provider catalog pricing supplied to the planner; never assumes a default cost.
- Keeps provider credit units separate from HeyGen quota units.
- Blocks when a quote/quota is unknown, when cost exceeds the budget, or when there is no affordable mode.
- Even a valid plan remains `PENDING_SPEND_APPROVAL` unless an explicit spend approval flag is provided.
- `executionAllowed` remains false; a separate caller must perform its own authorization and invoke the provider.

## Boundaries
No content was generated, no asset was uploaded, and no credits or speech quota were consumed by this change. Rights, voice likeness and provider terms remain explicit gates.
