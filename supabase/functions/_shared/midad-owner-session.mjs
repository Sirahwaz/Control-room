const OWNER_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_OWNER_SESSION_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/** Resolve owner only from an explicit owner binding on the authenticated session row. */
export function validateOwnerSessionBinding(session, nowMs = Date.now()) {
  if (!session || typeof session !== "object" || session.active !== true) {
    return { ok: false, error: "owner_session_inactive" };
  }
  if (typeof session.owner_user_id !== "string" || !OWNER_UUID.test(session.owner_user_id)) {
    return { ok: false, error: "owner_session_not_bound" };
  }
  const createdAt = Date.parse(session.created_at);
  if (!Number.isFinite(createdAt) || createdAt > nowMs || nowMs - createdAt > MAX_OWNER_SESSION_AGE_MS) {
    return { ok: false, error: "owner_session_expired" };
  }
  return { ok: true, ownerUserId: session.owner_user_id };
}

/** Bind new sessions only when the owner profile is unambiguous. */
export function resolveUniqueOwnerProfile(profiles) {
  if (!Array.isArray(profiles) || profiles.length !== 1 ||
      typeof profiles[0]?.id !== "string" || !OWNER_UUID.test(profiles[0].id)) {
    return { ok: false, error: "owner_profile_not_unambiguous" };
  }
  return { ok: true, ownerUserId: profiles[0].id };
}
