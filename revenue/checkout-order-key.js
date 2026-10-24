(function (root) {
  "use strict";
  const KEY_RE = /^store-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const memory = new Map();

  async function getPendingKey(input) {
    const productId = String((input && input.productId) || "").trim();
    if (!productId) throw new Error("checkout_product_required");
    if (!root.crypto || !root.crypto.subtle || typeof root.crypto.randomUUID !== "function") throw new Error("checkout_key_generation_unavailable");
    const fields = [
      productId,
      String((input && input.customerName) || "").trim(),
      String((input && input.customerEmail) || "").trim().toLowerCase(),
      String((input && input.requirements) || "").trim()
    ];
    const digest = await root.crypto.subtle.digest("SHA-256", new TextEncoder().encode(fields.join("\u0000")));
    const fingerprint = Array.from(new Uint8Array(digest), function (byte) { return byte.toString(16).padStart(2, "0"); }).join("");
    const slot = "midad.checkout.pending.v1:" + fingerprint;
    let key = memory.get(slot) || "";
    try { key = root.sessionStorage.getItem(slot) || key; } catch (_) {}
    if (!KEY_RE.test(key)) {
      key = "store-" + root.crypto.randomUUID();
      memory.set(slot, key);
      try { root.sessionStorage.setItem(slot, key); } catch (_) {}
    }
    return { key: key, slot: slot };
  }

  function clearPendingKey(slot) {
    if (!slot) return;
    memory.delete(slot);
    try { root.sessionStorage.removeItem(slot); } catch (_) {}
  }

  root.MIDADOrderKeys = Object.freeze({ KEY_RE: KEY_RE, getPendingKey: getPendingKey, clearPendingKey: clearPendingKey });
})(window);
