function asText(value, max = 300) {
  return typeof value === "string" ? value.slice(0, max) : "";
}
function asStringArray(value, maxItems = 30) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string").slice(0, maxItems).map((item) => item.slice(0, 80)) : [];
}
function asPrice(value) {
  if (value == null || (typeof value !== "string" && typeof value !== "number")) return null;
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? String(value) : null;
}
export function buildOpenRouterCatalog(modelsPayload, providersPayload, options = {}) {
  const modelRows = Array.isArray(modelsPayload?.data) ? modelsPayload.data : [];
  const providerRows = Array.isArray(providersPayload?.data) ? providersPayload.data : [];
  const query = asText(options.query, 120).trim().toLowerCase();
  const requestedLimit = Number(options.limit);
  const limit = Number.isInteger(requestedLimit) ? Math.min(100, Math.max(1, requestedLimit)) : 50;
  const normalizedModels = modelRows.map((model) => {
    const architecture = model?.architecture && typeof model.architecture === "object" ? model.architecture : {};
    const pricing = model?.pricing && typeof model.pricing === "object" ? model.pricing : {};
    const topProvider = model?.top_provider && typeof model.top_provider === "object" ? model.top_provider : {};
    return {
      id: asText(model?.id, 160), name: asText(model?.name, 200), description: asText(model?.description, 500),
      context_length: model?.context_length != null && Number.isFinite(Number(model.context_length)) ? Number(model.context_length) : null,
      input_modalities: asStringArray(architecture.input_modalities), output_modalities: asStringArray(architecture.output_modalities),
      pricing: { prompt: asPrice(pricing.prompt), completion: asPrice(pricing.completion), image: asPrice(pricing.image), request: asPrice(pricing.request) },
      supported_parameters: asStringArray(model?.supported_parameters),
      max_completion_tokens: topProvider.max_completion_tokens != null && Number.isFinite(Number(topProvider.max_completion_tokens)) ? Number(topProvider.max_completion_tokens) : null,
    };
  }).filter((model) => model.id);
  const filteredModels = query ? normalizedModels.filter((model) => `${model.id} ${model.name} ${model.description}`.toLowerCase().includes(query)) : normalizedModels;
  const providers = providerRows.map((provider) => ({
    slug: asText(provider?.slug, 100), name: asText(provider?.name, 160), headquarters: asText(provider?.headquarters, 80),
    datacenters: asStringArray(provider?.datacenters), privacy_policy_url: asText(provider?.privacy_policy_url, 500),
    terms_of_service_url: asText(provider?.terms_of_service_url, 500), status_page_url: asText(provider?.status_page_url, 500),
  })).filter((provider) => provider.slug || provider.name);
  return { model_count_total: normalizedModels.length, model_count_matched: filteredModels.length, models: filteredModels.slice(0, limit), provider_count: providers.length, providers: providers.slice(0, 120) };
}
