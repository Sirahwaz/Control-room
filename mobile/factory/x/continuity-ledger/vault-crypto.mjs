const encoder = new TextEncoder();
const decoder = new TextDecoder();

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const KEY_VERSION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;

function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return '{' + Object.keys(value).sort().map(key =>
    JSON.stringify(key) + ':' + canonical(value[key])
  ).join(',') + '}';
}

function encode64url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function decode64url(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error('VAULT_KEY_ENCODING_INVALID');
  }
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(normalized + '='.repeat((4 - normalized.length % 4) % 4));
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

function requireCrypto() {
  if (!globalThis.crypto?.subtle || typeof globalThis.crypto.getRandomValues !== 'function') {
    throw new Error('VAULT_CRYPTO_UNAVAILABLE');
  }
}

export function readVaultKeyring(env = {}) {
  requireCrypto();
  const raw = env.MIDAD_VAULT_KEYRING_JSON;
  const activeVersion = env.MIDAD_VAULT_ACTIVE_KEY_VERSION;
  if (typeof raw !== 'string' || !raw.trim() ||
      typeof activeVersion !== 'string' || !KEY_VERSION.test(activeVersion)) {
    throw new Error('VAULT_KEYRING_NOT_CONFIGURED');
  }
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch { throw new Error('VAULT_KEYRING_INVALID'); }
  if (!isRecord(parsed) || !Object.keys(parsed).length) throw new Error('VAULT_KEYRING_INVALID');
  const keys = new Map();
  for (const [version, encoded] of Object.entries(parsed)) {
    if (!KEY_VERSION.test(version)) throw new Error('VAULT_KEY_VERSION_INVALID');
    const key = decode64url(encoded);
    if (key.byteLength !== 32) throw new Error('VAULT_KEY_LENGTH_INVALID');
    keys.set(version, key);
  }
  if (!keys.has(activeVersion)) throw new Error('VAULT_ACTIVE_KEY_VERSION_MISSING');
  return { keys, activeVersion };
}

function metadataAad(metadata) {
  const required = ['owner_id', 'binding_id', 'secret_ref', 'platform_id', 'host', 'purpose', 'scope'];
  if (!isRecord(metadata) || required.some(key => typeof metadata[key] !== 'string' || !metadata[key])) {
    throw new Error('VAULT_METADATA_INVALID');
  }
  return encoder.encode('midad-vault-secret-v1:' + canonical(Object.fromEntries(required.map(key => [key, metadata[key]]))));
}

async function importAesKey(raw, usages) {
  return globalThis.crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, usages);
}

async function wrapAad(metadata, version) {
  return encoder.encode('midad-vault-dek-wrap-v1:' + version + ':' + canonical(metadata));
}

export async function encryptVaultSecret(secret, metadata, env = {}) {
  if (!isRecord(secret)) throw new Error('VAULT_SECRET_OBJECT_REQUIRED');
  const plaintext = encoder.encode(JSON.stringify(secret));
  if (plaintext.byteLength < 2 || plaintext.byteLength > 16384) throw new Error('VAULT_SECRET_SIZE_INVALID');
  const aad = metadataAad(metadata);
  const keyring = readVaultKeyring(env);
  const dek = globalThis.crypto.getRandomValues(new Uint8Array(32));
  const nonce = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const wrapNonce = globalThis.crypto.getRandomValues(new Uint8Array(12));
  try {
    const dataKey = await importAesKey(dek, ['encrypt', 'decrypt']);
    const kek = await importAesKey(keyring.keys.get(keyring.activeVersion), ['encrypt', 'decrypt']);
    const ciphertext = await globalThis.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: nonce, additionalData: aad, tagLength: 128 },
      dataKey,
      plaintext,
    );
    const wrapped = await globalThis.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: wrapNonce, additionalData: await wrapAad(metadata, keyring.activeVersion), tagLength: 128 },
      kek,
      dek,
    );
    return {
      key_version: keyring.activeVersion,
      ciphertext_b64: encode64url(new Uint8Array(ciphertext)),
      nonce_b64: encode64url(nonce),
      wrapped_dek_b64: encode64url(new Uint8Array(wrapped)),
      wrap_nonce_b64: encode64url(wrapNonce),
    };
  } finally {
    dek.fill(0);
    plaintext.fill(0);
  }
}

async function unwrapDataKey(row, metadata, keyring) {
  const key = keyring.keys.get(row.key_version);
  if (!key) throw new Error('VAULT_KEY_VERSION_UNAVAILABLE');
  const wrappedDek = decode64url(row.wrapped_dek_b64);
  const wrapNonce = decode64url(row.wrap_nonce_b64);
  const kek = await importAesKey(key, ['decrypt']);
  const rawDek = await globalThis.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: wrapNonce, additionalData: await wrapAad(metadata, row.key_version), tagLength: 128 },
    kek,
    wrappedDek,
  );
  return new Uint8Array(rawDek);
}

export async function decryptVaultSecret(row, metadata, env = {}) {
  const keyring = readVaultKeyring(env);
  const dek = await unwrapDataKey(row, metadata, keyring);
  try {
    const dataKey = await importAesKey(dek, ['decrypt']);
    const plaintext = await globalThis.crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: decode64url(row.nonce_b64),
        additionalData: metadataAad(metadata),
        tagLength: 128,
      },
      dataKey,
      decode64url(row.ciphertext_b64),
    );
    const value = JSON.parse(decoder.decode(plaintext));
    if (!isRecord(value)) throw new Error('VAULT_SECRET_PAYLOAD_INVALID');
    return value;
  } catch {
    throw new Error('VAULT_DECRYPTION_FAILED');
  } finally {
    dek.fill(0);
  }
}

export async function rewrapVaultSecret(row, metadata, env = {}) {
  const keyring = readVaultKeyring(env);
  if (row.key_version === keyring.activeVersion) return { ...row };
  const dek = await unwrapDataKey(row, metadata, keyring);
  const wrapNonce = globalThis.crypto.getRandomValues(new Uint8Array(12));
  try {
    const kek = await importAesKey(keyring.keys.get(keyring.activeVersion), ['encrypt']);
    const wrapped = await globalThis.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: wrapNonce, additionalData: await wrapAad(metadata, keyring.activeVersion), tagLength: 128 },
      kek,
      dek,
    );
    return {
      ...row,
      key_version: keyring.activeVersion,
      wrapped_dek_b64: encode64url(new Uint8Array(wrapped)),
      wrap_nonce_b64: encode64url(wrapNonce),
    };
  } finally {
    dek.fill(0);
  }
}

export async function deriveVaultLeaseToken(lease, env = {}) {
  const keyring = readVaultKeyring(env);
  const rawKey = keyring.keys.get(lease.key_version);
  if (!rawKey) throw new Error('VAULT_KEY_VERSION_UNAVAILABLE');
  const key = await globalThis.crypto.subtle.importKey(
    'raw', rawKey, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const material = encoder.encode('midad-vault-lease-token-v1:' + canonical({
    lease_id: lease.lease_id,
    owner_id: lease.owner_id,
    node_id: lease.node_id,
    task_id: lease.task_id,
    binding_id: lease.binding_id,
    request_id: lease.request_id,
    expires_at_ms: lease.expires_at_ms,
    key_version: lease.key_version,
  }));
  const signature = await globalThis.crypto.subtle.sign('HMAC', key, material);
  return encode64url(new Uint8Array(signature));
}
