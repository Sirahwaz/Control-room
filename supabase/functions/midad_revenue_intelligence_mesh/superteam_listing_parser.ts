/**
 * Safe, public-feed fallback for Superteam's agent listing discovery.
 *
 * This parser only returns explicitly agent-eligible OPEN listings from a
 * public feed. It never signs in, claims, or submits work, and it does not
 * treat the mere existence of a listing as proof of payout.
 */
export type SuperteamPublicListing = Record<string, unknown>;

function asRecord(value: unknown): SuperteamPublicListing | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as SuperteamPublicListing;
}

function rowsFrom(value: unknown, depth = 0): unknown[] {
  if (Array.isArray(value)) return value;
  if (depth > 2) return [];
  const record = asRecord(value);
  if (!record) return [];

  for (const key of ["listings", "results", "bounties", "data"]) {
    const child = record[key];
    if (Array.isArray(child)) return child;
    if (child && typeof child === "object") {
      const nested = rowsFrom(child, depth + 1);
      if (nested.length) return nested;
    }
  }
  return [];
}

function isFutureOrUndated(value: unknown, now: Date): boolean {
  if (value === null || value === undefined || value === "") return true;
  const deadline = new Date(String(value));
  return Number.isFinite(deadline.getTime()) && deadline.getTime() > now.getTime();
}

export function parseAgentEligibleSuperteamListings(
  body: unknown,
  now = new Date(),
): SuperteamPublicListing[] {
  return rowsFrom(body).map(asRecord).filter(
    (listing): listing is SuperteamPublicListing => listing !== null,
  ).filter((listing) => {
    const access = String(listing.agentAccess ?? "").trim().toUpperCase();
    const status = String(listing.status ?? "").trim().toUpperCase();
    const winnersAnnounced = String(listing.isWinnersAnnounced ?? "").trim().toLowerCase() === "true";
    const id = String(listing.slug ?? listing.id ?? "").trim();
    const title = String(listing.title ?? listing.name ?? "").trim();
    const deadline = listing.deadline ?? listing.expiresAt ?? listing.expires_at;
    return access === "AGENT_ALLOWED"
      && status === "OPEN"
      && !winnersAnnounced
      && id.length > 0
      && title.length > 0
      && isFutureOrUndated(deadline, now);
  });
}


export function normalizeSuperteamPublicListing(
  listing: SuperteamPublicListing,
): SuperteamPublicListing {
  const slug = String(listing.slug ?? listing.id ?? "").trim();
  const tokenRecord = asRecord(listing.token);
  const compensationRecord = asRecord(listing.compensation) ?? asRecord(listing.payout) ?? {};
  const token = typeof listing.token === "string"
    ? listing.token
    : String(tokenRecord?.symbol ?? tokenRecord?.ticker ?? tokenRecord?.name ?? "");
  const asset = String(
    compensationRecord.asset ?? compensationRecord.token ??
    listing.payoutAsset ?? listing.rewardAsset ?? token
  ).trim().toUpperCase();
  const amount = compensationRecord.amount ?? null;
  const url = String(
    listing.url ?? listing.official_listing_url ??
    (slug ? `https://superteam.fun/earn/listing/${encodeURIComponent(slug)}` : "")
  );

  // rewardAmount may represent a shared prize pool; never reinterpret it as
  // an individual reward. Only preserve an explicit individual amount.
  return {
    ...listing,
    id: slug || listing.id,
    url,
    compensation: { ...compensationRecord, asset, amount },
  };
}
