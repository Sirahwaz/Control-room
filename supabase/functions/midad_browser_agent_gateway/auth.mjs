/**
 * Normalize an Authorization value for owner-session lookup.
 * Supports RFC-style Bearer headers without weakening raw-token compatibility.
 */
export function stripBearerPrefix(value) {
  if (typeof value !== "string") return "";
  const header = value.trim();
  const match = /^Bearer[ \t]+(.+)$/i.exec(header);
  return match ? match[1].trim() : header;
}

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
