import { appendFile, mkdir, readFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";

const MAX_NOTE_CHARS = 8000;
const SECRET_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/i,
  /\b(?:sk-[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{20,}|gh[pousr]_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16})\b/,
  /\b0x[a-fA-F0-9]{64}\b/,
  /(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|password|private[_ -]?key|secret|mnemonic|recovery phrase|seed phrase)\s*["']?\s*[:=]\s*["']?[^,\s"'<>]{8,}/i
];
const STOP_WORDS = new Set(["the", "and", "for", "with", "from", "that", "this", "into", "are", "was", "were", "has", "have", "had", "the", "من", "في", "على", "إلى", "عن", "هذا", "هذه"]);

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function normalizeTokens(value) {
  return [...new Set(String(value ?? "")
    .toLocaleLowerCase()
    .match(/[\p{L}\p{N}]+/gu) ?? [])]
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

function detectSecret(value) {
  return SECRET_PATTERNS.some((pattern) => pattern.test(value));
}

function validateDate(value) {
  if (value === null || value === undefined || value === "") return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new TypeError("validUntil must be a valid date.");
  return date.toISOString();
}

export function createMemoryStore({ filePath, ownerId, now = () => new Date() } = {}) {
  if (typeof filePath !== "string" || !filePath.trim()) {
    throw new TypeError("filePath is required.");
  }
  if (typeof ownerId !== "string" || !ownerId.trim() || ownerId.length > 128) {
    throw new TypeError("ownerId must be a non-empty namespace of at most 128 characters.");
  }

  const targetFile = resolve(filePath);
  const namespace = ownerId.trim();
  let writeQueue = Promise.resolve();

  async function readRecords() {
    let data;
    try {
      data = await readFile(targetFile, "utf8");
    } catch (error) {
      if (error?.code === "ENOENT") return [];
      throw new Error("Memory log could not be read.");
    }
    if (!data.trim()) return [];
    const records = [];
    for (const [index, line] of data.split(/\r?\n/).entries()) {
      if (!line.trim()) continue;
      try {
        const record = JSON.parse(line);
        if (!record || record.schemaVersion !== "context-forge-memory/0.1" || typeof record.id !== "string") {
          throw new Error("Invalid memory record.");
        }
        records.push(record);
      } catch {
        throw new Error("Memory log is corrupt at line " + (index + 1) + "; reads are blocked to avoid silently losing records.");
      }
    }
    return records;
  }

  async function appendRecord(record) {
    const write = async () => {
      await mkdir(dirname(targetFile), { recursive: true, mode: 0o700 });
      await appendFile(targetFile, JSON.stringify(record) + "\n", { encoding: "utf8", mode: 0o600 });
    };
    const task = writeQueue.then(write);
    writeQueue = task.catch(() => {});
    await task;
    return record;
  }

  return {
    async saveUserNote(text, { label = "user note", validUntil = null } = {}) {
      if (typeof text !== "string" || !text.trim()) {
        throw new TypeError("A non-empty note is required.");
      }
      if (text.length > MAX_NOTE_CHARS) {
        throw new RangeError("Note exceeds the configured length limit.");
      }
      if (typeof label !== "string" || label.length > 200) {
        throw new TypeError("Source label must be a string under 200 characters.");
      }
      if (detectSecret(text) || detectSecret(label)) {
        throw new Error("Potential sensitive material detected. The memory note was not written.");
      }

      const timestamp = now().toISOString();
      const record = {
        schemaVersion: "context-forge-memory/0.1",
        recordType: "user_note",
        id: "mem_" + randomUUID().replaceAll("-", ""),
        ownerId: namespace,
        text: text.trim(),
        status: "PENDING",
        contentHash: sha256(text.trim()),
        source: {
          type: "user_input",
          label: label.trim() || "user note",
          capturedAt: timestamp
        },
        createdAt: timestamp,
        validUntil: validateDate(validUntil),
        verification: null,
        revision: 1,
        supersedes: []
      };
      await appendRecord(record);
      return record;
    },

    async saveAgentCycle({
      goal,
      contextHash,
      planId,
      planVerification,
      plannedSteps = [],
      relatedMemoryIds = [],
      learning
    } = {}) {
      if (typeof goal !== "string" || !goal.trim() || goal.length > 2000) {
        throw new TypeError("Agent cycle goal must be non-empty and at most 2000 characters.");
      }
      if (detectSecret(goal)) {
        throw new Error("Potential sensitive material detected in the goal; the cycle record was not written.");
      }
      if (typeof contextHash !== "string" || !/^[a-f0-9]{64}$/i.test(contextHash)) {
        throw new TypeError("contextHash must be a SHA-256 hex digest.");
      }
      if (typeof planId !== "string" || !/^[A-Za-z0-9_-]{4,128}$/.test(planId)) {
        throw new TypeError("planId must be a bounded identifier.");
      }
      if (!planVerification || planVerification.status !== "VERIFIED"
          || planVerification.scope !== "plan_policy_only"
          || planVerification.method !== "deterministic_plan_policy"
          || typeof planVerification.evidenceHash !== "string"
          || !/^[a-f0-9]{64}$/i.test(planVerification.evidenceHash)
          || !Array.isArray(planVerification.checks)
          || planVerification.checks.length === 0
          || planVerification.checks.some((check) => !check || check.passed !== true
            || typeof check.code !== "string" || !/^[A-Z0-9_]{2,80}$/.test(check.code))) {
        throw new Error("Plan verification evidence must pass the deterministic plan policy checks before cycle memory is written.");
      }
      if (!Array.isArray(plannedSteps) || plannedSteps.length > 16) {
        throw new TypeError("plannedSteps must be an array with at most 16 entries.");
      }
      const safeSteps = plannedSteps.map((step) => {
        if (!step || typeof step.tool !== "string" || !/^[A-Za-z0-9_.:-]{1,100}$/.test(step.tool)) {
          throw new TypeError("Each planned step must identify a valid tool name.");
        }
        const expectedOutcome = typeof step.expectedOutcome === "string" ? step.expectedOutcome.trim().slice(0, 240) : "";
        if (detectSecret(expectedOutcome)) {
          throw new Error("Potential sensitive material detected in a planned outcome.");
        }
        return {
          tool: step.tool,
          effect: typeof step.effect === "string" ? step.effect.slice(0, 40) : "unknown",
          expectedOutcome
        };
      });
      if (!Array.isArray(relatedMemoryIds) || relatedMemoryIds.length > 20
          || relatedMemoryIds.some((id) => typeof id !== "string" || id.length > 128)) {
        throw new TypeError("relatedMemoryIds must contain at most 20 bounded IDs.");
      }
      if (!learning || learning.status !== "INFERRED"
          || !learning.signals || typeof learning.signals !== "object"
          || !Array.isArray(learning.recommendations) || learning.recommendations.length > 8) {
        throw new Error("Learning output must be explicitly labeled INFERRED and contain structured signals.");
      }
      const recommendations = learning.recommendations.map((value) => {
        if (typeof value !== "string" || value.length > 240 || detectSecret(value)) {
          throw new TypeError("Learning recommendations must be short, non-sensitive strings.");
        }
        return value;
      });
      const signals = {
        stepCount: Math.min(16, Math.max(0, Number(learning.signals.stepCount) || 0)),
        stepsWithExpectedOutcome: Math.min(16, Math.max(0, Number(learning.signals.stepsWithExpectedOutcome) || 0)),
        contextConflictCount: Math.min(1000, Math.max(0, Number(learning.signals.contextConflictCount) || 0)),
        retrievedMemoryCount: Math.min(20, Math.max(0, Number(learning.signals.retrievedMemoryCount) || 0))
      };
      if (signals.stepsWithExpectedOutcome > signals.stepCount) {
        throw new TypeError("Learning signals are inconsistent.");
      }
      const timestamp = now().toISOString();
      const text = [
        "Agent cycle goal: " + goal.trim(),
        "Plan ID: " + planId,
        "Planned tools: " + safeSteps.map((step) => step.tool).join(", "),
        "Inferred recommendations: " + recommendations.join(" ")
      ].join("\n").slice(0, MAX_NOTE_CHARS);
      const cycle = {
        planId,
        contextHash: contextHash.toLowerCase(),
        planVerification: {
          status: "VERIFIED",
          scope: "plan_policy_only",
          method: "deterministic_plan_policy",
          evidenceHash: planVerification.evidenceHash.toLowerCase(),
          checks: planVerification.checks.map((check) => ({ code: check.code, passed: true }))
        },
        plannedSteps: safeSteps,
        relatedMemoryIds: [...new Set(relatedMemoryIds)],
        learning: { status: "INFERRED", signals, recommendations }
      };
      const record = {
        schemaVersion: "context-forge-memory/0.1",
        recordType: "agent_cycle",
        id: "mem_" + randomUUID().replaceAll("-", ""),
        ownerId: namespace,
        text,
        status: "PENDING",
        contentHash: sha256(JSON.stringify(cycle)),
        source: {
          type: "agent_runtime",
          label: "Context Forge bounded agent cycle",
          capturedAt: timestamp
        },
        createdAt: timestamp,
        validUntil: null,
        verification: cycle.planVerification,
        revision: 1,
        supersedes: [],
        cycle
      };
      await appendRecord(record);
      return record;
    },

    async getLearningReport({ limit = 100 } = {}) {
      const count = Number.isInteger(limit) ? Math.max(1, Math.min(500, limit)) : 100;
      const records = (await readRecords())
        .filter((record) => record.ownerId === namespace
          && record.recordType === "agent_cycle"
          && record.status !== "REVOKED"
          && (!record.validUntil || Date.parse(record.validUntil) > now().getTime()))
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
        .slice(0, count);
      const metrics = { steps: 0, stepsWithExpectedOutcome: 0, conflictsObserved: 0, cyclesUsingMemory: 0 };
      const recommendationCounts = new Map();
      for (const record of records) {
        const learning = record.cycle?.learning;
        const signals = learning?.signals ?? {};
        metrics.steps += Math.max(0, Number(signals.stepCount) || 0);
        metrics.stepsWithExpectedOutcome += Math.max(0, Number(signals.stepsWithExpectedOutcome) || 0);
        metrics.conflictsObserved += Math.max(0, Number(signals.contextConflictCount) || 0);
        if (Math.max(0, Number(signals.retrievedMemoryCount) || 0) > 0) metrics.cyclesUsingMemory += 1;
        for (const recommendation of Array.isArray(learning?.recommendations) ? learning.recommendations : []) {
          if (typeof recommendation !== "string") continue;
          recommendationCounts.set(recommendation, (recommendationCounts.get(recommendation) ?? 0) + 1);
        }
      }
      return {
        status: records.length > 0 ? "INFERRED" : "PENDING",
        cyclesAnalyzed: records.length,
        taskCompletionProven: false,
        source: "stored_cycle_metadata",
        metrics,
        recommendations: [...recommendationCounts.entries()]
          .map(([recommendation, occurrences]) => ({ recommendation, occurrences, status: "INFERRED" }))
          .sort((a, b) => b.occurrences - a.occurrences || a.recommendation.localeCompare(b.recommendation))
          .slice(0, 20)
      };
    },

    async list({ limit = 50 } = {}) {
      const count = Number.isInteger(limit) ? Math.max(1, Math.min(100, limit)) : 50;
      const records = await readRecords();
      return records
        .filter((record) => record.ownerId === namespace && record.status !== "REVOKED")
        .filter((record) => !record.validUntil || Date.parse(record.validUntil) > now().getTime())
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
        .slice(0, count);
    },

    async search(query, { limit = 10 } = {}) {
      if (typeof query !== "string" || !query.trim()) {
        throw new TypeError("A non-empty search query is required.");
      }
      const queryTokens = normalizeTokens(query);
      if (queryTokens.length === 0) return [];
      const records = await this.list({ limit: 100 });
      return records.map((record) => {
        const contentTokens = new Set(normalizeTokens(record.text + " " + record.source.label));
        const matches = queryTokens.filter((token) => contentTokens.has(token));
        return { record, score: matches.length / queryTokens.length, matches: matches.length };
      })
        .filter((item) => item.matches > 0)
        .sort((a, b) => b.score - a.score || Date.parse(b.record.createdAt) - Date.parse(a.record.createdAt))
        .slice(0, Number.isInteger(limit) ? Math.max(1, Math.min(50, limit)) : 10)
        .map((item) => ({ ...item.record, retrieval: { score: item.score, matchedTerms: item.matches } }));
    }
  };
}
