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
  assert.match(workflow, /osv-scanner\/v2\/cmd\/osv-scanner@v2\.7\.0/);
  assert.match(workflow, /aquasec\/trivy:0\.76\.2/);
  assert.match(workflow, /go-version:\s*["']1\.27\.3["']/);
});

test('secret and source-bearing scanner output is never uploaded raw', () => {
  assert.match(workflow, /gitleaks git[\s\S]*--redact/);
  assert.match(workflow, /msav-sanitize\.mjs/);
  assert.match(workflow, /security-report\.json/);
  assert.doesNotMatch(workflow, /path:[^\n]*(msav-raw|gitleaks\.sarif|semgrep\.json|osv\.json|trivy\.json)/);
  assert.match(workflow, /rawReportsUploaded:\s*false|msav-sanitize/);
});

test('Trivy excludes secret scanning because Gitleaks owns secret detection', () => {
  assert.match(workflow, /--scanners vuln,misconfig/);
  assert.doesNotMatch(workflow, /--scanners[^\n]*secret/);
});

test('MSAV-1 is non-blocking and stores the sanitized report for a short retention period', () => {
  assert.match(workflow, /continue-on-error:\s*true/);
  assert.match(workflow, /if:\s*always\(\)/);
  assert.match(workflow, /retention-days:\s*7/);
});
