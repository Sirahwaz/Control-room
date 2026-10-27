import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "index.ts"), "utf8");

test("public-source checker keeps a stable typed result on every early return", () => {
  assert.match(source, /type PublicFetchResult =/);
  assert.match(source, /fetchPublic\(source: string, rawUrl: string\): Promise<PublicFetchResult>/);
  assert.match(source, /if \(!url\) return \{ ok: false, status: 0, error: "no_official_source_url" \};/);
  assert.match(source, /invalid_source_url[^\n]*url: null, hash: null, excerpt: ""/);
  assert.match(source, /source_host_not_allowlisted[^\n]*url: null, hash: null, excerpt: ""/);
});

test("payout proof remains gated by the independent verifier result", () => {
  const verifyStart = source.indexOf("const checked = baseRail ? await verifyTaskmarketBase(t) : await verifyTaskmarketTempo(t);");
  const verified = source.indexOf("if (checked.verified)", verifyStart);
  const markPaidProof = source.indexOf("await markPayoutVerified", verifyStart);
  assert.ok(verifyStart >= 0 && verified > verifyStart && markPaidProof > verified);
  assert.match(source.slice(verifyStart, markPaidProof), /if \(checked\.unsupported\)/);
  assert.match(source.slice(verifyStart, markPaidProof), /if \(checked\.retryable\)/);
  assert.match(source.slice(verifyStart, markPaidProof), /external_action_allowed: false/);
});

test("payout evidence is JSON-normalized and the queue row ID is explicit", () => {
  assert.equal((source.match(/evidence as any/g) || []).length, 2);
  assert.match(source, /type ClaimedQueueTask =/);
  assert.match(source, /async function claimOne\(skipIds: string\[\]\): Promise<ClaimedQueueTask \| null>/);
  assert.match(source, /const t = rows\[0\] as unknown as ClaimedQueueTask/);
});

test("revenue worker retains fail-closed defaults for external actions", () => {
  assert.match(source, /external_action_allowed: false/);
  assert.match(source, /external_actions: \["none"\]/);
  assert.match(source, /claimBondUsd|claim_bond_usd/);
});
