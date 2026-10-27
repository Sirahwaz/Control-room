/**
 * @typedef {{ models: string[], shape: string, top_level_keys: string[] }} ParsedModelCatalog
 */

/**
 * Normalize the catalog response variants encountered at an OpenAI-compatible
 * model endpoint. Never infer IDs from display labels or from an unknown payload.
 * @param {unknown} payload
 * @returns {ParsedModelCatalog}
 */
export function parseModelCatalog(payload) {
  let rows = [];
  let shape = typeof payload;
  let top_level_keys = [];

  if (Array.isArray(payload)) {
    rows = payload;
    shape = "array";
  } else if (payload && typeof payload === "object") {
    const value = /** @type {Record<string, any>} */ (payload);
    top_level_keys = Object.keys(value).sort().slice(0, 24);
    const candidates = [
      ["data", value.data],
      ["models", value.models],
      ["data.models", value.data?.models],
      ["result.data", value.result?.data],
      ["result.models", value.result?.models],
      ["result.data.models", value.result?.data?.models]
    ];
    const found = candidates.find(([, candidate]) => Array.isArray(candidate));
    if (found) {
      shape = found[0];
      rows = found[1];
    } else {
      shape = "object.no_model_array";
    }
  }

  const models = [...new Set(rows.map((item) => {
    if (typeof item === "string") return item.trim();
    if (!item || typeof item !== "object") return "";
    const record = /** @type {Record<string, unknown>} */ (item);
    return String(record.id ?? record.model ?? record.name ?? "").trim();
  }).filter(Boolean))];

  return { models, shape, top_level_keys };
}
