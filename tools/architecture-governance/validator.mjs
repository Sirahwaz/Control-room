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

function moduleOwnsPath(module, changedPath) {
  if (module.repository !== module._currentRepository) return false;
  return module.paths.some(rawPath => {
    const ownerPath = normalizeRelativePath(rawPath);
    if (ownerPath.endsWith('/')) return changedPath.startsWith(ownerPath);
    return changedPath === ownerPath || changedPath.startsWith(`${ownerPath}/`);
  });
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
      const exists = module.repository !== manifest.currentRepository || localPathExists(root, normalized);
      checks.push({ path: normalized, exists });
      if (!exists) errors.push(issue('MISSING_MODULE_PATH', `Module ${module.id} path does not exist: ${normalized}`, 'error', normalized));
    }
    if (module.id) moduleHealth.push({ id: module.id, repository: module.repository, status: checks.every(x => x.exists) ? 'VERIFIED' : 'FAILED', paths: checks });
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
    const owners = localModules
      .filter(module => moduleOwnsPath({ ...module, _currentRepository: manifest.currentRepository }, changedPath))
      .sort((a, b) => b.paths.reduce((n, p) => Math.max(n, normalizeRelativePath(p).length), 0) - a.paths.reduce((n, p) => Math.max(n, normalizeRelativePath(p).length), 0));
    if (owners.length === 0) unmappedPaths.push(changedPath);
    for (const owner of owners) directlyChanged.add(owner.id);
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
      if (stat.size > 0 && stat.size <= MAX_HASH_BYTES) {
        const digest = crypto.createHash('sha256').update(fs.readFileSync(file.absolute)).digest('hex');
        const group = duplicateMap.get(digest) || [];
        group.push(file.path);
        duplicateMap.set(digest, group);
      }
    } catch (error) {
      findings.push(issue('FILE_READ_FAILED', `Could not inspect file: ${error.message}`, 'warning', file.path));
    }
  }

  const duplicateGroups = [...duplicateMap.entries()]
    .filter(([, paths]) => paths.length > 1)
    .map(([sha256, paths]) => ({ sha256, paths: paths.sort() }))
    .sort((a, b) => a.paths[0].localeCompare(b.paths[0]));
  for (const group of duplicateGroups) {
    findings.push(issue('DUPLICATE_CONTENT', `Identical file contents detected: ${group.paths.join(', ')}. No files were modified.`, 'warning', group.paths[0]));
  }
  findings.sort((a, b) => a.severity.localeCompare(b.severity) || (a.path || '').localeCompare(b.path || '') || a.code.localeCompare(b.code));
  const errors = findings.filter(x => x.severity === 'error');
  const warnings = findings.filter(x => x.severity === 'warning');
  return {
    status: errors.length ? 'FAILED' : warnings.length ? 'REVIEW' : 'VERIFIED',
    scannedFiles: files.length,
    moduleCount: (manifest.modules || []).filter(x => x.repository === manifest.currentRepository).length,
    findings,
    duplicateGroups,
    errorCount: errors.length,
    warningCount: warnings.length,
  };
}

export function createProvenanceRecord(env = process.env, manifestContent = '') {
  const commitSha = env.GITHUB_SHA || null;
  if (commitSha && !/^[a-f0-9]{40,64}$/i.test(commitSha)) throw new TypeError('GITHUB_SHA must be a 40- to 64-character hexadecimal commit hash');
  const timestamp = env.MIDAD_GOVERNANCE_TIMESTAMP || new Date().toISOString();
  if (Number.isNaN(Date.parse(timestamp))) throw new TypeError('MIDAD_GOVERNANCE_TIMESTAMP must be a valid ISO timestamp');
  const runAttempt = env.GITHUB_RUN_ATTEMPT ? Number(env.GITHUB_RUN_ATTEMPT) : 1;
  if (!Number.isInteger(runAttempt) || runAttempt < 1) throw new TypeError('GITHUB_RUN_ATTEMPT must be a positive integer');
  return {
    schemaVersion: 1,
    repository: env.GITHUB_REPOSITORY || 'local',
    commitSha,
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
