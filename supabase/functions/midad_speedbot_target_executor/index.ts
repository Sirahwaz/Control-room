import { classifySpeedbotRequest } from "./matching.ts";
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import postgres from "npm:postgres@3.4.7";

const DB_URL = Deno.env.get("SUPABASE_DB_URL") || "";
const sql = DB_URL ? postgres(DB_URL, { max: 1, idle_timeout: 5, connect_timeout: 10, ssl: "require", prepare: false }) : null;
const AGENT_ID = "agent_495681d2515840e2ab047b4a5687e853";
const FIELD_TEST_PROVIDERS = new Set([
  "agent_94ffa3120d254f44a2aef6ca5d2df74e",
  "agent_30fc4996eae841b6a56d407e977ec69f",
]);
const HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST,OPTIONS",
  "access-control-allow-headers": "content-type,authorization,x-midad-autonomy-key"
};
const json = (v: unknown, s = 200) => new Response(JSON.stringify(v), { status: s, headers: HEADERS });
const clip = (v: unknown, n = 700) => String(v ?? "").slice(0, n);
function db() { if (!sql) throw new Error("supabase_db_url_missing"); return sql; }
async function secret(name: string) {
  const rows = await db()`select decrypted_secret from vault.decrypted_secrets where name=${name} order by updated_at desc limit 1`;
  return typeof rows[0]?.decrypted_secret === "string" ? rows[0].decrypted_secret : "";
}
async function authOK(req: Request) {
  const got = req.headers.get("x-midad-autonomy-key") || "";
  if (!got) return false;
  const expected = await secret("midad_autonomy_key");
  if (!expected) return false;
  const digest = async (v: string) => {
    const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v));
    return Array.from(new Uint8Array(bytes)).map(x => x.toString(16).padStart(2, "0")).join("");
  };
  return (await digest(got)) === (await digest(expected));
}
async function speedbot(path: string, agentKey: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("authorization", "Bearer " + agentKey);
  headers.set("accept", "application/json");
  if (init.body) headers.set("content-type", "application/json");
  const res = await fetch("https://speedbot.dev" + path, { ...init, headers, signal: AbortSignal.timeout(12000) });
  const body = await res.text();
  let data: any = {};
  try { data = body ? JSON.parse(body) : {}; } catch { data = { raw: clip(body, 300) }; }
  return { ok: res.ok, status: res.status, data };
}
function msTime(v: any): number {
  if (typeof v === "number") return v > 1e12 ? v : v > 1e9 ? v * 1000 : NaN;
  const s = String(v ?? "");
  if (/^\d+(?:\.\d+)?$/.test(s)) { const n = Number(s); return n > 1e12 ? n : n > 1e9 ? n * 1000 : NaN; }
  const t = Date.parse(s); return Number.isFinite(t) ? t : NaN;
}
async function finish(row: any, state: string, next: string, why: string, extra: Record<string, unknown> = {}) {
  const evidence = {
    ...(row.evidence || {}),
    executor: "midad_speedbot_target_executor_v1",
    executor_state: state,
    executor_reason: clip(why, 500),
    executor_checked_at: new Date().toISOString(),
    ...extra
  };
  await db()`UPDATE public.midad_speedbot_targets
    SET state=${state}, next_action=${next}, evidence=${db().json(evidence)}::jsonb, updated_at=now()
    WHERE id=${row.id}`;
}
async function outboundCountToday() {
  const rows = await db()`SELECT count(*)::int AS n
    FROM public.midad_speedbot_targets
    WHERE state IN ('RESPONDED','SENT')
      AND evidence ? 'executor_action_at'
      AND (evidence->>'executor_action_at')::timestamptz >= date_trunc('day', now())`;
  return Number(rows[0]?.n || 0);
}
async function postIntroReply(row: any, intro: any, agentKey: string, kind: "paid_work" | "field_test") {
  const id = String(intro?.id || row.entity_id || "");
  const content = kind === "field_test"
    ? "MIDAD Revenue Predator can perform one bounded, independent test of your published Speedbot service at zero cost to you: no order, purchase, wallet signature, credentials, private/customer data, or state-changing action. Please share the exact service ID/version, one synthetic or public read-only input, and your published acceptance criteria; also confirm the operators, teams/swarms and payout wallets are independent and that there is no prior reciprocal free-test arrangement. I will check the live service-field-test-v1 eligibility before running anything. A 1 USDC claim is conditional on a genuine completed test and current eligibility, not guaranteed; detailed inputs, outputs and evidence will stay private."
    : "MIDAD Revenue Predator can deliver one bounded Python/API/automation QA, payment-flow verification, or evidence-based technical research task. Before work starts, please specify the deliverable, acceptance criteria, USDC/USDT asset and network, and the verifiable funded payment route (or published settlement terms). No upfront purchase, upgrade, wallet signature, private credentials, or unverified payout promise. I will confirm only the scope that can be completed and verified.";
  const goal = kind === "field_test"
    ? "Coordinate one zero-cost independent service field test"
    : "Confirm one bounded crypto-paid technical task with verifiable settlement";
  const body = {
    goal,
    content,
    public_details: kind === "field_test"
      ? "One active published service; one synthetic/public read-only input; agreed criteria; independent operators/wallets; no fee, order, purchase, signatures, credentials, private data or state-changing requests. Claim only after genuine execution and live eligibility verification; no guarantee."
      : "Scope must be bounded and match MIDAD's existing Python, TypeScript/REST API, automation QA, payment verification or research capabilities. Crypto payout asset/network and funded settlement path must be stated before work; no upfront spend or wallet signatures.",
    ttl_hours: 168,
    publish_when_matched: true,
    match_policy: "relevant",
    client_message_id: "midad-auto-" + String(row.notification_id)
  };
  const result = await speedbot("/api/intros/" + encodeURIComponent(id) + "/respond", agentKey, { method: "POST", body: JSON.stringify(body) });
  if (result.ok) {
    await finish(row, "RESPONDED", "monitor_response", "Posted one scope-limited response to a live, relevant public request.", {
      executor_action_at: new Date().toISOString(),
      response_type: kind,
      response_http_status: result.status,
      response_request_id: result.data?.request_id || null
    });
    return { notification_id: row.notification_id, kind: row.kind, action: "responded", response_type: kind, status: result.status };
  }
  if (result.status === 409) {
    await finish(row, "SKIPPED", "none", "Platform rejected the response because the request/state conflicts; no fallback action.", { response_http_status: result.status, response_error: clip(result.data?.message || result.data?.error, 250) });
    return { notification_id: row.notification_id, action: "skipped_conflict", status: result.status };
  }
  await finish(row, "ERROR", "review_platform_response", "The public reply was not accepted; no alternative route attempted.", { response_http_status: result.status, response_error: clip(result.data?.message || result.data?.error, 250) });
  return { notification_id: row.notification_id, action: "reply_failed", status: result.status };
}
async function handleWork(row: any, agentKey: string, currentOutbound: number) {
  const introId = String(row.entity_id || "");
  if (!/^intro_[a-f0-9]{32}$/.test(introId)) {
    await finish(row, "SKIPPED", "none", "Notification does not contain a valid public request ID.");
    return { notification_id: row.notification_id, action: "skipped_invalid_intro" };
  }
  const fetched = await speedbot("/api/intros/" + encodeURIComponent(introId), agentKey);
  if (!fetched.ok) {
    await finish(row, fetched.status === 404 ? "STALE" : "ERROR", "refresh_discovery", fetched.status === 404 ? "Public work request is closed, cancelled or expired." : "Could not verify the current request; fail closed.", { source_http_status: fetched.status });
    return { notification_id: row.notification_id, action: fetched.status === 404 ? "stale" : "read_failed", status: fetched.status };
  }
  const intro = fetched.data;
  const ownAgent = String(intro?.agent?.id || "");
  if (ownAgent === AGENT_ID) {
    await finish(row, "SKIPPED", "none", "Own request; do not respond to own listing.");
    return { notification_id: row.notification_id, action: "skipped_own_request" };
  }
  const priorResponse = await db()`SELECT id FROM public.midad_speedbot_targets WHERE entity_id=${introId} AND kind='work.available' AND state='RESPONDED' AND id <> ${row.id} LIMIT 1`;
  if (priorResponse.length) {
    await finish(row, "SKIPPED", "none", "Another notification for this same public request already received a response; prevent duplicate outreach.");
    return { notification_id: row.notification_id, action: "skipped_duplicate_outreach" };
  }
  const expireMs = msTime(intro?.expires_at);
  if (Number.isFinite(expireMs) && expireMs <= Date.now()) {
    await finish(row, "STALE", "refresh_discovery", "Public request deadline has passed.");
    return { notification_id: row.notification_id, action: "stale_expired" };
  }
  const swarm = String(intro?.agent?.swarm || "").toLowerCase();
  if (swarm === "midad revenue swarm") {
    await finish(row, "SKIPPED", "none", "Same-swarm target; no cross-swarm reward or collaboration claim.");
    return { notification_id: row.notification_id, action: "skipped_same_swarm" };
  }
  const goal = String(intro?.goal || "");
  const details = String(intro?.public_details || "");
  const seeking = Array.isArray(intro?.agent?.seeking) ? intro.agent.seeking.join(" ") : "";
  const blob = (goal + " " + details + " " + seeking).toLowerCase();
  const requestsBuyer = /seeking a buyer|looking for a buyer|need(?:s)? a buyer|seeking customers|looking for customers|need buyers|buy my service|service provider \(not another tester\)|provider \(not another tester\)/i.test(blob);
  const offersTestingOurService = /i will (?:run|perform|do) (?:one )?(?:genuinely )?(?:free,? )?(?:independent )?(?:directed )?(?:field )?test of your (?:published )?speedbot service|i act as external tester|you have a service published/i.test(blob);
  if (requestsBuyer || offersTestingOurService) {
    await finish(row, "SKIPPED", "none", requestsBuyer ? "This request is looking for a buyer; responding would make MIDAD the spender." : "This request offers to test the provider's service, which would pay the other tester rather than MIDAD.");
    return { notification_id: row.notification_id, action: "skipped_not_income_route" };
  }
  const sameIdentity = Boolean(intro?.agent?.team_id) && String(intro.agent.team_id) === "MIDAD Revenue Swarm";
  if (sameIdentity) {
    await finish(row, "SKIPPED", "none", "Same-team or same-operator isolation gate.");
    return { notification_id: row.notification_id, action: "skipped_identity_gate" };
  }
  const { seeksTester, noPaymentIntent, wantsPaidWorker, cryptoAndSettlement } = classifySpeedbotRequest(blob);
  if (currentOutbound >= 3) {
    await finish(row, "DEFERRED", "retry_after_rate_window", "Daily limit of three relevant public responses reached; no response sent.");
    return { notification_id: row.notification_id, action: "deferred_rate_limit" };
  }
  if (seeksTester) return await postIntroReply(row, intro, agentKey, "field_test");
  if (wantsPaidWorker && cryptoAndSettlement) return await postIntroReply(row, intro, agentKey, "paid_work");
  await finish(row, "SKIPPED", "none", "Live request is not a verified, no-upfront-spend path to MIDAD income; no public reply sent.", {
    request_goal: clip(goal, 250),
    request_expiry: intro?.expires_at || null,
    funding_or_crypto_path_explicit: cryptoAndSettlement
  });
  return { notification_id: row.notification_id, action: "skipped_unqualified_live_request" };
}
async function handleRoom(row: any, agentKey: string, currentOutbound: number) {
  const roomId = String(row.entity_id || "");
  if (!/^room_[a-f0-9]{32}$/.test(roomId)) {
    await finish(row, "SKIPPED", "none", "Conversation notification does not contain a valid room ID.");
    return { notification_id: row.notification_id, action: "skipped_invalid_room" };
  }
  const fetched = await speedbot("/api/rooms/" + encodeURIComponent(roomId), agentKey);
  if (!fetched.ok) {
    await finish(row, fetched.status === 404 ? "STALE" : "ERROR", "refresh_inbox", fetched.status === 404 ? "Room not found; no message sent." : "Could not verify room state; fail closed.", { room_http_status: fetched.status });
    return { notification_id: row.notification_id, action: fetched.status === 404 ? "stale_room" : "room_read_failed" };
  }
  const room = fetched.data;
  if (String(room?.status || "") !== "open" || room?.can_continue === false) {
    await finish(row, "STALE", "none", "Room is not open for continuation.");
    return { notification_id: row.notification_id, action: "stale_closed_room" };
  }
  const participants = Array.isArray(room?.participants) ? room.participants : [];
  const peer = participants.find((p: any) => String(p?.id || "") !== AGENT_ID);
  if (!peer || String(peer?.swarm || "").toLowerCase() === "midad revenue swarm") {
    await finish(row, "SKIPPED", "none", "No independent external participant was verified.");
    return { notification_id: row.notification_id, action: "skipped_no_independent_peer" };
  }
  if (String(room?.next_speaker || "") !== AGENT_ID) {
    await finish(row, "WAITING_FOR_TURN", "wait_for_peer_message", "Room is open but another participant has the next turn.");
    return { notification_id: row.notification_id, action: "waiting_for_turn" };
  }
  if (currentOutbound >= 3) {
    await finish(row, "DEFERRED", "retry_after_rate_window", "Daily limit of three relevant public responses reached; no message sent.");
    return { notification_id: row.notification_id, action: "deferred_rate_limit" };
  }
  const msgs = Array.isArray(room?.messages) ? room.messages : [];
  const last = msgs.length ? msgs[msgs.length - 1] : null;
  if (last && String(last.agent_id || "") === AGENT_ID) {
    await finish(row, "SKIPPED", "wait_for_peer_message", "Latest room message was already sent by MIDAD; avoid duplicate messaging.");
    return { notification_id: row.notification_id, action: "skipped_already_replied" };
  }
  const priorRoomKickoff = await db()`SELECT id FROM public.midad_speedbot_targets WHERE entity_id=${roomId} AND kind LIKE 'conversation.%' AND state='SENT' AND id <> ${row.id} AND evidence->>'executor'='midad_speedbot_target_executor_v1' LIMIT 1`;
  if (priorRoomKickoff.length) {
    await finish(row, "NEEDS_REVIEW", "review_peer_reply_before_action", "This room already received MIDAD's automated kickoff. Review the peer's new content before any further reply or test; do not repeat the kickoff.", { room_id: roomId, latest_peer_message_id: last?.id || null });
    return { notification_id: row.notification_id, action: "needs_review_no_repeat" };
  }
  if (String(room?.activity_state || "") === "dormant" || (last && Number(last.created_at) > 0 && Date.now() - Number(last.created_at) > 48 * 3600 * 1000)) {
    await finish(row, "STALE", "wait_for_fresh_activity", "Room lacks recent two-way activity; no unsolicited revival.");
    return { notification_id: row.notification_id, action: "stale_dormant_room" };
  }
  const context = msgs.map((m: any) => String(m?.content || "")).join(" ").toLowerCase();
  const providerInvitedForTest = FIELD_TEST_PROVIDERS.has(String(peer?.id || ""));
  const fieldContext = providerInvitedForTest || /service-field-test-v1|directed field test|independent service test|zero-cost field test|field-test pilot/i.test(context);
  const content = fieldContext
    ? "Thanks for connecting. To coordinate a legitimate field test, please confirm the exact active service ID and version, its published acceptance criteria, and one synthetic or public read-only input. Please also confirm independence of operators, teams/swarms and payout wallets, and that there is no prior reciprocal free-test arrangement. The run will cost you 0 USDC, use no credentials, signatures, private/customer data or state-changing calls, and detailed input/output evidence will remain private. I will check the live service-field-test-v1 rules before running; any 1 USDC claim is conditional on genuine execution and eligibility, not guaranteed."
    : "Thanks for connecting. To keep the work actionable without upfront spend, please share one concrete scope, deliverables, acceptance criteria, crypto asset/network, reward amount and verifiable settlement route before work begins. MIDAD can handle bounded Python/API/automation QA, payment-flow verification and source-backed technical research. No service purchases, upfront fees, wallet signatures or credentials; I will confirm only work with clear terms.";
  const msgId = "midad-room-" + roomId.slice(-10) + "-" + String(last?.id || row.notification_id);
  const sent = await speedbot("/api/rooms/" + encodeURIComponent(roomId) + "/messages", agentKey, { method: "POST", body: JSON.stringify({ content, client_message_id: msgId }) });
  if (!sent.ok) {
    await finish(row, sent.status === 409 ? "SKIPPED" : "ERROR", "refresh_inbox", sent.status === 409 ? "Turn or room state changed; do not retry through an alternate route." : "Message was not accepted; no alternate route attempted.", { room_http_status: sent.status, room_error: clip(sent.data?.message || sent.data?.error, 200) });
    return { notification_id: row.notification_id, action: "room_reply_failed_or_conflict", status: sent.status };
  }
  await finish(row, "SENT", "wait_for_peer_message", "Sent one bounded coordination or payment-terms message on MIDAD's verified turn.", {
    executor_action_at: new Date().toISOString(),
    room_id: roomId,
    recipient_agent_id: peer.id,
    field_test_context: fieldContext,
    send_http_status: sent.status
  });
  return { notification_id: row.notification_id, action: "room_message_sent", field_test_context: fieldContext, status: sent.status };
}
async function cycle() {
  const d = db();
  const stale = await d`UPDATE public.midad_speedbot_targets
    SET state='STALE', next_action='refresh_discovery',
        evidence=evidence || jsonb_build_object('executor','midad_speedbot_target_executor_v1','executor_reason','Target older than 72 hours; recheck from live source before any action.','executor_checked_at',now()),
        updated_at=now()
    WHERE state='QUEUED' AND created_at < now() - interval '72 hours'`;
  await d`UPDATE public.midad_speedbot_targets
    SET state='QUEUED', updated_at=now()
    WHERE state='PROCESSING' AND updated_at < now() - interval '20 minutes'`;
  const currentKey = await secret("midad_speedbot_revenue_predator_key");
  if (!currentKey) throw new Error("speedbot_agent_key_unavailable_from_vault");
  const batch = await d.begin(async tx => {
    const rows = await tx`SELECT t.id,t.notification_id,t.entity_id,t.kind,t.category,t.priority_score,t.next_action,t.evidence,t.created_at,n.payload
      FROM public.midad_speedbot_targets t
      LEFT JOIN public.midad_speedbot_notifications n ON n.id=t.notification_id
      WHERE t.state='QUEUED'
      ORDER BY t.priority_score DESC,t.created_at ASC
      LIMIT 20
      FOR UPDATE OF t SKIP LOCKED`;
    for (const r of rows) {
      await tx`UPDATE public.midad_speedbot_targets SET state='PROCESSING', updated_at=now() WHERE id=${r.id}`;
    }
    return rows;
  });
  let outbound = await outboundCountToday();
  const actions: any[] = [];
  for (const row of batch) {
    try {
      if (row.kind === "work.available") {
        const result = await handleWork(row, currentKey, outbound);
        if (result.action === "responded") outbound++;
        actions.push(result);
      } else if (String(row.kind || "").startsWith("conversation.") && row.kind !== "conversation.closed" && row.kind !== "conversation.decision") {
        const result = await handleRoom(row, currentKey, outbound);
        if (result.action === "room_message_sent") outbound++;
        actions.push(result);
      } else if (row.kind === "invitation.accepted") {
        await finish(row, "WAITING_FOR_ROOM", "inspect_matching_room", "Invitation accepted; await/inspect the separate room-open notification before messaging.");
        actions.push({ notification_id: row.notification_id, action: "waiting_for_room" });
      } else if (row.kind === "invitation.received") {
        await finish(row, "NEEDS_REVIEW", "inspect_invitation", "Incoming invitation requires scope and payment review; it was not accepted automatically.");
        actions.push({ notification_id: row.notification_id, action: "needs_review" });
      } else if (row.kind === "bootstrap.available") {
        await finish(row, "NEEDS_REVIEW", "verify_live_reward_rules", "Sponsored task must be checked against live funding, independence and claim rules before participation.");
        actions.push({ notification_id: row.notification_id, action: "needs_review_sponsored_task" });
      } else {
        await finish(row, "SKIPPED", "none", "Notification does not directly authorize a no-spend income action; discovery/event retained without posting or purchasing.");
        actions.push({ notification_id: row.notification_id, action: "skipped_non_actionable", kind: row.kind });
      }
    } catch (e) {
      const msg = clip((e as any)?.message || e, 300);
      await finish(row, "ERROR", "inspect_executor_error", "Target processing failed closed.", { executor_error: msg });
      actions.push({ notification_id: row.notification_id, action: "error", error: msg });
    }
  }
  const remaining = await d`SELECT count(*)::int AS n FROM public.midad_speedbot_targets WHERE state='QUEUED'`;
  return {
    ok: true,
    service: "midad_speedbot_target_executor",
    version: 5,
    selected: batch.length,
    stale_aged_out: stale.count ?? null,
    public_actions_sent_or_posted: outbound - (await outboundCountToday() - 0) >= 0 ? actions.filter(x => x.action === "responded" || x.action === "room_message_sent").length : 0,
    remaining_queued: Number(remaining[0]?.n || 0),
    actions
  };
}
Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: HEADERS });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  try {
    if (!(await authOK(req))) return json({ ok: false, error: "unauthorized" }, 401);
  } catch {
    return json({ ok: false, error: "auth_check_failed" }, 500);
  }
  const started = Date.now();
  let body: any = {};
  try { body = await req.json(); } catch { body = {}; }
  try {
    if (body.action === "health") {
      const r = await db()`SELECT
        (SELECT count(*)::int FROM public.midad_speedbot_targets WHERE state='QUEUED') AS queued,
        (SELECT count(*)::int FROM public.midad_speedbot_targets WHERE state='PROCESSING') AS processing,
        (SELECT count(*)::int FROM public.midad_speedbot_targets WHERE state IN ('RESPONDED','SENT') AND updated_at >= now()-interval '24 hours') AS acted_last_24h,
        (SELECT count(*)::int FROM public.midad_speedbot_fulfillments) AS existing_fulfillments`;
      return json({ ok: true, service: "midad_speedbot_target_executor", version: 5, database_connected: true, counts: Array.isArray(r) ? (r[0] ?? r) : r, duration_ms: Date.now() - started });
    }
    return json({ ...(await cycle()), duration_ms: Date.now() - started });
  } catch (e) {
    return json({ ok: false, service: "midad_speedbot_target_executor", version: 5, error: clip((e as any)?.message || e, 500), duration_ms: Date.now() - started }, 500);
  }
});