/**
 * Network privacy policy layer for MIDAD Browser.
 * Only the isolated native adapter holding the injected capability may attest tunnel readiness.
 */
const SUPPORTED = new Set(["http", "https", "socks5"]);
const STATES = new Set(["disabled", "configuring", "connecting", "connected", "disconnecting", "failed"]);

export function validateTunnelProfile(profile) {
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) return { ok:false, error:"profile_invalid" };
  if (!SUPPORTED.has(profile.protocol)) return { ok:false, error:"protocol_unsupported" };
  if (typeof profile.host !== "string" || profile.host.length > 253 || !profile.host.trim() || /[\s/@?#]/.test(profile.host)) return { ok:false, error:"host_invalid" };
  if (!Number.isInteger(profile.port) || profile.port < 1 || profile.port > 65535) return { ok:false, error:"port_invalid" };
  if (profile.username !== undefined && (typeof profile.username !== "string" || profile.username.length > 256)) return { ok:false, error:"username_invalid" };
  if (profile.password !== undefined && (typeof profile.password !== "string" || profile.password.length > 512)) return { ok:false, error:"password_invalid" };
  return { ok:true, profile:Object.freeze({ protocol:profile.protocol, host:profile.host.trim(), port:profile.port, username:profile.username, password:profile.password }) };
}

export function createNetworkPrivacyPolicy({ killSwitch = true, nativeCapability = null } = {}) {
  let state = "disabled", profile = null, lastError = null, leakProtection = killSwitch, nativeSessionId = null;
  const canAttest = !!nativeCapability && (typeof nativeCapability === "object" || typeof nativeCapability === "function");
  const snapshot = () => Object.freeze({
    state, profile:profile ? { protocol:profile.protocol, host:profile.host, port:profile.port } : null,
    killSwitch:leakProtection, tunnelReady:state === "connected",
    trafficPolicy:leakProtection && state !== "connected" ? "block-non-tunnel" : state === "connected" ? "tunnel-only" : "direct",
    lastError, implementation:"policy-contract-native-vpnservice-integration-pending",
  });
  const configure = next => {
    const valid = validateTunnelProfile(next);
    if (!valid.ok) return valid;
    profile = valid.profile; state = "configuring"; lastError = null; nativeSessionId = null;
    return { ok:true, state, profile:{ protocol:profile.protocol, host:profile.host, port:profile.port } };
  };
  const setState = (next, error = null) => {
    if (!STATES.has(next)) return { ok:false, error:"state_invalid" };
    if (next === "connected") return { ok:false, error:"native_tunnel_attestation_required" };
    if (next === "connecting" && !profile) return { ok:false, error:"profile_required" };
    if (next === "disabled" || next === "failed" || next === "disconnecting") nativeSessionId = null;
    state = next; lastError = error;
    return { ok:true, state, policy:snapshot().trafficPolicy };
  };
  const reportNativeTunnel = (event, capability) => {
    if (!canAttest || capability !== nativeCapability) return { ok:false, error:"native_capability_required" };
    if (!event || typeof event !== "object") return { ok:false, error:"native_event_invalid" };
    if (typeof event.sessionId !== "string" || !event.sessionId.trim() || event.sessionId.length > 128) return { ok:false, error:"session_id_invalid" };
    if (event.status === "connected") {
      if (!profile) return { ok:false, error:"profile_required" };
      if (typeof event.interfaceName !== "string" || !/^tun[0-9]*$/.test(event.interfaceName)) return { ok:false, error:"vpn_interface_not_verified" };
      if (event.routesInstalled !== true || event.dnsConfigured !== true) return { ok:false, error:"routes_or_dns_not_verified" };
      nativeSessionId = event.sessionId; state = "connected"; lastError = null;
      return { ok:true, state, policy:snapshot().trafficPolicy };
    }
    if (event.status === "failed" || event.status === "disconnected") {
      if (!nativeSessionId || event.sessionId !== nativeSessionId) return { ok:false, error:"stale_or_unknown_session_event" };
      nativeSessionId = null; state = event.status === "failed" ? "failed" : "disabled";
      lastError = typeof event.error === "string" ? event.error.slice(0, 160) : null;
      return { ok:true, state, policy:snapshot().trafficPolicy };
    }
    return { ok:false, error:"native_status_invalid" };
  };
  const setKillSwitch = enabled => {
    if (typeof enabled !== "boolean") return { ok:false, error:"boolean_required" };
    leakProtection = enabled;
    return { ok:true, killSwitch:leakProtection, policy:snapshot().trafficPolicy };
  };
  const routeDecision = ({ requestUrl, isPrivate = false } = {}) => {
    if (typeof requestUrl !== "string" || requestUrl.length > 2048) return { action:"block", reason:"url_invalid" };
    let url; try { url = new URL(requestUrl); } catch { return { action:"block", reason:"url_invalid" }; }
    if (!["http:","https:"].includes(url.protocol) || url.username || url.password) return { action:"block", reason:"scheme_blocked" };
    if (isPrivate) return { action:"local", reason:"private_content_not_forwarded_to_remote_proxy" };
    if (state === "connected" && nativeSessionId) return { action:"tunnel", reason:"native_tunnel_attested" };
    if (leakProtection) return { action:"block", reason:"kill_switch_tunnel_unavailable" };
    return { action:"direct", reason:"tunnel_disabled_leak_protection_off" };
  };
  return Object.freeze({ snapshot, configure, setState, reportNativeTunnel, setKillSwitch, routeDecision });
}
