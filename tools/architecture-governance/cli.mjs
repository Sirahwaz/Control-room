#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {
  validateManifest,
  auditWorkspace,
  analyzeImpact,
  createProvenanceRecord,
} from './validator.mjs';

function parseArgs(args) {
  const options = { manifest: 'architecture/governance/manifest.json', out: null, impactFile: null, provenance: false, failOnUnmapped: false, help: false };
  for (let i = 0; i < args.length; i += 1) {
    const value = args[i];
    if (value === '--manifest') options.manifest = args[++i];
    else if (value === '--out') options.out = args[++i];
    else if (value === '--impact-file') options.impactFile = args[++i];
    else if (value === '--provenance') options.provenance = true;
    else if (value === '--fail-on-unmapped') options.failOnUnmapped = true;
    else if (value === '--help' || value === '-h') options.help = true;
    else throw new Error(`Unknown argument: ${value}`);
  }
  if (!options.manifest) throw new Error('--manifest requires a path');
  if (options.out === '') throw new Error('--out requires a directory');
  if (options.impactFile === '') throw new Error('--impact-file requires a path');
  return options;
}

function writeJson(directory, fileName, value) {
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, fileName), `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
}

function usage() {
  return [
    'MIDAD Architecture Governance',
    '',
    'Usage:',
    '  node tools/architecture-governance/cli.mjs [options]',
    '',
    'Options:',
    '  --manifest <path>     Governance manifest (default: architecture/governance/manifest.json)',
    '  --impact-file <path>  Newline-delimited changed paths to analyze',
    '  --out <directory>     Write health, impact and provenance JSON artifacts',
    '  --provenance          Generate release/run provenance metadata',
    '  --fail-on-unmapped    Fail when changed paths have no registered owner',
    '  --help                Show this help',
  ].join('\n');
}

function main() {
  let options;
  try { options = parseArgs(process.argv.slice(2)); }
  catch (error) {
    process.stderr.write(`${error.message}\n${usage()}\n`);
    return 2;
  }
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }

  const root = process.cwd();
  const manifestPath = path.resolve(root, options.manifest);
  let manifestContent;
  let manifest;
  try {
    manifestContent = fs.readFileSync(manifestPath, 'utf8');
    manifest = JSON.parse(manifestContent);
  } catch (error) {
    process.stderr.write(`Could not load governance manifest: ${error.message}\n`);
    return 2;
  }

  const validation = validateManifest(manifest, { root });
  const audit = auditWorkspace(root, manifest);
  const impactPaths = options.impactFile
    ? fs.readFileSync(path.resolve(root, options.impactFile), 'utf8').split(/\r?\n/).map(x => x.trim()).filter(Boolean)
    : null;
  let impact = null;
  if (impactPaths) {
    try { impact = analyzeImpact(impactPaths, manifest); }
    catch (error) {
      process.stderr.write(`Change-impact analysis failed: ${error.message}\n`);
      return 2;
    }
  }

  const impactGatePassed = !options.failOnUnmapped || Boolean(impact && impact.unmappedPaths.length === 0);
  const status = !validation.valid || audit.errorCount > 0 || !impactGatePassed ? 'FAILED' : audit.status;
  const report = {
    schemaVersion: 1,
    status,
    checkedAt: new Date().toISOString(),
    repository: manifest.repositories?.find(x => x.id === manifest.currentRepository)?.fullName || manifest.currentRepository,
    manifestSha256: createProvenanceRecord({}, manifestContent).manifestSha256,
    validation: {
      valid: validation.valid,
      repositoryCount: validation.repositoryCount,
      moduleCount: validation.moduleCount,
      dependencyCount: validation.dependencyCount,
      moduleHealth: validation.moduleHealth,
      errors: validation.errors,
      warnings: validation.warnings,
    },
    audit,
    changeImpact: impact,
    impactGate: { enabled: options.failOnUnmapped, passed: impactGatePassed, unmappedPaths: impact?.unmappedPaths || [] },
  };

  let provenance = null;
  if (options.provenance || options.out) provenance = createProvenanceRecord(process.env, manifestContent);

  if (options.out) {
    const outputDirectory = path.resolve(root, options.out);
    writeJson(outputDirectory, 'architecture-health.json', report);
    if (impact) writeJson(outputDirectory, 'change-impact.json', impact);
    if (provenance) writeJson(outputDirectory, 'release-provenance.json', provenance);
  }

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  return status === 'FAILED' ? 1 : 0;
}

process.exitCode = main();
