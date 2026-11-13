import { normalizeOutreachRequest, buildOutreachKey } from "./outreach-policy.mjs";

export async function prepareOutreach(admin: any, userId: string, p: any, deps: {
  getOrCreateClient: (admin: any, userId: string, payload: any) => Promise<any>;
  getOrCreateConversation: (admin: any, userId: string, clientId: string, payload: any) => Promise<any>;
  audit: (admin: any, userId: string, payload: any) => Promise<void>;
}) {
  const validation = normalizeOutreachRequest(p);
  if (!validation.ok) return validation;
  const request: any = (validation as any).value;
  const outreachKey = await buildOutreachKey(userId, request.recipient_email, request.source_url, request.campaign_ref || "");
  const threadId = "midad-outreach:" + outreachKey;

  const client = await deps.getOrCreateClient(admin, userId, {
    external_customer_ref: request.recipient_email,
    client_name: request.recipient_name || request.recipient_email,
    contact: request.recipient_email,
    channel: "agentmail",
    language: "unknown",
  });
  const convo = await deps.getOrCreateConversation(admin, userId, client.id, {
    channel: "agentmail",
    external_thread_id: threadId,
    inbox_id: request.inbox_id,
    topic: request.subject,
    language: "unknown",
  });

  const metadata = {
    ...(convo.metadata || {}),
    provider: "agentmail",
    inbox_id: request.inbox_id,
    outreach_key: outreachKey,
    outreach_source_url: request.source_url,
    outreach_lawful_basis: request.lawful_basis,
    outreach_basis_evidence: request.basis_evidence,
    suppression_checked: true,
  };
  const { error: conversationUpdateError } = await admin.from("midad_conversations")
    .update({ metadata, human_approval_required: true, risk_class: "medium" })
    .eq("id", convo.id).eq("user_id", userId);
  if (conversationUpdateError) throw new Error("outreach_conversation_update_failed");

  const { data: priorApproval, error: priorApprovalError } = await admin.from("midad_approvals")
    .select("id,status,expires_at").eq("user_id", userId).eq("subject_id", convo.id)
    .eq("action", "send_client_reply").contains("evidence", { outreach_key: outreachKey })
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (priorApprovalError) throw new Error("outreach_idempotency_lookup_failed");
  if (priorApproval) {
    return { ok: true, mode: "duplicate", conversation_id: convo.id, client_id: client.id,
      approval_id: priorApproval.id, approval_status: priorApproval.status };
  }

  const { data: priorMessage, error: priorMessageError } = await admin.from("midad_messages")
    .select("id").eq("user_id", userId).eq("conversation_id", convo.id)
    .eq("direction", "out").contains("metadata", { outreach_key: outreachKey })
    .limit(1).maybeSingle();
  if (priorMessageError) throw new Error("outreach_message_lookup_failed");
  if (!priorMessage) {
    const { error: messageError } = await admin.from("midad_messages").insert({
      user_id: userId, conversation_id: convo.id,
      external_message_id: "midad-outreach-" + outreachKey,
      direction: "out", sender_role: "agent", intent: "outreach",
      ai_draft: request.draft, final_text: null, approval_status: "pending", confidence: 1,
      metadata: {
        agent: "midad_outreach_dispatcher_v1", outreach_key: outreachKey,
        source_url: request.source_url, lawful_basis: request.lawful_basis,
        basis_evidence: request.basis_evidence, suppression_checked: true,
      },
    });
    if (messageError) throw new Error("outreach_draft_persist_failed");
  }

  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const evidence = {
    client_id: client.id, conversation_id: convo.id, draft: request.draft,
    intent: "outreach", confidence: 1, outreach_key: outreachKey,
    source_url: request.source_url, lawful_basis: request.lawful_basis,
    basis_evidence: request.basis_evidence, suppression_checked: true,
    recipient_email: request.recipient_email,
  };
  const { data: approval, error: approvalError } = await admin.from("midad_approvals").insert({
    user_id: userId, subject_type: "client_message", subject_id: convo.id,
    action: "send_client_reply", risk_class: "medium",
    reason: "Owner approval required before first-contact outreach",
    evidence, expires_at: expiresAt,
  }).select("id,status,expires_at").single();

  if (approvalError || !approval) {
    const { data: concurrent } = await admin.from("midad_approvals")
      .select("id,status,expires_at").eq("user_id", userId).eq("subject_id", convo.id)
      .eq("action", "send_client_reply").contains("evidence", { outreach_key: outreachKey })
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (concurrent) {
      return { ok: true, mode: "duplicate", conversation_id: convo.id, client_id: client.id,
        approval_id: concurrent.id, approval_status: concurrent.status };
    }
    throw new Error("outreach_approval_create_failed");
  }

  await deps.audit(admin, userId, {
    event_type: "approval_created", actor_type: "agent", action: "prepare_first_contact_outreach",
    subject_type: "client_message", subject_id: convo.id, status: "pending", risk_class: "medium",
    summary: "تم تجهيز مسودة تواصل أولي؛ الإرسال متوقف حتى موافقة المالك.",
    details: { approval_id: approval.id, outreach_key: outreachKey,
      lawful_basis: request.lawful_basis, source_url: request.source_url },
  });
  return { ok: true, mode: "approval_required", conversation_id: convo.id, client_id: client.id,
    approval_id: approval.id, expires_at: approval.expires_at, delivery_started: false };
}
