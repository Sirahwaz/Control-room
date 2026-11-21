/**
 * MIDAD local model registry/integration adapter.
 * Capability-gated: inference is not ready until the native MNN runtime is integrated.
 */
export const MNN_POCKET_MODEL = Object.freeze({
  id: "taobao-mnn/MNN-Pocket-0.3B-MNN", format: "MNN-INT4-W4A16",
  approximateBytes: 173 * 1024 * 1024, license: "Apache-2.0",
  source: "https://huggingface.co/taobao-mnn/MNN-Pocket-0.3B-MNN",
  runtime: "MNN-LLM", languages: ["zh", "en"], contextTokens: 32768,
});
export function localModelCapability(nativeBridge) {
  return !!nativeBridge && typeof nativeBridge.localModelStatus === "function" &&
    typeof nativeBridge.localModelGenerate === "function";
}
export function localModelStatus(nativeBridge) {
  if (!localModelCapability(nativeBridge)) return {
    state: "runtime_missing", model: MNN_POCKET_MODEL.id,
    inferenceReady: false, reason: "native_mnn_runtime_not_integrated",
  };
  return nativeBridge.localModelStatus();
}
export async function localModelGenerate(nativeBridge, prompt, options = {}) {
  if (!localModelCapability(nativeBridge)) throw new Error("native_mnn_runtime_not_integrated");
  if (typeof prompt !== "string" || !prompt.trim() || prompt.length > 12000) throw new Error("prompt_invalid");
  const requested = Number(options.maxTokens);
  const maxTokens = Number.isFinite(requested) ? Math.min(512, Math.max(1, Math.floor(requested))) : 256;
  return nativeBridge.localModelGenerate(prompt, { maxTokens });
}
