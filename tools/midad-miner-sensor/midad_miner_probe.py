#!/usr/bin/env python3
"""
MIDAD Local Miner Sensor — zero-dependency collector.

Reads a Bitmain/CGMiner-compatible TCP API on port 4028, normalizes safe
telemetry, and sends signed batches to MIDAD Miner Telemetry Ingest.

No restart/reboot/control commands are issued. This collector is read-only.
"""

from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import os
import socket
import ssl
import sys
import time
import urllib.request
from datetime import datetime, timezone
from typing import Any

DEFAULT_TIMEOUT = 4.0


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def tcp_api(host: str, port: int = 4028, timeout: float = DEFAULT_TIMEOUT) -> dict[str, Any]:
    """Read-only cgminer report commands."""
    payload = json.dumps({"command": "summary+devs+stats+pools"}).encode()
    with socket.create_connection((host, port), timeout=timeout) as sock:
        sock.settimeout(timeout)
        sock.sendall(payload)
        chunks: list[bytes] = []
        # cgminer sends a single JSON object, but tolerate chunking.
        while True:
            try:
                chunk = sock.recv(65535)
            except socket.timeout:
                break
            if not chunk:
                break
            chunks.append(chunk)
            if len(chunk) < 65535:
                break
    raw = b"".join(chunks).decode("utf-8", errors="replace")
    if not raw:
        raise RuntimeError("empty cgminer response")
    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        # A few firmware versions concatenate status envelopes. Try to recover
        # the first JSON object without pretending the rest is valid.
        start = raw.find("{")
        end = raw.rfind("}")
        if start >= 0 and end > start:
            return json.loads(raw[start:end + 1])
        raise RuntimeError(f"invalid cgminer JSON: {exc}") from exc


def as_num(v: Any) -> float | None:
    try:
        x = float(v)
        return x if x == x and abs(x) != float("inf") else None
    except (TypeError, ValueError):
        return None


def deep_values(obj: Any, names: set[str]) -> list[float]:
    out: list[float] = []
    if isinstance(obj, dict):
        for k, v in obj.items():
            if str(k).strip().lower() in names:
                n = as_num(v)
                if n is not None:
                    out.append(n)
            out.extend(deep_values(v, names))
    elif isinstance(obj, list):
        for x in obj:
            out.extend(deep_values(x, names))
    return out


def first_number(obj: Any, names: set[str]) -> float | None:
    vals = deep_values(obj, names)
    return vals[0] if vals else None


def all_strings(obj: Any, names: set[str]) -> list[str]:
    out: list[str] = []
    if isinstance(obj, dict):
        for k, v in obj.items():
            if str(k).strip().lower() in names and isinstance(v, (str, int, float)):
                out.append(str(v))
            out.extend(all_strings(v, names))
    elif isinstance(obj, list):
        for x in obj:
            out.extend(all_strings(x, names))
    return out


def hash_to_ths(summary: Any) -> float | None:
    # Prefer averages when available.
    for key in ("ghs av", "ghs 5s", "mhs av", "mhs 5s"):
        x = first_number(summary, {key})
        if x is None:
            continue
        if key.startswith("ghs"):
            return x / 1000.0
        return x / 1_000_000.0
    return None


def normalize(raw: dict[str, Any], target: dict[str, Any]) -> dict[str, Any]:
    temps = deep_values(raw, {"temperature", "temp", "temp2", "temp3", "temp4"})
    fans = deep_values(raw, {"fan speed", "fan speed in", "fan", "fan1", "fan2", "fan3", "fan4"})
    hwerr = deep_values(raw, {"hardware errors", "hw errors", "hw"})
    chains = deep_values(raw, {"chain acn", "chain count", "chain_num", "chain_asic_num"})
    power = first_number(raw, {"power", "power watts", "power_w", "watts"})
    uptime = first_number(raw, {"elapsed", "uptime", "runtime"})
    local_hash = hash_to_ths(raw.get("SUMMARY", raw.get("summary", raw)))

    chain_count = None
    if chains:
        plausible = [int(x) for x in chains if 0 < x < 30]
        chain_count = max(plausible) if plausible else None

    stratum = None
    pool_text = " ".join(all_strings(raw.get("POOLS", raw.get("pools", raw)), {"stratum active", "has stratum"})).lower()
    if "true" in pool_text:
        stratum = True
    elif "false" in pool_text:
        stratum = False

    model = str(target.get("model") or "").strip() or None
    firmware = str(target.get("firmware") or "").strip() or None

    faults: list[str] = []
    for s in all_strings(raw, {"status", "msg", "message", "chain_asic_status"}):
        low = s.lower()
        if any(token in low for token in ("error", "fail", "fault", "x", "missing")):
            faults.append(s[:180])
    faults = list(dict.fromkeys(faults))[:20]

    return {
        "worker_id": int(target["worker_id"]),
        "node_id": str(target.get("node_id") or target.get("worker_id")),
        "endpoint": f"{target['host']}:{int(target.get('port', 4028))}",
        "observed_at": now_iso(),
        "local_hashrate_ths": local_hash,
        "temp_max_c": max(temps) if temps else None,
        "temp_avg_c": (sum(temps) / len(temps)) if temps else None,
        "fan_min_pct": min(fans) if fans else None,
        "fan_avg_pct": (sum(fans) / len(fans)) if fans else None,
        "power_watts": power,
        "uptime_seconds": int(uptime) if uptime is not None else None,
        "asic_error_count": sum(hwerr) if hwerr else 0,
        "chain_count": chain_count,
        "chain_expected": target.get("chain_expected"),
        "stratum_ok": stratum,
        "pool_latency_ms": first_number(raw, {"latency", "latency_ms"}),
        "firmware": firmware,
        "model": model,
        "fault_codes": faults,
        "signals": {
            "temperature_seen": bool(temps),
            "fan_seen": bool(fans),
            "power_seen": power is not None,
            "local_hashrate_seen": local_hash is not None,
            "asic_error_seen": bool(hwerr),
            "chain_count_seen": chain_count is not None,
            "stratum_state_seen": stratum is not None,
        },
        "raw": raw,
    }


def sign(secret: str, timestamp: str, body: bytes) -> str:
    return hmac.new(secret.encode(), (timestamp + ".").encode() + body, hashlib.sha256).hexdigest()


def post_batch(url: str, secret: str, node_id: str, body_obj: dict[str, Any]) -> dict[str, Any]:
    body = json.dumps(body_obj, separators=(",", ":"), ensure_ascii=False).encode()
    ts = str(int(time.time()))
    req = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={
            "content-type": "application/json",
            "x-midad-node": node_id,
            "x-midad-timestamp": ts,
            "x-midad-signature": sign(secret, ts, body),
        },
    )
    ctx = ssl.create_default_context()
    with urllib.request.urlopen(req, timeout=15, context=ctx) as res:
        return json.loads(res.read().decode("utf-8"))


def load_config(path: str) -> dict[str, Any]:
    with open(path, "r", encoding="utf-8") as fh:
        cfg = json.load(fh)
    if not isinstance(cfg.get("targets"), list) or not cfg["targets"]:
        raise ValueError("config.targets must contain at least one miner")
    if not cfg.get("account_id"):
        raise ValueError("config.account_id is required")
    return cfg


def collect_once(cfg: dict[str, Any], ingest_url: str, secret: str, timeout: float) -> int:
    samples = []
    errors = []
    for target in cfg["targets"]:
        try:
            raw = tcp_api(str(target["host"]), int(target.get("port", 4028)), timeout)
            samples.append(normalize(raw, target))
        except Exception as exc:
            errors.append({"worker_id": target.get("worker_id"), "host": target.get("host"), "error": str(exc)})
    if samples:
        result = post_batch(
            ingest_url,
            secret,
            str(cfg.get("node_id") or os.uname().nodename),
            {"account_id": cfg["account_id"], "node_id": str(cfg.get("node_id") or os.uname().nodename), "samples": samples},
        )
        print(json.dumps({"accepted": len(samples), "errors": errors, "ingest": result}, ensure_ascii=False))
        return 0 if not errors else 2
    print(json.dumps({"accepted": 0, "errors": errors}, ensure_ascii=False))
    return 1


def main() -> int:
    ap = argparse.ArgumentParser(description="MIDAD read-only local miner sensor collector")
    ap.add_argument("--config", default=os.environ.get("MIDAD_MINER_CONFIG", "miners.json"))
    ap.add_argument("--url", default=os.environ.get("MIDAD_TELEMETRY_URL", "https://froegigfmpmvtecztfb.supabase.co/functions/v1/midad_miner_telemetry_ingest"))
    ap.add_argument("--key", default=os.environ.get("MIDAD_TELEMETRY_KEY"))
    ap.add_argument("--interval", type=int, default=60)
    ap.add_argument("--once", action="store_true")
    ap.add_argument("--timeout", type=float, default=DEFAULT_TIMEOUT)
    args = ap.parse_args()

    if not args.key:
        print("MIDAD_TELEMETRY_KEY is required", file=sys.stderr)
        return 2
    cfg = load_config(args.config)
    if args.once:
        return collect_once(cfg, args.url, args.key, args.timeout)
    while True:
        try:
            collect_once(cfg, args.url, args.key, args.timeout)
        except Exception as exc:
            print(f"collector error: {exc}", file=sys.stderr)
        time.sleep(max(15, args.interval))


if __name__ == "__main__":
    raise SystemExit(main())
