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
