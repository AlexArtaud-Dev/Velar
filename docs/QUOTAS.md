# Velar — Data Quotas

Velar enforces per-client data caps using **Linux nftables named quotas**. Enforcement happens at the kernel's netfilter layer — packets are dropped the instant the budget is exhausted, with zero overshoot regardless of transfer speed.

---

## How it works

Each client with a quota gets a dedicated **named quota object** inside an nftables table (`velar_quota`). Two forwarding rules share that single counter:

```
table ip velar_quota {
    quota q_10_0_0_2 { over 104857600 bytes }   ← named counter (e.g. 100 MB)

    chain forward {
        type filter hook forward priority filter; policy accept;
        ip saddr 10.0.0.2 quota name "q_10_0_0_2" drop   ← upload
        ip daddr 10.0.0.2 quota name "q_10_0_0_2" drop   ← download
    }
}
```

Both upload and download are counted together against the same budget. The moment the counter hits the limit, **the kernel starts dropping packets** — no polling interval, no overshoot.

---

## Quota periods

| Period | Reset behaviour |
|---|---|
| **Monthly** | Counter resets on the 1st of each month |
| **Weekly** | Counter resets every Monday at midnight |
| **Total** | Counter never resets — cumulative lifetime usage |

Manual resets are available at any time from the client card (⟳ button in the quota dialog).

---

## Enforcement lifecycle

| Event | nftables action |
|---|---|
| Quota set on a client | `nft add quota` + two forwarding rules created |
| Client enabled | Rules applied with remaining budget for the current period |
| Client disabled | Rules removed |
| Client deleted | Rules removed |
| Quota value updated | Rules reset with new budget (old rules deleted, new ones added) |
| Quota reset (manual) | Counter restored to the full quota value |
| Period rollover | Counter restored to the full quota value (detected within 15 s) |
| Server restart | `restoreQuotas()` re-installs rules with `remaining = quota − DB usage` |

---

## Warning emails

At **80%** usage Velar sends a single warning email per period to the admin and (if configured) the client's email address. The warning is not repeated within the same period even if the usage climbs further before the period ends.

---

## Suspension flow

When the quota is exceeded:

1. **nftables drops packets immediately** (kernel-level, no lag)
2. The background job (every 15 s) detects the exceeded state via `nft list quota`
3. The WireGuard peer is removed from the running interface
4. The client is marked `quota_suspended = true` + `enabled = false` in the DB
5. Alert emails are sent to admin and client

The suspended state is reflected immediately in the UI (red quota bar) — no page refresh needed.

---

## Re-enabling a suspended client

Two ways:

- **Quota reset** — click the ⟳ reset button. Resets the usage counter to zero, restores the full quota, and re-adds the peer to WireGuard.
- **Quota upgrade** — set a higher quota via the Edit dialog. Velar automatically re-enables the client with the remaining budget.

---

## Server restart continuity

nftables rules live in kernel memory and are lost on reboot. On each container start, `restoreQuotas()` reads the current period's usage from the database and re-creates rules with the **remaining** budget:

```
remaining = quota − SUM(peer_snapshots since period start)
```

This means a client who used 70 MB of a 100 MB quota before a reboot will have a 30 MB nftables rule after restart — not a fresh 100 MB.

---

## Requirements

- Linux kernel with nftables support (kernel ≥ 4.14, standard on Debian 10+)
- `nft` binary in the container (`nftables` package — included in Velar's Docker image)
- `NET_ADMIN` capability on the `api` container (already set in `docker-compose.yml`)
- `network_mode: host` so nftables sees the real WireGuard forwarded traffic

**Does not work with `WG_MOCK=true`** — all nftables calls are skipped in mock mode. Quota enforcement falls back to DB-based polling (≤ 15 s enforcement lag) when nftables is unavailable.

---

## Troubleshooting

**Quota bar shows over 100% but client is still connected**

The nftables rule may not be installed. Check:

```bash
docker exec velar-api nft list table ip velar_quota
```

If empty, trigger a manual sync via **Settings → Run sync** or restart the container — `restoreQuotas()` runs on every start.

**`nft: command not found` in container logs**

The `nftables` package is missing from the image. Rebuild with `make build`.

**Quota resets every server restart**

This should not happen — `restoreQuotas()` uses DB snapshots to restore remaining budget. If you see a fresh full quota after restart, check that snapshot writes are working: `docker compose logs api | grep snapshot`.
