import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const readRepo = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("both UEFI QEMU boot paths map the loader's fixed payload window into guest RAM", async () => {
  const [workflow, loader] = await Promise.all([
    readRepo("../../../.github/workflows/midad-hakios-qemu-smoke.yml"),
    readRepo("../../../hakios/xnuloader/loader.c"),
  ]);

  const baseMatch = loader.match(/#define\s+PAYLOAD_BASE\s+0x([0-9A-Fa-f]+)ULL/);
  const sizeMatch = loader.match(/#define\s+PAYLOAD_MAX_SIZE\s+0x([0-9A-Fa-f]+)ULL/);
  assert.ok(baseMatch, "pinned XNULOADER must declare PAYLOAD_BASE");
  assert.ok(sizeMatch, "pinned XNULOADER must declare PAYLOAD_MAX_SIZE");

  const payloadEnd = Number.parseInt(baseMatch[1], 16) + Number.parseInt(sizeMatch[1], 16);
  const bootStart = workflow.indexOf("- name: Boot HakiOS open kernel under QEMU");
  const uploadStart = workflow.indexOf("- name: Upload bounded boot log", bootStart);
  assert.ok(bootStart >= 0 && uploadStart > bootStart, "UEFI boot step must exist");
  const bootStep = workflow.slice(bootStart, uploadStart);

  const configuredMemories = [...bootStep.matchAll(/QEMU_MEM=([0-9]+)G/g)].map((m) => Number(m[1]));
  assert.deepEqual(configuredMemories, [6, 6], "UEFI-ESP and loader-device must both use the 6 GiB baseline");
  assert.ok(configuredMemories.every((gb) => gb * 1024 ** 3 >= payloadEnd),
    "guest RAM must cover the full fixed payload window that XNULOADER probes before its banner");
  assert.match(bootStep, /QEMU_ESP=1/, "UEFI-ESP must keep its volume-backed payload path");
  assert.doesNotMatch(bootStep, /QEMU_MEM=2G/, "2 GiB RAM cannot cover the fixed 0xF0000000 payload address");
});
