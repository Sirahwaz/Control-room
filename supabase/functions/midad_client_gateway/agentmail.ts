import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { Webhook } from "npm:svix@1.76.1";

const API_BASE = "https://api.agentmail.to/v0";
const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: JSON_HEADERS });
const clip = (value: unknown, max = 4000) => String(value ?? "").trim().slice(0, max);

type AgentMailEvent = {
  type?: string;
  event_type?: string;
  event_id?: string;
  message?: Record<string, unknown>;
  thread?: Record<string, unknown>;
};

export function normalizeReceivedEvent(event: AgentMailEvent) {
  const message = event.message || {};
  const labels = Array.isArray(message.labels) ? message.labels.map(String) : [];
  const eventType = clip(event.event_type, 100);
  const armor = message.agent_armor as Record<string, unknown> | undefined;
  const text = clip(message.extracted_text || message.text || message.preview, 12000);
  return {
    accepted: event.type === "event" &&
      eventType === "message.received" &&
      Boolean(clip(event.event_id, 240)) &&
      Boolean(clip(message.message_id, 240)) &&
      Boolean(clip(message.inbox_id, 240)) &&
      !labels.some((label) => ["spam", "blocked", "unauthenticated"].includes(label.toLowerCase())) &&
      (!armor || (armor.status === "complete" && armor.verdict === "clear")),
    event_id: clip(event.event_id, 240),
    message_id: clip(message.message_id, 240),
    inbox_id: clip(message.inbox_id, 240),
    thread_id: clip(message.thread_id || event.thread?.thread_id, 240),
    from: clip(message.from, 320),
    subject: clip(message.subject, 500),
    text,
    body_url_present: Boolean(message.body_url),
    labels,
    armor_status: clip(armor?.status, 40) || "not_available",
    created_at: clip(message.created_at || message.timestamp, 80),
  };
}

function headerRecord(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((value, key) => { result[key] = value; });
  return result;
}

function verifyWebhook(req: Request, rawBody: string): AgentMailEvent | null {
  const secret = Deno.env.get("AGENTMAIL_WEBHOOK_SECRET") || "";
  if (!secret) return null;
  try {
    const verified = new Webhook(secret).verify(rawBody, headerRecord(req.headers));
    return verified as AgentMailEvent;
  } catch {
    return null;
  }
}

function hasAdminAccess(req: Request): boolean {
  const expected = Deno.env.get("MIDAD_AGENTMAIL_ADMIN_KEY") || "";
  const supplied = req.headers.get("x-midad-agentmail-admin-key") || "";
  return Boolean(expected && supplied && supplied === expected);
}

async function agentMailRequest(path: string, method: string, body?: unknown, idempotencyKey?: string) {
  const apiKey = Deno.env.get("AGENTMAIL_API_KEY") || "";
  if (!apiKey) throw new Error("agentmail_api_key_missing");
  const headers: Record<string, string> = {
    authorization: "Bearer " + apiKey,
    "content-type": "application/json",
  };
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  const response = await fetch(API_BASE + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error("agentmail_api_error");
    (error as Error & { status?: number; detail?: unknown }).status = response.status;
    (error as Error & { status?: number; detail?: unknown }).detail = payload;
    throw error;
  }
  return payload;
}

async function processInbound(event: AgentMailEvent) {
  const incoming = event.message || {};
  const needsAuthenticatedFetch = event.event_type === "message.security.completed" ||
    (event.event_type === "message.received" && Boolean(incoming.body_url) &&
      !incoming.extracted_text && !incoming.text);
  if (needsAuthenticatedFetch) {
    const inboxId = clip(incoming.inbox_id, 240);
    const messageId = clip(incoming.message_id, 240);
    if (!inboxId || !messageId) return { ok: true, ignored: true, reason: "message_identifiers_missing" };
    const fullMessage = await agentMailRequest(
      "/inboxes/" + encodeURIComponent(inboxId) + "/messages/" + encodeURIComponent(messageId),
      "GET",
    );
    event = { ...event, event_type: "message.received", message: fullMessage as Record<string, unknown> };
  }
  const normalized = normalizeReceivedEvent(event);
  if (!normalized.accepted) return { ok: true, ignored: true, reason: "event_not_eligible" };

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const ingestKey = Deno.env.get("MIDAD_INGEST_KEY") || "";
  if (!supabaseUrl || !serviceRoleKey || !ingestKey) throw new Error("midad_gateway_secrets_missing");

  const admin = createClient(supabaseUrl, serviceRoleKey);
  const eventRow = {
    event_id: normalized.event_id,
    event_type: "message.received",
    inbox_id: normalized.inbox_id,
    message_id: normalized.message_id,
    thread_id: normalized.thread_id || null,
    status: "processing",
    metadata: {
      labels: normalized.labels,
      armor_status: normalized.armor_status,
      body_url_present: normalized.body_url_present,
      created_at: normalized.created_at || null,
    },
  };

  const { error: insertError } = await admin.from("midad_agentmail_events").insert(eventRow);
  if (insertError?.code === "23505") {
    const { data: prior, error: readError } = await admin.from("midad_agentmail_events")
      .select("status,locked_at").eq("event_id", normalized.event_id).maybeSingle();
    if (readError) throw new Error("agentmail_event_dedupe_read_failed");
    if (prior?.status === "processed") {
      return { ok: true, duplicate: true, event_id: normalized.event_id };
    }
    const staleBefore = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    if (prior?.status === "processing" && prior.locked_at && prior.locked_at > staleBefore) {
      return { ok: true, duplicate: true, event_id: normalized.event_id };
    }
    let claim = admin.from("midad_agentmail_events")
      .update({ status: "processing", locked_at: new Date().toISOString(), last_error: null })
      .eq("event_id", normalized.event_id);
    claim = prior?.status === "processing"
      ? claim.eq("status", "processing").lt("locked_at", staleBefore)
      : claim.in("status", ["failed", "received"]);
    const { data: claimed, error: claimError } = await claim.select("event_id").maybeSingle();
    if (claimError || !claimed) return { ok: true, duplicate: true, event_id: normalized.event_id };
  } else if (insertError) {
    throw new Error("agentmail_event_persist_failed");
  }

  try {
    const text = normalized.text || (normalized.body_url_present
      ? "[Email body omitted by AgentMail webhook; retrieve via the authenticated message API]"
      : "[Email contained no extracted plain-text body]");
    const senderMatch = normalized.from.match(/<([^<>]+)>/);
    const senderEmail = String(senderMatch?.[1] || normalized.from).trim().toLowerCase();
    const response = await fetch(supabaseUrl + "/functions/v1/midad_client_gateway", {
      method: "POST",
      headers: {
        authorization: "Bearer " + serviceRoleKey,
        "content-type": "application/json",
        "x-midad-ingest-key": ingestKey,
      },
      body: JSON.stringify({
        action: "client_message",
        channel: "agentmail",
        external_message_id: normalized.message_id,
        external_thread_id: normalized.thread_id,
        inbox_id: normalized.inbox_id,
        external_customer_ref: senderEmail,
        client_name: normalized.from,
        contact: normalized.from,
        topic: normalized.subject,
        text,
        language: "unknown",
        metadata: {
          provider: "agentmail",
          event_id: normalized.event_id,
          inbox_id: normalized.inbox_id,
          labels: normalized.labels,
          armor_status: normalized.armor_status,
        },
      }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result?.ok === false) throw new Error("midad_client_gateway_rejected");
    const { error: finishError } = await admin.from("midad_agentmail_events")
      .update({ status: "processed", processed_at: new Date().toISOString(), last_error: null })
      .eq("event_id", normalized.event_id);
    if (finishError) throw new Error("agentmail_event_finish_failed");
    return { ok: true, processed: true, event_id: normalized.event_id, conversation: result };
  } catch (error) {
    await admin.from("midad_agentmail_events")
      .update({ status: "failed", last_error: clip(error, 500) })
      .eq("event_id", normalized.event_id);
    throw error;
  }
}

export async function handleAgentMailRequest(req: Request) {
  const url = new URL(req.url);
  if (req.method === "GET" && url.pathname.endsWith("/health")) {
    return json({
      ok: true,
      service: "midad_agentmail_gateway",
      region: "us",
      provider_api: "https://api.agentmail.to",
      configured: {
        api_key: Boolean(Deno.env.get("AGENTMAIL_API_KEY")),
        webhook_secret: Boolean(Deno.env.get("AGENTMAIL_WEBHOOK_SECRET")),
        admin_key: Boolean(Deno.env.get("MIDAD_AGENTMAIL_ADMIN_KEY")),
      },
    });
  }

  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  if (url.pathname.endsWith("/webhook")) {
    const rawBody = await req.text();
    const event = verifyWebhook(req, rawBody);
    if (!event) return json({ ok: false, error: "invalid_webhook_signature" }, 401);
    try {
      if (!["message.received", "message.security.completed"].includes(String(event.event_type))) {
        return json({ ok: true, ignored: true, reason: "unsupported_event_type" }, 202);
      }
      const result = await processInbound(event);
      return json(result, 202);
    } catch {
      return json({ ok: false, error: "inbound_processing_failed" }, 503);
    }
  }

  if (url.pathname.endsWith("/inboxes")) {
    if (!hasAdminAccess(req)) return json({ ok: false, error: "unauthorized" }, 401);
    const body = await req.json().catch(() => ({}));
    const clientId = clip(body.client_id, 120);
    if (!clientId || clientId.includes("@")) return json({ ok: false, error: "valid_client_id_required" }, 400);
    try {
      const inbox = await agentMailRequest("/inboxes", "POST", {
        client_id: clientId,
        username: clip(body.username, 64) || undefined,
        display_name: clip(body.display_name, 120) || "MIDAD Agent",
        metadata: { system: "midad-ai", region: "us" },
      });
      return json({ ok: true, inbox }, 201);
    } catch (error) {
      const status = (error as Error & { status?: number }).status || 502;
      return json({ ok: false, error: "agentmail_inbox_create_failed", status }, status >= 400 && status < 600 ? status : 502);
    }
  }

  if (url.pathname.endsWith("/webhooks")) {
    if (!hasAdminAccess(req)) return json({ ok: false, error: "unauthorized" }, 401);
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    if (!supabaseUrl) return json({ ok: false, error: "supabase_url_missing" }, 503);
    const webhookUrl = supabaseUrl.replace(/\/$/, "") + "/functions/v1/midad_client_gateway/agentmail/webhook";
    try {
      const webhook = await agentMailRequest("/webhooks", "POST", {
        client_id: "midad-agentmail-us-webhook-v1",
        url: webhookUrl,
        event_types: ["message.received", "message.security.completed"],
      });
      return json({
        ok: true,
        webhook_id: webhook.webhook_id,
        url: webhook.url,
        secret: webhook.secret,
        event_types: webhook.event_types,
        note: "Store the returned signing secret as AGENTMAIL_WEBHOOK_SECRET in Supabase Edge Function Secrets. It is not persisted by this function.",
      }, 201);
    } catch (error) {
      const status = (error as Error & { status?: number }).status || 502;
      return json({ ok: false, error: "agentmail_webhook_create_failed", status }, status >= 400 && status < 600 ? status : 502);
    }
  }

  return json({ ok: false, error: "not_found" }, 404);
}
