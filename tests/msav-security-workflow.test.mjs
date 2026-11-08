import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const workflow = fs.readFileSync(new URL('../.github/workflows/midad-security-assessment.yml', import.meta.url), 'utf8');

test('MSAV-1 is pull-request and manual only with read-only repository permissions', () => {
  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /permissions:\s*\n\s*contents:\s*read/);
  assert.doesNotMatch(workflow, /pull_request_target:/);
  assert.doesNotMatch(workflow, /contents:\s*write|security-events:\s*write|actions:\s*write/);
  assert.doesNotMatch(workflow, /secrets\./);
});

test('scanner versions are pinned to reviewed releases', () => {
  assert.match(workflow, /semgrep==1\.184\.0/);
  assert.match(workflow, /ghcr\.io\/gitleaks\/gitleaks:v8\.30\.1@sha256:b109bc5f8f76a38196a3e413704fc5b9e3c32360bce4e4b603bd6f45b3721dbb/);
  assert.match(workflow, /ghcr\.io\/google\/osv-scanner:v2\.7\.0@sha256:4f3b7e2c64b9d38a5febc5a7e4a3dfef1d1362f726dea7a2ef4762b46469fcd0/);
  assert.match(workflow, /aquasec\/trivy:0\.76\.2/);
  assert.doesNotMatch(workflow, /setup-go@|go-version:|go install/);
});

test('secret and source-bearing scanner output is never uploaded raw', () => {
  assert.match(workflow, /gitleaks:v8\.30\.1[\s\S]*\n\s+git\s+[\s\S]*--redact/);
  assert.match(workflow, /msav-sanitize\.mjs/);
  assert.match(workflow, /security-report\.json/);
  assert.doesNotMatch(workflow, /path:[^\n]*(msav-raw|gitleaks\.sarif|semgrep\.json|osv\.json|trivy\.json)/);
  assert.match(workflow, /rawReportsUploaded:\s*false|msav-sanitize/);
});

test('Trivy excludes secret scanning because Gitleaks owns secret detection', () => {
  assert.match(workflow, /--scanners vuln,misconfig/);
  assert.doesNotMatch(workflow, /--scanners[^\n]*secret/);
});

test('scanner execution is non-blocking, but MSAV contract tests remain a required gate', () => {
  const testStep = workflow.split('      - name: Run MSAV sanitizer contract tests')[1]?.split('      - name: Build sanitized security report')[0] || '';
  assert.match(workflow, /continue-on-error:\s*true/);
  assert.doesNotMatch(testStep, /continue-on-error:\s*true/);
  assert.match(workflow, /if:\s*always\(\)/);
  assert.match(workflow, /retention-days:\s*7/);
});
