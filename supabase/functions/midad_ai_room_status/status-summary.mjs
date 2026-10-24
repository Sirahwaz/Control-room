/**
 * Summarizes independent read-only metric queries.
 * A successful zero is kept; failed metrics are omitted so clients can display a dash.
 */
export function summarizeStatusCounts(results) {
  const counts = {};
  const unavailable_metrics = [];
  for (const [name, result] of Object.entries(results ?? {})) {
    if (result && !result.error && typeof result.count === "number" && Number.isFinite(result.count)) {
      counts[name] = result.count;
    } else {
      unavailable_metrics.push(name);
    }
  }
  return { counts, partial: unavailable_metrics.length > 0, unavailable_metrics };
}
