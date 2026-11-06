import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const POLICY = Object.freeze({
  maxFiles: 32, maxSourceBytes: 60000, maxManifestBytes: 2000000,
  maxArtifactFiles: 3000, maxArtifactFileBytes: 5000000, maxArtifactBytes: 30000000,
  commandTimeoutMs: 180000, logLimitBytes: 512000, scripts: ['lint', 'test', 'build']
});
const blocked = /^(?:\.env(?:\..*)?|\.npmrc|\.netrc|\.pypirc|\.git|\.github|\.ssh|\.aws|\.azure|\.config|node_modules)$/i;
const sensitive = /(?:secret|credential|password|private[_-]?key|id_(?:rsa|ed25519)|service[_-]?role|access[_-]?token)/i;
const blockedExt = /\.(?:pem|key|p12|pfx|p7b|p7c|jks|keystore)$/i;
const need = (ok, message) => { if (!ok) throw new Error(message); };
const inside = (base, candidate) => {
  const r = path.relative(base, candidate);
  return r === '' || (r !== '..' && !r.startsWith('..' + path.sep) && !path.isAbsolute(r));
};

export function safeRelativePath(value) {
  if (typeof value !== 'string' || !value || value.length > 240 || value.includes('\0') ||
      value.includes('\\') || value.startsWith('/') || /^[A-Za-z]:/.test(value)) return false;
  return value.split('/').every(p => p && p !== '.' && p !== '..' &&
    !blocked.test(p) && !sensitive.test(p) && !blockedExt.test(p));
}

export function validateForgeManifest(payload) {
  const m = payload && payload.manifest && typeof payload.manifest === 'object' ? payload.manifest : payload;
  need(m && typeof m === 'object', 'manifest_missing');
  const target = String(m.target_dir || '');
  const branch = String(m.branch_name || '');
  need(/^forge-workspaces\/[A-Za-z0-9][A-Za-z0-9._-]{0,100}$/.test(target), 'unsafe_target_dir');
  need(/^forge\/[A-Za-z0-9][A-Za-z0-9._-]{0,100}$/.test(branch), 'unsafe_branch_name');
  need(Array.isArray(m.files) && m.files.length > 0 && m.files.length <= POLICY.maxFiles, 'manifest_file_count_out_of_range');
  let total = 0;
  const seen = new Set();
  const files = m.files.map((f, i) => {
    need(f && typeof f === 'object' && typeof f.content === 'string', 'invalid_file_entry_' + i);
    const full = String(f.path || '');
    need(full.startsWith(target + '/'), 'file_outside_target_dir_' + i);
    const rel = full.slice(target.length + 1);
    need(safeRelativePath(rel), 'unsafe_file_path_' + i);
    const size = Buffer.byteLength(f.content, 'utf8');
    need(size <= POLICY.maxSourceBytes, 'source_file_too_large_' + i);
    total += size;
    need(total <= POLICY.maxManifestBytes, 'manifest_total_size_exceeded');
    const key = full.toLowerCase();
    need(!seen.has(key), 'duplicate_manifest_path_' + i);
    seen.add(key);
    return { path: full, relativePath: rel };
  });
  return { run_id: String(payload.run_id || ''), target_dir: target, branch_name: branch, files };
}

async function inspect(dir, rel = '', info = { files: 0, bytes: 0 }) {
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const name = rel ? rel + '/' + e.name : e.name;
    need(!blocked.test(e.name) && !sensitive.test(e.name) && !blockedExt.test(e.name), 'forbidden_workspace_entry:' + name);
    const full = path.join(dir, e.name);
    const st = await fs.lstat(full);
    need(!st.isSymbolicLink(), 'symlink_not_allowed:' + name);
    if (st.isDirectory()) await inspect(full, name, info);
    else {
      need(st.isFile() && st.size <= POLICY.maxSourceBytes, 'invalid_workspace_file:' + name);
      info.files++; info.bytes += st.size;
      need(info.files <= POLICY.maxFiles && info.bytes <= POLICY.maxManifestBytes, 'workspace_size_exceeded');
    }
  }
  return info;
}

async function verifyWorkspace(root, m) {
  const base = path.resolve(root);
  const dir = path.resolve(base, m.target_dir);
  need(inside(base, dir) && dir !== base, 'workspace_outside_repository');
  const st = await fs.lstat(dir);
  need(st.isDirectory() && !st.isSymbolicLink(), 'workspace_not_directory');
  for (const f of m.files) {
    let current = dir;
    for (const part of f.relativePath.split('/')) {
      current = path.join(current, part);
      need(!(await fs.lstat(current)).isSymbolicLink(), 'symlink_not_allowed:' + f.relativePath);
    }
    need((await fs.lstat(current)).isFile(), 'manifest_file_missing:' + f.relativePath);
  }
  await inspect(dir);
  return dir;
}

function minimalEnv(home) {
  return {
    PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
    HOME: home, TMPDIR: os.tmpdir(), CI: 'true', LANG: 'C.UTF-8',
    npm_config_cache: path.join(home, '.npm-cache'),
    npm_config_audit: 'false', npm_config_fund: 'false',
    npm_config_update_notifier: 'false', npm_config_yes: 'true'
  };
}

export async function runCommand({ command, args, cwd, env, timeoutMs = POLICY.commandTimeoutMs, logFile }) {
  await fs.mkdir(path.dirname(logFile), { recursive: true });
  const log = createWriteStream(logFile, { flags: 'w' });
  const started = Date.now();
  return await new Promise(resolve => {
    const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
    let written = 0, timedOut = false, settled = false, killTimer;
    const capture = chunk => {
      if (written >= POLICY.logLimitBytes) return;
      const p = chunk.subarray(0, POLICY.logLimitBytes - written);
      written += p.length;
      log.write(p);
    };
    child.stdout.on('data', capture);
    child.stderr.on('data', capture);
    const finish = result => {
      if (settled) return;
      settled = true;
      clearTimeout(timer); clearTimeout(killTimer);
      log.end(() => resolve({ ...result, timedOut, durationMs: Date.now() - started, logFile }));
    };
    const kill = signal => {
      try {
        if (child.pid && process.platform !== 'win32') process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch {}
    };
    const timer = setTimeout(() => {
      timedOut = true;
      kill('SIGTERM');
      killTimer = setTimeout(() => kill('SIGKILL'), 5000);
    }, timeoutMs);
    child.once('error', e => finish({ exitCode: null, error: e.message }));
    child.once('close', (code, signal) => finish({ exitCode: code ?? 1, signal }));
  });
}

async function copyTree(src, dest, rel = '', count = { files: 0, bytes: 0 }) {
  for (const e of await fs.readdir(src, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git') continue;
    const name = rel ? rel + '/' + e.name : e.name;
    need(safeRelativePath(name), 'unsafe_artifact_path:' + name);
    const from = path.join(src, e.name), to = path.join(dest, e.name);
    const st = await fs.lstat(from);
    need(!st.isSymbolicLink(), 'symlink_not_allowed:' + name);
    if (st.isDirectory()) {
      await fs.mkdir(to, { recursive: true });
      await copyTree(from, to, name, count);
    } else {
      need(st.isFile() && st.size <= POLICY.maxArtifactFileBytes, 'invalid_artifact_file:' + name);
      count.files++; count.bytes += st.size;
      need(count.files <= POLICY.maxArtifactFiles && count.bytes <= POLICY.maxArtifactBytes, 'artifact_size_exceeded');
      await fs.copyFile(from, to);
    }
  }
  return count;
}

export async function runForgeBuild({ root = process.cwd(), manifestPath = 'forge.json', outputDir = 'forge-output', commandRunner = runCommand } = {}) {
  const base = path.resolve(root), manifestFile = path.resolve(base, manifestPath);
  need(inside(base, manifestFile) && manifestFile !== base, 'manifest_path_outside_repository');
  const manifestText = await fs.readFile(manifestFile, 'utf8');
  need(Buffer.byteLength(manifestText, 'utf8') <= POLICY.maxManifestBytes, 'manifest_json_too_large');
  const payload = JSON.parse(manifestText), m = validateForgeManifest(payload);
  const workspace = await verifyWorkspace(base, m);
  const out = path.resolve(base, outputDir);
  need(inside(base, out) && out !== base && !inside(workspace, out), 'unsafe_output_path');
  await fs.rm(out, { recursive: true, force: true });
  await fs.mkdir(path.join(out, 'forge-logs'), { recursive: true });
  const report = {
    ok: true, runtime: 'midad-linux-worker', version: 1,
    run_id: m.run_id || null, target_dir: m.target_dir, mode: 'source-only',
    stages: {}, limits: { command_timeout_ms: POLICY.commandTimeoutMs, source_files: POLICY.maxFiles, artifact_bytes: POLICY.maxArtifactBytes },
    artifact: null
  };
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'midad-worker-home-'));
  try {
    let pkg = null;
    try { pkg = JSON.parse(await fs.readFile(path.join(workspace, 'package.json'), 'utf8')); }
    catch (e) { if (e.code !== 'ENOENT') throw new Error('invalid_package_json:' + e.message); }
    if (pkg) {
      need(pkg.scripts === undefined || (pkg.scripts && typeof pkg.scripts === 'object' && !Array.isArray(pkg.scripts)), 'invalid_package_scripts');
      report.mode = 'node-app';
      const stages = [
        { name: 'install', args: ['install', '--ignore-scripts', '--no-audit', '--no-fund'] },
        ...POLICY.scripts.filter(n => typeof pkg.scripts?.[n] === 'string' && pkg.scripts[n].trim())
          .map(n => ({ name: n, args: ['run', '--ignore-scripts', '--if-present', n] }))
      ];
      for (const stage of stages) {
        const result = await commandRunner({
          command: 'npm', args: stage.args, cwd: workspace, env: minimalEnv(home),
          timeoutMs: POLICY.commandTimeoutMs, logFile: path.join(out, 'forge-logs', stage.name + '.log')
        });
        const ok = result.exitCode === 0 && !result.timedOut;
        report.stages[stage.name] = {
          ok, exit_code: result.exitCode, timed_out: !!result.timedOut,
          duration_ms: result.durationMs, log: 'forge-logs/' + stage.name + '.log'
        };
        if (!ok) report.ok = false;
      }
    }
    const artifactTarget = path.join(out, m.target_dir);
    await fs.mkdir(artifactTarget, { recursive: true });
    const inventory = await copyTree(workspace, artifactTarget);
    report.artifact = { files: inventory.files, bytes: inventory.bytes, target_dir: m.target_dir };
    await fs.copyFile(manifestFile, path.join(out, 'forge.json'));
    await fs.writeFile(path.join(out, 'forge-build-report.json'), JSON.stringify(report, null, 2) + '\n');
    return { ok: report.ok, report, outputDir: out };
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
}

function parseArgs(args) {
  const o = {};
  for (let i = 0; i < args.length; i += 2) {
    const k = args[i];
    need(['--manifest', '--output'].includes(k) && args[i + 1], 'unsupported_or_missing_argument:' + k);
    o[k.slice(2)] = args[i + 1];
  }
  return o;
}
async function main() {
  const a = parseArgs(process.argv.slice(2));
  const result = await runForgeBuild({ manifestPath: a.manifest || 'forge.json', outputDir: a.output || 'forge-output' });
  console.log(JSON.stringify(result.report));
  if (!result.ok) process.exitCode = 1;
}
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch(e => {
    console.error(JSON.stringify({ ok: false, runtime: 'midad-linux-worker', error: String(e.message || e).slice(0, 1200) }));
    process.exitCode = 1;
  });
}
