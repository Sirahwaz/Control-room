# LearnHub bridge — MIDAD Neural++

## Scope
A thin outbound bridge from the existing AI Room to LearnHub. It preserves MIDAD's current Control Room, AI Room, Supabase functions, agent mesh, and browser operator. It does not copy LearnHub summaries or ingest third-party content.

## Available workflows
- Search LearnHub summaries: `?ai=learnhub_search`
- Start a rapid study plan: `?ai=learnhub_starter`
- Open a topic-specific AI deep dive using the entered topic.
- Language allowlist: AR, EN, FA, NL, DE, FR, ES, IT, TR, RU, HI.

## Security and behavior
- Destination origin is fixed to `https://alisol.ir/`; user input cannot override it.
- Topic input is trimmed and limited to 160 characters.
- Only topic and selected language are placed in the outbound URL.
- No MIDAD session token, Telegram init data, wallet data, secrets, or customer data is sent.
- Outbound-only: no Supabase writes, model invocation, agent execution, or financial actions.
- Popup-blocked behavior is reported honestly and a visible fallback link is provided.

## Verification
Run: `node --test tests/learnhub-bridge.test.mjs`

## License note
LearnHub declares CC BY-NC-SA 4.0. This integration links to LearnHub and does not copy its summaries. Future content ingestion or commercial reuse requires a separate license/compatibility review.
