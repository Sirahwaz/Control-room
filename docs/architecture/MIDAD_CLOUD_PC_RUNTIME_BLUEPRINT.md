# MIDAD Cloud PC — Online Runtime Blueprint

**Date:** 2026-11-20  
**Status:** Architecture baseline; persistent compute host is currently **BLOCKED / NOT VERIFIED**.  
**Parent architecture:** [MIDAD Distributed Runtime Fabric](MIDAD_DISTRIBUTED_RUNTIME_FABRIC.md)  
**Operating rule:** Audit → Preserve → Repair → Integrate → Upgrade. Zero-budget first; no paid capacity without explicit cost disclosure and approval.

## 1. Outcome

Provide one owner-controlled Linux Cloud PC that is reachable from an Android phone or any modern browser, with:

- a persistent desktop session and home directory;
- browser, terminal, file manager and development tools;
- remote access over an authenticated encrypted path;
- start / stop / suspend / resume controls;
- durable state across browser disconnects and host restarts;
- optional additional compute nodes without moving the desktop session or its home directory;
- resource, cost, health and audit reporting in MIDAD Control Room.

A Cloud PC is not a GitHub Actions job, a browser tab, a PXE boot menu, or a Cloudflare Worker. It requires a real persistent compute host and durable storage.

## 2. Evidence-backed resource inventory (2026-11-20)

| Resource | Observed state | Cloud PC role |
|---|---|---|
| `Sirahwaz/Control-room` | Repository accessible; DRF/MNCF/Continuity source and tests exist | Source of truth for implementation |
| MIDAD Distributed Runtime Fabric | Architecture and planner source exist; whole-fabric live linkage is not verified | Control and scheduling contracts |
| MNCF Linux worker | Bounded Node 24 worker source and contract tests exist | Reusable bounded task executor; not a desktop daemon |
| Continuity Ledger / Cloudflare Durable Object | Source, SQLite state model and deployment workflow exist; no live deployment or node handshake is verified | Intended node identity, leases, checkpoints and wake coordination |
| GitHub Actions Linux | Available as ephemeral public-repository CI/build capacity | Builds, tests and bounded one-shot jobs only |
| Android Browser Mesh | App and participant contracts exist; live persistent Fabric pairing remains pending | Mobile console, user interaction and optional edge participant |
| Remote Desktop Commander | No online persistent MIDAD desktop host was available during this audit | Host inventory / local execution unavailable |
| Railway | No project or deployed service was visible in the connected account inventory | Not an available compute host at this time |
| Supabase `midad-ai` | Project currently reports `ACTIVE_HEALTHY` on the Free organization | Existing metadata/control-plane integration only; not a VM or desktop host |
| iVentoy | PXE/HTTP network-boot software | Optional physical-host OS provisioning; not a Cloud PC runtime |

**Conclusion:** There is no verified always-on host with capacity to run a desktop session. Do not report a Cloud PC as deployed or online. GitHub Actions and Cloudflare coordination do not create persistent CPU/RAM or a desktop.

## 3. Architecture decision

Keep the existing MIDAD planes and add a distinct **Desktop Session Adapter**. Do not create a second global task queue, node registry, orchestrator or database.

```text
MIDAD Control Room / Telegram / Android
                  |
        Existing DRF policy layer
                  |
   Existing Continuity node identity + leases
                  |
       Desktop Session Adapter (new)
                  |
       Enrolled persistent Linux host
          |                    |
   Desktop runtime        Persistent home volume
   XFCE + browser         /home/midad
   terminal + tools       snapshots / quota
          |
 Authenticated remote desktop gateway
          |
 Android phone / browser client
```

### Plane ownership

- **Control Room:** user intent, visibility, approvals, kill switch and audit.
- **DRF / Continuity:** enrolled node identity, heartbeat, capabilities, cost ceilings, task leases and evidence. Continue using existing contracts.
- **Desktop Session Adapter:** lifecycle of a long-running interactive desktop. A desktop session is not a generic `SINGLE` task and must not be mislabeled as `BROWSER_SESSION`.
- **Host runtime:** Linux user session, desktop processes, persistent volume and resource limits.
- **Remote access gateway:** authenticated encrypted access. The host initiates outbound control connections where possible.
- **Supabase:** existing application metadata and business state only; no VM disk images or desktop session filesystem.

### Desktop session contract (design only)

A session record must contain:

- `session_id`, trusted `owner_id`, `node_id`, `runtime_profile`, `image_digest`;
- `storage_volume_ref`, storage quota and backup/snapshot policy;
- CPU, RAM, disk and network ceilings;
- access policy, session expiry, idle timeout and cost ceiling;
- lifecycle state, heartbeat, last activity and evidence references;
- idempotency key and explicit destroy/retention policy.

Lifecycle:

```text
REQUESTED → POLICY_APPROVED → PROVISIONING → READY → ACTIVE
                                      ACTIVE → SUSPENDED → READY
                                      READY / ACTIVE → DEGRADED
                                      any state → QUARANTINED
                                      STOPPED → DESTROYED (explicit policy)
```

Session lifecycle and task execution must remain separate. A worker crash must not delete a user's home directory or silently recreate a desktop session.

## 4. Lowest-cost runtime profile

### First target: one Linux host, one user desktop

Use an owner-controlled Linux host or a genuinely free persistent host that passes the qualification gate. The first runtime should be deliberately small:

- Debian or Ubuntu LTS;
- unprivileged service identity;
- lightweight XFCE desktop;
- browser-based remote desktop gateway (noVNC/KasmVNC-class adapter);
- persistent local home volume;
- outbound authenticated node connection to the existing Continuity service;
- encrypted remote access through WireGuard or a separately approved authenticated tunnel;
- resource quotas, bounded logs, health checks and a host-level kill switch.

Do not expose SSH, RDP, VNC, browser debugging, database or worker-control ports directly to the public Internet. Do not put host credentials, browser cookies or user secrets in images, task payloads, CI artifacts or logs.

### Host qualification gate

These are admission targets, not claims about currently available hardware:

| Resource | Minimum admission target | Preferred |
|---|---:|---:|
| CPU | 2 vCPU | 4 vCPU |
| RAM | 2 GiB for a minimal desktop | 4–8 GiB |
| Free SSD | 20 GiB | 40+ GiB |
| Network | Stable outbound HTTPS | Reliable broadband |
| Availability | Owner-controlled and restartable | Always-on |

A host below the minimum may be enrolled as an edge/CPU worker, but must not be labelled a full Cloud PC. The previously documented 1-vCPU / 512-MiB / 5-GB candidate is not suitable for a full desktop or Chromium session.

### Remote access choice

- Prefer WireGuard when the host has a reachable endpoint and the operator can manage peer keys.
- If the host is behind NAT, evaluate an authenticated outbound tunnel as a separate adapter.
- Keep the desktop gateway behind authentication and TLS; never publish a raw VNC/RDP port.
- Mobile browser access is the client experience; it does not make the Android phone the server.

## 5. Role of iVentoy

iVentoy is an optional **provisioning tool** for physical machines on a controlled LAN:

- PXE/HTTPBoot can install or boot supported OS images on compatible clients.
- It does not provide a VM, persistent cloud storage, remote desktop, public Internet reachability or compute scheduling.
- Do not expose DHCP/PXE/TFTP services to the public Internet.
- Use it only after identifying a physical host, LAN topology and boot compatibility. For a virtual VPS, use the provider's image/rescue mechanism instead.

Official references: [iVentoy overview](https://www.iventoy.com/en/index.html), [network/DHCP topology](https://www.iventoy.com/en/doc_ext_dhcp.html), [FAQ](https://www.iventoy.com/en/faq.html).

## 6. Provider boundaries and zero-budget policy

| Provider | Allowed role | Explicit non-role |
|---|---|---|
| Cloudflare Durable Objects / Queues | Coordination, leases, wake events and small metadata | Not a Linux VM, desktop host or general-purpose Chromium server |
| GitHub Actions | CI, build/test and bounded ephemeral tasks | Not an always-on node or persistent desktop |
| Android | Mobile console, local edge work and user-started participant | Not a guaranteed 24/7 server |
| Supabase | Existing application data and authorized control-plane integration | Not a VM or persistent desktop disk |
| Owner-operated Linux | Primary persistent desktop host when qualified | No silent sharing of third-party resources |
| iVentoy | Optional physical OS provisioning | Not compute capacity |

- Default task/session cost ceiling is USD 0.
- No paid VPS, Cloudflare upgrade, hosted desktop, bandwidth overage or metered browser provider may be activated automatically.
- Check quota and price before any provider activation; block rather than silently upgrade.
- Additional nodes require explicit owner consent, signed enrollment, revocation, capability attestation and resource quotas.
- Financial actions, publication, deletion, external sends, permission changes and credential rotation remain human-gated.

## 7. Implementation gates

### P0 — Audit and preserve (completed for this blueprint)

- Confirmed source architecture and existing adapters in `Sirahwaz/Control-room`.
- Confirmed there is no currently verified persistent desktop host.
- Identified existing open work that must be preserved: DRF task-envelope PR #296, Cloudflare-to-ephemeral-runner PR #238, Android participant PR #279.
- No production database, deployment, account, secret, firewall or billing change was made.

### P1 — Host admission (blocked)

1. Obtain an owner-controlled Linux host or reconnect an existing authorized host.
2. Inspect OS, architecture, CPU, RAM, free disk, virtualization support, network path and power/uptime.
3. Reject insufficient or untrusted capacity; do not install anything during inspection.
4. Record measured resources and the exact access/recovery method.

### P2 — Desktop image and session adapter

After P1 passes:

1. Add a versioned, reproducible desktop image with a pinned digest.
2. Add a session lifecycle adapter with idempotent start/stop/suspend/resume.
3. Keep persistent home data separate from the disposable image.
4. Add tests for owner isolation, session lifecycle, resource ceilings, idle timeout, crash recovery, volume retention and revocation.
5. Keep the existing task envelope, Continuity Ledger and MNCF worker boundaries intact.

### P3 — One-host pilot

1. Enroll one node with explicit owner consent.
2. Verify fresh heartbeat and resource report.
3. Start one non-sensitive desktop session.
4. Connect from Android over the authenticated gateway.
5. Verify persistence after browser disconnect, worker restart and host reboot.
6. Verify kill switch, revocation, logs, quota and cost remain within policy.

### P4 — Optional federation

Only after the one-host pilot passes, add other owner-operated computers as independent nodes. Keep the interactive desktop session pinned to one host; distribute only eligible stateless CPU tasks.

## 8. Acceptance criteria

The Cloud PC is **VERIFIED** only when:

- a real persistent host is enrolled and reports fresh authenticated heartbeats;
- a desktop session starts and is reachable from Android/browser through an authenticated encrypted path;
- user files persist across disconnect and host restart;
- node revocation and kill switch stop access safely;
- resource ceilings and zero-cost policy are enforced;
- a session can be stopped and resumed without losing its home volume;
- evidence and health are visible in MIDAD Control Room.

Until every applicable criterion passes, status remains **BLOCKED**, **PENDING** or **FAILED**—never “online Cloud PC”.
