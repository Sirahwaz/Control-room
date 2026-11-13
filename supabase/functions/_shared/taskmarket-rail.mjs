/**
 * Fail-closed normalization for Taskmarket's multi-chain payment rail.
 * Pure helpers: no network access, secrets, or writes.
 */
export function normalizeTaskmarketRail(task) {
  const rawId = task?.chainId ?? task?.chain_id;
  const parsedId = rawId === null || rawId === undefined || rawId === "" ? NaN : Number(rawId);
  const chainId = Number.isSafeInteger(parsedId) && parsedId > 0 ? parsedId : null;
  if (chainId === 8453) return { chainId, asset: "USDC", network: "Base", supportedForBaseVerifier: true };
  if (chainId === 4217) return { chainId, asset: "OUSD", network: "Tempo", supportedForBaseVerifier: false };
  return { chainId, asset: null, network: chainId === null ? "unknown" : String(chainId), supportedForBaseVerifier: false };
}
export function isSupportedBaseUsdcRail(rail) {
  return rail?.chainId === 8453 && rail?.asset === "USDC" && rail?.network === "Base" && rail?.supportedForBaseVerifier === true;
}
export function isSupportedTempoOusdRail(rail) {
  return rail?.chainId === 4217 && rail?.asset === "OUSD" && rail?.network === "Tempo" && rail?.supportedForBaseVerifier === false;
}
/** Prefer official payout/funding evidence over the human-facing task page. */
export function resolveOfficialProofUrl(task) {
  return String(task?.payout_proof_url || task?.payoutProofUrl || task?.url || "").trim();
}
/**
 * Pure, fail-closed receipt validator for Taskmarket's Tempo/OUSD escrow.
 * It proves the task-specific escrow deposit, not worker acceptance or future earnings.
 */
export function evaluateTaskmarketTempoReceipt(input) {
  const chainId = Number(input?.chainId);
  const taskId = String(input?.taskId || "").toLowerCase();
  const txHash = String(input?.txHash || "").toLowerCase();
  const receipt = input?.receipt;
  const confirmations = Number(input?.confirmations);
  if (chainId !== 4217) return { verified:false, unsupported:true, retryable:false, reason:"tempo_chain_id_mismatch", expected_chain_id:4217, current_chain_id:Number.isFinite(chainId)?chainId:null };
  if (!/^0x[a-f0-9]{64}$/.test(taskId) || !/^0x[a-f0-9]{64}$/.test(txHash)) return { verified:false, retryable:false, reason:"invalid_task_or_transaction_hash" };
  let rewardAtomic;
  try { rewardAtomic = BigInt(String(input?.rewardAtomic ?? "0")); } catch { return { verified:false, retryable:false, reason:"invalid_reward_amount" }; }
  if (rewardAtomic <= 0n) return { verified:false, retryable:false, reason:"invalid_reward_amount" };
  if (!receipt || typeof receipt !== "object") return { verified:false, retryable:true, reason:"tempo_receipt_not_available_yet", tx_hash:txHash };
  const receiptTx = String(receipt.transactionHash || "").toLowerCase();
  if (receiptTx && receiptTx !== txHash) return { verified:false, retryable:false, reason:"tempo_receipt_transaction_hash_mismatch", tx_hash:txHash, receipt_tx_hash:receiptTx };
  const receiptStatus = String(receipt.status || "").toLowerCase();
  if (receiptStatus !== "0x1") return { verified:false, retryable:false, reason:"tempo_transaction_not_successful", tx_hash:txHash, receipt_status:receiptStatus || null };
  const ousd="0x20c0000000000000000000006a37da5c996874be";
  const market="0xf4f4a00011b080ebc1e599a765d8bce7557b97e7";
  const relayer="0x3c0820e2dabd5feae1fd03b78079dee15c7f83d8";
  const transferTopic="0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
  const taskCreatedTopic="0xe0dc4072f8420c56e984e9c6eec7bad2e5616825f0d1ca581bd96ff3e8eec948";
  const padded=(address)=>"0x000000000000000000000000"+address.slice(2);
  const logs=Array.isArray(receipt.logs)?receipt.logs:[];
  let transfer=null, taskEvent=null;
  for (const log of logs) {
    if (!log || log.removed===true) continue;
    const address=String(log.address||"").toLowerCase();
    const topics=Array.isArray(log.topics)?log.topics.map((x)=>String(x||"").toLowerCase()):[];
    if (address===ousd && topics[0]===transferTopic && topics[1]===padded(relayer) && topics[2]===padded(market)) {
      try { if (BigInt(String(log.data||"0x0"))===rewardAtomic) transfer=log; } catch {}
    }
    if (address===market && topics[0]===taskCreatedTopic && topics[1]===taskId) {
      const data=String(log.data||"").toLowerCase();
      const firstWord=/^0x[0-9a-f]{64}/.test(data)?data.slice(0,66):"";
      try { if (firstWord && BigInt(firstWord)===rewardAtomic) taskEvent=log; } catch {}
    }
  }
  if (!transfer) return { verified:false, retryable:false, reason:"tempo_receipt_missing_exact_ousd_escrow_transfer", tx_hash:txHash, receipt_status:receiptStatus };
  if (!taskEvent) return { verified:false, retryable:false, reason:"tempo_receipt_missing_matching_task_created_event", tx_hash:txHash, receipt_status:receiptStatus };
  if (!Number.isFinite(confirmations) || confirmations<12) return { verified:false, retryable:true, reason:"awaiting_12_tempo_confirmations", tx_hash:txHash, confirmations:Math.max(0,Number.isFinite(confirmations)?confirmations:0), receipt_block:receipt.blockNumber||null };
  return { verified:true, retryable:false, reason:"live_tempo_task_and_ousd_escrow_receipt_verified", chain_id:4217, network:"Tempo", asset:"OUSD", tx_hash:txHash, task_id:taskId, reward_atomic:rewardAtomic.toString(), confirmations, required_confirmations:12, receipt_block:receipt.blockNumber||null, ousd_contract:ousd, escrow_contract:market, relayer, transfer_log_index:transfer.logIndex||null, task_event_log_index:taskEvent.logIndex||null, checked_at:new Date().toISOString() };
}


/** Supported native crypto assets for Taskmarket discovery; payout proof remains a separate gate. */
export function isSupportedTaskmarketCryptoAsset(asset) {
  return ["USDC", "USDT", "OUSD", "BTC", "ETH", "SOL", "DAI", "EURC"].includes(String(asset ?? "").trim().toUpperCase());
}

/**
 * Reuse a Tempo escrow proof only while it is recent and every identity,
 * asset, network, amount and finality field still matches the live listing.
 * This is escrow-funding evidence only, never worker-payment evidence.
 */
export function isFreshVerifiedTempoProof(input) {
  const status = String(input?.status ?? "").trim().toLowerCase();
  const paymentTxHash = String(input?.paymentTxHash ?? "").trim().toLowerCase();
  const taskId = String(input?.taskId ?? "").trim().toLowerCase();
  const txHash = String(input?.txHash ?? "").trim().toLowerCase();
  const proof = input?.proof && typeof input.proof === "object" ? input.proof : null;
  const now = Number.isFinite(Number(input?.now)) ? Number(input.now) : Date.now();
  const checkedAt = Date.parse(String(input?.checkedAt ?? ""));
  const proofCheckedAt = Date.parse(String(proof?.checked_at ?? ""));
  const amount = Number(input?.amount);
  if (status !== "verified_task_escrow" || !proof) return false;
  if (!/^0x[a-f0-9]{64}$/.test(taskId) || !/^0x[a-f0-9]{64}$/.test(txHash)) return false;
  if (paymentTxHash !== txHash || String(proof.task_id ?? "").toLowerCase() !== taskId || String(proof.tx_hash ?? "").toLowerCase() !== txHash) return false;
  if (proof.verified !== true || Number(proof.chain_id) !== 4217) return false;
  if (String(proof.network ?? "").toLowerCase() !== "tempo" || String(proof.asset ?? "").toUpperCase() !== "OUSD") return false;
  if (!Number.isFinite(amount) || amount <= 0) return false;
  const expectedAtomic = String(Math.round(amount * 1_000_000));
  if (String(proof.reward_atomic ?? "") !== expectedAtomic) return false;
  if (Number(proof.confirmations) < 12 || Number(proof.required_confirmations) < 12) return false;
  const fresh = (value) => Number.isFinite(value) && value <= now + 30_000 && value >= now - 30 * 60 * 1000;
  return fresh(checkedAt) && fresh(proofCheckedAt);
}
