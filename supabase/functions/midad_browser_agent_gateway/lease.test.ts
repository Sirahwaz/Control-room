import {
  hashLeaseToken,
  normalizeLeaseJobId,
  normalizeLeaseLimit,
  normalizeLeaseOwnerId,
  normalizeLeaseSeconds,
  normalizeLeaseToken,
  normalizeLeaseWorkerId,
} from "./lease.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("worker ids accept bounded opaque identifiers and reject unsafe values", () => {
  assert(normalizeLeaseWorkerId("worker-A:17") === "worker-A:17", "valid worker id rejected");
  for (const value of ["", "ab", "worker id", "../worker", "worker\n", 17, null]) {
    assert(normalizeLeaseWorkerId(value) === null, "unsafe worker id accepted");
  }
});

Deno.test("lease tokens must be random-looking bounded opaque strings", () => {
  assert(normalizeLeaseToken("a".repeat(64)) !== null, "valid token rejected");
  for (const value of ["", "short", "x".repeat(201), "token with spaces", 99, null]) {
    assert(normalizeLeaseToken(value) === null, "invalid token accepted");
  }
});

Deno.test("lease owner and job references must be UUIDs", () => {
  const uuid = "00000000-0000-4000-8000-000000000001";
  assert(normalizeLeaseJobId(uuid) === uuid, "valid job id rejected");
  assert(normalizeLeaseOwnerId(uuid) === uuid, "valid owner id rejected");
  assert(normalizeLeaseJobId("not-a-uuid") === null, "invalid job id accepted");
});

Deno.test("lease durations and batch sizes are strictly bounded", () => {
  assert(normalizeLeaseSeconds(undefined) === 120, "default lease duration mismatch");
  assert(normalizeLeaseSeconds(30) === 30, "minimum lease duration rejected");
  assert(normalizeLeaseSeconds(300) === 300, "maximum lease duration rejected");
  for (const value of [0, 29, 301, "1.5", "not-a-number"]) {
    assert(normalizeLeaseSeconds(value) === null, "invalid lease duration accepted");
  }
  assert(normalizeLeaseLimit(undefined) === 5, "default batch size mismatch");
  assert(normalizeLeaseLimit(20) === 20, "maximum batch size rejected");
  for (const value of [0, 21, 1.5, "abc"]) {
    assert(normalizeLeaseLimit(value) === null, "invalid batch size accepted");
  }
});

Deno.test("lease token hashing returns SHA-256 and never returns the token", async () => {
  const token = "midad-worker-lease-token-" + "a".repeat(48);
  const digest = await hashLeaseToken(token);
  assert(/^[a-f0-9]{64}$/.test(digest), "digest must be SHA-256");
  assert(digest !== token, "plaintext token must not be persisted as digest");
  assert(digest === await hashLeaseToken(token), "token digest must be deterministic");
});
