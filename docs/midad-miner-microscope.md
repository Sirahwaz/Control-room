# MIDAD Miner Microscope

## Mission
A read-first autonomous mining watchdog for the ViaBTC BTC Monitor. It inspects each worker independently, compares current telemetry with prior microscope state, diagnoses likely causes, performs safe re-probes, records incidents, and sends deduplicated Telegram alerts.

## Agent pipeline
1. Telemetry Scout — refreshes the ViaBTC monitor and snapshots worker telemetry.
2. Drop Detector — detects state transitions, hashrate step-downs, 10m/1h/24h divergence, reject anomalies, and stale telemetry with baseline awareness.
3. Root Cause Agent — emits evidence-backed candidate causes; it does not claim hardware/network root cause without supporting telemetry.
4. Recovery Agent — performs non-destructive re-probes and a second worker-detail read. No power cycle, restart, withdrawal, or live trade actuator exists in this agent.
5. Alert Agent — sends only new/escalated/recovery-worthy events to authorized Telegram recipients and deduplicates repeated noise.

## Safety boundary
The current repair ladder is observational/re-probing only. A future hardware actuator must be separately authenticated, explicitly scoped, reversible where possible, and audited before it can restart/power-cycle a miner.

## Persistence
- public.midad_miner_worker_states: previous worker state and alert streaks.
- public.midad_miner_incidents: incident lifecycle, evidence, diagnosis, recovery status, and alert timestamps.
- public.midad_miner_agent_runs: run-level audit trail.
All three tables have RLS enabled and are not granted to anon/authenticated/public.

## Automation
Supabase pg_cron invokes midad_miner_microscope every 5 minutes using a Vault-held internal key. The current job is midad-miner-microscope-5m.

## False-positive guard
Last Active is never treated as a standalone failure signal. Historical inactive/invalid workers are not incidents unless they were previously observed active or are currently active with no meaningful hashrate.

## Trade architecture
Trade remains a separate specialist lane:
ViaBTC/Mining Telemetry -> Miner Microscope
Market/Finance Signals -> Trade Agent / midad_noncopy_trading_engine
Both publish/consume through shared MIDAD events and Decision Ledger / Control Room surfaces. This keeps mining remediation isolated from financial execution and preserves independent kill switches.

## Next expansion
Add persistent Machine Profiles, group/rack topology, local miner telemetry (temperature/fan/power), optional AI root-cause escalation for ambiguous critical cases, and authenticated hardware actuators only after evidence and approval gates.
