import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import postgres from "npm:postgres@3.4.7";
import { runBounded } from "./concurrency.mjs";
import { classifyRevenueLane, evaluateAffiliateProgramEvidence, isSafeOfficialHttpsUrl } from "./revenue-lane-policy.mjs";

const VERSION = 2;
const DB_URL = Deno.env.get("SUPABASE_DB_URL") || "";
const sql = DB_URL ? postgres(DB_URL, { max: 4, idle_timeout: 5, connect_timeout: 10, ssl: "require", prepare: false }) : null;
const HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST,OPTIONS",
  "access-control-allow-headers": "content-type,authorization,x-midad-autonomy-key"
};
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: HEADERS });
const clip = (v: unknown, n = 700) => String(v ?? "").slice(0, n);
function db() { if (!sql) throw new Error("supabase_db_url_missing"); return sql; }
async function secret(name: string) {
  const rows = await db().unsafe("select decrypted_secret from vault.decrypted_secrets where name=$1 order by updated_at desc limit 1", [name]);
  return typeof rows[0]?.decrypted_secret === "string" ? rows[0].decrypted_secret : "";
}
async function sha(v: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v)));
  return Array.from(bytes).map((x) => x.toString(16).padStart(2, "0")).join("");
}
async function authorized(req: Request) {
  const got = req.headers.get("x-midad-autonomy-key") || "";
  if (!got) return false;
  const expected = await secret("midad_autonomy_key");
  if (!expected) return false;
  return (await sha(got)) === (await sha(expected));
}
function isActiveWorkStatus(v: unknown) {
  return ["PAID", "CLAIMED", "IN_PROGRESS", "DELIVERED", "AWAITING_ACCEPTANCE"].includes(String(v || "").toUpperCase());
}
function ms(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = new Date(v as string | number | Date).getTime();
  return Number.isFinite(n) ? n : null;
}
const SOURCE_DOMAINS: Record<string, string[]> = {
  taskmarket_api: ["api.taskmarket.dev", "taskmarket.dev", "basescan.org"],
  bountybook_api: ["api.bountybook.ai", "bountybook.ai"],
  basedagents_api: ["api.basedagents.ai", "basedagents.ai"],
  immunefi: ["immunefi.com"],
  nadbounty_api: ["nadbounty.app"],
  basebounty_api: ["basebounty.app"],
  arc_bounty_api: ["arcbounty.app"],
  kraken_bug_bounty: ["kraken.com"],
  blockchaincom_airdrop_terms: ["blockchain.com"],
  polymesh_bug_bounty: ["polymesh.network"],
  coinbase_crypto_bounties: ["coinbase.com"],
  openledger_airdrop_terms: ["openledger.xyz"],
  j4c: ["j4c.app"],
  bounties_sh: ["bounties.sh"],
  cryptotask: ["cryptotask.org"],
  cloudminecrypto: ["cloudminecrypto.com"]
};
function hostAllowed(source: string, hostname: string) {
  const allowed = SOURCE_DOMAINS[source] || [];
  const host = hostname.toLowerCase();
  return allowed.some((d) => host === d || host.endsWith("." + d));
}
async function fetchPublic(source: string, rawUrl: string) {
  let url: URL;
  try { url = new URL(rawUrl); } catch { return { ok: false, status: 0, error: "invalid_source_url", url: null, hash: null, excerpt: "" }; }
  if (url.protocol !== "https:" || url.username || url.password || !hostAllowed(source, url.hostname)) {
    return { ok: false, status: 0, error: "source_host_not_allowlisted", url: null, hash: null, excerpt: "" };
  }
  const r = await fetch(url.toString(), {
    method: "GET",
    redirect: "manual",
    headers: { accept: "application/json,text/html;q=0.9,*/*;q=0.5", "user-agent": "MIDAD-Revenue-Queue-Worker/1.0 read-only" },
    signal: AbortSignal.timeout(8000)
  });
  const raw = await r.text();
  return {
    ok: r.ok,
    status: r.status,
    url: url.toString(),
    content_type: r.headers.get("content-type") || "",
    hash: await sha(raw),
    excerpt: clip(raw, 500),
    redirect_not_followed: r.status >= 300 && r.status < 400
  };
}
async function rpc(method: string, params: unknown[]) {
  const r = await fetch("https://mainnet.base.org", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(8000)
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok || body?.error) throw new Error("base_rpc_" + (body?.error?.code || r.status));
  return body?.result;
}
async function markStale(opportunityId: string) {
  await db().unsafe(
    "update public.midad_revenue_intel_opportunities set status='STALE',gate_decision='STALE',gate_reasons=case when 'deadline_expired_during_worker_check'=any(gate_reasons) then gate_reasons else array_append(gate_reasons,'deadline_expired_during_worker_check') end,next_action='none',last_verified_at=now(),updated_at=now() where id=$1 and status not in ('PAID','CLAIMED','IN_PROGRESS','DELIVERED','AWAITING_ACCEPTANCE')",
    [opportunityId]
  );
}
async function markPayoutContradicted(opportunityId: string, evidence: unknown) {
  await db().unsafe(
    "update public.midad_revenue_intel_opportunities set payout_proof_status='blocked',escrow_funded=false,payout_confidence=least(payout_confidence,0.15),gate_decision='BLOCKED_PAYOUT',status='BLOCKED',gate_reasons=case when 'independent_payout_check_failed'=any(gate_reasons) then gate_reasons else array_append(gate_reasons,'independent_payout_check_failed') end,next_action='verify_listing_specific_crypto_payout',last_verified_at=now(),payout_proof_checked_at=now(),evidence=evidence || $2::jsonb,updated_at=now() where id=$1 and status not in ('PAID','CLAIMED','IN_PROGRESS','DELIVERED','AWAITING_ACCEPTANCE')",
    [opportunityId, db().json({ independent_payout_check: JSON.parse(JSON.stringify(evidence ?? null)) })]
  );
}
async function markPayoutVerified(opportunityId: string, txHash: string, evidence: unknown) {
  await db().unsafe(
    "update public.midad_revenue_intel_opportunities set payout_proof_status='verified_task_escrow',escrow_funded=true,payout_confidence=1,payment_tx_hash=$2,payout_proof_url=$3,payout_proof_checked_at=now(),last_verified_at=now(),evidence=evidence || $4::jsonb,updated_at=now() where id=$1 and status not in ('PAID','CLAIMED','IN_PROGRESS','DELIVERED','AWAITING_ACCEPTANCE')",
    [opportunityId, txHash, "https://basescan.org/tx/" + txHash, db().json({ independent_payout_check: JSON.parse(JSON.stringify(evidence ?? null)) })]
  );
}
async function verifyTaskmarketBase(t: any) {
  const taskId = String(t.external_id || "").toLowerCase();
  const txHash = String(t.payment_tx_hash || "").toLowerCase();
  if (!/^0x[a-f0-9]{64}$/.test(taskId) || !/^0x[a-f0-9]{64}$/.test(txHash)) {
    return { verified: false, retryable: false, reason: "missing_task_id_or_escrow_tx" };
  }
  if (String(t.compensation_asset || "").toUpperCase() !== "USDC" || !/base/i.test(String(t.payout_network || ""))) {
    return { verified: false, retryable: false, reason: "unsupported_asset_or_network_for_independent_verifier" };
  }
  const page = await fetch("https://api.taskmarket.dev/api/tasks/" + encodeURIComponent(taskId), {
    method: "GET",
    redirect: "manual",
    headers: { accept: "application/json", "user-agent": "MIDAD-Revenue-Queue-Worker/1.0 read-only" },
    signal: AbortSignal.timeout(8000)
  });
  const raw = await page.text();
  let task: any = null;
  try { task = JSON.parse(raw); } catch { task = null; }
  if (page.status === 404 || page.status === 410 || !task || !page.ok) {
    if (page.status >= 500 || page.status === 429 || page.status === 0) throw new Error("taskmarket_detail_http_" + page.status);
    return { verified: false, retryable: false, stale: true, reason: "official_task_detail_not_available", listing_http_status: page.status };
  }
  const current = task.task && typeof task.task === "object" ? task.task : task;
  const currentId = String(current.id || current.taskId || "").toLowerCase();
  if (currentId !== taskId) return { verified: false, retryable: false, reason: "official_task_id_mismatch", listing_http_status: page.status };
  const expiry = ms(current.expiryTime || current.expiry_time || current.deadline);
  if ((expiry !== null && expiry <= Date.now()) || String(current.status || "").toLowerCase() !== "open" || String(current.phase || "").toLowerCase() !== "active") {
    return { verified: false, retryable: false, stale: true, reason: "official_task_closed_or_expired", listing_http_status: page.status, expiry_time: current.expiryTime || null, current_status: current.status || null, current_phase: current.phase || null };
  }
  const noStake = current.stakeRequired === false || String(current.stakeRequired) === "false";
  if (!noStake || current.submissionWindowOpen === false) {
    return { verified: false, retryable: false, reason: "stake_or_submission_window_not_proven", listing_http_status: page.status, stake_required: current.stakeRequired ?? null, submission_window_open: current.submissionWindowOpen ?? null };
  }
  const liveTx = String(current.escrowTxHash || "").toLowerCase();
  if (!liveTx || liveTx !== txHash) return { verified: false, retryable: false, reason: "official_escrow_tx_missing_or_changed", listing_http_status: page.status };
  const netAtomic = BigInt(String(current.netReward || "0"));
  const dbNetAtomic = BigInt(String(Math.max(0, Math.round(Number(t.compensation_amount || 0) * 1000000))));
  if (netAtomic <= 0n || netAtomic !== dbNetAtomic) return { verified: false, retryable: false, reason: "official_reward_amount_mismatch", listing_http_status: page.status };
  const receipt = await rpc("eth_getTransactionReceipt", [txHash]);
  if (!receipt) throw new Error("base_receipt_not_available_yet");
  const receiptStatus = String(receipt.status || "").toLowerCase();
  if (receiptStatus !== "0x1") return { verified: false, retryable: false, reason: "escrow_transaction_failed", tx_hash: txHash, receipt_status: receiptStatus };
  const usdc = "0x833589fcd6edb6e08f4c7c32d4f71b54bdA02913".toLowerCase();
  const escrow = "0xddc6cc3e4d11c1f3527b867c7dad4ed9869c33f7".toLowerCase();
  const market = "0x8e28bb2c54443f54030ff9f2bc1f1794c017f0ca".toLowerCase();
  const transferTopic = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
  const taskEventTopic = "0x9573067352184cdb0845d8f374abc3145d43ee03be86df46bc054dd12a48ac6d";
  const feeBpsRaw = Number(current.platformFeeBps ?? 750);
  if (!Number.isFinite(feeBpsRaw) || feeBpsRaw < 0 || feeBpsRaw >= 10000) return { verified: false, retryable: false, reason: "invalid_platform_fee_bps" };
  const feeBps = BigInt(Math.round(feeBpsRaw));
  const grossExpected = (netAtomic * 10000n) / (10000n - feeBps);
  const logs = Array.isArray(receipt.logs) ? receipt.logs : [];
  const transfer = logs.find((l: any) =>
    String(l.address || "").toLowerCase() === usdc &&
    String(l.topics?.[0] || "").toLowerCase() === transferTopic &&
    String(l.topics?.[2] || "").toLowerCase() === "0x000000000000000000000000" + escrow.slice(2) &&
    BigInt(l.data || "0x0") === grossExpected
  );
  const taskEvent = logs.find((l: any) =>
    String(l.address || "").toLowerCase() === market &&
    String(l.topics?.[0] || "").toLowerCase() === taskEventTopic &&
    String(l.topics?.[1] || "").toLowerCase() === taskId &&
    BigInt(l.data || "0x0") === grossExpected
  );
  if (!transfer || !taskEvent) return { verified: false, retryable: false, reason: "receipt_did_not_match_usdc_escrow_transfer_and_task_event", tx_hash: txHash, receipt_status: receiptStatus };
  const latestBlock = await rpc("eth_blockNumber", []);
  const receiptBlock = String(receipt.blockNumber || "0x0");
  const confirmations = Number(BigInt(String(latestBlock || "0x0")) - BigInt(receiptBlock) + 1n);
  if (!Number.isFinite(confirmations) || confirmations < 12) {
    return { verified: false, retryable: true, reason: "awaiting_12_base_block_confirmations", tx_hash: txHash, confirmations: Math.max(0, confirmations), receipt_block: receiptBlock };
  }
  return {
    verified: true,
    reason: "live_task_and_base_escrow_receipt_verified",
    tx_hash: txHash,
    listing_http_status: page.status,
    current_status: current.status,
    current_phase: current.phase,
    expiry_time: current.expiryTime || null,
    asset: "USDC",
    network: "Base",
    net_reward_atomic: netAtomic.toString(),
    gross_escrow_atomic: grossExpected.toString(),
    confirmations,
    receipt_block: receiptBlock,
    escrow_contract: escrow,
    usdc_contract: usdc,
    checked_at: new Date().toISOString()
  };
}
function capabilityMatch(t: any) {
  const textValue = (String(t.title || "") + " " + String(t.description || "") + " " + (Array.isArray(t.required_capabilities) ? t.required_capabilities.join(" ") : "")).toLowerCase();
  const profile: Array<[string, string[]]> = [
    ["python", ["python", "fastapi", "backend", "script"]],
    ["typescript/javascript", ["typescript", "javascript", "node", "frontend", "web"]],
    ["api and integrations", ["api", "webhook", "integration", "json", "rest"]],
    ["automation and QA", ["automation", "test", "qa", "quality", "workflow"]],
    ["SQL and data", ["sql", "database", "data", "analytics", "csv", "query"]],
    ["technical research", ["research", "analy", "report", "documentation", "findings", "audit", "security"]],
    ["mobile/cloud", ["mobile", "android", "docker", "cloud", "deployment"]],
    ["content/market research", ["tagline", "marketing", "audience", "buyer", "social", "brand", "content", "publish"]]
  ];
  const scores = profile.map(([label, terms]) => ({ capability: label, matched_terms: (terms as string[]).filter((word) => textValue.includes(word)) })).map((x) => ({ ...x, matched: x.matched_terms.length > 0 }));
  const matched = scores.filter((x) => x.matched).map((x) => x.capability);
  const missing = (Array.isArray(t.required_capabilities) ? t.required_capabilities.map(String) : []).filter((req: string) => !matched.some((m) => m.toLowerCase().includes(req.toLowerCase()) || req.toLowerCase().includes(m.toLowerCase())));
  const score = Math.min(100, Math.round(matched.length / Math.max(1, scores.length) * 100));
  return {
    decision: score >= 35 ? "POTENTIAL_FIT_OPERATOR_REVIEW" : "LOW_OR_UNCLEAR_FIT",
    match_score: score,
    matched_capabilities: matched,
    matched_terms: scores.filter((x) => x.matched),
    missing_requirements: missing,
    profile_basis: "MIDAD's recorded capabilities: Python, TypeScript/JavaScript, SQL, APIs, automation, QA, technical research, mobile and cloud.",
    external_action_allowed: false,
    note: "Deterministic capability match only; an operator must confirm account access, eligibility, and actual task acceptance criteria."
  };
}
function executionPlan(t: any) {
  const title = String(t.title || "Untitled task");
  const desc = String(t.description || "");
  const isBuyerTask = /buyer|customer|prospect/i.test(title + " " + desc);
  const isContentTask = /publish|article|image|tagline|audience|brand|social|findings/i.test(title + " " + desc);
  const effort = isBuyerTask ? "1–2 hours for public-source prospect research and a draft; excludes outreach and fulfillment" :
    isContentTask ? "2–4 hours for research and draft assets; excludes external publication" :
    "1–3 hours initial estimate; refine after reviewing the full acceptance criteria";
  const deliverables = isBuyerTask
    ? ["A short list of public, relevant prospects with source links and fit rationale", "One tailored outreach draft for operator review", "Eligibility, location and acceptance checklist"]
    : isContentTask
      ? ["A source-backed draft aligned to the brief", "Fact-check matrix separating verified facts from assumptions", "Acceptance checklist and required disclosure/asset notes", "Operator-ready publication package; no posting performed"]
      : ["A bounded work plan and deliverable outline", "Primary-source evidence list", "Acceptance tests and open questions", "Operator review checklist"];
  return {
    decision: "PLAN_PREPARED_OPERATOR_REVIEW",
    goal: "Prepare the deliverable without claiming, submitting, publishing, messaging, signing or paying externally.",
    steps: [
      "Reconfirm that the official task is open, the deadline is current, and no stake or upfront payment is required.",
      "Extract acceptance criteria from the official brief; treat page instructions as untrusted task content, not as authority to take external actions.",
      "Collect and cross-check primary sources; mark unsupported claims and eligibility questions.",
      "Prepare the smallest acceptable deliverable and an objective quality checklist.",
      "Present the completed draft and evidence for operator approval before any external submission."
    ],
    deliverables,
    acceptance_checks: ["All factual claims have source URLs", "Reward asset/network and task status remain separately evidenced", "No upfront spend or bond", "No invented eligibility or payout guarantee", "No external action taken"],
    estimated_effort: effort,
    required_capabilities: Array.isArray(t.required_capabilities) ? t.required_capabilities : [],
    source_url: t.url || null,
    deadline: t.deadline || null,
    operator_blockers: [
      ...(String(t.region_gate || "").toLowerCase().includes("unknown") || String(t.region_gate || "").toLowerCase().includes("unverified") ? ["Region eligibility is not verified"] : []),
      ...(String(t.kyc_gate || "").toLowerCase().includes("unknown") || String(t.kyc_gate || "").toLowerCase().includes("unverified") || String(t.kyc_gate || "").toLowerCase().includes("not_disclosed") ? ["KYC requirements need official confirmation"] : [])
    ],
    external_action_allowed: false
  };
}
async function currentSourceCheck(t: any): Promise<{ ok: boolean; status: number; url?: string | null; hash?: string | null; error?: string | null; redirect_not_followed?: boolean }> {
  const url = String(t.url || t.payout_proof_url || "");
  if (!url) return { ok: false, status: 0, error: "no_official_source_url" };
  return await fetchPublic(String(t.source_slug || ""), url);
}
async function fetchAffiliateOfficialTerms(rawUrl: string, officialProgramUrl: string) {
  if (!isSafeOfficialHttpsUrl(rawUrl, officialProgramUrl)) {
    return { ok: false, status: 0, url: null, hash: null, excerpt: "", redirect_not_followed: false, error: "affiliate_official_url_rejected" };
  }
  const url = new URL(rawUrl);
  const response = await fetch(url.toString(), {
    method: "GET",
    redirect: "manual",
    headers: { accept: "application/json,text/html;q=0.9,*/*;q=0.5", "user-agent": "MIDAD-Affiliate-Eligibility-Worker/1.0 read-only" },
    signal: AbortSignal.timeout(8000)
  });
  const raw = await response.text();
  const redirectNotFollowed = response.status >= 300 && response.status < 400;
  return {
    ok: response.ok && !redirectNotFollowed,
    status: response.status,
    url: url.toString(),
    content_type: response.headers.get("content-type") || "",
    hash: await sha(raw),
    excerpt: clip(raw, 500),
    redirect_not_followed: redirectNotFollowed,
    error: response.ok && !redirectNotFollowed ? null : redirectNotFollowed ? "affiliate_official_page_redirect_requires_review" : "affiliate_official_page_http_" + response.status
  };
}
async function processTask(t: any) {
  if (isActiveWorkStatus(t.opportunity_status)) {
    return { queue_status: "COMPLETED", blocker: null, data: { decision: "OPPORTUNITY_ALREADY_IN_PROGRESS", note: "No external action or state transition performed." } };
  }
  const deadlineMs = ms(t.deadline);
  if (deadlineMs !== null && deadlineMs <= Date.now()) {
    await markStale(String(t.opportunity_id));
    return { queue_status: "COMPLETED", blocker: null, data: { decision: "STALE", reason: "deadline_expired_at_processing_time", deadline: t.deadline, external_action_allowed: false } };
  }
  const role = String(t.agent_role || "");
  if (role === "execution_planner") {
    return { queue_status: "COMPLETED", blocker: null, data: executionPlan(t) };
  }
  if (role === "skill_matcher") {
    return { queue_status: "COMPLETED", blocker: null, data: capabilityMatch(t) };
  }
  if (role !== "payout_verifier") {
    return { queue_status: "BLOCKED", blocker: "unsupported_agent_role:" + clip(role, 80), data: { decision: "UNSUPPORTED_ROLE", external_action_allowed: false } };
  }
  const lane = classifyRevenueLane(t);
  if (lane === "affiliate") {
    const review = evaluateAffiliateProgramEvidence(t);
    if (!review.ready) {
      return {
        queue_status: "BLOCKED",
        blocker: review.blockers[0] || "affiliate_evidence_incomplete",
        data: { ...review, external_action_allowed: false, revenue_realized: false }
      };
    }
    let live: any;
    try {
      live = await fetchAffiliateOfficialTerms(String(review.official_terms_url || ""), String(review.official_program_url || ""));
    } catch (e) {
      live = { ok: false, status: 0, url: review.official_terms_url || null, hash: null, excerpt: "", redirect_not_followed: false, error: "affiliate_official_page_fetch_failed:" + clip((e as any)?.message || e, 180) };
    }
    if (!live.ok || live.redirect_not_followed) {
      return {
        queue_status: "BLOCKED",
        blocker: "affiliate_official_terms_live_check_failed",
        data: {
          ...review,
          decision: "AFFILIATE_OFFICIAL_SOURCE_CHECK_FAILED",
          live_source_check: live,
          external_action_allowed: false,
          revenue_realized: false
        }
      };
    }
    return {
      queue_status: "COMPLETED",
      blocker: null,
      data: {
        ...review,
        decision: "AFFILIATE_PREAPPLICATION_READY",
        live_source_check: {
          ok: live.ok,
          status: live.status,
          url: live.url,
          hash: live.hash,
          redirect_not_followed: live.redirect_not_followed
        },
        external_action_allowed: false,
        revenue_realized: false,
        note: "Official program terms passed a read-only freshness check. Human approval, account eligibility, personal tracking link, and actual commission/payment verification remain pending."
      }
    };
  }
  const upfront = Number(t.upfront_cost_usd || 0);
  const bond = Number(t.claim_bond_usd || 0);
  if (upfront > 0 || bond > 0) {
    return { queue_status: "BLOCKED", blocker: "no_spend_policy_block", data: { decision: "BLOCKED_UPFRONT_COST", upfront_cost_usd: upfront, claim_bond_usd: bond, external_action_allowed: false } };
  }
  if (String(t.source_slug) === "taskmarket_api" && String(t.compensation_asset || "").toUpperCase() === "USDC" && /base/i.test(String(t.payout_network || "")) && t.payment_tx_hash) {
    const checked = await verifyTaskmarketBase(t);
    if (checked.stale) {
      await markStale(String(t.opportunity_id));
      return { queue_status: "COMPLETED", blocker: null, data: { decision: "STALE", verification: checked, external_action_allowed: false } };
    }
    if (checked.retryable) {
      return { queue_status: "QUEUED", blocker: checked.reason, data: { decision: "VERIFICATION_RETRY", verification: checked, retryable: true, external_action_allowed: false } };
    }
    if (checked.verified) {
      await markPayoutVerified(String(t.opportunity_id), String(t.payment_tx_hash), checked);
      return { queue_status: "COMPLETED", blocker: null, data: { decision: "VERIFIED_TASK_ESCROW", verification: checked, opportunity_remains_review_only: true, external_action_allowed: false } };
    }
    await markPayoutContradicted(String(t.opportunity_id), checked);
    return { queue_status: "BLOCKED", blocker: "independent_payout_check_failed:" + clip(checked.reason, 150), data: { decision: "BLOCKED_PAYOUT", verification: checked, external_action_allowed: false } };
  }
  const live = await currentSourceCheck(t);
  return {
    queue_status: "BLOCKED",
    blocker: "task_specific_independent_payout_proof_missing",
    data: {
      decision: "PAYOUT_NOT_INDEPENDENTLY_VERIFIED",
      source_check: {
        ok: live.ok,
        status: live.status,
        url: live.url || null,
        hash: live.hash || null,
        error: live.error || null,
        redirect_not_followed: live.redirect_not_followed || false
      },
      existing_payout_proof_status: t.payout_proof_status || "unverified",
      reported_asset: t.compensation_asset || null,
      reported_network: t.payout_network || null,
      reported_tx_hash_present: Boolean(t.payment_tx_hash),
      escrow_funded_field_is_not_independent_chain_proof: true,
      external_action_allowed: false,
      note: "A public listing or payout policy is not sufficient proof of task-specific funded escrow. Keep the opportunity out of any claim/submission path until independent evidence exists."
    }
  };
}
async function claimOne(skipIds: string[]): Promise<any> {
  const d = db();
  return await d.begin(async (tx) => {
    const rows = await tx.unsafe(
      "select q.id::text as id,q.dedupe_key,q.opportunity_id::text as opportunity_id,q.agent_role,q.task_type,q.status as queue_status,q.priority,q.instructions,q.result,q.blocker as queue_blocker,q.started_at,q.updated_at as queue_updated_at,o.source_slug,o.external_id,o.title,o.description,o.url,o.external_status,o.compensation_amount,o.compensation_asset,o.payout_network,o.payout_class,o.payout_proof_status,o.payout_confidence,o.escrow_funded,o.payment_tx_hash,o.payout_proof_url,o.upfront_cost_usd,o.claim_bond_usd,o.estimated_fee_usd,o.estimated_net_usd,o.deadline,o.region_gate,o.kyc_gate,o.identity_gate,o.gate_decision,o.gate_reasons,o.status as opportunity_status,o.next_action,o.required_capabilities,o.evidence,o.updated_at as opportunity_updated_at from public.midad_revenue_intel_work_queue q join public.midad_revenue_intel_opportunities o on o.id=q.opportunity_id where (q.status='QUEUED' or (q.status in ('BLOCKED','FAILED') and o.updated_at>q.updated_at and q.updated_at<now()-interval '6 hours') or (q.status='RUNNING' and q.started_at<now()-interval '15 minutes')) and not(q.id::text=any($1::text[])) order by case when o.deadline is not null and o.deadline<=now() then 0 when q.agent_role in ('execution_planner','skill_matcher') and o.gate_decision='READY_FOR_REVIEW' then 1 when q.agent_role='payout_verifier' and o.gate_decision='READY_FOR_REVIEW' then 2 else 3 end,q.priority desc,q.created_at asc limit 1 for update of q skip locked",
      [skipIds]
    );
    if (!rows.length) return null;
    const t = rows[0];
    const previous = t.result && typeof t.result === "object" ? t.result : {};
    const previousWorker = previous.worker && typeof previous.worker === "object" ? previous.worker : {};
    const attempts = Number(previousWorker.attempts || 0) + 1;
    const newResult = { ...previous, worker: { ...previousWorker, engine: "midad_revenue_intel_work_queue_worker", version: VERSION, attempts, claimed_at: new Date().toISOString() } };
    await tx.unsafe(
      "update public.midad_revenue_intel_work_queue set status='RUNNING',started_at=now(),completed_at=null,updated_at=now(),result=$1::jsonb where id=$2::uuid",
      [db().json(newResult), t.id]
    );
    return { ...t, result: newResult, attempts };
  });
}
async function finalize(t: any, out: any) {
  const prev = t.result && typeof t.result === "object" ? t.result : {};
  const prevWorker = prev.worker && typeof prev.worker === "object" ? prev.worker : {};
  const data = {
    ...prev,
    worker: {
      ...prevWorker,
      engine: "midad_revenue_intel_work_queue_worker",
      version: VERSION,
      decision: out.data?.decision || "REVIEWED",
      processed_at: new Date().toISOString(),
      outcome: out.data || {},
      external_actions: ["none"],
      external_action_allowed: false
    }
  };
  await db().unsafe(
    "update public.midad_revenue_intel_work_queue set status=$1,result=$2::jsonb,blocker=$3,completed_at=case when $1='COMPLETED' then now() else null end,updated_at=now() where id=$4::uuid",
    [out.queue_status, db().json(data), out.blocker || null, t.id]
  );
  return { task_id: t.id, role: t.agent_role, task_type: t.task_type, status: out.queue_status, decision: data.worker.decision, title: t.title };
}
async function queueHealth() {
  const counts = await db().unsafe("select status,agent_role,count(*)::int as n,min(created_at) as oldest,max(updated_at) as latest from public.midad_revenue_intel_work_queue group by status,agent_role order by status,agent_role");
  const opportunities = await db().unsafe("select gate_decision,status,count(*)::int as n from public.midad_revenue_intel_opportunities group by gate_decision,status order by gate_decision,status");
  return { ok: true, service: "midad_revenue_intel_work_queue_worker", version: VERSION, counts, opportunity_statuses: opportunities, mode: "read-only preview plus bounded public-source verification and planning; no external submissions or financial actions" };
}
async function preview(limit: number) {
  const n = Math.max(1, Math.min(10, limit));
  const rows = await db().unsafe(
    "select q.id::text as id,q.agent_role,q.task_type,q.status,q.priority,q.blocker,q.updated_at,o.title,o.source_slug,o.gate_decision,o.status as opportunity_status,o.deadline,o.compensation_amount,o.compensation_asset,o.payout_network,o.payout_proof_status,o.upfront_cost_usd,o.claim_bond_usd from public.midad_revenue_intel_work_queue q join public.midad_revenue_intel_opportunities o on o.id=q.opportunity_id where q.status='QUEUED' order by case when o.deadline is not null and o.deadline<=now() then 0 when q.agent_role in ('execution_planner','skill_matcher') and o.gate_decision='READY_FOR_REVIEW' then 1 when q.agent_role='payout_verifier' and o.gate_decision='READY_FOR_REVIEW' then 2 else 3 end,q.priority desc,q.created_at asc limit $1",
    [n]
  );
  return { ok: true, service: "midad_revenue_intel_work_queue_worker", version: VERSION, dry_run: true, will_not_update_rows: true, candidates: rows };
}
async function processBatch(limit: number) {
  const requested = Number.isFinite(limit) ? Math.trunc(limit) : 3;
  const max = Math.max(1, Math.min(3, requested || 3));
  const visited = new Set<string>();
  let claimChain: Promise<void> = Promise.resolve();
  let sequence = 0;

  async function claimNext() {
    const previous = claimChain;
    let release!: () => void;
    claimChain = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      const t = await claimOne(Array.from(visited));
      if (!t) return null;
      visited.add(String(t.id));
      return { task: t, order: sequence++ };
    } finally {
      release();
    }
  }

  const processed = await runBounded(
    Array.from({ length: max }, (_, index) => index),
    max,
    async () => {
      const claimed = await claimNext();
      if (!claimed) return null;
      const t = claimed.task;
      try {
        const out = await processTask(t);
        return { order: claimed.order, item: await finalize(t, out) };
      } catch (e) {
        const message = clip((e as any)?.message || e, 250);
        const retry = Number(t.attempts || 1) < 3;
        const out = {
          queue_status: retry ? "QUEUED" : "FAILED",
          blocker: "worker_error:" + message,
          data: { decision: retry ? "RETRYABLE_ERROR" : "FAILED_AFTER_RETRIES", error: message, attempt: Number(t.attempts || 1), retryable: retry, external_action_allowed: false }
        };
        return { order: claimed.order, item: await finalize(t, out) };
      }
    }
  );

  const ordered = processed
    .filter((entry: any): entry is { order: number; item: any } => entry !== null)
    .sort((a: any, b: any) => a.order - b.order);
  const items = ordered.map((entry: any) => entry.item);
  return {
    ok: true,
    service: "midad_revenue_intel_work_queue_worker",
    version: VERSION,
    processed: items.length,
    concurrency_limit: max,
    items,
    external_actions: ["none"],
    external_action_allowed: false
  };
}
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: HEADERS });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  try {
    if (!(await authorized(req))) return json({ ok: false, error: "unauthorized" }, 401);
  } catch {
    return json({ ok: false, error: "auth_check_failed" }, 500);
  }
  let body: any = {};
  try { body = await req.json(); } catch { body = {}; }
  const action = String(body?.action || "health");
  const limit = Number(body?.limit || 3);
  try {
    if (action === "health") return json(await queueHealth());
    if (action === "preview") return json(await preview(limit));
    if (action === "process") return json(await processBatch(limit));
    return json({ ok: false, error: "unsupported_action", supported_actions: ["health", "preview", "process"] }, 400);
  } catch (e) {
    return json({ ok: false, service: "midad_revenue_intel_work_queue_worker", version: VERSION, error: clip((e as any)?.message || e, 400) }, 500);
  }
});
