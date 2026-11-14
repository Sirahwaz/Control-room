import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  sanitizeSemgrep,
  sanitizeGitleaks,
  sanitizeOsv,
  sanitizeTrivy,
  sanitizeRepositoryPath,
  buildSanitizedReport,
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

test('OSV scanner exit state is read from the same report key written by the workflow', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'midad-msav-osv-state-'));
  try {
    fs.writeFileSync(path.join(directory, 'osv.json'), JSON.stringify({ results: [] }));
    fs.writeFileSync(path.join(directory, 'osv-scanner.exit'), '0\n');
    const report = buildSanitizedReport({
      inputDirectory: directory,
      workspaceRoot: WORKSPACE,
      repository: 'Sirahwaz/Control-room',
      commitSha: 'a'.repeat(40),
    });
    const osv = report.scanners.find(scanner => scanner.name === 'osv-scanner');
    assert.ok(osv);
    assert.equal(osv.exitCode, 0);
    assert.equal(osv.status, 'REPORT_PARSED');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('Semgrep report is marked partial when the scanner reports rule or collection errors', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'midad-msav-semgrep-errors-'));
  try {
    fs.writeFileSync(path.join(directory, 'semgrep.json'), JSON.stringify({
      results: [],
      errors: [{ type: 'RuleParseError', message: 'Synthetic invalid rule fixture' }],
    }));
    fs.writeFileSync(path.join(directory, 'semgrep.exit'), '0\n');
    const report = buildSanitizedReport({
      inputDirectory: directory,
      workspaceRoot: WORKSPACE,
      repository: 'Sirahwaz/Control-room',
      commitSha: 'b'.repeat(40),
    });
    const semgrep = report.scanners.find(scanner => scanner.name === 'semgrep');
    assert.ok(semgrep);
    assert.equal(semgrep.exitCode, 0);
    assert.equal(semgrep.reportedErrorCount, 1);
    assert.equal(semgrep.status, 'REPORT_PARSED_WITH_ERRORS');
    assert.equal(report.coverageState, 'PARTIAL');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('overall scanner coverage is COMPLETE only when all four reports parse without errors', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'midad-msav-complete-coverage-'));
  try {
    const fixtures = {
      'semgrep.json': { results: [], errors: [] },
      'gitleaks.json': [],
      'osv.json': { results: [] },
      'trivy.json': { Results: [] },
    };
    for (const [filename, data] of Object.entries(fixtures)) {
      fs.writeFileSync(path.join(directory, filename), JSON.stringify(data));
    }
    for (const name of ['semgrep', 'gitleaks', 'osv-scanner', 'trivy']) {
      fs.writeFileSync(path.join(directory, name + '.exit'), '0\n');
    }
    const report = buildSanitizedReport({
      inputDirectory: directory,
      workspaceRoot: WORKSPACE,
      repository: 'Sirahwaz/Control-room',
      commitSha: 'c'.repeat(40),
    });
    assert.equal(report.coverageState, 'COMPLETE');
    assert.equal(report.findingCount, 0);
    assert.ok(report.scanners.every(scanner => scanner.status === 'REPORT_PARSED'));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('Semgrep error metadata is sanitized and omits raw messages', () => {
  const privateText = 'DO-NOT-LEAK-SEM-GREP-ERROR-DETAIL';
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'midad-msav-semgrep-error-details-'));
  try {
    fs.writeFileSync(path.join(directory, 'semgrep.json'), JSON.stringify({
      results: [],
      errors: [{
        type: 'RuleParseError',
        code: 42,
        path: 'tools/rules/custom.yml',
        spans: [{ start: { line: 9 } }],
        message: privateText,
      }],
    }));
    fs.writeFileSync(path.join(directory, 'semgrep.exit'), '0\n');
    const report = buildSanitizedReport({
      inputDirectory: directory,
      workspaceRoot: WORKSPACE,
      repository: 'Sirahwaz/Control-room',
      commitSha: 'd'.repeat(40),
    });
    const semgrep = report.scanners.find(scanner => scanner.name === 'semgrep');
    assert.equal(semgrep.reportedErrors.length, 1);
    assert.deepEqual(semgrep.reportedErrors[0], {
      errorType: 'RuleParseError',
      code: 42,
      path: 'tools/rules/custom.yml',
      line: 9,
    });
    assert.equal(JSON.stringify(report).includes(privateText), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('Gitleaks JSON keeps commit and HEAD-presence metadata but never exports secret material', () => {
  const secret = 'SYNTHETIC_GITLEAKS_SECRET_MUST_NOT_LEAK';
  const historicalSecret = 'SYNTHETIC_HISTORICAL_SECRET_MUST_NOT_LEAK';
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'midad-msav-gitleaks-history-'));
  try {
    fs.mkdirSync(path.join(workspace, 'src'), { recursive: true });
    fs.writeFileSync(path.join(workspace, 'src', 'config.txt'), 'TOKEN=' + secret + '\n');

    const report = sanitizeGitleaks([
      {
        RuleID: 'generic-api-key',
        File: 'src/config.txt',
        StartLine: 1,
        EndLine: 1,
        Commit: 'a'.repeat(40),
        Secret: secret,
        Match: secret,
        Fingerprint: 'raw-fingerprint-must-not-leak',
        Author: 'private@example.invalid',
        Message: 'raw match message',
      },
      {
        RuleID: 'generic-api-key',
        File: 'removed/old.env',
        StartLine: 4,
        Commit: 'b'.repeat(40),
        Secret: historicalSecret,
        Match: historicalSecret,
      },
    ], workspace);

    assert.equal(report.findings.length, 2);
    const current = report.findings.find(item => item.path === 'src/config.txt');
    const historical = report.findings.find(item => item.path === 'removed/old.env');
    assert.equal(current.presentInHead, true);
    assert.equal(current.commitSha, 'a'.repeat(40));
    assert.match(current.secretSha256, /^[a-f0-9]{64}$/);
    assert.equal(historical.presentInHead, false);
    assert.equal(historical.commitSha, 'b'.repeat(40));

    const serialized = JSON.stringify(report);
    for (const forbidden of [
      secret,
      historicalSecret,
      'raw-fingerprint-must-not-leak',
      'private@example.invalid',
      'raw match message',
    ]) {
      assert.equal(serialized.includes(forbidden), false);
    }
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});
