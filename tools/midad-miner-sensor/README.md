# MIDAD Local Miner Sensor Layer

This is the second evidence plane for Miner Microscope.

## What it does

The telemetry collector reads Bitmain/CGMiner reporting commands on each miner and sends signed observations to:

`midad_miner_telemetry_ingest`

The telemetry-only path issues read commands such as `summary+devs+stats+pools`. It does not change pools, reboot devices, or perform financial actions.

**Important execution boundary:** this package also contains an optional repair-polling adapter. When `MIDAD_REPAIR_KEY` is configured, it can poll `midad_miner_repair_bridge`. Diagnostics remain read-only. A `restart` command is rejected unless the signed bridge response contains a per-action approval ID with status `approved`, the cloud-approval and local-policy markers are both true, and any supplied expiry is valid and still in the future. A second local opt-in, `MIDAD_ALLOW_RESTART=true`, is also required. Both gates default to disabled; never enable the local flag as a general convenience. A new restart action must be explicitly proposed and approved through the MIDAD approval workflow.

The Bitmain cgminer API supports report commands such as `summary`, `devs`, `stats`, and `pools`, with the API commonly exposed on TCP port 4028. citeturn412255search0turn412255search3

## Data it can observe

Depending on firmware/model, the collector opportunistically captures:
- local hashrate
- temperature
- fan speed
- power (when firmware exposes it)
- ASIC/hardware error counts
- chain count / expected chains
- stratum state / latency when exposed
- uptime
- firmware/model supplied in config
- raw diagnostic report for evidence

Missing fields stay null. Nothing is invented.

## Security

The ingest endpoint expects:
- `x-midad-timestamp`
- `x-midad-signature = HMAC-SHA256(key, timestamp + "." + raw_body)`
- `x-midad-node`

The HMAC key is stored server-side in Supabase Vault under `midad_miner_telemetry_key`. Never commit the real key to GitHub.

On the local node, set `MIDAD_TELEMETRY_KEY` in a protected environment file.

The optional repair bridge uses `MIDAD_REPAIR_KEY` in a protected environment file. Keep `MIDAD_ALLOW_RESTART` unset unless the operator has separately approved enabling this node's restart capability. The global local flag never substitutes for a per-action approval; malformed, missing, rejected, or expired approval evidence is acknowledged as `blocked` without issuing the miner command.

Approval checks are regression-tested with:

```bash
python -m unittest discover -s . -p 'test_*.py' -v
```

## First run

1. Copy `miners.example.json` to a private `miners.json`.
2. Replace the account UUID with the existing ViaBTC mining account UUID.
3. Set each miner's private LAN IP and worker ID.
4. Test one collection with:
   `python3 midad_miner_probe.py --config miners.json --once`
5. Then run as a system service at 60-second intervals.

## Important

The current ViaBTC pool-side microscope remains authoritative for pool telemetry. Local telemetry is an independent evidence plane used to strengthen root-cause diagnosis.

Future expansion:
- temperature/fan/power time-series
- per-chain degradation
- thermal throttle signatures
- PSU/power anomaly detection
- group/rack peer correlation
- repair actuator adapter behind approval gates
