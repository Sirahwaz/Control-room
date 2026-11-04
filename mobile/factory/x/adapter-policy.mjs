/**
 * Fail-closed readiness policy for MIDAD Factory X adapters.
 * Legacy entries without a status remain compatible; explicit non-active states do not.
 */
export function assessAdapterReadiness(adapter) {
  if (!adapter || typeof adapter !== "object" || Array.isArray(adapter)) {
    return { ready: false, reason: "adapter_missing" };
  }

  const status = adapter.status === undefined
    ? "ACTIVE"
    : String(adapter.status).trim().toUpperCase();

  if (status !== "ACTIVE" && status !== "VERIFIED") {
    return {
      ready: false,
      reason: ["PENDING", "BLOCKED", "FAILED", "DISABLED"].includes(status)
        ? "adapter_not_active"
        : "adapter_status_unrecognized",
    };
  }

  if (typeof adapter.execution !== "string" || !adapter.execution.trim()) {
    return { ready: false, reason: "execution_mode_missing" };
  }

  if (adapter.execution === "none") {
    return { ready: false, reason: "execution_disabled" };
  }

  return { ready: true, reason: null };
}
