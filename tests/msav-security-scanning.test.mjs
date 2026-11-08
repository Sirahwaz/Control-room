import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizeSemgrep,
  sanitizeGitleaks,
  sanitizeOsv,
  sanitizeTrivy,
  sanitizeRepositoryPath,
} from '../tools/security/msav-sanitize.mjs';

const WORKSPACE = '/workspace/control-room';

test('Semgrep normalization keeps finding coordinates but removes source and metavariable values', () => {
  const secret = 'sk-live-DO-NOT-LEAK-SEM-GREP';
  const report = sanitizeSemgrep({
    results: [{
      check_id: 'javascript.lang.security.audit.eval-detected',
      path: 'src/app.js',
      start: { line: 18, col: 4 },
      end: { line: 18, col: 40 },
      extra: {
        severity: 'ERROR',
        message: 'Dynamic execution detected',
        lines: `const token = "${secret}"; eval(input);`,
        metavars: { '$TOKEN': { abstract_content: secret } },
      },
    }],
    errors: [],
  }, WORKSPACE);

  assert.equal(report.findings.length, 1);
  assert.deepEqual(report.findings[0], {
    scanner: 'semgrep',
    category: 'SAST',
    ruleId: 'javascript.lang.security.audit.eval-detected',
    severity: 'ERROR',
    path: 'src/app.js',
    startLine: 18,
    endLine: 18,
  });
  assert.equal(JSON.stringify(report).includes(secret), false);
});

test('Gitleaks SARIF normalization never exports secret-bearing message or properties', () => {
  const secret = 'ghp_DO-NOT-LEAK-GITLEAKS';
  const report = sanitizeGitleaks({
    runs: [{
      results: [{
        ruleId: 'github-pat',
        level: 'error',
        message: { text: `Leaked token ${secret}` },
        locations: [{
          physicalLocation: {
            artifactLocation: { uri: 'config/settings.env' },
            region: { startLine: 7 },
          },
        }],
        properties: { secret, match: secret, fingerprint: 'safe-fingerprint' },
      }],
    }],
  }, WORKSPACE);

  assert.equal(report.findings.length, 1);
  assert.deepEqual(report.findings[0], {
    scanner: 'gitleaks',
    category: 'SECRET',
    ruleId: 'github-pat',
    severity: 'ERROR',
    path: 'config/settings.env',
    startLine: 7,
  });
  assert.equal(JSON.stringify(report).includes(secret), false);
  assert.equal(JSON.stringify(report).includes('safe-fingerprint'), false);
});

test('OSV normalization preserves dependency identity and advisory IDs but drops advisory text', () => {
  const privateText = 'DO-NOT-LEAK-PRIVATE-ADVISORY-CONTENT';
  const report = sanitizeOsv({
    results: [{
      source: { path: 'mobile/package-lock.json' },
      packages: [{
        package: { name: 'example-lib', version: '1.2.3', ecosystem: 'npm' },
        vulnerabilities: [{
          id: 'GHSA-1111-2222-3333',
          aliases: ['CVE-2026-12345'],
          summary: privateText,
          details: privateText,
        }],
      }],
    }],
  }, WORKSPACE);

  assert.equal(report.findings.length, 1);
  assert.deepEqual(report.findings[0], {
    scanner: 'osv-scanner',
    category: 'DEPENDENCY',
    advisoryId: 'GHSA-1111-2222-3333',
    aliases: ['CVE-2026-12345'],
    packageName: 'example-lib',
    packageVersion: '1.2.3',
    ecosystem: 'npm',
    path: 'mobile/package-lock.json',
  });
  assert.equal(JSON.stringify(report).includes(privateText), false);
});

test('Trivy normalization retains vulnerability and misconfiguration identifiers without raw cause data', () => {
  const privateText = 'DO-NOT-LEAK-TRIVY-SOURCE-CONTEXT';
  const report = sanitizeTrivy({
    Results: [{
      Target: 'supabase/config.toml',
      Type: 'config',
      Vulnerabilities: [{
        VulnerabilityID: 'CVE-2026-11111',
        PkgName: 'sample-package',
        InstalledVersion: '1.0.0',
        FixedVersion: '1.0.1',
        Severity: 'HIGH',
        Description: privateText,
      }],
      Misconfigurations: [{
        ID: 'AVD-EXAMPLE-0001',
        Type: 'Kubernetes Security Check',
        Title: 'Example misconfiguration',
        Severity: 'MEDIUM',
        Message: privateText,
        CauseMetadata: { Resource: privateText, Provider: privateText },
      }],
    }],
  }, WORKSPACE);

  assert.equal(report.findings.length, 2);
  assert.ok(report.findings.some(item => item.advisoryId === 'CVE-2026-11111'));
  assert.ok(report.findings.some(item => item.ruleId === 'AVD-EXAMPLE-0001'));
  assert.equal(JSON.stringify(report).includes(privateText), false);
});

test('repository paths are relative and traversal or outside-workspace paths are rejected', () => {
  assert.equal(sanitizeRepositoryPath('src/main.ts', WORKSPACE), 'src/main.ts');
  assert.equal(sanitizeRepositoryPath('../outside.env', WORKSPACE), null);
  assert.equal(sanitizeRepositoryPath('/etc/passwd', WORKSPACE), null);
  assert.equal(sanitizeRepositoryPath('../../workspace/other-secret', WORKSPACE), null);
  assert.equal(sanitizeRepositoryPath('', WORKSPACE), null);
});
