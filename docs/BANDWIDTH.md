# Velar — Bandwidth Limiting

Velar enforces per-client bandwidth caps using **Linux `tc` (traffic control)**. Limits are applied at the kernel level — no userspace proxying, no overhead.

---

## How it works

Each client has two independent limit fields:

| Field | Direction | Mechanism |
|---|---|---|
| **Download limit** (`↓`) | Server → client | HTB qdisc class on egress |
| **Upload limit** (`↑`) | Client → server | Ingress qdisc + `u32` police action |

A value of `0` means unlimited for that direction. You can cap one direction while leaving the other unlimited.

### Egress (download: server → client)

Traffic leaving the WireGuard interface toward the client is shaped using an **HTB (Hierarchical Token Bucket)** qdisc:

```
root qdisc (HTB, default class 9999 = unlimited)
  └── class 1:<handle>  rate=Xmbit  burst=Xk   ← per-client class
        └── u32 filter: dst ip == client_ip/32  ← matches traffic to this client
```

Excess packets are delayed (shaped), not dropped — clients see the capped throughput smoothly.

### Ingress (upload: client → server)

Traffic arriving from the client is policed using an **ingress qdisc** + `u32` filter with a `police` action:

```
ingress qdisc (ffff:)
  └── u32 filter: src ip == client_ip/32
        └── police rate=Xmbit burst=Xk drop  ← excess packets are dropped
```

Upload excess is dropped immediately (hard drop). This is the standard approach for ingress policing on Linux — shaping ingress is not supported by the kernel.

### Handle derivation

Each client's tc rules use a **deterministic handle** derived from the last two octets of their assigned VPN IP:

```
IP: 10.0.1.5  →  handle = 1*256 + 5 = 261
```

This means add/remove operations are idempotent and don't require querying existing tc state.

---

## Lifecycle

| Event | Bandwidth action |
|---|---|
| Client created with limit | `tc` rules applied immediately |
| Client edited (limit changed) | Old rules removed, new rules applied |
| Client disabled | Rules removed (peer is off the VPN) |
| Client re-enabled | Rules reapplied |
| Client deleted | Rules removed |
| Interface brought up | Rules reapplied for all clients with a limit (tc state is lost when the interface goes down) |
| Interface deleted | All tc qdiscs torn down (`tc qdisc del ... root` + ingress) |

---

## Setting limits from the UI

Each client card has a **gauge icon button** (⚡) that opens the bandwidth dialog. Set download and upload limits independently in Mbps. Apply saves and enforces immediately — no restart required.

The card shows the active limits as a badge:

```
⚡ ↓ 50 / ↑ 10 Mbps
```

---

## Requirements

- Linux kernel with `tc` (iproute2) — standard on Debian/Ubuntu
- `NET_ADMIN` capability on the `api` container (already set in `docker-compose.yml`)
- The container runs with `network_mode: host` so tc sees the real WireGuard interface

**Does not work with `WG_MOCK=true`** — all `tc` calls are skipped in mock mode.

---

## Caveats

- **Ingress policing drops packets** rather than queuing them. This means upload-limited clients may experience higher retransmit rates at the limit. For interactive traffic (SSH, browsing) this is generally fine. For bulk transfers it may show as slightly lower effective throughput than the configured cap.
- Handles are unique within a `/16` subnet (last two octets). If two clients in different interfaces have the same last two octets, they map to the same handle — but since they're on different network interfaces, tc rules are scoped per interface and don't conflict.
- tc rules are stored in kernel memory only. They survive process restarts but not interface recreation (handled by Velar's BringUp logic) or full server reboots where the interface is recreated.
