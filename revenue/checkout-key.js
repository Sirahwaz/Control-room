(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MIDADCheckoutKey = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const PUBLIC_ORDER_KEY_RE = /^store-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const STORAGE_PREFIX = 'midadRevenueOrderKey:v2:';

  function clean(value) {
    return String(value ?? '').trim();
  }

  function newUuid(cryptoApi) {
    if (typeof cryptoApi.randomUUID === 'function') return cryptoApi.randomUUID();
    if (typeof cryptoApi.getRandomValues !== 'function') throw new Error('secure_random_unavailable');
    const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  async function createCheckoutKey({
    product,
    customerName = '',
    customerEmail = '',
    customerRequirements = '',
    storage,
    cryptoApi
  } = {}) {
    const productId = clean(product);
    if (!productId) throw new Error('checkout_product_required');
    if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') {
      throw new Error('checkout_storage_unavailable');
    }
    if (!cryptoApi || !cryptoApi.subtle || typeof cryptoApi.subtle.digest !== 'function') {
      throw new Error('checkout_crypto_unavailable');
    }

    // Hash order details before they become part of a browser-storage key.
    const fingerprint = JSON.stringify([
      productId,
      clean(customerName),
      clean(customerEmail).toLowerCase(),
      clean(customerRequirements)
    ]);
    const digest = await cryptoApi.subtle.digest('SHA-256', new TextEncoder().encode(fingerprint));
    const fingerprintHash = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
    const storageKey = `${STORAGE_PREFIX}${productId}:${fingerprintHash}`;

    let id = clean(storage.getItem(storageKey));
    if (!UUID_RE.test(id)) {
      id = newUuid(cryptoApi);
      if (!UUID_RE.test(id)) throw new Error('secure_uuid_invalid');
      storage.setItem(storageKey, id);
    }

    const orderKey = `store-${id}`;
    if (!PUBLIC_ORDER_KEY_RE.test(orderKey)) throw new Error('public_order_key_invalid');
    return Object.freeze({ orderKey, storageKey });
  }

  function clearCheckoutKey({ storage, storageKey } = {}) {
    if (!storage || typeof storage.removeItem !== 'function') throw new Error('checkout_storage_unavailable');
    const key = clean(storageKey);
    if (!key.startsWith(STORAGE_PREFIX)) throw new Error('checkout_storage_key_invalid');
    storage.removeItem(key);
  }

  return Object.freeze({ createCheckoutKey, clearCheckoutKey, PUBLIC_ORDER_KEY_RE });
});
