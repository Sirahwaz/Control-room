import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { validateForgeManifest, runForgeBuild } from '../compute/mncf/runtime/worker.mjs';

const target = 'forge-workspaces/demo-12345678';
function manifest(overrides = {}) {
  return {
    run_id: '12345678-1234-4123-8123-123456789abc',
    manifest: {
      app_name: 'Demo', target_dir: target, branch_name: 'forge/demo-12345678',
      files: [
        { path: target + '/index.html', content: '<!doctype html><title>Demo</title>' },
        { path: target + '/package.json', content: JSON.stringify({ scripts: {
          preinstall: 'echo SHOULD_NOT_RUN', postinstall: 'echo SHOULD_NOT_RUN',
          lint: 'echo lint', test: 'echo test', build: 'echo build'
        } }) }
      ],
      ...overrides
    }
  };
}
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'midad-worker-'));
  const value = manifest();
  await fs.writeFile(path.join(root, 'forge.json'), JSON.stringify(value));
  for (const file of value.manifest.files) {
    const destination = path.join(root, file.path);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, file.content);
  }
  return root;
}

test('validates a Forge manifest and confines files to its workspace', () => {
  const result = validateForgeManifest(manifest());
  assert.equal(result.target_dir, target);
  assert.equal(result.files.length, 2);
});

test('rejects traversal, absolute paths, hidden credentials, and workflow injection', () => {
  for (const bad of [
    target + '/../outside.txt', target + '/.env.production',
    target + '/.github/workflows/pwn.yml', target + '/certs/service.pem',
    '/tmp/outside.txt', target + '\\..\\outside.txt'
  ]) {
    assert.throws(() => validateForgeManifest(manifest({ files: [{ path: bad, content: 'x' }] })));
  }
});

test('rejects branch names and workspace names outside the publish contract', () => {
  assert.throws(() => validateForgeManifest(manifest({ branch_name: 'main;rm -rf' })));
  assert.throws(() => validateForgeManifest(manifest({ target_dir: 'forge-workspaces/../outside' })));
});

test('runs only allowlisted npm stages with a secret-free environment and packages safe files', async () => {
  const root = await fixture();
  const calls = [];
  const result = await runForgeBuild({
    root,
    commandRunner: async ({ command, args, env }) => {
      calls.push({ command, args, env });
      return { exitCode: 0, timedOut: false, durationMs: 2 };
    }
  });
  assert.equal(result.ok, true);
  assert.deepEqual(calls.map(c => c.args.at(-1)), ['--no-fund', 'lint', 'test', 'build']);
  assert.equal(calls[0].args[0], 'install');
  assert.ok(calls.every(c => !('GITHUB_TOKEN' in c.env) && !('SUPABASE_SERVICE_ROLE_KEY' in c.env)));
  assert.ok(calls.slice(1).every(c => c.args.includes('--ignore-scripts')));
  const output = path.join(root, 'forge-output', target);
  assert.equal(await fs.readFile(path.join(output, 'index.html'), 'utf8'), '<!doctype html><title>Demo</title>');
  assert.equal(JSON.parse(await fs.readFile(path.join(root, 'forge-output/forge-build-report.json'), 'utf8')).ok, true);
  await fs.rm(root, { recursive: true, force: true });
});

test('records failed commands, keeps diagnostics, and returns a failed result', async () => {
  const root = await fixture();
  const result = await runForgeBuild({
    root,
    commandRunner: async ({ args }) => ({ exitCode: args.at(-1) === 'test' ? 1 : 0, timedOut: false, durationMs: 1 })
  });
  assert.equal(result.ok, false);
  assert.equal(result.report.stages.test.ok, false);
  assert.ok(await fs.stat(path.join(root, 'forge-output', target, 'index.html')));
  await fs.rm(root, { recursive: true, force: true });
});

test('rejects symlinks in generated workspaces before executing package code', async () => {
  const root = await fixture();
  await fs.symlink('/etc/passwd', path.join(root, target, 'outside-link'));
  let called = false;
  await assert.rejects(() => runForgeBuild({
    root,
    commandRunner: async () => { called = true; return { exitCode: 0, timedOut: false, durationMs: 1 }; }
  }));
  assert.equal(called, false);
  await fs.rm(root, { recursive: true, force: true });
});
