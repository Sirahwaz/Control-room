const MICRO_ORIGIN = "https://micro.mu";
const MICRO_PATH = "/api/v1/events/free";
const MAX_RANGE_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_RESPONSE_BYTES = 32 * 1024;
const ALLOWED_INPUT_KEYS = new Set(["from", "to", "minutes", "day_start", "day_end"]);
const RFC3339_WITH_ZONE = /^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}(?::\\d{2}(?:\\.\\d+)?)?(?:Z|[+-](?:0\\d|1\\d|2[0-3]):[0-5]\\d)$/;

function fail(error) { return { ok: false, error }; }

function validTimestamp(value) {
  return typeof value === "string" && value.length <= 40 &&
    RFC3339_WITH_ZONE.test(value) && Number.isFinite(Date.parse(value));
}

export function validateCalendarInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return fail("invalid_input");
  for (const key of Object.keys(input)) if (!ALLOWED_INPUT_KEYS.has(key)) return fail("unsupported_parameter");
  const params = {};
  for (const key of ["from", "to"]) {
    if (input[key] !== undefined) {
      if (!validTimestamp(input[key])) return fail("invalid_time_range");
      params[key] = input[key];
    }
  }
  if (params.from && params.to) {
    const from = Date.parse(params.from), to = Date.parse(params.to);
    if (to <= from || to - from > MAX_RANGE_MS) return fail("invalid_time_range");
  }
  if (input.minutes !== undefined) {
    if (!Number.isInteger(input.minutes) || input.minutes < 15 || input.minutes > 480) return fail("invalid_duration");
    params.minutes = input.minutes;
  }
  const dayStart = input.day_start === undefined ? 9 : input.day_start;
  const dayEnd = input.day_end === undefined ? 18 : input.day_end;
  if (!Number.isInteger(dayStart) || dayStart < 0 || dayStart > 23 ||
      !Number.isInteger(dayEnd) || dayEnd < 0 || dayEnd > 23 || dayEnd <= dayStart) {
    return fail("invalid_working_hours");
  }
  if (input.day_start !== undefined) params.day_start = dayStart;
  if (input.day_end !== undefined) params.day_end = dayEnd;
  return { ok: true, params };
}

export function buildCalendarUrl(input) {
  const checked = validateCalendarInput(input);
  if (!checked.ok) throw new TypeError(checked.error);
  const url = new URL(MICRO_PATH, MICRO_ORIGIN);
  for (const [key, value] of Object.entries(checked.params)) url.searchParams.set(key, String(value));
  return url;
}

function mapUpstreamError(status) {
  if (status === 401) return "micro_auth_failed";
  if (status === 403) return "micro_scope_denied";
  if (status === 429) return "micro_rate_limited";
  if (status >= 500) return "micro_unavailable";
  return "micro_request_rejected";
}

async function readBounded(response, maxBytes = MAX_RESPONSE_BYTES) {
  if (!response.body) return "";
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let total = 0, output = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error("micro_response_too_large");
    }
    output += decoder.decode(value, { stream: true });
  }
  output += decoder.decode();
  return output;
}

export async function callMicroCalendarAvailability({ token, input, fetchImpl = fetch, timeoutMs = 8000 }) {
  if (typeof token !== "string" || token.trim().length < 8 || token.length > 4096) return fail("micro_token_missing");
  const checked = validateCalendarInput(input);
  if (!checked.ok) return checked;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(Math.max(timeoutMs, 1000), 15000));
  try {
    const response = await fetchImpl(buildCalendarUrl(checked.params), {
      method: "GET",
      headers: { accept: "application/json", authorization: `Bearer ${token}` },
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) return fail(mapUpstreamError(response.status));
    let body;
    try {
      body = JSON.parse(await readBounded(response));
    } catch (error) {
      return fail(error instanceof Error && error.message === "micro_response_too_large"
        ? "micro_response_too_large" : "micro_invalid_response");
    }
    if (!body || typeof body !== "object" || Array.isArray(body) || body.error) return fail("micro_invalid_response");
    return { ok: true, provider: "micro.mu", operation: "events_free", read_only: true, data: body.data ?? body.result ?? body };
  } catch (error) {
    return fail(error?.name === "AbortError" ? "micro_timeout" : "micro_network_error");
  } finally {
    clearTimeout(timer);
  }
}
