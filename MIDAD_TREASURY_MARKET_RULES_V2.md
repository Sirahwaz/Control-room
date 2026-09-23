# MIDAD — Treasury & Market Edge Rules v2

## 1. Core composition

MIDAD is not a wallet and is not an exchange. It is an intelligence + policy + orchestration layer.

**Operating chain**
SIGNAL → EVIDENCE → QUALIFY → VALUE → PAYMENT RAIL → TREASURY ROUTE → RISK POLICY → EXECUTION ADAPTER → FILL/SETTLEMENT → OUTCOME → LEARNING

The Control Room is the human-readable command surface. Secrets, signing, exchange credentials, and latency-sensitive execution remain behind provider adapters.

## 2. Treasury architecture

### Wallet records
MIDAD may store:
- public address
- chain/network
- asset
- role
- provider label
- ownership/verification status

MIDAD must never store seed phrases or private keys in the UI ledger.

### Roles
PERSONAL, RESERVE, MINING, SERVICES, INVEST, TRADE.

### Transfers
RECEIVE, DEPOSIT, WITHDRAW/SEND, INTERNAL ROUTE.

Every transfer has:
- request id
- source
- destination
- asset
- amount
- network
- fee estimate when available
- status
- evidence/reference
- approval record

No live withdrawal is allowed merely because a local record exists.

## 3. Provider adapters

Every exchange, custodian, wallet provider, chain RPC, and payment rail implements the same conceptual contract:

- discoverCapabilities
- getMarkets
- getTicker
- getOrderBook
- getTrades
- getBalances
- getOrders
- placeOrder
- cancelOrder
- replaceOrder
- getOrder
- getDepositAddress
- createDeposit/transfer where supported
- createWithdrawal where explicitly enabled
- health/time/synchronization

Provider-specific quirks stay inside the adapter.

A normalized internal schema is mandatory. Vendor-specific fields may be preserved under metadata.

## 4. Two-speed design

### Intelligence speed
Use streaming market data when available, plus periodic REST reconciliation.

### Execution speed
Use backend/server-side adapters, not the browser UI. Preload market metadata, tick size, minimum order size, balances, fee model, and risk limits.

An execution request must have a freshness deadline. Stale requests are rejected instead of sent blindly.

## 5. Market-event radar

MIDAD may detect and classify:
- fast rise
- fast fall
- unusual volume
- spread widening
- order-book imbalance
- liquidity collapse
- volatility expansion
- breakout/breakdown
- gap
- possible pump/dump pattern

Detection is informational and risk-aware. MIDAD must not coordinate market manipulation, spoofing, wash trading, or artificial pump/dump activity.

## 6. Risk engine

Every order candidate passes policy checks before provider execution:

1. symbol/market is allow-listed
2. account/venue is allow-listed
3. position limit
4. notional limit
5. daily loss limit
6. max slippage
7. maximum order age
8. price-band sanity check
9. balance availability
10. fee impact
11. stop/exit policy
12. kill-switch state
13. approval state

The risk engine returns ALLOW, ALLOW_WITH_WARNING, or BLOCK with machine-readable reasons.

## 7. Exit controls

Where the provider supports them, use server-side stop/trigger orders so exits do not rely solely on the browser being open.

The system must distinguish:
- stop-loss
- take-profit
- trailing stop
- emergency market exit
- cancel-all
- kill switch

Provider semantics are adapter-specific and must be verified before live use.

## 8. API key policy

Recommended permissions:
- public market data: enabled
- account read: enabled only where needed
- spot trade: disabled until explicitly armed
- withdrawals: disabled by default
- futures/margin: separate credentials and separate risk envelope

Withdrawal-capable credentials should be isolated from trading credentials. Where supported, use IP restrictions/address allow-lists.

## 9. Reality rules

Never label these as cash or verified balance:
- pipeline
- local wallet estimate
- prepared transfer
- submitted order
- predicted P&L

Verified states require evidence from the provider, blockchain, payment rail, or reconciled transaction record.

## 10. Human control gates

Human approval is mandatory for:
- enabling live trading
- increasing risk limits
- adding a new withdrawal destination
- enabling withdrawal permissions
- moving reserve capital
- changing leverage/margin policy
- overriding a risk BLOCK

Safe automation may continue for discovery, monitoring, normalization, scoring, paper trading, reconciliation, and alerts.

## 11. Self-funding loop

REVENUE → SETTLEMENT → TREASURY → RESERVE → INFRASTRUCTURE → OPPORTUNITY INTELLIGENCE → REVENUE

Capital allocation must remain traceable. Every reinvestment is a ledger event with an explicit purpose and amount.

## 12. Non-negotiable portability rule

No MIDAD core feature may depend directly on one exchange, one wallet vendor, Telegram, n8n, or one AI provider.

Adapters may change. Core schemas and policy contracts remain stable.

## 13. /Loop+ emergency runtime doctrine

`/Loop+` is an execution-mode directive for MIDAD engineering. It means:

**DISCOVER → VERIFY → ATTACK-TEST → BUILD → MEASURE → MONETIZE → SECURE → LEARN**

The system should expand the solution space, search for hidden dependencies and edge cases, test from an adversarial perspective, and convert useful findings into deployable modules.

This does not authorize unauthorized access, credential theft, evasion of controls, market manipulation, fraud, or destructive activity. The objective is to break MIDAD's own assumptions and close its own gaps before an adversary or failure does.

## 14. Agent mesh rule

MIDAD prefers a mesh of bounded agents over one unrestricted agent.

Each agent must have:
- agent_id
- capabilities
- allowed_actions
- risk_class
- input_contract
- output_contract
- evidence_requirement
- budget/time limits
- approval requirement
- audit trail
- rollback or fail-safe behavior

High-impact actions must not be delegated merely because an agent can technically perform them.

## 15. Payment → settlement rule

A verified payment may enter the treasury pipeline automatically.

Required chain:

**PAID + MATCHED EVIDENCE → SETTLEMENT INTENT → WALLET RESOLUTION → TREASURY RECONCILIATION → APPROVAL GATE (when movement is required) → PROVIDER ADAPTER**

The Settlement Router records and routes state; it does not acquire unrestricted withdrawal authority.

Current backend primitive:
- `midad_payment_verifier`
- `midad_settlement_router`
- `midad_wallets`
- `midad_payment_intents`
- `midad_payment_events`
- `midad_approvals`

## 16. Autonomy rule

The Autonomy Loop may:
- collect market/OSINT evidence
- monitor mining telemetry
- measure outcomes
- expire stale operational state
- prepare verified settlement intents

The Autonomy Loop may not silently:
- withdraw funds
- enable withdrawal permissions
- bypass an approval
- increase trading risk
- convert an unverified signal into verified cash
- claim revenue that has not been independently evidenced

## 17. Security doctrine

Treat security as a continuous pipeline, not a final review:

**Functional → Authentication → Authorization → Business Logic → Race/Replay → Data-flow → Failure/Recovery → Provenance → Reconciliation**

Internal financial tables use explicit deny-by-default browser policies when direct client access is not required. Backend secret/service credentials remain backend-only.

## 18. Emergency financial objective

The practical optimization target is not nominal “activity”. It is:

**time-to-verified-value**

Priority should be given to paths that can move from:
opportunity → qualified demand → offer → payment intent → verified payment → settlement state

with minimal manual work and without fabricating financial state.

Pipeline is not cash. Preparation is not execution. Execution is not settlement. Settlement is not verified profit until evidence exists.
