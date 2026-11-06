import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const manifest = JSON.parse(
  fs.readFileSync(new URL('../compute/mncf/manifest.json', import.meta.url), 'utf8')
);

test('MNCF is explicitly hybrid and zero-budget', () => {
  assert.equal(manifest.scope.mode, 'hybrid');
  assert.equal(manifest.budget.mode, 'zero');
  assert.equal(manifest.budget.allow_paid_resources, false);
});

test('Linux production compute is separate from the HakiOS research guest', () => {
  assert.equal(manifest.layers.linux_compute.role, 'production_compute');
  assert.equal(manifest.layers.hakios_lab.role, 'isolated_research_guest');
  assert.equal(manifest.layers.hakios_lab.production_kernel, false);
  assert.equal(manifest.layers.hakios_lab.qemu.target, 'qemu-open');
  assert.equal(manifest.layers.hakios_lab.qemu.requires_apple_payload, false);
});

test('only verified ephemeral CI compute is enabled by default', () => {
  const enabled = manifest.providers.filter(provider => provider.enabled);
  assert.deepEqual(enabled.map(provider => provider.id), ['github-actions-linux']);
  assert.equal(enabled[0].persistence, 'ephemeral');
  assert.equal(enabled[0].paid_resources_allowed, false);
  assert.equal(
    manifest.providers.find(provider => provider.id === 'self-hosted-linux').enabled,
    false
  );
});

test('no network administration ports are exposed by the baseline', () => {
  assert.deepEqual(manifest.network.publicly_exposed_ports, []);
  assert.equal(manifest.network.remote_access_requires_authenticated_overlay, true);
});

test('existing MIDAD control-plane components are preserved as integrations', () => {
  for (const component of [
    'midad_orchestrator',
    'midad_forge',
    'midad_forge_coordinator',
    'midad_bot_fabric'
  ]) {
    assert.ok(manifest.integrations.existing_control_plane.includes(component));
  }
  assert.equal(manifest.integrations.create_replacement_orchestrator, false);
});

test('manifest contains no credentials or secret material', () => {
  const serialized = JSON.stringify(manifest);
  assert.doesNotMatch(serialized, /(api[_-]?key|secret|token|password|private[_-]?key)\s*[:=]\s*["'][^"']+/i);
});
