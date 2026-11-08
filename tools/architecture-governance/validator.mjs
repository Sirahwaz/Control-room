import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const VISIBILITIES = new Set(['public', 'private']);
const REPOSITORY_STATUSES = new Set(['active', 'experimental', 'unknown', 'archived']);
const MODULE_STATUSES = new Set(['active', 'experimental', 'planned', 'deprecated', 'unknown']);
const GENERATED_SEGMENTS = new Set([
  'node_modules', '__pycache__', '.pytest_cache', '.mypy_cache', '.ruff_cache',
  '.next', '.turbo', 'coverage', '.nyc_output', 'playwright-report', 'test-results',
]);
const MAX_HASH_BYTES = 5 * 1024 * 1024;

function issue(code, message, severity = 'error', filePath = undefined) {
  return { code, message, severity, ...(filePath ? { path: filePath } : {}) };
}

export function normalizeRelativePath(value) {
  if (typeof value !== 'string' || value.trim() === '' || value.includes('\0')) {
    throw new TypeError('Path must be a non-empty relative string');
  }
  const normalized = value.replaceAll('\\', '/').replace(/^\.\//, '');
  if (normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) {
    throw new TypeError(`Absolute paths are forbidden: ${value}`);
  }
  const parts = normalized.split('/').filter(Boolean);
  if (parts.some(part => part === '..' || part === '.')) {
    throw new TypeError(`Path traversal is forbidden: ${value}`);
  }
  return `${parts.join('/')}${normalized.endsWith('/') && parts.length ? '/' : ''}`;
}

function localPathExists(root, relativePath) {
  const normalized = normalizeRelativePath(relativePath);
  const absolute = path.resolve(root, normalized.replace(/\/$/, ''));
  const resolvedRoot = path.resolve(root);
  return (absolute === resolvedRoot || absolute.startsWith(`${resolvedRoot}${path.sep}`))
    && fs.existsSync(absolute);
}

function modulePathSpecificity(module, changedPath) {
  let specificity = -1;
  for (const rawPath of module.paths) {
    const ownerPath = normalizeRelativePath(rawPath);
    const matches = ownerPath.endsWith('/')
      ? changedPath.startsWith(ownerPath)
      : (changedPath === ownerPath || changedPath.startsWith(`${ownerPath}/`));
    if (matches) specificity = Math.max(specificity, ownerPath.length);
  }
  return specificity;
}

export function validateManifest(manifest, { root = process.cwd() } = {}) {
  const errors = [];
  const warnings = [];
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return { valid: false, errors: [issue('INVALID_MANIFEST', 'Manifest must be a JSON object.')], warnings };
  }
  if (manifest.schemaVersion !== 1) errors.push(issue('UNSUPPORTED_SCHEMA_VERSION', 'schemaVersion must be 1.'));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(manifest.auditDate || '')) errors.push(issue('INVALID_AUDIT_DATE', 'auditDate must use YYYY-MM-DD.'));
  if (typeof manifest.currentRepository !== 'string' || !manifest.currentRepository) errors.push(issue('MISSING_CURRENT_REPOSITORY', 'currentRepository is required.'));
  if (typeof manifest.canonicalRepository !== 'string' || !manifest.canonicalRepository) errors.push(issue('MISSING_CANONICAL_REPOSITORY', 'canonicalRepository is required.'));

  const repositories = Array.isArray(manifest.repositories) ? manifest.repositories : [];
  const modules = Array.isArray(manifest.modules) ? manifest.modules : [];
  const dependencies = Array.isArray(manifest.dependencies) ? manifest.dependencies : [];
  if (!Array.isArray(manifest.repositories)) errors.push(issue('INVALID_REPOSITORIES', 'repositories must be an array.'));
  if (!Array.isArray(manifest.modules)) errors.push(issue('INVALID_MODULES', 'modules must be an array.'));
  if (!Array.isArray(manifest.dependencies)) errors.push(issue('INVALID_DEPENDENCIES', 'dependencies must be an array.'));

  const repositoryIds = new Set();
  const repositoryNames = new Set();
  for (const repository of repositories) {
    if (!repository || typeof repository !== 'object') {
      errors.push(issue('INVALID_REPOSITORY', 'Each repository entry must be an object.'));
      continue;
    }
    if (typeof repository.id !== 'string' || !repository.id.trim()) {
      errors.push(issue('MISSING_REPOSITORY_ID', 'Each repository requires a non-empty id.'));
    } else if (repositoryIds.has(repository.id)) {
      errors.push(issue('DUPLICATE_REPOSITORY_ID', `Duplicate repository id: ${repository.id}.`));
    } else repositoryIds.add(repository.id);
    if (typeof repository.fullName !== 'string' || !/^[^/\s]+\/[^/\s]+$/.test(repository.fullName)) {
      errors.push(issue('INVALID_REPOSITORY_NAME', `Repository ${repository.id || '(unknown)'} must use owner/name.`));
    } else if (repositoryNames.has(repository.fullName.toLowerCase())) {
      errors.push(issue('DUPLICATE_REPOSITORY_NAME', `Duplicate repository name: ${repository.fullName}.`));
    } else repositoryNames.add(repository.fullName.toLowerCase());
    if (!VISIBILITIES.has(repository.visibility)) errors.push(issue('INVALID_REPOSITORY_VISIBILITY', `Invalid visibility for ${repository.id || '(unknown)'}.`));
    if (!REPOSITORY_STATUSES.has(repository.status)) errors.push(issue('INVALID_REPOSITORY_STATUS', `Invalid status for ${repository.id || '(unknown)'}.`));
    if (typeof repository.defaultBranch !== 'string' || !repository.defaultBranch) errors.push(issue('MISSING_DEFAULT_BRANCH', `Repository ${repository.id || '(unknown)'} requires defaultBranch.`));
  }
  if (!repositoryIds.has(manifest.canonicalRepository)) errors.push(issue('UNKNOWN_CANONICAL_REPOSITORY', 'canonicalRepository does not match a registered repository id.'));
  if (!repositoryIds.has(manifest.currentRepository)) errors.push(issue('UNKNOWN_CURRENT_REPOSITORY', 'currentRepository does not match a registered repository id.'));

  const moduleIds = new Set();
  const moduleHealth = [];
  for (const module of modules) {
    if (!module || typeof module !== 'object') {
      errors.push(issue('INVALID_MODULE', 'Each module entry must be an object.'));
      continue;
    }
    if (typeof module.id !== 'string' || !module.id.trim()) {
      errors.push(issue('MISSING_MODULE_ID', 'Each module requires a non-empty id.'));
    } else if (moduleIds.has(module.id)) {
      errors.push(issue('DUPLICATE_MODULE_ID', `Duplicate module id: ${module.id}.`));
    } else moduleIds.add(module.id);
    if (!repositoryIds.has(module.repository)) errors.push(issue('UNKNOWN_MODULE_REPOSITORY', `Module ${module.id || '(unknown)'} references unknown repository ${module.repository}.`));
    if (typeof module.domain !== 'string' || !module.domain) errors.push(issue('MISSING_MODULE_DOMAIN', `Module ${module.id || '(unknown)'} requires a domain.`));
    if (typeof module.kind !== 'string' || !module.kind) errors.push(issue('MISSING_MODULE_KIND', `Module ${module.id || '(unknown)'} requires a kind.`));
    if (!MODULE_STATUSES.has(module.status)) errors.push(issue('INVALID_MODULE_STATUS', `Module ${module.id || '(unknown)'} has an invalid status.`));
    if (!Array.isArray(module.paths) || module.paths.length === 0) {
      errors.push(issue('MISSING_MODULE_PATHS', `Module ${module.id || '(unknown)'} requires one or more paths.`));
      continue;
    }
    const checks = [];
    for (const rawPath of module.paths) {
      let normalized;
      try { normalized = normalizeRelativePath(rawPath); }
      catch (error) {
        errors.push(issue('UNSAFE_MODULE_PATH', `Module ${module.id || '(unknown)'}: ${error.message}`));
        checks.push({ path: String(rawPath), exists: false });
        continue;
      }
      const isLocal = module.repository === manifest.currentRepository;
      const exists = isLocal ? localPathExists(root, normalized) : null;
      checks.push({ path: normalized, exists, verificationScope: isLocal ? 'local' : 'external-not-fetched' });
      if (isLocal && !exists) errors.push(issue('MISSING_MODULE_PATH', `Module ${module.id} path does not exist: ${normalized}`, 'error', normalized));
    }
    const localModule = module.repository === manifest.currentRepository;
    const moduleStatus = !localModule ? 'NOT_CHECKED_EXTERNAL' : checks.every(x => x.exists) ? 'VERIFIED' : 'FAILED';
    if (module.id) moduleHealth.push({ id: module.id, repository: module.repository, status: moduleStatus, verificationScope: localModule ? 'local' : 'external-not-fetched', paths: checks });
  }

  const dependencyKeys = new Set();
  for (const dependency of dependencies) {
    if (!dependency || typeof dependency !== 'object') {
      errors.push(issue('INVALID_DEPENDENCY', 'Each dependency entry must be an object.'));
      continue;
    }
    if (!moduleIds.has(dependency.from) || !moduleIds.has(dependency.to)) {
      errors.push(issue('UNKNOWN_DEPENDENCY_MODULE', `Dependency references unknown module: ${dependency.from} -> ${dependency.to}.`));
    }
    if (dependency.from === dependency.to) errors.push(issue('SELF_DEPENDENCY', `Module ${dependency.from} cannot depend on itself.`));
    if (typeof dependency.relationship !== 'string' || !dependency.relationship) errors.push(issue('MISSING_DEPENDENCY_RELATIONSHIP', `Dependency ${dependency.from} -> ${dependency.to} requires relationship.`));
    const key = `${dependency.from}->${dependency.to}:${dependency.relationship}`;
    if (dependencyKeys.has(key)) errors.push(issue('DUPLICATE_DEPENDENCY', `Duplicate dependency: ${key}.`));
    dependencyKeys.add(key);
    if (!Array.isArray(dependency.evidence) || dependency.evidence.length === 0) {
      errors.push(issue('MISSING_DEPENDENCY_EVIDENCE', `Dependency ${dependency.from} -> ${dependency.to} requires evidence.`));
      continue;
    }
    for (const evidence of dependency.evidence) {
      if (!evidence || !repositoryIds.has(evidence.repository) || typeof evidence.path !== 'string' || !evidence.path) {
        errors.push(issue('INVALID_DEPENDENCY_EVIDENCE', `Dependency ${dependency.from} -> ${dependency.to} has invalid evidence metadata.`));
        continue;
      }
      let normalized;
      try { normalized = normalizeRelativePath(evidence.path); }
      catch (error) {
        errors.push(issue('UNSAFE_EVIDENCE_PATH', `Dependency evidence path is unsafe: ${error.message}`));
        continue;
      }
      if (evidence.repository === manifest.currentRepository && !localPathExists(root, normalized)) {
        errors.push(issue('MISSING_DEPENDENCY_EVIDENCE', `Evidence file does not exist: ${normalized}`, 'error', normalized));
      }
      if (typeof evidence.note !== 'string' || !evidence.note.trim()) warnings.push(issue('UNDESCRIBED_EVIDENCE', `Evidence ${normalized} should explain what it proves.`, 'warning', normalized));
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    repositoryCount: repositories.length,
    moduleCount: modules.length,
    dependencyCount: dependencies.length,
    currentRepository: manifest.currentRepository || null,
    moduleHealth: moduleHealth.sort((a, b) => a.id.localeCompare(b.id)),
  };
}

export function analyzeImpact(changedPaths, manifest) {
  if (!Array.isArray(changedPaths)) throw new TypeError('changedPaths must be an array');
  const localModules = (manifest.modules || []).filter(module => module.repository === manifest.currentRepository);
  const normalizedChanges = changedPaths.map(normalizeRelativePath);
  const directlyChanged = new Set();
  const unmappedPaths = [];
  for (const changedPath of normalizedChanges) {
    const scoredOwners = localModules
      .map(module => ({ module, specificity: modulePathSpecificity(module, changedPath) }))
      .filter(item => item.specificity >= 0);
    const bestSpecificity = scoredOwners.reduce((best, item) => Math.max(best, item.specificity), -1);
    const owners = scoredOwners.filter(item => item.specificity === bestSpecificity);
    if (owners.length === 0) unmappedPaths.push(changedPath);
    for (const owner of owners) directlyChanged.add(owner.module.id);
  }

  const impacted = new Set(directlyChanged);
  const queue = [...directlyChanged];
  const dependencyChain = [];
  while (queue.length) {
    const changedModule = queue.shift();
    for (const dependency of manifest.dependencies || []) {
      if (dependency.impactPropagation === false || dependency.to !== changedModule || impacted.has(dependency.from)) continue;
      impacted.add(dependency.from);
      queue.push(dependency.from);
      dependencyChain.push({ changedDependency: dependency.to, impactedDependent: dependency.from, relationship: dependency.relationship });
    }
  }
  const directlyChangedModules = [...directlyChanged].sort();
  const impactedDependents = [...impacted].filter(id => !directlyChanged.has(id)).sort();
  return {
    changedPaths: normalizedChanges,
    directlyChangedModules,
    impactedDependents,
    allImpactedModules: [...impacted].sort(),
    unmappedPaths: [...new Set(unmappedPaths)].sort(),
    dependencyChain,
  };
}

function walkFiles(root, relative = '', findings = []) {
  const absolute = path.join(root, relative);
  let entries;
  try { entries = fs.readdirSync(absolute, { withFileTypes: true }); }
  catch (error) {
    findings.push(issue('UNREADABLE_DIRECTORY', `Could not read directory: ${error.message}`, 'warning', relative || '.'));
    return findings;
  }
  for (const entry of entries) {
    const rel = relative ? `${relative}/${entry.name}` : entry.name;
    if (rel === '.git' || rel.startsWith('.git/')) continue;
    const segments = rel.split('/');
    if (segments.some(segment => GENERATED_SEGMENTS.has(segment))) {
      findings.push(issue('GENERATED_ARTIFACT', `Generated/cache path detected: ${rel}.`, 'warning', rel));
      continue;
    }
    if (entry.isDirectory()) walkFiles(root, rel, findings);
    else if (entry.isFile()) findings.push({ code: 'FILE', path: rel, absolute: path.join(root, rel) });
  }
  return findings;
}

function isSecretLikeFile(filePath) {
  const name = path.posix.basename(filePath).toLowerCase();
  if (name === '.env.example' || name === '.env.template') return false;
  if (name === '.env' || name.startsWith('.env.')) return true;
  return /^(id_rsa|id_ed25519|credentials\.json|service-account\.json)$/i.test(name)
    || /\.(pem|key|p12|pfx|jks)$/i.test(name);
}


const MAX_SECRET_SCAN_BYTES = 1024 * 1024;
const SECRET_CONTENT_RULES = [
  { rule: 'PRIVATE_KEY_MATERIAL', pattern: /-----BEGIN (?:OPENSSH|RSA|EC|DSA|PGP)? ?PRIVATE KEY-----/i },
  { rule: 'GITHUB_TOKEN', pattern: /\bgh[pousr]_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{40,}\b/ },
  { rule: 'OPENAI_API_KEY', pattern: /\bsk-(?:proj|or-v1|live)[-_][A-Za-z0-9_-]{24,}\b|\bsk-[A-Za-z0-9]{32,}\b/ },
  { rule: 'STRIPE_SECRET_KEY', pattern: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/ },
  { rule: 'AWS_ACCESS_KEY_ID', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { rule: 'SLACK_TOKEN', pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
];
const GENERIC_CREDENTIAL_ASSIGNMENT = /\b(?:[A-Z0-9_]*(?:API[_-]?KEY|ACCESS[_-]?TOKEN|CLIENT[_-]?SECRET|SERVICE[_-]?ROLE[_-]?KEY|PRIVATE[_-]?KEY|PASSWORD|SECRET|TOKEN)[A-Z0-9_]*)\b\s*[:=]\s*["'\x60]([^"'\x60]{24,})["'\x60]/i;
const PLACEHOLDER_VALUE = /^(?:YOUR|EXAMPLE|PLACEHOLDER|REPLACE|CHANGEME|DUMMY|TEST|REDACTED|XXX|TODO)(?:[_-]|$)/i;
const TEXT_EXTENSIONS = new Set([
  '.cjs', '.css', '.csv', '.html', '.ini', '.js', '.json', '.md', '.mjs', '.py',
  '.sh', '.sql', '.svg', '.toml', '.ts', '.tsx', '.txt', '.webmanifest', '.xml',
  '.yaml', '.yml', '.env', '.properties',
]);

export function scanSecretContent(filePath, content) {
  if (typeof filePath !== 'string' || typeof content !== 'string') throw new TypeError('scanSecretContent requires a path and text content');
  const findings = [];
  const lines = content.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const specificMatches = SECRET_CONTENT_RULES.filter(rule => rule.pattern.test(line));
    for (const rule of specificMatches) {
      findings.push({ code: 'SECRET_CONTENT', rule: rule.rule, severity: 'error', path: filePath, line: index + 1 });
    }
    const assignment = line.match(GENERIC_CREDENTIAL_ASSIGNMENT);
    if (!specificMatches.length && assignment && !PLACEHOLDER_VALUE.test(assignment[1].trim())) {
      findings.push({ code: 'SECRET_CONTENT', rule: 'GENERIC_CREDENTIAL_ASSIGNMENT', severity: 'error', path: filePath, line: index + 1 });
    }
  }
  return findings;
}

function readTextFile(root, filePath, maxBytes = 2 * 1024 * 1024) {
  const absolute = path.join(root, filePath);
  const stat = fs.statSync(absolute);
  if (!stat.isFile() || stat.size > maxBytes) return null;
  const buffer = fs.readFileSync(absolute);
  const sample = buffer.subarray(0, Math.min(buffer.length, 8192));
  if (sample.includes(0)) return null;
  const extension = path.extname(filePath).toLowerCase();
  const baseName = path.posix.basename(filePath);
  if (extension && !TEXT_EXTENSIONS.has(extension) && !baseName.startsWith('.')) return null;
  return buffer.toString('utf8');
}

export function auditDuplicateReferences(root, duplicateGroups) {
  if (!Array.isArray(duplicateGroups)) throw new TypeError('duplicateGroups must be an array');
  const discovered = walkFiles(root).filter(item => item.code === 'FILE');
  const results = [];
  for (const group of duplicateGroups) {
    const paths = [...new Set((group.paths || []).map(normalizeRelativePath))].sort();
    const references = [];
    for (const source of discovered) {
      if (paths.includes(source.path)) continue;
      let content;
      try { content = readTextFile(root, source.path); } catch { continue; }
      if (content === null) continue;
      for (const target of paths) {
        const basename = path.posix.basename(target);
        let offset = content.indexOf(basename);
        while (offset >= 0) {
          const before = offset > 0 ? content[offset - 1] : '';
          const after = content[offset + basename.length] || '';
          const beforeIsBoundary = !before || !/[A-Za-z0-9_.-]/.test(before);
          const afterIsBoundary = !after || !/[A-Za-z0-9_.-]/.test(after);
          if (beforeIsBoundary && afterIsBoundary) {
            references.push({ source: source.path, target, line: content.slice(0, offset).split(/\r?\n/).length });
            break;
          }
          offset = content.indexOf(basename, offset + 1);
        }
      }
    }
    const referencedPaths = [...new Set(references.map(item => item.target))].sort();
    results.push({
      paths,
      referencedPaths,
      references: references.sort((a, b) => a.source.localeCompare(b.source) || a.target.localeCompare(b.target)),
      status: referencedPaths.length ? 'INTERNAL_REFERENCES_FOUND' : 'NO_INTERNAL_REFERENCE_FOUND_EXTERNAL_UNVERIFIED',
      deletionAllowed: false,
    });
  }
  return results;
}

function detectLicenseIdentifier(content) {
  if (/Apache License\s+Version 2\.0/i.test(content)) return 'Apache-2.0';
  if (/MIT License/i.test(content) && /Permission is hereby granted, free of charge/i.test(content)) return 'MIT';
  if (/BSD 3-Clause License/i.test(content)) return 'BSD-3-Clause';
  if (/GNU GENERAL PUBLIC LICENSE\s+Version 3/i.test(content)) return 'GPL-3.0-only';
  if (/GNU GENERAL PUBLIC LICENSE\s+Version 2/i.test(content)) return 'GPL-2.0-only';
  if (/This is free and unencumbered software released into the public domain/i.test(content)) return 'Unlicense';
  return 'UNRECOGNIZED';
}

export function auditLicenses(root, manifest) {
  const candidates = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'COPYING', 'COPYING.md', 'UNLICENSE'];
  const issues = [];
  const repositories = (manifest.repositories || []).map(repository => {
    if (repository.id !== manifest.currentRepository) {
      return { id: repository.id, fullName: repository.fullName, declared: repository.licenseStatus || 'unknown', detected: null, status: 'NOT_CHECKED_EXTERNAL' };
    }
    const licensePath = candidates.find(candidate => fs.existsSync(path.join(root, candidate)) && fs.statSync(path.join(root, candidate)).isFile());
    if (!licensePath) {
      issues.push(issue('ROOT_LICENSE_MISSING', 'No root-level LICENSE/COPYING file found; do not infer or assign a license without an owner decision.', 'warning'));
      return { id: repository.id, fullName: repository.fullName, declared: repository.licenseStatus || 'unknown', detected: null, status: 'MISSING_REVIEW_REQUIRED' };
    }
    const detected = detectLicenseIdentifier(fs.readFileSync(path.join(root, licensePath), 'utf8'));
    const declared = repository.licenseStatus || 'unknown';
    const explicitSpdx = /^[A-Za-z0-9.+-]+$/.test(declared) && !['unknown', 'not_reviewed', 'no_root_license_observed'].includes(declared);
    const mismatch = explicitSpdx && declared !== detected;
    if (detected === 'UNRECOGNIZED') issues.push(issue('LICENSE_UNRECOGNIZED', 'Root license file exists but did not match a supported identifier; human review is required.', 'warning', licensePath));
    if (mismatch) issues.push(issue('LICENSE_DECLARATION_MISMATCH', 'Detected root license does not match the registry declaration.', 'error', licensePath));
    if (declared === 'no_root_license_observed') issues.push(issue('LICENSE_REGISTRY_STALE', 'A root license file now exists but the registry still says no root license was observed.', 'warning', licensePath));
    return { id: repository.id, fullName: repository.fullName, declared, detected, licensePath, status: mismatch ? 'FAILED' : detected === 'UNRECOGNIZED' ? 'REVIEW' : 'VERIFIED' };
  });
  return { repositories, issues };
}

function isOwnedByLocalModule(filePath, manifest) {
  return (manifest.modules || []).some(module => module.repository === manifest.currentRepository
    && module.paths?.some(rawPath => {
      try {
        const ownerPath = normalizeRelativePath(rawPath);
        return ownerPath.endsWith('/') ? filePath.startsWith(ownerPath) : (filePath === ownerPath || filePath.startsWith(`${ownerPath}/`));
      } catch { return false; }
    }));
}

export function auditWorkspace(root, manifest) {
  const discovered = walkFiles(root);
  const findings = discovered.filter(x => x.code !== 'FILE');
  const files = discovered.filter(x => x.code === 'FILE');
  const duplicateMap = new Map();

  for (const file of files) {
    if (isSecretLikeFile(file.path)) findings.push(issue('SECRET_LIKE_FILE', `Secret-like file name detected; inspect and remove from Git if it contains sensitive material: ${file.path}.`, 'error', file.path));
    const rootLevel = !file.path.includes('/');
    if (rootLevel && (manifest.policy?.rootAssetExtensions || []).some(ext => file.path.toLowerCase().endsWith(ext.toLowerCase())) && !isOwnedByLocalModule(file.path, manifest)) {
      findings.push(issue('UNOWNED_ROOT_ASSET', `Root-level application asset has no registered module owner: ${file.path}.`, 'warning', file.path));
    }
    for (const managedRoot of manifest.policy?.managedRoots || []) {
      const prefix = normalizeRelativePath(managedRoot);
      if (file.path.startsWith(prefix) && !isOwnedByLocalModule(file.path, manifest)) {
        findings.push(issue('UNOWNED_MANAGED_PATH', `File in managed root has no module owner: ${file.path}.`, 'error', file.path));
        break;
      }
    }
    try {
      const stat = fs.statSync(file.absolute);
      const extension = path.extname(file.path).toLowerCase();
      const baseName = path.posix.basename(file.path);
      const likelyText = !extension || TEXT_EXTENSIONS.has(extension) || baseName.startsWith('.');
      if (likelyText && stat.size <= MAX_SECRET_SCAN_BYTES) {
        const content = readTextFile(root, file.path, MAX_SECRET_SCAN_BYTES);
        if (content !== null) findings.push(...scanSecretContent(file.path, content));
      } else if (likelyText) {
        findings.push(issue('SECRET_SCAN_SIZE_LIMIT', 'File exceeded the 1 MiB content-scan limit and was not inspected for secrets.', 'warning', file.path));
      }
      if (stat.size > 0 && stat.size <= MAX_HASH_BYTES) {
        const digest = crypto.createHash('sha256').update(fs.readFileSync(file.absolute)).digest('hex');
        const group = duplicateMap.get(digest) || [];
        group.push(file.path);
        duplicateMap.set(digest, group);
      }
    } catch (error) {
      findings.push(issue('FILE_READ_FAILED', 'Could not inspect file: ' + error.message, 'warning', file.path));
    }
  }

  const duplicateGroups = [...duplicateMap.entries()]
    .filter(([, paths]) => paths.length > 1)
    .map(([sha256, paths]) => ({ sha256, paths: paths.sort() }))
    .sort((a, b) => a.paths[0].localeCompare(b.paths[0]));
  for (const group of duplicateGroups) {
    findings.push(issue('DUPLICATE_CONTENT', `Identical file contents detected: ${group.paths.join(', ')}. No files were modified.`, 'warning', group.paths[0]));
  }
  const duplicateReferenceAudit = auditDuplicateReferences(root, duplicateGroups);
  const licenseAudit = auditLicenses(root, manifest);
  findings.push(...licenseAudit.issues);
  findings.sort((a, b) => a.severity.localeCompare(b.severity) || (a.path || '').localeCompare(b.path || '') || a.code.localeCompare(b.code));
  const errors = findings.filter(x => x.severity === 'error');
  const warnings = findings.filter(x => x.severity === 'warning');
  return {
    status: errors.length ? 'FAILED' : warnings.length ? 'REVIEW' : 'VERIFIED',
    scannedFiles: files.length,
    moduleCount: (manifest.modules || []).filter(x => x.repository === manifest.currentRepository).length,
    findings,
    duplicateGroups,
    duplicateReferenceAudit,
    licenseAudit,
    errorCount: errors.length,
    warningCount: warnings.length,
  };
}

export function createProvenanceRecord(env = process.env, manifestContent = '') {
  const commitSha = env.GITHUB_SHA || null;
  if (commitSha && !/^[a-f0-9]{40,64}$/i.test(commitSha)) throw new TypeError('GITHUB_SHA must be a 40- to 64-character hexadecimal commit hash');
  const timestamp = env.MIDAD_GOVERNANCE_TIMESTAMP || new Date().toISOString();
  if (Number.isNaN(Date.parse(timestamp))) throw new TypeError('MIDAD_GOVERNANCE_TIMESTAMP must be a valid ISO timestamp');
  const sourceHeadSha = env.MIDAD_GOVERNANCE_PR_HEAD_SHA || commitSha;
  const baseSha = env.MIDAD_GOVERNANCE_PR_BASE_SHA || null;
  for (const [label, sha] of [['MIDAD_GOVERNANCE_PR_HEAD_SHA', sourceHeadSha], ['MIDAD_GOVERNANCE_PR_BASE_SHA', baseSha]]) {
    if (sha && !/^[a-f0-9]{40,64}$/i.test(sha)) throw new TypeError(`${label} must be a 40- to 64-character hexadecimal commit hash`);
  }
  const pullRequestNumber = env.MIDAD_GOVERNANCE_PR_NUMBER ? Number(env.MIDAD_GOVERNANCE_PR_NUMBER) : null;
  if (pullRequestNumber !== null && (!Number.isInteger(pullRequestNumber) || pullRequestNumber < 1)) throw new TypeError('MIDAD_GOVERNANCE_PR_NUMBER must be a positive integer');
  const runAttempt = env.GITHUB_RUN_ATTEMPT ? Number(env.GITHUB_RUN_ATTEMPT) : 1;
  if (!Number.isInteger(runAttempt) || runAttempt < 1) throw new TypeError('GITHUB_RUN_ATTEMPT must be a positive integer');
  return {
    schemaVersion: 1,
    repository: env.GITHUB_REPOSITORY || 'local',
    commitSha,
    sourceHeadSha,
    baseSha,
    pullRequestNumber,
    ref: env.GITHUB_REF || 'local',
    workflow: env.GITHUB_WORKFLOW || 'local',
    runId: env.GITHUB_RUN_ID || null,
    runAttempt,
    eventName: env.GITHUB_EVENT_NAME || 'local',
    actor: env.GITHUB_ACTOR || 'local',
    recordedAt: new Date(timestamp).toISOString(),
    manifestSha256: crypto.createHash('sha256').update(String(manifestContent)).digest('hex'),
    secretValuesIncluded: false,
  };
}
