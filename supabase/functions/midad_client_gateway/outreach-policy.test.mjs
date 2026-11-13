import { normalizeOutreachRequest, buildOutreachKey } from "./outreach-policy.mjs";

Deno.test("accepts one evidence-backed AgentMail outreach draft", () => {
  const result = normalizeOutreachRequest({
    channel: "agentmail",
    recipient_email: "buyer@example.com",
    recipient_name: "Buyer",
    inbox_id: "midad-inbox",
    subject: "A relevant proposal",
    draft: "Hello, I noticed your published request and can help.",
    source_url: "https://example.com/request",
    lawful_basis: "consent",
    basis_evidence: "The recipient requested contact through the public form.",
    suppression_checked: true,
  });
  if (!result.ok || result.value.recipient_email !== "buyer@example.com") {
    throw new Error("valid outreach request was rejected");
  }
});

Deno.test("rejects malformed recipient addresses", () => {
  const result = normalizeOutreachRequest({
    channel: "agentmail", recipient_email: "not-an-email",
    inbox_id: "inbox", subject: "Hello", draft: "Hello",
    source_url: "https://example.com", lawful_basis: "consent",
    basis_evidence: "Recipient requested contact.", suppression_checked: true,
  });
  if (result.ok || result.error !== "outreach_recipient_invalid") {
    throw new Error("invalid recipient must be rejected");
  }
});

Deno.test("requires an HTTPS source and evidence of the contact basis", () => {
  for (const patch of [
    { source_url: "http://example.com/request" },
    { basis_evidence: "" },
    { lawful_basis: "unknown" },
  ]) {
    const result = normalizeOutreachRequest({
      channel: "agentmail", recipient_email: "buyer@example.com",
      inbox_id: "inbox", subject: "Hello", draft: "Hello",
      source_url: "https://example.com/request", lawful_basis: "consent",
      basis_evidence: "Recipient requested contact.", suppression_checked: true,
      ...patch,
    });
    if (result.ok) throw new Error("incomplete evidence must be rejected");
  }
});

Deno.test("requires suppression screening before a draft is queued", () => {
  const result = normalizeOutreachRequest({
    channel: "agentmail", recipient_email: "buyer@example.com",
    inbox_id: "inbox", subject: "Hello", draft: "Hello",
    source_url: "https://example.com/request", lawful_basis: "legitimate_interest",
    basis_evidence: "Documented relevance and balancing assessment.",
    suppression_checked: false,
  });
  if (result.ok || result.error !== "outreach_suppression_check_required") {
    throw new Error("unscreened contact must be blocked");
  }
});

Deno.test("blocks first-contact Telegram messages", () => {
  const result = normalizeOutreachRequest({
    channel: "telegram", recipient_email: "buyer@example.com",
    inbox_id: "inbox", subject: "Hello", draft: "Hello",
    source_url: "https://example.com/request", lawful_basis: "consent",
    basis_evidence: "Recipient requested contact.", suppression_checked: true,
  });
  if (result.ok || result.error !== "outreach_channel_not_supported") {
    throw new Error("Telegram first-contact must be blocked");
  }
});

Deno.test("outreach idempotency key is stable and campaign-scoped", async () => {
  const first = await buildOutreachKey("owner-1", "buyer@example.com", "https://example.com/request", "campaign-a");
  const repeat = await buildOutreachKey("owner-1", "buyer@example.com", "https://example.com/request", "campaign-a");
  const otherCampaign = await buildOutreachKey("owner-1", "buyer@example.com", "https://example.com/request", "campaign-b");
  if (first !== repeat || first === otherCampaign || first.length !== 64) {
    throw new Error("outreach idempotency key is not stable and scoped");
  }
});
