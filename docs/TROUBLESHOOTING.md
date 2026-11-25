# Velar — Troubleshooting

---

## Peers stay in `wg show` after deleting a client

**Fixed in v0.4.** In earlier versions, the conf sync ran before the DB delete, causing `wg syncconf` to re-add the peer. Update and use **Settings → Run sync** to clean up any stale peers from previous deployments.

---

## Delete returns 200 but nothing is actually deleted

**Fixed in v0.4.** Caused by a foreign key constraint: with `PRAGMA foreign_keys=ON`, deleting a client that has `DownloadToken` or `ConnectionEvent` records silently fails. The fix cascade-deletes child records before the client delete and properly checks the DB error.

If you see this on a pre-v0.4 install: go to **Settings → Run sync** — it won't fix the DB orphans but it will resync the WireGuard state. Then delete clients via the UI (now fixed).

---

## Interface is DOWN after server reboot

WireGuard interfaces are brought up by Velar at container start. Make sure:

1. Docker is set to start on boot: `systemctl enable docker`
2. Containers have `restart: unless-stopped` (already set in `docker-compose.yml`)
3. If interfaces are still down: go to the **Interfaces** page and click the power icon to bring them up, or use **Settings → Run sync** to reconcile state.

---

## Clients can connect but have no internet

- Check IP forwarding is active: `sysctl net.ipv4.ip_forward` (must be `1`)
- Check iptables NAT: `iptables -t nat -L POSTROUTING -nv`
- Make sure PostUp/PostDown rules reference the correct network interface

Velar auto-detects the default interface for NAT rules via `ip route show default`. If you have an unusual network setup (bonding, bridges), set PostUp/PostDown manually in the interface settings.

---

## Clients reach the LAN but not the internet — DNS_PROBE_FINISHED_BAD_CONFIG

**Symptom:** VPN clients can ping LAN hosts, but browsers show `DNS_PROBE_FINISHED_BAD_CONFIG`. On the host, `dig @10.0.0.1 google.com` returns `SERVFAIL` while `dig @1.1.1.1 google.com` works. AdGuard logs loop on:

```
dnsproxy: exchange failed upstream=https://dns10.quad9.net:443/dns-query ... no addresses
```

**Cause:** AdGuard Home ships with Quad9 as its upstream (`https://dns10.quad9.net/dns-query`) and bootstrap (`9.9.9.10`, `149.112.112.10`). Since 24/11/2026 Quad9 no longer answers queries from France, so every instance still on the defaults stops resolving at once.

**Fix:**
1. Go to **AdGuard → Upstream DNS** with the affected source selected (Master or a slave)
2. Click **Edit**, pick a preset (e.g. **Cloudflare**), click **Test** and check every server shows a green check
3. Click **Save**
4. Repeat for each slave, or let **auto-sync** push the master's upstream config to slaves
5. Verify: `dig @10.0.0.1 google.com +short`

**Rule:** bootstrap servers must be **IP addresses** of a provider reachable from your location. A hostname in the bootstrap list cannot be resolved and reproduces the `no addresses` error — Velar rejects it on save.

---

## Data quota not blocking traffic

- Verify nftables rules are installed: `docker exec velar-api nft list table ip velar_quota`
- If the table is empty, restart the container — `restoreQuotas()` runs on every start and re-installs rules from DB usage
- Check `NET_ADMIN` capability is present: `docker inspect velar-api | grep -i cap`
- Make sure `WG_MOCK` is not `true` in `.env` (nftables is skipped in mock mode)
- If nft is unavailable, enforcement falls back to DB-based polling — quota will still be enforced within 15 s

---

## Bandwidth limits not taking effect

- Verify `NET_ADMIN` capability is present: `docker inspect velar-api | grep -i cap`
- Check `tc` is available in the container: `docker exec velar-api tc qdisc show`
- Run **Settings → Run sync** to reapply all limits
- Make sure `WG_MOCK` is not set to `true` in `.env`

---

## `wg-quick: /etc/wireguard/wgX.conf does not exist`

The WireGuard config volume may have been recreated. Restart the API container — it regenerates all configs from the database on startup:

```bash
docker compose restart api
```

---

## Nothing works after an application upgrade

1. Run `docker compose restart api` to let AutoMigrate add any new columns
2. Go to **Settings → Run sync** to reconcile the WireGuard state with the new DB schema
3. If deletes are still broken, the old DownloadToken cascade issue may have left orphaned records — sync will not fix DB orphans but will resync WireGuard state

---

## Cannot scan QR code

Make sure you're using the **WireGuard mobile app** (not a generic QR scanner). Config QR codes encode WireGuard-specific syntax that only the WireGuard app can parse.

---

## WebSocket live stats not updating

- Verify the reverse proxy passes `Upgrade` and `Connection` headers (see [Reverse Proxy guide](./REVERSE-PROXY.md))
- If using Authelia, make sure `/ws/` is excluded from authentication checks
- Check browser console for WebSocket connection errors

---

## Forgot admin password

Reset the database and start fresh:

```bash
docker compose down
docker volume rm velar_sqlite_data
docker compose up -d
docker compose logs api | grep -i password
```

> ⚠️ This deletes **all** interfaces, clients, and configuration.

---

## SMTP / email not working

- Verify `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `ADMIN_EMAIL` are all set in `.env`
- Check **Settings → Email notifications** shows "Configured"
- If using Gmail: create an **App Password** (not your account password) and use `smtp.gmail.com:587`
- Test SMTP from the server: `curl smtp://smtp.yourhost.com:587 --ssl-reqd -u user:pass`

---

*For persistent issues, open a GitHub issue with your `docker compose logs api` output.*
