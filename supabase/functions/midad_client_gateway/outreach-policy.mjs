const EMAIL_RE = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;
const LAWFUL_BASES = new Set(["consent", "existing_relationship", "legitimate_interest"]);
const clean = (value, max) => String(value ?? "").trim().slice(0, max);

export function normalizeOutreachRequest(input) {
  const p = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const channel = clean(p.channel, 24).toLowerCase();
  if (channel !== "agentmail") {
    return { ok: false, error: "outreach_channel_not_supported" };
  }

  const recipient = clean(p.recipient_email, 320).toLowerCase();
  if (!EMAIL_RE.test(recipient)) {
    return { ok: false, error: "outreach_recipient_invalid" };
  }

  const inboxId = clean(p.inbox_id, 240);
  if (!inboxId) return { ok: false, error: "outreach_inbox_required" };

  const subject = clean(p.subject, 500);
  const draft = clean(p.draft, 8000);
  if (!subject || !draft) return { ok: false, error: "outreach_subject_and_draft_required" };

  const sourceUrl = clean(p.source_url, 1200);
  let parsedUrl;
  try { parsedUrl = new URL(sourceUrl); } catch {
    return { ok: false, error: "outreach_source_url_invalid" };
  }
  if (parsedUrl.protocol !== "https:" || !parsedUrl.hostname || parsedUrl.username || parsedUrl.password) {
    return { ok: false, error: "outreach_source_url_invalid" };
  }

  const lawfulBasis = clean(p.lawful_basis, 40).toLowerCase();
  const basisEvidence = clean(p.basis_evidence, 1200);
  if (!LAWFUL_BASES.has(lawfulBasis) || basisEvidence.length < 20) {
    return { ok: false, error: "outreach_contact_basis_evidence_required" };
  }
  if (p.suppression_checked !== true) {
    return { ok: false, error: "outreach_suppression_check_required" };
  }

  return {
    ok: true,
    value: {
      channel,
      recipient_email: recipient,
      recipient_name: clean(p.recipient_name, 160) || null,
      inbox_id: inboxId,
      subject,
      draft,
      source_url: parsedUrl.toString(),
      lawful_basis: lawfulBasis,
      basis_evidence: basisEvidence,
      suppression_checked: true,
      campaign_ref: clean(p.campaign_ref, 120) || null,
    },
  };
}

export async function buildOutreachKey(userId, recipientEmail, sourceUrl, campaignRef = "") {
  const material = [userId, String(recipientEmail).toLowerCase(), sourceUrl, campaignRef].join("\\n");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(material));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
