import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const TOOL_VERSIONS = Object.freeze({
  semgrep: '1.184.0',
  gitleaks: '8.30.1',
  osvScanner: '2.7.0',
  trivy: '0.76.2',
});

function cleanText(value, maxLength = 200) {
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return cleaned ? cleaned.slice(0, maxLength) : null;
}

function cleanSeverity(value) {
  const severity = cleanText(value, 24)?.toUpperCase();
  return ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO', 'WARNING', 'ERROR', 'NOTE'].includes(severity)
    ? severity
    : 'UNKNOWN';
}

function positiveLine(value) {
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function cleanIdentifier(value) {
  const identifier = cleanText(value, 160);
  return identifier && /^[A-Za-z0-9_.:@/+ -]+$/.test(identifier) ? identifier : null;
}

/**
 * Converts a scanner-supplied path into a safe repository-relative path.
 * Paths outside the checked-out repository are deliberately discarded.
 */
export function sanitizeRepositoryPath(value, workspaceRoot) {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0')) return null;
  const root = path.resolve(workspaceRoot);
  let candidate = value.trim().replaceAll('\\', '/');

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate)) {
    if (!candidate.toLowerCase().startsWith('file://')) return null;
    try {
      candidate = decodeURIComponent(new URL(candidate).pathname);
    } catch {
      return null;
    }
  }

  const absolute = path.isAbsolute(candidate)
    ? path.resolve(candidate)
    : path.resolve(root, candidate);
  const relative = path.relative(root, absolute);
  if (!relative || relative === '.' || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return null;
  }
  return relative.split(path.sep).join('/');
}

export function sanitizeSemgrep(data, workspaceRoot) {
  const results = Array.isArray(data?.results) ? data.results : [];
  const findings = [];
  for (const item of results) {
    const file = sanitizeRepositoryPath(item?.path, workspaceRoot);
    const ruleId = cleanIdentifier(item?.check_id);
    if (!file || !ruleId) continue;
    const startLine = positiveLine(item?.start?.line);
    const endLine = positiveLine(item?.end?.line);
    findings.push({
      scanner: 'semgrep',
      category: 'SAST',
      ruleId,
      severity: cleanSeverity(item?.extra?.severity),
      path: file,
      ...(startLine ? { startLine } : {}),
      ...(endLine ? { endLine } : {}),
    });
  }
  const rawErrors = Array.isArray(data?.errors) ? data.errors : [];
  const reportedErrors = rawErrors.slice(0, 20).map(error => {
    const file = sanitizeRepositoryPath(error?.path, workspaceRoot);
    const line = positiveLine(error?.spans?.[0]?.start?.line ?? error?.start?.line);
    const errorType = cleanIdentifier(error?.type) || 'UNKNOWN';
    const code = Number.isSafeInteger(error?.code) ? error.code : null;
    return {
      errorType,
      ...(code !== null ? { code } : {}),
      ...(file ? { path: file } : {}),
      ...(line ? { line } : {}),
    };
  });
  return { findings, reportedErrorCount: rawErrors.length, reportedErrors };
}

export function sanitizeGitleaks(data, workspaceRoot) {
  const findings = [];

  const addJsonFinding = item => {
    const file = sanitizeRepositoryPath(item?.File || item?.file, workspaceRoot);
    const ruleId = cleanIdentifier(item?.RuleID || item?.ruleId);
    if (!file || !ruleId) return;

    const secret = typeof item?.Secret === 'string' ? item.Secret : '';
    const commitSha = /^[a-f0-9]{40,64}$/i.test(item?.Commit || '') ? item.Commit : null;
    const startLine = positiveLine(item?.StartLine ?? item?.startLine);
    const endLine = positiveLine(item?.EndLine ?? item?.endLine);
    let presentInHead;
    if (secret) {
      try {
        presentInHead = fs.readFileSync(path.resolve(workspaceRoot, file), 'utf8').includes(secret);
      } catch (error) {
        presentInHead = error?.code === 'ENOENT' ? false : null;
      }
    }

    findings.push({
      scanner: 'gitleaks',
      category: 'SECRET',
      ruleId,
      severity: 'UNKNOWN',
      path: file,
      ...(startLine ? { startLine } : {}),
      ...(endLine ? { endLine } : {}),
      ...(commitSha ? { commitSha } : {}),
      ...(secret ? {
        secretSha256: createHash('sha256').update(secret, 'utf8').digest('hex'),
        presentInHead: presentInHead === null ? null : presentInHead,
      } : {}),
    });
  };

  if (Array.isArray(data)) {
    for (const item of data) addJsonFinding(item);
  } else {
    const runs = Array.isArray(data?.runs) ? data.runs : [];
    for (const run of runs) {
      const results = Array.isArray(run?.results) ? run.results : [];
      for (const item of results) {
        const location = item?.locations?.[0]?.physicalLocation;
        const file = sanitizeRepositoryPath(location?.artifactLocation?.uri, workspaceRoot);
        const ruleId = cleanIdentifier(item?.ruleId);
        if (!file || !ruleId) continue;
        const startLine = positiveLine(location?.region?.startLine);
        findings.push({
          scanner: 'gitleaks',
          category: 'SECRET',
          ruleId,
          severity: cleanSeverity(item?.level),
          path: file,
          ...(startLine ? { startLine } : {}),
        });
      }
    }
  }
  return { findings, reportedErrorCount: 0 };
}

export function sanitizeOsv(data, workspaceRoot) {
  const results = Array.isArray(data?.results) ? data.results : [];
  const findings = [];
  for (const result of results) {
    const packages = Array.isArray(result?.packages) ? result.packages : [];
    for (const item of packages) {
      const pkg = item?.package || {};
      const packageName = cleanIdentifier(pkg.name);
      const packageVersion = cleanText(pkg.version, 100);
      const ecosystem = cleanIdentifier(pkg.ecosystem);
      const file = sanitizeRepositoryPath(result?.source?.path, workspaceRoot);
      const vulnerabilities = Array.isArray(item?.vulnerabilities) ? item.vulnerabilities : [];
      if (!file || !packageName) continue;
      for (const vulnerability of vulnerabilities) {
        const advisoryId = cleanIdentifier(vulnerability?.id);
        if (!advisoryId) continue;
        const aliases = Array.isArray(vulnerability.aliases)
          ? vulnerability.aliases.map(cleanIdentifier).filter(Boolean).slice(0, 20)
          : [];
        findings.push({
          scanner: 'osv-scanner',
          category: 'DEPENDENCY',
          advisoryId,
          aliases,
          packageName,
          ...(packageVersion ? { packageVersion } : {}),
          ...(ecosystem ? { ecosystem } : {}),
          path: file,
        });
      }
    }
  }
  return { findings, reportedErrorCount: 0 };
}

export function sanitizeTrivy(data, workspaceRoot) {
  const results = Array.isArray(data?.Results) ? data.Results : [];
  const findings = [];
  for (const result of results) {
    const file = sanitizeRepositoryPath(result?.Target, workspaceRoot);
    if (!file) continue;

    const vulnerabilities = Array.isArray(result?.Vulnerabilities) ? result.Vulnerabilities : [];
    for (const item of vulnerabilities) {
      const advisoryId = cleanIdentifier(item?.VulnerabilityID);
      const packageName = cleanIdentifier(item?.PkgName);
      if (!advisoryId || !packageName) continue;
      const installedVersion = cleanText(item?.InstalledVersion, 100);
      const fixedVersion = cleanText(item?.FixedVersion, 100);
      findings.push({
        scanner: 'trivy',
        category: 'DEPENDENCY',
        advisoryId,
        packageName,
        severity: cleanSeverity(item?.Severity),
        ...(installedVersion ? { installedVersion } : {}),
        ...(fixedVersion ? { fixedVersion } : {}),
        path: file,
      });
    }

    const misconfigurations = Array.isArray(result?.Misconfigurations) ? result.Misconfigurations : [];
    for (const item of misconfigurations) {
      const ruleId = cleanIdentifier(item?.ID);
      if (!ruleId) continue;
      findings.push({
        scanner: 'trivy',
        category: 'MISCONFIGURATION',
        ruleId,
        severity: cleanSeverity(item?.Severity),
        path: file,
      });
    }
  }
  return { findings, reportedErrorCount: 0 };
}

function readJsonReport(directory, filename) {
  const reportPath = path.join(directory, filename);
  try {
    const raw = fs.readFileSync(reportPath, 'utf8');
    return { ok: true, data: JSON.parse(raw) };
  } catch (error) {
    return { ok: false, errorCode: error?.code === 'ENOENT' ? 'REPORT_NOT_CREATED' : 'REPORT_INVALID_JSON' };
  }
}

function readExitCode(directory, name) {
  try {
    const raw = fs.readFileSync(path.join(directory, `${name}.exit`), 'utf8').trim();
    const value = Number(raw);
    return Number.isInteger(value) && value >= 0 ? value : null;
  } catch {
    return null;
  }
}

export function buildSanitizedReport({ inputDirectory, workspaceRoot, repository = 'unknown', commitSha = null }) {
  const specs = [
    { name: 'semgrep', filename: 'semgrep.json', sanitize: sanitizeSemgrep },
    { name: 'gitleaks', filename: 'gitleaks.json', sanitize: sanitizeGitleaks },
    { name: 'osv-scanner', filename: 'osv.json', sanitize: sanitizeOsv, versionKey: 'osvScanner' },
    { name: 'trivy', filename: 'trivy.json', sanitize: sanitizeTrivy },
  ];
  const findings = [];
  const scanners = [];

  for (const spec of specs) {
    const loaded = readJsonReport(inputDirectory, spec.filename);
    const exitName = spec.name;
    const exitCode = readExitCode(inputDirectory, exitName);
    if (!loaded.ok) {
      scanners.push({
        name: spec.name,
        version: TOOL_VERSIONS[spec.versionKey || spec.name],
        status: loaded.errorCode,
        exitCode,
        findings: 0,
      });
      continue;
    }

    const normalized = spec.sanitize(loaded.data, workspaceRoot);
    findings.push(...normalized.findings);
    const status = exitCode === null
      ? 'REPORT_PARSED_EXIT_UNKNOWN'
      : exitCode !== 0
        ? 'REPORT_PARSED_NONZERO_EXIT'
        : normalized.reportedErrorCount > 0
          ? 'REPORT_PARSED_WITH_ERRORS'
          : 'REPORT_PARSED';
    scanners.push({
      name: spec.name,
      version: TOOL_VERSIONS[spec.versionKey || spec.name],
      status,
      exitCode,
      findings: normalized.findings.length,
      reportedErrorCount: normalized.reportedErrorCount,
      ...(normalized.reportedErrors?.length ? { reportedErrors: normalized.reportedErrors } : {}),
    });
  }

  findings.sort((a, b) =>
    a.scanner.localeCompare(b.scanner)
    || a.path.localeCompare(b.path)
    || String(a.ruleId || a.advisoryId).localeCompare(String(b.ruleId || b.advisoryId))
    || (a.startLine || 0) - (b.startLine || 0));

  const coverageState = scanners.every(scanner => scanner.status === 'REPORT_PARSED')
    ? 'COMPLETE'
    : 'PARTIAL';

  return {
    schemaVersion: 1,
    reportType: 'midad-msav-sanitized-security-scan',
    coverageState,
    generatedAt: new Date().toISOString(),
    repository: cleanText(repository, 200) || 'unknown',
    commitSha: /^[a-f0-9]{40,64}$/i.test(commitSha || '') ? commitSha : null,
    toolVersions: TOOL_VERSIONS,
    scanners,
    findingCount: findings.length,
    findings,
    rawReportsUploaded: false,
    sourceSnippetsIncluded: false,
    secretValuesIncluded: false,
  };
}

function readArgument(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const inputDirectory = readArgument('--input', process.env.MSAV_RAW_DIR);
  const outputFile = readArgument('--output', process.env.MSAV_OUTPUT_FILE);
  const workspaceRoot = readArgument('--workspace', process.env.GITHUB_WORKSPACE || process.cwd());
  if (!inputDirectory || !outputFile) {
    process.stderr.write('Usage: node msav-sanitize.mjs --input <raw-report-dir> --output <sanitized-report.json> [--workspace <repo-root>]\n');
    process.exitCode = 2;
  } else {
    const report = buildSanitizedReport({
      inputDirectory,
      workspaceRoot,
      repository: process.env.GITHUB_REPOSITORY || 'unknown',
      commitSha: process.env.GITHUB_SHA || null,
    });
    fs.mkdirSync(path.dirname(outputFile), { recursive: true });
    fs.writeFileSync(outputFile, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    process.stdout.write(`MSAV_SANITIZED_REPORT_READY findings=${report.findingCount}\n`);
  }
}
