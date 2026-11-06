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
  assert.equal(manifest.layers.hakios_lab.source_ref, '63fc2b4633bac3af8e57dadab9f5a8d4cb940438');
  assert.equal(manifest.layers.hakios_lab.qemu.smoke_mode, 'prebuilt-qemu-boot');
  assert.equal(manifest.layers.hakios_lab.qemu.full_source_build, false);
  assert.equal(manifest.layers.hakios_lab.qemu.ci_workflow, '.github/workflows/midad-hakios-qemu-smoke.yml');
  assert.equal(manifest.layers.hakios_lab.qemu.firmware_flash_strategy, 'copy-and-zero-extend-code-and-vars-images-to-64MiB');
});

test('only verified ephemeral CI compute is enabled by default', () => {
  const enabled = manifest.providers.filter(provider => provider.enabled);
  assert.deepEqual(enabled.map(provider => provider.id), ['github-actions-linux']);
  assert.equal(enabled[0].persistence, 'ephemeral');
  assert.equal(enabled[0].paid_resources_allowed, false);
  assert.ok(enabled[0].permitted_workloads.includes('hakios-prebuilt-qemu-boot-smoke'));
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
test('external technologies are classified without replacing the production stack', () => {
  const review = manifest.external_technology_review;
  assert.equal(review.candidates.weaver.adoption, 'not_in_server_runtime');
  assert.equal(review.candidates.tiny11builder.adoption, 'excluded_from_linux_compute');
  assert.equal(review.candidates.fuchsia.adoption, 'patterns_only_not_production_kernel');
  assert.equal(review.candidates.appwrite.adoption, 'not_deployed_not_a_supabase_replacement');
  const openworld = manifest.providers.find(provider => provider.id === 'openworld-vps-sandbox');
  assert.equal(openworld.enabled, false);
  assert.equal(openworld.production_eligible, false);
  assert.equal(openworld.paid_resources_allowed, false);
  assert.ok(openworld.forbidden_workloads.includes('credentials'));
  assert.equal(openworld.verified_public_facts.no_card, true);
  assert.equal(openworld.verified_public_facts.authentication, 'Discord');
  assert.equal(openworld.verified_public_facts.retention_conflict_unresolved, true);
  assert.equal(openworld.enabled, false);
});
