/**
 * Network privacy policy layer for MIDAD Browser.
 * Policy/contract module; Android VpnService transport is a separate native implementation.
 */
const SUPPORTED = new Set(["http", "https", "socks5"]);
const STATES = new Set(["disabled", "configuring", "connecting", "connected", "disconnecting", "failed"]);

export function validateTunnelProfile(profile) {
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) return { ok:false, error:"profile_invalid" };
  if (!SUPPORTED.has(profile.protocol)) return { ok:false, error:"protocol_unsupported" };
  if (typeof profile.host !== "string" || profile.host.length > 253 || !profile.host.trim()) return { ok:false, error:"host_invalid" };
  if (!Number.isInteger(profile.port) || profile.port < 1 || profile.port > 65535) return { ok:false, error:"port_invalid" };
  if (profile.username !== undefined && (typeof profile.username !== "string" || profile.username.length > 256)) return { ok:false, error:"username_invalid" };
  if (profile.password !== undefined && (typeof profile.password !== "string" || profile.password.length > 512)) return { ok:false, error:"password_invalid" };
  return { ok:true, profile:Object.freeze({ protocol:profile.protocol, host:profile.host.trim(), port:profile.port, username:profile.username, password:profile.password }) };
}

export function createNetworkPrivacyPolicy({ killSwitch = true } = {}) {
  let state = "disabled";
  let profile = null;
  let lastError = null;
  let leakProtection = killSwitch;

  const snapshot = () => Object.freeze({
    state, profile: profile ? { protocol:profile.protocol, host:profile.host, port:profile.port } : null,
    killSwitch: leakProtection, tunnelReady: state === "connected",
    trafficPolicy: leakProtection && state !== "connected" ? "block-non-tunnel" : state === "connected" ? "tunnel-only" : "direct",
    lastError,
    implementation: "policy-only-native-vpnservice-pending",
  });

  const configure = (next) => {
    const valid = validateTunnelProfile(next);
    if (!valid.ok) return valid;
    profile = valid.profile; state = "configuring"; lastError = null;
    return { ok:true, state };
  };
  const setState = (next, error = null) => {
    if (!STATES.has(next)) return { ok:false, error:"state_invalid" };
    if (next === "connected" && !profile) return { ok:false, error:"profile_required" };
    state = next; lastError = error;
    return { ok:true, state, policy:snapshot().trafficPolicy };
  };
  const setKillSwitch = (enabled) => {
    if (typeof enabled !== "boolean") return { ok:false, error:"boolean_required" };
    leakProtection = enabled; return { ok:true, killSwitch:leakProtection, policy:snapshot().trafficPolicy };
  };
  const routeDecision = ({ requestUrl, isPrivate = false } = {}) => {
    if (typeof requestUrl !== "string" || requestUrl.length > 2048) return { action:"block", reason:"url_invalid" };
    let url;
    try { url = new URL(requestUrl); } catch { return { action:"block", reason:"url_invalid" }; }
    if (!["http:","https:"].includes(url.protocol) || url.username || url.password) return { action:"block", reason:"scheme_blocked" };
    if (isPrivate) return { action:"local", reason:"private_content_not_forwarded_to_remote_proxy" };
    if (state === "connected") return { action:"tunnel", reason:"tunnel_connected" };
    if (leakProtection) return { action:"block", reason:"kill_switch_tunnel_unavailable" };
    return { action:"direct", reason:"tunnel_disabled_leak_protection_off" };
  };
  return Object.freeze({ snapshot, configure, setState, setKillSwitch, routeDecision });
}
