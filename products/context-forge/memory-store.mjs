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
