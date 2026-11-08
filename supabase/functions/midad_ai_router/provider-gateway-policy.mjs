function isConfigured(value) { return typeof value === "string" && value.trim().length > 0; }
export function configuredExecutorProviders(env = {}) { const providers=[]; if(isConfigured(env.MIDAD_APMIX_API_KEY))providers.push("apmix"); if(isConfigured(env.OPENAI_API_KEY)||isConfigured(env.MIDAD_OPENAI_API_KEY))providers.push("openai"); if(isConfigured(env.MIDAD_OPENROUTER_API_KEY))providers.push("openrouter"); return providers; }
export function hasExecutorProvider(env = {}) { return configuredExecutorProviders(env).length>0; }
export function hasGeminiAdvisor(env = {}) { return isConfigured(env.GEMINI_API_KEY); }
export function executorProviderLabel(provider) { const value=String(provider||"").trim().toLowerCase(); return ["apmix","openai","openrouter"].includes(value)?value:"unknown"; }
export function buildOpenRouterCatalogRequest(body = {}) { const query=typeof body.query==="string"?body.query.trim().slice(0,120):undefined; const rawLimit=Number(body.limit); const limit=Number.isInteger(rawLimit)?Math.min(100,Math.max(1,rawLimit)):50; return {action:"catalog",provider:"openrouter",...(query?{query}:{}),limit}; }
