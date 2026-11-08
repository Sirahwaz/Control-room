import { benchmarkAnswerMatches } from "./benchmark-eval.mjs";
import { resolveAutoPromotableRouteTaskClass } from "./model-promotion-policy.mjs";

const BASE_URL = "https://openrouter.ai/api/v1";

// Discovery is intentionally metadata-only. Inference benchmarks and all route
// enable/disable/promotion actions require a separate owner-approved change.
export const OPENROUTER_DISCOVERY_POLICY = Object.freeze({
  catalogSync: true,
  endpointMetadataRefresh: true,
  recommendations: true,
  providerInference: false,
  routeReconciliation: false,
  routePromotion: false
});
const clip = (value, max = 500) => String(value ?? "").slice(0, max);

function dataRows(payload) {
  return Array.isArray(payload?.data) ? payload.data : [];
}

function normalizeModelId(id) {
  const value = String(id || "").trim();
  const slash = value.indexOf("/");
  if (slash <= 0 || slash === value.length - 1) throw new Error("invalid_model_id");
  return { author: value.slice(0, slash), slug: value.slice(slash + 1) };
}

function isZeroPrice(pricing) {
  if (!pricing || pricing.prompt == null || pricing.completion == null) return false;
  return Number(pricing.prompt) === 0 && Number(pricing.completion) === 0;
}

function normalizeModel(model, accountEligible, zdrEligible) {
  const id = String(model?.id || model?.canonical_slug || "").trim();
  const parts = normalizeModelId(id);
  const architecture = model?.architecture && typeof model.architecture === "object" ? model.architecture : {};
  const pricing = model?.pricing && typeof model.pricing === "object" ? model.pricing : {};
  return {
    model_id: id,
    author: parts.author,
    model_slug: parts.slug,
    canonical_slug: typeof model?.canonical_slug === "string" ? model.canonical_slug : null,
    name: String(model?.name || id).slice(0, 240),
    description: clip(model?.description, 4000),
    created_epoch: Number.isFinite(Number(model?.created)) ? Number(model.created) : null,
    context_length: Number.isFinite(Number(model?.context_length)) ? Number(model.context_length) : null,
    input_modalities: Array.isArray(architecture.input_modalities) ? architecture.input_modalities : [],
    output_modalities: Array.isArray(architecture.output_modalities) ? architecture.output_modalities : [],
    pricing,
    supported_parameters: Array.isArray(model?.supported_parameters) ? model.supported_parameters : [],
    top_provider: model?.top_provider && typeof model.top_provider === "object" ? model.top_provider : {},
    account_eligible: accountEligible,
    zdr_eligible: zdrEligible,
    free_pricing: isZeroPrice(pricing),
    metadata: { source: "openrouter_models_api", details_path: model?.links?.details || null, last_catalog_sync: new Date().toISOString() }
  };
}

function classifyModel(model) {
  const id = String(model.model_id || model.id || "").toLowerCase();
  const text = (String(model.name || "") + " " + String(model.description || "") + " " + id).toLowerCase();
  const input = Array.isArray(model.input_modalities) ? model.input_modalities : [];
  const output = Array.isArray(model.output_modalities) ? model.output_modalities : [];
  const params = Array.isArray(model.supported_parameters) ? model.supported_parameters : [];
  const tags = [];
  if (input.includes("text") && output.includes("text")) tags.push("general_reasoning");
  if (/code|coding|programming|developer|software/.test(text)) tags.push("code_generation");
  if (/research|reasoning|analysis|agent|knowledge/.test(text)) tags.push("research_compression");
  if (/finance|trading|market|investment/.test(text)) tags.push("market_analysis");
  if (/osint|investigation|intelligence/.test(text)) tags.push("osint_synthesis");
  if (input.includes("image")) tags.push("vision_analysis");
  if (input.includes("audio") || output.includes("audio") || output.includes("speech") || output.includes("transcription")) tags.push("audio_tasks");
  if (input.includes("video") || output.includes("video")) tags.push("video_analysis");
  if (input.includes("file") || /document|pdf|long context|extraction/.test(text)) tags.push("document_analysis");
  if (params.includes("structured_outputs") || params.includes("response_format")) tags.push("structured_generation");
  if (output.includes("embeddings") || id.includes("embed")) tags.push("embeddings");
  if (params.includes("tools") || params.includes("tool_choice")) tags.push("agentic_tools");
  if (/translation|translate/.test(text)) tags.push("translation");
  return [...new Set(tags.length ? tags : ["general_reasoning"])];
}

function recommendationScore(model, taskClass) {
  let score = 40;
  if (model.free_pricing) score += 20;
  if (model.zdr_eligible) score += 18;
  if (Number(model.context_length || 0) >= 128000) score += 8;
  if ((model.supported_parameters || []).includes("tools")) score += 7;
  if ((model.input_modalities || []).includes("image") && taskClass === "vision_analysis") score += 7;
  if (model.benchmark_state === "passed") score += 10;
  return Math.min(100, score);
}

async function fetchJson(url, headers, timeoutMs = 20000) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
  const text = await response.text();
  let payload = {};
  try { payload = JSON.parse(text); } catch { payload = { message: clip(text, 300) }; }
  return { response, payload };
}

async function fetchCatalog(path, headers) {
  const all = [];
  const pageSize = 1000;
  for (let offset = 0; offset < 5000; offset += pageSize) {
    const url = BASE_URL + path + (path.includes("?") ? "&" : "?") + "limit=" + pageSize + "&offset=" + offset;
    const result = await fetchJson(url, headers, 25000);
    if (!result.response.ok) throw new Error("openrouter_catalog_http_" + result.response.status + "_" + path);
    const rows = dataRows(result.payload);
    if (!Array.isArray(result.payload?.data)) throw new Error("openrouter_catalog_invalid_shape_" + path);
    all.push(...rows);
    if (rows.length < pageSize) break;
  }
  return all;
}

async function upsertModels(db, records) {
  const idsJson = db.json(records.map((r) => ({ model_id: r.model_id })));
  const prior = await db.unsafe(
    "select count(*)::int as count from midad_private.model_catalog c where exists (select 1 from jsonb_to_recordset($1::jsonb) x(model_id text) where x.model_id=c.model_id)",
    [idsJson]
  );
  const existingCount = Number(prior[0]?.count || 0);
  await db.unsafe(
    "insert into midad_private.model_catalog (model_id,author,model_slug,canonical_slug,name,description,created_epoch,context_length,input_modalities,output_modalities,pricing,supported_parameters,top_provider,account_eligible,zdr_eligible,free_pricing,metadata,last_seen_at,is_listed,updated_at) " +
    "select x.model_id,x.author,x.model_slug,x.canonical_slug,x.name,x.description,x.created_epoch,x.context_length,x.input_modalities,x.output_modalities,x.pricing,x.supported_parameters,x.top_provider,x.account_eligible,x.zdr_eligible,x.free_pricing,x.metadata,now(),true,now() " +
    "from jsonb_to_recordset($1::jsonb) as x(model_id text,author text,model_slug text,canonical_slug text,name text,description text,created_epoch bigint,context_length bigint,input_modalities jsonb,output_modalities jsonb,pricing jsonb,supported_parameters jsonb,top_provider jsonb,account_eligible boolean,zdr_eligible boolean,free_pricing boolean,metadata jsonb) " +
    "on conflict (model_id) do update set author=excluded.author,model_slug=excluded.model_slug,canonical_slug=excluded.canonical_slug,name=excluded.name,description=excluded.description,created_epoch=excluded.created_epoch,context_length=excluded.context_length,input_modalities=excluded.input_modalities,output_modalities=excluded.output_modalities,pricing=excluded.pricing,supported_parameters=excluded.supported_parameters,top_provider=excluded.top_provider,account_eligible=excluded.account_eligible,zdr_eligible=excluded.zdr_eligible,free_pricing=excluded.free_pricing,metadata=excluded.metadata,last_seen_at=now(),is_listed=true,updated_at=now(),last_changed_at=case when midad_private.model_catalog.name is distinct from excluded.name or midad_private.model_catalog.description is distinct from excluded.description or midad_private.model_catalog.pricing is distinct from excluded.pricing or midad_private.model_catalog.supported_parameters is distinct from excluded.supported_parameters or midad_private.model_catalog.input_modalities is distinct from excluded.input_modalities or midad_private.model_catalog.output_modalities is distinct from excluded.output_modalities or midad_private.model_catalog.top_provider is distinct from excluded.top_provider or midad_private.model_catalog.context_length is distinct from excluded.context_length then now() else midad_private.model_catalog.last_changed_at end",
    [db.json(records)]
  );
  await db.unsafe(
    "update midad_private.model_catalog set is_listed=false,updated_at=now() where is_listed=true and not exists (select 1 from jsonb_to_recordset($1::jsonb) x(model_id text) where x.model_id=midad_private.model_catalog.model_id)",
    [idsJson]
  );
  return Math.max(0, records.length - existingCount);
}

async function refreshEndpoints(db, apiHeaders, batchSize = 24) {
  const queue = await db.unsafe(
    "select model_id,author,model_slug from midad_private.model_catalog " +
    "where account_eligible=true and (endpoint_check_state='pending' " +
    "or (endpoint_check_state='failed' and (last_endpoint_check_at is null or last_endpoint_check_at < now()-interval '6 hours')) " +
    "or (endpoint_check_state in ('checked','empty') and last_endpoint_check_at < now()-interval '24 hours')) " +
    "order by zdr_eligible desc,free_pricing desc,created_epoch desc nulls last limit $1",
    [batchSize]
  );
  let checked = 0;
  let failures = 0;
  for (let start = 0; start < queue.length; start += 4) {
    const batch = queue.slice(start, start + 4);
    const results = await Promise.all(batch.map(async (model) => {
      const url = BASE_URL + "/models/" + encodeURIComponent(model.author) + "/" + encodeURIComponent(model.model_slug) + "/endpoints";
      try {
        const result = await fetchJson(url, apiHeaders, 15000);
        if (result.response.status === 404) return { model, state: "empty", endpoints: [], status: 404 };
        if (!result.response.ok) return { model, state: "failed", endpoints: [], status: result.response.status };
        const endpoints = Array.isArray(result.payload?.data?.endpoints) ? result.payload.data.endpoints : [];
        return { model, state: endpoints.length ? "checked" : "empty", endpoints, status: result.response.status };
      } catch (_error) {
        return { model, state: "failed", endpoints: [], status: 0 };
      }
    }));
    for (const result of results) {
      checked++;
      if (result.state === "failed") failures++;
      const endpointRecords = result.endpoints.map((endpoint) => {
        const providerName = String(endpoint?.provider_name || "unknown");
        const endpointName = String(endpoint?.name || providerName);
        const tag = String(endpoint?.tag || "");
        const quantization = String(endpoint?.quantization || "unknown");
        return {
          endpoint_key: [result.model.model_id, providerName, endpointName, tag, quantization].join("::"),
          model_id: result.model.model_id,
          provider_name: providerName,
          endpoint_name: endpointName,
          tag,
          status: Number.isFinite(Number(endpoint?.status)) ? Number(endpoint.status) : null,
          quantization,
          context_length: Number.isFinite(Number(endpoint?.context_length)) ? Number(endpoint.context_length) : null,
          max_completion_tokens: Number.isFinite(Number(endpoint?.max_completion_tokens)) ? Number(endpoint.max_completion_tokens) : null,
          max_prompt_tokens: Number.isFinite(Number(endpoint?.max_prompt_tokens)) ? Number(endpoint.max_prompt_tokens) : null,
          pricing: endpoint?.pricing && typeof endpoint.pricing === "object" ? endpoint.pricing : {},
          supported_parameters: Array.isArray(endpoint?.supported_parameters) ? endpoint.supported_parameters : [],
          uptime_metrics: { last_5m: endpoint?.uptime_last_5m ?? null, last_30m: endpoint?.uptime_last_30m ?? null, last_1d: endpoint?.uptime_last_1d ?? null },
          latency_metrics: endpoint?.latency_last_30m && typeof endpoint.latency_last_30m === "object" ? endpoint.latency_last_30m : {},
          throughput_metrics: endpoint?.throughput_last_30m && typeof endpoint.throughput_last_30m === "object" ? endpoint.throughput_last_30m : {},
          metadata: {
            native_tools: endpoint?.native_tools ?? null,
            service_tier: endpoint?.service_tier ?? null,
            supports_tool_choice: endpoint?.supports_tool_choice ?? null,
            supports_implicit_caching: endpoint?.supports_implicit_caching ?? null,
            checked_http_status: result.status
          }
        };
      });
      if (result.state !== "failed") {
        await db.unsafe(
          "update midad_private.model_endpoint_catalog set is_listed=false,updated_at=now() where model_id=$1",
          [result.model.model_id]
        );
      }
      if (endpointRecords.length) {
        await db.unsafe(
          "insert into midad_private.model_endpoint_catalog (endpoint_key,model_id,provider_name,endpoint_name,tag,status,quantization,context_length,max_completion_tokens,max_prompt_tokens,pricing,supported_parameters,uptime_metrics,latency_metrics,throughput_metrics,metadata,is_listed,last_seen_at,updated_at) " +
          "select x.endpoint_key,x.model_id,x.provider_name,x.endpoint_name,x.tag,x.status,x.quantization,x.context_length,x.max_completion_tokens,x.max_prompt_tokens,x.pricing,x.supported_parameters,x.uptime_metrics,x.latency_metrics,x.throughput_metrics,x.metadata,true,now(),now() from jsonb_to_recordset($1::jsonb) x(endpoint_key text,model_id text,provider_name text,endpoint_name text,tag text,status integer,quantization text,context_length bigint,max_completion_tokens bigint,max_prompt_tokens bigint,pricing jsonb,supported_parameters jsonb,uptime_metrics jsonb,latency_metrics jsonb,throughput_metrics jsonb,metadata jsonb) " +
          "on conflict (endpoint_key) do update set status=excluded.status,pricing=excluded.pricing,supported_parameters=excluded.supported_parameters,uptime_metrics=excluded.uptime_metrics,latency_metrics=excluded.latency_metrics,throughput_metrics=excluded.throughput_metrics,metadata=excluded.metadata,is_listed=true,last_seen_at=now(),updated_at=now()",
          [db.json(endpointRecords)]
        );
      }
      await db.unsafe(
        "update midad_private.model_catalog set endpoint_check_state=$1,endpoint_count=$2,last_endpoint_check_at=now(),updated_at=now() where model_id=$3",
        [result.state, endpointRecords.length, result.model.model_id]
      );
    }
  }
  return { checked, failures };
}

async function refreshRecommendations(db) {
  const models = await db.unsafe(
    "select model_id,name,description,context_length,input_modalities,output_modalities,supported_parameters,account_eligible,zdr_eligible,free_pricing,benchmark_state from midad_private.model_catalog where is_listed=true"
  );
  const recommendations = [];
  for (const model of models) {
    const eligibility = !model.account_eligible ? "blocked" : (model.zdr_eligible ? "eligible_zdr" : "eligible_safety_retention");
    for (const taskClass of classifyModel(model)) {
      const reasons = [];
      if (model.free_pricing) reasons.push("zero_input_and_output_price");
      if (model.zdr_eligible) reasons.push("zdr_endpoint_available");
      if (Number(model.context_length || 0) >= 128000) reasons.push("long_context");
      if ((model.supported_parameters || []).includes("tools")) reasons.push("tool_calling");
      if (taskClass === "vision_analysis") reasons.push("image_input_supported");
      if (taskClass === "audio_tasks") reasons.push("audio_modality_supported");
      recommendations.push({
        model_id: model.model_id,
        task_class: taskClass,
        recommendation_score: recommendationScore(model, taskClass),
        recommendation_reason: reasons.length ? reasons.join(",") : "matched_model_metadata",
        eligibility_state: eligibility,
        benchmark_state: model.benchmark_state || "not_tested",
        auto_route_eligible: false,
        metadata: { source: "metadata_heuristics_v1", requires_benchmark: model.benchmark_state !== "passed" }
      });
    }
  }
  if (recommendations.length) {
    await db.unsafe(
      "insert into midad_private.model_recommendations (model_id,task_class,recommendation_score,recommendation_reason,eligibility_state,benchmark_state,auto_route_eligible,metadata) " +
      "select x.model_id,x.task_class,x.recommendation_score,x.recommendation_reason,x.eligibility_state,x.benchmark_state,x.auto_route_eligible,x.metadata from jsonb_to_recordset($1::jsonb) x(model_id text,task_class text,recommendation_score numeric,recommendation_reason text,eligibility_state text,benchmark_state text,auto_route_eligible boolean,metadata jsonb) " +
      "on conflict (model_id,task_class) do update set recommendation_score=excluded.recommendation_score,recommendation_reason=excluded.recommendation_reason,eligibility_state=excluded.eligibility_state,benchmark_state=excluded.benchmark_state,auto_route_eligible=excluded.auto_route_eligible,metadata=excluded.metadata,updated_at=now()",
      [db.json(recommendations)]
    );
  }
  return { models: models.length, recommendations: recommendations.length };
}

async function reconcileOpenRouterRoutes(db) {
  const result = await db.unsafe(
    "update midad_private.model_routes r set enabled=false,updated_at=now(),metadata=coalesce(r.metadata,'{}'::jsonb) || jsonb_build_object('disabled_reason','model_no_longer_meets_free_zdr_benchmark_gate','disabled_at',now()) " +
    "where r.provider_slug='openrouter' and r.task_class <> 'public_sanitized' and r.enabled=true " +
    "and not exists (select 1 from midad_private.model_catalog c where c.model_id=r.model and c.is_listed=true and c.account_eligible=true and c.zdr_eligible=true and c.free_pricing=true and c.endpoint_count>0 and c.benchmark_state='passed')"
  );
  return Number(result?.count || 0);
}

async function promoteVerifiedRoutes(db, benchmark) {
  if (!benchmark || benchmark.state !== "passed" || !benchmark.model_id) return { promoted: 0, reason: "benchmark_not_passed" };
  const modelRows = await db.unsafe(
    "select model_id,account_eligible,zdr_eligible,free_pricing,endpoint_count,benchmark_state " +
    "from midad_private.model_catalog where model_id=$1 and is_listed=true limit 1",
    [benchmark.model_id]
  );
  const model = modelRows[0];
  if (!model || !model.account_eligible || !model.zdr_eligible || !model.free_pricing || Number(model.endpoint_count || 0) < 1 || model.benchmark_state !== "passed") {
    return { promoted: 0, reason: "model_failed_final_route_gate" };
  }
  const recommendations = await db.unsafe(
    "select task_class,recommendation_score from midad_private.model_recommendations " +
    "where model_id=$1 and eligibility_state='eligible_zdr' order by recommendation_score desc",
    [benchmark.model_id]
  );
  let promoted = 0;
  for (const item of recommendations) {
    const taskClass = resolveAutoPromotableRouteTaskClass(item.task_class);
    if (!taskClass) continue;
    const score = Number(item.recommendation_score || 0);
    const priority = Math.max(10, Math.min(190, Math.round(190 - score)));
    const metadata = {
      purpose: "General-reasoning baseline only; specialized task routes require task-specific evaluation and approval",
      privacy_profile: "sensitive",
      activation_scope: "verified_free_zdr_general_reasoning_baseline",
      benchmark_profile: "json_arithmetic_v2",
      price_input_per_token: "0",
      price_output_per_token: "0",
      free_price_verified_at: new Date().toISOString(),
      free_price_verified_source: "openrouter_models_api",
      benchmark_request_ref: benchmark.request_ref || null,
      benchmark_verified_at: new Date().toISOString(),
      provider_only: [],
      allow_fallbacks: false
    };
    await db.unsafe(
      "insert into midad_private.model_routes (task_class,provider_slug,model,enabled,priority,max_output_tokens,budget_class,metadata) " +
      "values ($1,'openrouter',$2,true,$3,1024,'free',$4::jsonb) " +
      "on conflict (task_class,provider_slug,model) do update set enabled=true,priority=excluded.priority,max_output_tokens=excluded.max_output_tokens,budget_class='free',metadata=midad_private.model_routes.metadata || excluded.metadata,updated_at=now()",
      [taskClass, benchmark.model_id, priority, db.json(metadata)]
    );
    await db.unsafe(
      "update midad_private.model_recommendations set approval_state='approved',auto_route_eligible=true,metadata=metadata || $1::jsonb,updated_at=now() where model_id=$2 and task_class=$3",
      [db.json({ approval_reason: "automatic_free_zdr_benchmark_gate", benchmark_request_ref: benchmark.request_ref || null }), benchmark.model_id, item.task_class]
    );
    promoted++;
  }
  return { promoted, reason: promoted ? "free_zdr_benchmark_gate_passed" : "no_supported_task_classes" };
}

async function benchmarkOne(db, apiHeaders) {
  const recent = await db.unsafe(
    "select count(*)::int as count from midad_private.model_runs where task_class='model_benchmark' and created_at >= now()-interval '12 hours'"
  );
  if (Number(recent[0]?.count || 0) > 0) return { state: "benchmark_cooldown", next_after_hours: 12 };
  const candidates = await db.unsafe(
    "select model_id from midad_private.model_catalog " +
    "where is_listed=true and account_eligible=true and zdr_eligible=true and free_pricing=true and endpoint_count>0 " +
    "and (benchmark_state='not_tested' or benchmark_state='pending' or (benchmark_state='rate_limited' and last_benchmark_at < now()-interval '12 hours')) " +
    "order by created_epoch desc nulls last,context_length desc limit 1"
  );
  if (!candidates.length) return { state: "no_eligible_candidate" };
  const modelId = String(candidates[0].model_id);
  const started = Date.now();
  const requestRef = "model-discovery-" + Date.now() + "-" + modelId.replace(/[^a-zA-Z0-9-]/g, "-").slice(0, 60);
  let httpStatus = null;
  let latency = 0;
  let state = "failed";
  let errorCode = null;
  let answerMatched = false;
  try {
    const response = await fetch(BASE_URL + "/chat/completions", {
      method: "POST",
      headers: { ...Object.fromEntries(new Headers(apiHeaders).entries()), "content-type": "application/json" },
      body: JSON.stringify({
        model: modelId,
        messages: [{ role: "user", content: 'Compute (17 * 23) + 19. Return only one JSON object with the numeric answer: {"answer":410}.' }],
        max_tokens: 128,
        temperature: 0,
        provider: { zdr: true, data_collection: "deny", allow_fallbacks: false }
      }),
      signal: AbortSignal.timeout(45000)
    });
    httpStatus = response.status;
    const payload = await response.json().catch(() => ({}));
    latency = Date.now() - started;
    const answer = payload?.choices?.[0]?.message?.content;
    answerMatched = benchmarkAnswerMatches(answer);
    if (response.status === 429) state = "rate_limited";
    else if (response.ok && answerMatched) state = "passed";
    else state = "failed";
    if (!response.ok) errorCode = "OPENROUTER_BENCHMARK_HTTP_" + response.status;
    else if (!answerMatched) errorCode = "BENCHMARK_OUTPUT_MISMATCH";
  } catch (_error) {
    latency = Date.now() - started;
    errorCode = "BENCHMARK_FETCH_EXCEPTION";
  }
  await db.unsafe(
    "update midad_private.model_catalog set benchmark_state=$1,benchmark_score=$2,last_benchmark_at=now(),benchmark_error=$3,updated_at=now() where model_id=$4",
    [state, state === "passed" ? 100 : 0, errorCode, modelId]
  );
  await db.unsafe(
    "insert into midad_private.model_runs (request_ref,task_class,provider_slug,model,status,latency_ms,http_status,error_code,error_message,metadata) " +
    "values ($1,'model_benchmark','openrouter',$2,$3,$4,$5,$6,$7,$8::jsonb)",
    [
      requestRef, modelId, state === "passed" ? "ok" : "error", latency, httpStatus, errorCode, errorCode,
      JSON.stringify({
        source: "midad_openrouter_model_discovery",
        benchmark: "json_arithmetic_v2",
        benchmark_task_class: "general_reasoning",
        answer_matched: answerMatched,
        free_pricing_verified: true,
        privacy_policy: { zdr: true, data_collection: "deny", allow_fallbacks: false }
      })
    ]
  );
  await db.unsafe(
    "update midad_private.model_recommendations set benchmark_state=$1,auto_route_eligible=$2,updated_at=now() where model_id=$3",
    [state, state === "passed", modelId]
  );
  return { model_id: modelId, request_ref: requestRef, state, http_status: httpStatus, latency_ms: latency, answer_matched: answerMatched };
}

export async function getOpenRouterDiscoveryStatus(db) {
  const rows = await db.unsafe(
    "select count(*) filter (where is_listed=true)::int as catalog_models," +
    "count(*) filter (where is_listed=true and account_eligible=true)::int as account_eligible," +
    "count(*) filter (where is_listed=true and zdr_eligible=true)::int as zdr_eligible," +
    "count(*) filter (where is_listed=true and free_pricing=true)::int as zero_price," +
    "count(*) filter (where endpoint_check_state='checked')::int as endpoints_checked," +
    "count(*) filter (where benchmark_state='passed')::int as benchmark_passed," +
    "count(*) filter (where benchmark_state='failed')::int as benchmark_failed " +
    "from midad_private.model_catalog"
  );
  const last = await db.unsafe(
    "select id,status,started_at,finished_at,global_models_count,account_eligible_count,zdr_model_count,new_models_count,endpoint_checks_count,endpoint_failures_count,recommendations_count " +
    "from midad_private.model_discovery_runs order by started_at desc limit 1"
  );
  return { counts: rows[0] || {}, last_run: last[0] || null };
}

export async function getOpenRouterRecommendations(db, taskClass = "", limit = 20) {
  const safeLimit = Math.max(1, Math.min(50, Number(limit) || 20));
  const rows = await db.unsafe(
    "select r.model_id,c.name,c.author,c.context_length,c.input_modalities,c.output_modalities,c.pricing,c.supported_parameters,c.zdr_eligible,c.free_pricing,c.benchmark_state,c.benchmark_score,r.task_class,r.recommendation_score,r.recommendation_reason,r.eligibility_state,r.approval_state,r.benchmark_state as recommendation_benchmark_state,r.auto_route_eligible " +
    "from midad_private.model_recommendations r join midad_private.model_catalog c using(model_id) " +
    "where c.is_listed=true and r.eligibility_state in ('eligible_zdr','eligible_safety_retention') " +
    "and ($1='' or r.task_class=$1) " +
    "order by r.auto_route_eligible desc,r.recommendation_score desc,c.free_pricing desc,c.zdr_eligible desc limit $2",
    [taskClass, safeLimit]
  );
  return rows;
}

export async function runOpenRouterDiscovery({ db, apiKey, source = "manual" }) {
  if (!db) throw new Error("discovery_database_missing");
  if (!String(apiKey || "").trim()) throw new Error("openrouter_api_key_not_configured");
  await db.unsafe(
    "update midad_private.model_discovery_runs set status='timed_out',finished_at=now(),error_message='stale_running_record_recovered' where status='running' and started_at < now()-interval '30 minutes'"
  );
  let stage = 'catalog_fetch';
  let runId;
  try {
    const run = await db.unsafe(
      "insert into midad_private.model_discovery_runs(source,status) values ($1,'running') returning id",
      [String(source).slice(0, 80)]
    );
    runId = String(run[0].id);
  } catch (_error) {
    return { ok: true, state: "BUSY", message: "another_discovery_run_is_active" };
  }

  try {
    const apiHeaders = { authorization: "Bearer " + String(apiKey).trim(), accept: "application/json" };
    const [globalModels, accountModels, zdrModels] = await Promise.all([
      fetchCatalog("/models", apiHeaders),
      fetchCatalog("/models/user", apiHeaders),
      fetchCatalog("/models?zdr=true", apiHeaders)
    ]);
    stage = 'validate_catalog';
    if (!globalModels.length || !accountModels.length) throw new Error("empty_or_invalid_openrouter_catalog");

    const eligibleIds = new Set(accountModels.map((m) => String(m?.id || "")).filter(Boolean));
    const zdrIds = new Set(zdrModels.map((m) => String(m?.id || "")).filter(Boolean));
    const merged = new Map();
    for (const model of globalModels) {
      const id = String(model?.id || "");
      if (id) merged.set(id, normalizeModel(model, eligibleIds.has(id), zdrIds.has(id)));
    }
    for (const model of accountModels) {
      const id = String(model?.id || "");
      if (id) merged.set(id, normalizeModel(model, true, zdrIds.has(id)));
    }

    const records = [...merged.values()];
    stage = 'upsert_models';
    const newModels = await upsertModels(db, records);
    stage = 'reconcile_routes';
    const disabledRoutes = OPENROUTER_DISCOVERY_POLICY.routeReconciliation
      ? await reconcileOpenRouterRoutes(db)
      : 0;
    stage = 'refresh_endpoints';
    const endpointResult = await refreshEndpoints(db, apiHeaders, 24);
    stage = 'refresh_recommendations';
    const recommendationResult = await refreshRecommendations(db);
    stage = 'benchmark';
    const benchmarkResult = OPENROUTER_DISCOVERY_POLICY.providerInference
      ? await benchmarkOne(db, apiHeaders)
      : { state: "PENDING_APPROVAL", inference_called: false };
    const promotionResult = OPENROUTER_DISCOVERY_POLICY.routePromotion
      ? await promoteVerifiedRoutes(db, benchmarkResult)
      : { promoted: 0, reason: "human_approval_required" };
    stage = 'persist_discovery_run';

    await db.unsafe(
      "update midad_private.model_providers set metadata=coalesce(metadata,'{}'::jsonb) || $1::jsonb,updated_at=now() where slug='openrouter'",
      [db.json({
        catalog_state: "VERIFIED",
        catalog_models_global: globalModels.length,
        account_eligible_models: accountModels.length,
        zdr_eligible_models: zdrModels.length,
        last_discovery_at: new Date().toISOString(),
        discovery_source: "models+models_user+models_zdr"
      })]
    );

    const state = endpointResult.failures > 0 ? "partial" : "completed";
    await db.unsafe(
      "update midad_private.model_discovery_runs set status=$1,finished_at=now(),global_models_count=$2,account_eligible_count=$3,zdr_model_count=$4,new_models_count=$5,changed_models_count=$6,endpoint_checks_count=$7,endpoint_failures_count=$8,recommendations_count=$9,metadata=$10::jsonb where id=$11::uuid",
      [
        state, globalModels.length, accountModels.length, zdrModels.length,
        newModels, Math.max(0, records.length - newModels), endpointResult.checked,
        endpointResult.failures, recommendationResult.recommendations,
        JSON.stringify({ catalog_sync: "verified", endpoint_batch_size: 24, benchmark: benchmarkResult, route_reconciliation_disabled: disabledRoutes, route_promotion: promotionResult, recommendation_models: recommendationResult.models }),
        runId
      ]
    );
    return {
      ok: true,
      state: "VERIFIED",
      run_id: runId,
      global_models: globalModels.length,
      account_eligible_models: accountModels.length,
      zdr_models: zdrModels.length,
      new_models: newModels,
      endpoint_checks: endpointResult.checked,
      endpoint_failures: endpointResult.failures,
      recommendations: recommendationResult.recommendations,
      benchmark: benchmarkResult,
      route_reconciliation_disabled: disabledRoutes,
      route_promotion: promotionResult,
      summary: await getOpenRouterDiscoveryStatus(db)
    };
  } catch (error) {
    const diagnostic = stage + ":" + clip(error?.message || error, 500);
    await db.unsafe(
      "update midad_private.model_discovery_runs set status='failed',finished_at=now(),error_message=$1 where id=$2::uuid",
      [diagnostic, runId]
    );
    return { ok: false, state: "FAILED", run_id: runId, error: diagnostic };
  }
}
