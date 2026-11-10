import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync(
  new URL('../../../../.github/workflows/midad-continuity-cloudflare-deploy.yml', import.meta.url),
  'utf8',
);

test('Cloudflare deploy requires, validates and installs the complete Vault keyring', () => {
  assert.ok(
    workflow.includes('MIDAD_VAULT_KEYRING_JSON: ${{ secrets.MIDAD_VAULT_KEYRING_JSON }}'),
    'the protected environment keyring secret must be mapped into the deploy job',
  );
  assert.ok(
    workflow.includes('MIDAD_VAULT_ACTIVE_KEY_VERSION: ${{ secrets.MIDAD_VAULT_ACTIVE_KEY_VERSION }}'),
    'the protected environment active key version must be mapped into the deploy job',
  );
  assert.ok(
    workflow.includes('-z "$MIDAD_VAULT_KEYRING_JSON"') &&
      workflow.includes('-z "$MIDAD_VAULT_ACTIVE_KEY_VERSION"'),
    'deployment must fail closed when either Vault key setting is missing',
  );
  assert.ok(
    workflow.includes('readVaultKeyring(process.env)'),
    'the deployment preflight must validate JSON, key lengths and active key version with the production parser',
  );
  assert.ok(
    workflow.includes('MIDAD_VAULT_KEYRING_JSON: process.env.MIDAD_VAULT_KEYRING_JSON'),
    'the validated Vault keyring must be installed as a Worker secret',
  );
  assert.ok(
    workflow.includes('MIDAD_VAULT_ACTIVE_KEY_VERSION: process.env.MIDAD_VAULT_ACTIVE_KEY_VERSION'),
    'the active Vault key version must be installed as a Worker secret',
  );
});
