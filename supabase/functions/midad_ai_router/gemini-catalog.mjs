/**
 * Minimal, secret-safe parser for the public Gemini models.list payload.
 * It intentionally discards unknown metadata and never returns API keys or raw payloads.
 */
export function parseGeminiModels(payload) {
  let rows = [];
  let shape = typeof payload;
  let top_level_keys = [];

  if (Array.isArray(payload)) {
    rows = payload;
    shape = "array";
  } else if (payload && typeof payload === "object") {
    top_level_keys = Object.keys(payload).sort().slice(0, 24);
    const candidates = [
      ["models", payload.models],
      ["data", payload.data],
      ["result.models", payload.result?.models],
      ["result.data", payload.result?.data]
    ];
    const found = candidates.find(([, value]) => Array.isArray(value));
    if (found) {
      shape = found[0];
      rows = found[1];
    } else {
      shape = "object.no_model_array";
    }
  }

  const byId = new Map();
  for (const row of rows) {
    if (!row || (typeof row !== "object" && typeof row !== "string")) continue;
    const rawId = typeof row === "string" ? row : String(row.name ?? row.id ?? row.model ?? "");
    const id = rawId.trim().replace(/^models\//, "").slice(0, 180);
    if (!/^[A-Za-z0-9._-]+$/.test(id) || byId.has(id)) continue;
    const methodsRaw = typeof row === "object" && Array.isArray(row.supportedGenerationMethods)
      ? row.supportedGenerationMethods : [];
    const methods = [...new Set(methodsRaw
      .filter(value => typeof value === "string")
      .map(value => value.trim().slice(0, 80))
      .filter(value => /^[A-Za-z0-9._-]+$/.test(value)))].slice(0, 12);
    const displayName = typeof row === "object" && typeof row.displayName === "string"
      ? row.displayName.trim().slice(0, 120) : "";
    byId.set(id, {
      id,
      display_name: displayName || null,
      supported_generation_methods: methods,
      supports_generate_content: methods.includes("generateContent")
    });
  }
  return { models: [...byId.values()], shape, top_level_keys };
}
