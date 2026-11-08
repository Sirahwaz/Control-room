import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  validateManifest,
  analyzeImpact,
  auditWorkspace,
  createProvenanceRecord,
  normalizeRelativePath,
} from '../tools/architecture-governance/validator.mjs';

function fixture(root) {
  fs.mkdirSync(path.join(root, 'assets', 'ui'), { recursive: true });
  fs.mkdirSync(path.join(root, 'pwa'), { recursive: true });
  fs.mkdirSync(path.join(root, '.github', 'workflows'), { recursive: true });
  fs.mkdirSync(path.join(root, 'architecture', 'governance'), { recursive: true });
  fs.mkdirSync(path.join(root, 'tools', 'architecture-governance'), { recursive: true });
  fs.writeFileSync(path.join(root, 'index.html'), '<html></html>');
  fs.writeFileSync(path.join(root, 'assets', 'ui', 'app.js'), 'console.log("ui");');
  fs.writeFileSync(path.join(root, 'pwa', 'worker.js'), 'self.addEventListener("fetch", () => {});');
  fs.writeFileSync(path.join(root, '.github', 'workflows', 'verify.yml'), 'name: verify');
  fs.writeFileSync(path.join(root, 'architecture', 'governance', 'manifest.json'), '{}');
  fs.writeFileSync(path.join(root, 'tools', 'architecture-governance', 'cli.mjs'), '/* cli */');
  return {
    schemaVersion: 1,
    auditDate: '2026-11-08',
    currentRepository: 'control-room',
    canonicalRepository: 'control-room',
    repositories: [
      { id: 'control-room', fullName: 'Sirahwaz/Control-room', visibility: 'public', role: 'canonical_application', status: 'active', defaultBranch: 'main' },
      { id: 'genesis0', fullName: 'Sirahwaz/midad-genesis0', visibility: 'private', role: 'independent_research', status: 'active', defaultBranch: 'main' },
    ],
    modules: [
      { id: 'control-room-entry', repository: 'control-room', domain: 'control-plane', kind: 'entrypoint', paths: ['index.html'], status: 'active' },
      { id: 'control-room-ui', repository: 'control-room', domain: 'control-plane', kind: 'runtime', paths: ['assets/ui/'], status: 'active' },
      { id: 'pwa-runtime', repository: 'control-room', domain: 'pwa', kind: 'runtime', paths: ['pwa/'], status: 'active' },
      { id: 'github-workflows', repository: 'control-room', domain: 'ci-cd', kind: 'automation', paths: ['.github/workflows/'], status: 'active' },
      { id: 'governance-registry', repository: 'control-room', domain: 'architecture-governance', kind: 'registry', paths: ['architecture/governance/'], status: 'active' },
      { id: 'developer-tools', repository: 'control-room', domain: 'developer-tooling', kind: 'tooling', paths: ['tools/'], status: 'active' },
      { id: 'architecture-governance-tooling', repository: 'control-room', domain: 'architecture-governance', kind: 'tooling', paths: ['tools/architecture-governance/'], status: 'active' },
      { id: 'genesis0-bridge', repository: 'genesis0', domain: 'research-integration', kind: 'adapter', paths: ['integrations/midad_agi_lab_bridge.py'], status: 'active' },
    ],
    dependencies: [
      { from: 'control-room-entry', to: 'control-room-ui', relationship: 'runtime', evidence: [{ repository: 'control-room', path: 'index.html', note: 'Loads the UI bundle.' }] },
      { from: 'control-room-entry', to: 'pwa-runtime', relationship: 'runtime', evidence: [{ repository: 'control-room', path: 'index.html', note: 'Registers the PWA service worker.' }] },
      { from: 'genesis0-bridge', to: 'control-room-entry', relationship: 'optional-integration', evidence: [{ repository: 'genesis0', path: 'integrations/midad_agi_lab_bridge.py', note: 'Bounded handoff adapter.' }] },
    ],
    policy: {
      managedRoots: ['assets/', 'pwa/', '.github/workflows/', 'architecture/governance/'],
      rootAssetExtensions: ['.html', '.js', '.css', '.mjs', '.webmanifest'],
    },
  };
}

test('accepts a well-formed registry and dependency graph with existing local evidence', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'midad-governance-valid-'));
  try {
    const manifest = fixture(root);
    const result = validateManifest(manifest, { root });
    assert.equal(result.valid, true, JSON.stringify(result.errors));
    assert.equal(result.repositoryCount, 2);
    assert.equal(result.moduleCount, 8);
    assert.equal(result.dependencyCount, 3);
    assert.ok(result.moduleHealth.filter(module => module.repository === 'control-room').every(module => module.status === 'VERIFIED'));
    assert.equal(result.moduleHealth.find(module => module.repository === 'genesis0').status, 'NOT_CHECKED_EXTERNAL');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('rejects duplicate repository and module identifiers and unknown repository owners', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'midad-governance-ids-'));
  try {
    const manifest = fixture(root);
    manifest.repositories.push({ ...manifest.repositories[0] });
    manifest.modules[1].id = manifest.modules[0].id;
    manifest.modules[2].repository = 'missing-repository';
    const result = validateManifest(manifest, { root });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(x => x.code === 'DUPLICATE_REPOSITORY_ID'));
    assert.ok(result.errors.some(x => x.code === 'DUPLICATE_MODULE_ID'));
    assert.ok(result.errors.some(x => x.code === 'UNKNOWN_MODULE_REPOSITORY'));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('rejects missing dependency endpoints and evidence files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'midad-governance-evidence-'));
  try {
    const manifest = fixture(root);
    manifest.dependencies.push({ from: 'missing-module', to: 'control-room-ui', relationship: 'runtime', evidence: [{ repository: 'control-room', path: 'missing.js', note: 'Missing evidence.' }] });
    const result = validateManifest(manifest, { root });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(x => x.code === 'UNKNOWN_DEPENDENCY_MODULE'));
    assert.ok(result.errors.some(x => x.code === 'MISSING_DEPENDENCY_EVIDENCE'));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('maps changed files to owning modules and computes reverse transitive impact', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'midad-governance-impact-'));
  try {
    const manifest = fixture(root);
    const result = analyzeImpact(['assets/ui/app.js', 'unmapped/new-file.txt'], manifest);
    assert.deepEqual(result.directlyChangedModules, ['control-room-ui']);
    assert.deepEqual(result.impactedDependents, ['control-room-entry', 'genesis0-bridge']);
    assert.deepEqual(result.unmappedPaths, ['unmapped/new-file.txt']);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('flags secrets and generated artifacts but exempts documented environment templates', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'midad-governance-drift-'));
  try {
    const manifest = fixture(root);
    fs.writeFileSync(path.join(root, '.env'), 'SHOULD_NOT_BE_HERE=secret');
    fs.writeFileSync(path.join(root, '.env.example'), 'KEY=placeholder');
    fs.mkdirSync(path.join(root, 'assets', 'ui', 'node_modules'), { recursive: true });
    fs.writeFileSync(path.join(root, 'assets', 'ui', 'node_modules', 'package.json'), '{}');
    const result = auditWorkspace(root, manifest);
    assert.ok(result.findings.some(x => x.code === 'SECRET_LIKE_FILE'));
    assert.ok(result.findings.some(x => x.code === 'GENERATED_ARTIFACT'));
    assert.ok(!result.findings.some(x => x.path === '.env.example'));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('reports duplicate file-content groups without deleting either copy', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'midad-governance-duplicates-'));
  try {
    const manifest = fixture(root);
    fs.writeFileSync(path.join(root, 'copy-a.txt'), 'same bytes');
    fs.writeFileSync(path.join(root, 'copy-b.txt'), 'same bytes');
    const result = auditWorkspace(root, manifest);
    assert.ok(result.duplicateGroups.some(group => group.paths.includes('copy-a.txt') && group.paths.includes('copy-b.txt')));
    assert.equal(fs.existsSync(path.join(root, 'copy-a.txt')), true);
    assert.equal(fs.existsSync(path.join(root, 'copy-b.txt')), true);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('records release provenance without exposing environment secrets', () => {
  const record = createProvenanceRecord({
    GITHUB_REPOSITORY: 'Sirahwaz/Control-room',
    GITHUB_SHA: 'a'.repeat(40),
    GITHUB_REF: 'refs/heads/main',
    GITHUB_WORKFLOW: 'Architecture Governance',
    GITHUB_RUN_ID: '12345',
    GITHUB_RUN_ATTEMPT: '2',
    GITHUB_EVENT_NAME: 'push',
    GITHUB_ACTOR: 'Sirahwaz',
    MIDAD_GOVERNANCE_TIMESTAMP: '2026-11-08T00:00:00.000Z',
    OPENROUTER_API_KEY: 'must-not-appear',
  }, '{"schemaVersion":1}');
  assert.equal(record.repository, 'Sirahwaz/Control-room');
  assert.equal(record.commitSha, 'a'.repeat(40));
  assert.equal(record.runId, '12345');
  assert.equal(record.runAttempt, 2);
  assert.match(record.manifestSha256, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(record).includes('must-not-appear'), false);
  assert.equal(record.secretValuesIncluded, false);
});

test('rejects absolute paths and traversal in registry path declarations', () => {
  assert.throws(() => normalizeRelativePath('../outside.txt'), /traversal/);
  assert.throws(() => normalizeRelativePath('/etc/passwd'), /Absolute/);
  assert.throws(() => normalizeRelativePath('C:\\Windows\\system.ini'), /Absolute/);
});

test('flags files added to a managed domain without a registered module owner', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'midad-governance-unowned-'));
  try {
    const manifest = fixture(root);
    fs.mkdirSync(path.join(root, 'assets', 'unowned'), { recursive: true });
    fs.writeFileSync(path.join(root, 'assets', 'unowned', 'feature.js'), '/* no module owner */');
    const result = auditWorkspace(root, manifest);
    assert.equal(result.status, 'FAILED');
    assert.ok(result.findings.some(x => x.code === 'UNOWNED_MANAGED_PATH' && x.path === 'assets/unowned/feature.js'));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});


test('records pull request head and base revisions in provenance without changing the checkout SHA', () => {
  const record = createProvenanceRecord({
    GITHUB_REPOSITORY: 'Sirahwaz/Control-room',
    GITHUB_SHA: 'a'.repeat(40),
    MIDAD_GOVERNANCE_PR_HEAD_SHA: 'b'.repeat(40),
    MIDAD_GOVERNANCE_PR_BASE_SHA: 'c'.repeat(40),
    MIDAD_GOVERNANCE_PR_NUMBER: '200',
  }, 'manifest');
  assert.equal(record.commitSha, 'a'.repeat(40));
  assert.equal(record.sourceHeadSha, 'b'.repeat(40));
  assert.equal(record.baseSha, 'c'.repeat(40));
  assert.equal(record.pullRequestNumber, 200);
});

test('prefers the most specific module owner over a broad parent module path', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'midad-governance-specificity-'));
  try {
    const manifest = fixture(root);
    const result = analyzeImpact(['tools/architecture-governance/cli.mjs'], manifest);
    assert.deepEqual(result.directlyChangedModules, ['architecture-governance-tooling']);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
