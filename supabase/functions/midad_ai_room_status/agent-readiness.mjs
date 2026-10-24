export function buildAgentReadiness({ metrics, unavailableMetrics = [], identities = [], events = [], generatedAt = new Date().toISOString() }) {
  const metricNames = ["signals", "opportunities", "engine_runs", "active_alerts", "pending_approvals", "pending_human_tasks"];
  const unavailable = [...new Set(unavailableMetrics)];
  const complete = metricNames.every((key) => typeof metrics?.[key] === "number" && Number.isFinite(metrics[key])) && unavailable.length === 0;
  const nonnegative = metricNames.every((key) => typeof metrics?.[key] === "number" && Number.isFinite(metrics[key]) && metrics[key] >= 0);
  const invalidCount = metricNames.some((key) => metrics?.[key] !== null && metrics?.[key] !== undefined && (typeof metrics[key] !== "number" || !Number.isFinite(metrics[key]) || metrics[key] < 0));
  const registryAvailable = Array.isArray(identities);
  const eventsAvailable = Array.isArray(events);
  const verified = complete && nonnegative && registryAvailable && eventsAvailable;
  const roleState = verified ? "connected" : invalidCount ? "blocked" : "partial";
  const safeIdentities = registryAvailable ? identities.filter((x) => x && typeof x.agent_key === "string") : [];
  const safeEvents = eventsAvailable ? events.filter((x) => x && typeof x.agent_key === "string") : [];
  const latestEventAt = safeEvents.reduce((latest, event) => {
    const time = Date.parse(event.created_at || "");
    return Number.isFinite(time) && time > latest ? time : latest;
  }, 0);
  const checks = [
    { id: "metrics_complete", label: "جميع المؤشرات المطلوبة متاحة", passed: complete },
    { id: "counts_nonnegative", label: "المؤشرات أعداد صالحة وغير سالبة", passed: nonnegative },
    { id: "registry_readable", label: "سجل الوكلاء قابل للقراءة", passed: registryAvailable },
    { id: "events_readable", label: "سجل الأحداث قابل للقراءة", passed: eventsAvailable },
    { id: "read_only_guards", label: "الكتابة والمال واستدعاء النماذج معطّلة", passed: true },
  ];
  const insights = [];
  const signals = metrics?.signals;
  const opportunities = metrics?.opportunities;
  const tasks = metrics?.pending_human_tasks;
  const alerts = metrics?.active_alerts;
  if (typeof signals === "number" && signals >= 0 && typeof opportunities === "number" && opportunities >= 0) {
    insights.push({ id: "volume", severity: "info", text: `مصدر القراءة يعرض ${signals.toLocaleString("en-US")} إشارة و${opportunities.toLocaleString("en-US")} فرصة؛ العدد لا يثبت أهلية الفرص أو ربحيتها.` });
  }
  if (typeof tasks === "number" && tasks > 0) {
    insights.push({ id: "human_tasks", severity: "review", text: `هناك ${tasks.toLocaleString("en-US")} مهمة بشرية مفتوحة وفق المؤشر الحي؛ لا تُعتمد أو تُغلق تلقائياً.` });
  }
  if (typeof alerts === "number" && alerts === 0) {
    insights.push({ id: "alerts_zero", severity: "info", text: "استعلام التنبيهات النشطة أعاد صفراً؛ يلزم أن يظل مصدر الاستعلام سليماً حتى تكون هذه النتيجة موثوقة." });
  }
  if (unavailable.length) insights.push({ id: "partial_data", severity: "warning", text: "البيانات جزئية؛ المؤشرات غير المتاحة: " + unavailable.join(", ") });
  const agents = [
    { key: "orchestrator", name: "Orchestrator", state: roleState, connector: "supabase_metrics", mode: "read_only", description: "تنسيق ملخص من المؤشرات الحية دون إنشاء مهام أو توزيع تنفيذ." },
    { key: "reasoner", name: "Reasoner", state: roleState, connector: "supabase_metrics", mode: "deterministic_analysis", description: "تحليل قواعد من البيانات الحية؛ لا يستدعي نموذجاً خارجياً ولا يستهلك رصيداً." },
    { key: "verifier", name: "Verifier", state: verified ? "connected" : invalidCount ? "blocked" : "partial", connector: "supabase_metrics+agent_registry+agent_events", mode: "read_only_verification", description: "فحص اكتمال الأعداد وسلامة سجل الوكلاء والأحداث؛ لا يغيّر حالة أي سجل." },
  ];
  return {
    ok: true, schema_version: "midad.ai-room.agent-mesh.v1", scope: "read_only_agent_mesh",
    mode: "deterministic_read_only", generated_at: generatedAt, partial: !verified,
    guards: { mutations: false, financial_actions: false, model_calls: false },
    connectors: [
      { id: "supabase_metrics", label: "Supabase live metrics", state: invalidCount ? "blocked" : complete && nonnegative ? "connected" : "partial", mode: "read_only" },
      { id: "agent_registry", label: "MIDAD agent registry", state: registryAvailable ? "connected" : "unavailable", mode: "read_only" },
      { id: "agent_events", label: "MIDAD agent events", state: eventsAvailable ? "connected" : "unavailable", mode: "read_only" },
    ],
    agents, checks, insights,
    evidence: { registered_agents: safeIdentities.length, active_registered_agents: safeIdentities.filter((x) => String(x.status).toLowerCase() === "active").length, recent_events: safeEvents.length, latest_event_at: latestEventAt ? new Date(latestEventAt).toISOString() : null },
    counts: Object.fromEntries(metricNames.map((key) => [key, typeof metrics?.[key] === "number" && Number.isFinite(metrics[key]) && metrics[key] >= 0 ? metrics[key] : null])),
    unavailable_metrics: unavailable,
  };
}
