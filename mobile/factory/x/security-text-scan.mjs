import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PRIVATE_KEY_HEADER = /^-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----$/;
const IGNORE_DIRS = new Set(['.git', 'node_modules', '.factory-cache', '.cache', 'dist', 'build']);

export function containsPrivateKeyBlock(source) {
  const lines = String(source).split(/\r?\n/);
  for (let start = 0; start < lines.length; start += 1) {
    const header = lines[start].trim();
    const match = header.match(PRIVATE_KEY_HEADER);
    if (!match) continue;

    const label = match[1] || '';
    const footer = '-----END ' + label + 'PRIVATE KEY-----';
    let bodyChars = 0;
    let bodyLines = 0;
    let validBody = true;

    for (let lineIndex = start + 1; lineIndex < lines.length; lineIndex += 1) {
      const line = lines[lineIndex].trim();
      if (line === footer) {
        if (validBody && bodyLines > 0 && bodyChars >= 80) return true;
        break;
      }
      if (!line || !/^[A-Za-z0-9+/]+={0,2}$/.test(line)) {
        validBody = false;
        break;
      }
      bodyChars += line.length;
      bodyLines += 1;
    }
  }
  return false;
}

export function containsKnownSecretPattern(source) {
  const text = String(source);
  const serviceRoleName = ['SUPABASE', '_SERVICE', '_ROLE_KEY'].join('');
  const patterns = [
    new RegExp(serviceRoleName),
    /(?:sk-or-|sk-)[A-Za-z0-9_-]{20,}/,
    /AIza[0-9A-Za-z_-]{20,}/,
  ];
  return patterns.some(pattern => pattern.test(text));
}

async function walk(directory, output = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!IGNORE_DIRS.has(entry.name)) await walk(path.join(directory, entry.name), output);
      continue;
    }
    if (!entry.isFile() || entry.name.endsWith('.lock')) continue;
    output.push(path.join(directory, entry.name));
  }
  return output;
}

export async function scanFactoryTree(root = ROOT) {
  const findings = [];
  const files = await walk(root);
  for (const file of files) {
    const content = await readFile(file, 'utf8');
    const relative = path.relative(root, file).replaceAll(path.sep, '/');
    if (containsPrivateKeyBlock(content)) findings.push({ file: relative, rule: 'COMPLETE_PRIVATE_KEY_PEM' });
    if (containsKnownSecretPattern(content)) findings.push({ file: relative, rule: 'KNOWN_CREDENTIAL_PATTERN' });
  }
  return { ok: findings.length === 0, scanned_files: files.length, findings };
}

async function main() {
  const result = await scanFactoryTree();
  if (!result.ok) {
    process.stderr.write(JSON.stringify(result) + '\n');
    process.exitCode = 1;
    return;
  }
  process.stdout.write(JSON.stringify({
    ok: true,
    scanned_files: result.scanned_files,
    findings: 0,
  }) + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => {
    process.stderr.write('SECURITY_SCAN_FAILED: ' + String(error?.message || 'UNKNOWN') + '\n');
    process.exitCode = 1;
  });
}
