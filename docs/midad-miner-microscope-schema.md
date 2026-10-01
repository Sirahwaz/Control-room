# Miner Microscope schema

The live database contains three RLS-protected tables:

- `midad_miner_worker_states`: account/worker key, last status, 10m/1h/24h hashrate, reject rate, last active, consecutive counters, metadata.
- `midad_miner_incidents`: incident fingerprint, worker, severity, lifecycle state, health/anomaly values, evidence, diagnosis, recommended action, safe recovery status, timestamps.
- `midad_miner_agent_runs`: one audit row per microscope cycle with worker count, incident counts, alert counts, and summary.

The internal authentication key is stored in Supabase Vault as `midad_miner_microscope_key`. It is never committed to the repository.

Automation is scheduled by Supabase `pg_cron` job `midad-miner-microscope-5m` using `pg_net` to call the Edge Function.

Trade is intentionally not coupled to the microscope actuator path.