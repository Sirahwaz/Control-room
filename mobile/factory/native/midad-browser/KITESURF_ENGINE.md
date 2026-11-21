# MIDAD Kitesurf Engine Adapter (experimental)

This module adds policy-level engine selection for Cloudflare Kitesurf without shipping,
deploying, or claiming a live Kitesurf worker.

- Native WebView is the default engine and fallback.
- Remote Kitesurf is opt-in per request via explicit consent.
- Private/sensitive classification and URL hints force local execution.
- Remote execution requires an injected client and an explicit feature enablement.
- Worker deployment, authentication, cost controls, response schema validation, and
  end-to-end rendering remain separate integration gates.

Source: https://github.com/cloudflare/kitesurf
