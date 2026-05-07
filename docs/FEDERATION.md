# Velar — Federation Guide

Velar supports a **multi-instance deployment model**: one node acts as the master (full UI, admin, SMTP) and any number of remote nodes run as slaves (API-only, token-secured, no UI). The master gives you a single pane of glass over the entire infrastructure.

---

## Concepts

| Role | Description |
|---|---|
| **Master** | Runs the full Velar stack (UI + API + AdGuard). Holds credentials, sends all emails. The browser always talks only to the master. |
| **Slave** | Runs the Velar API in stripped mode (`VELAR_MODE=slave`). No web UI, no JWT, no SMTP. Secured by a single MasterToken. Can be on any reachable host. |

The master **proxies all API calls** to slaves server-side — the browser never sees a slave URL or token.

---

## Setting up a slave

### 1. Deploy the slave

On the slave server, clone Velar and create a `.env`:

```bash
git clone https://github.com/AlexArtaud-Dev/Velar.git
cd Velar
cp .env.slave.example .env
```

Minimum `.env` for a slave:

```env
VELAR_MODE=slave

# Unique secret for this slave's key encryption — never share with master
APP_SECRET=<openssl rand -hex 32>

# This slave's public IP or DDNS hostname (used in client .conf files)
WG_HOST=<slave-public-ip-or-domain>

# Master's public URL — used to build download/portal links in emails
APP_URL=https://master.example.com

APP_PORT=8080
DB_PATH=./data/velar.db
WG_CONFIG_DIR=/etc/wireguard
```

> `SMTP_*` and `ADGUARD_*` are **not needed** on a slave. The master handles all email delivery. AdGuard is not initialised in slave mode.

Start the slave API:

```bash
docker compose -f docker-compose.slave.yml up -d
```

### 2. Retrieve the MasterToken

The token is printed **once** on first boot:

```bash
docker compose -f docker-compose.slave.yml logs api | grep -A3 "SLAVE TOKEN"
```

Copy the `vs_...` string. It is stored as a SHA-256 hash in the slave DB — the raw value is never shown again.

> **Lost the token?** Set `SLAVE_TOKEN_RESET=true` in the slave `.env`, restart, copy the new token, then set it back to `false`.

### 3. Register the slave on the master

1. Open the master UI → **Instances** (sidebar)
2. Click **Register instance**
3. Enter:
   - **Name** — a friendly label (e.g. `Raspberry Pi`, `VPS-FR`)
   - **URL** — the slave's reachable address from the master (e.g. `http://192.168.1.12:8080` or `https://slave.example.com`)
   - **Token** — the `vs_...` value from step 2
4. Click **Register** — the master pings the slave's `/health` endpoint to confirm reachability

Once registered, the slave appears in **Interfaces**, **Clients**, and **Dashboard**.

---

## What works on slaves

Everything you can do with local clients works identically on slaves:

| Feature | Notes |
|---|---|
| Create / edit / delete clients | Proxied through master |
| Enable / disable | Proxied; lifecycle email sent by master |
| Bulk enable / disable / delete | Proxied |
| View config / QR code | Fetched from slave, displayed on master |
| Download link | Points to `master/dl/s/:instanceId/:token` |
| Send config by email | Master fetches config from slave, sends via its own SMTP |
| Client portal | `master/portal/s/:instanceId/:token` — master proxies data |
| Bandwidth limits | Applied directly on slave |
| Data quotas | Applied directly on slave |
| Interface UP / DOWN | Proxied |
| Live RX/TX per client | Polled from slave every 5 s |

---

## Dashboard federation

The dashboard aggregates data from all instances automatically:

- **Interfaces card** — local interfaces (via WebSocket) + slave interfaces (via `GET /api/v1/interfaces/overview` + `GET /api/v1/stats`), each in their own labelled section
- **Clients stat card** — connected + total across all instances
- **Downloaded / Uploaded** — 24 h and 7 d traffic summed across all instances
- **Live bandwidth chart** — local WebSocket + slave stats polled every 5 s, combined into a single curve
- **Connected peers card** — local peers + slave peers grouped by instance name
- **Recent connections** — events from all instances merged by timestamp, with an origin badge

---

## Email routing

Slaves have no SMTP. The master intercepts all email triggers:

| Event | What the master does |
|---|---|
| Client created | Creates a one-time download token on slave, builds `master/dl/s/…` URL, sends welcome email |
| Client updated | Sends update notification |
| Client deleted | Sends deletion notification |
| Enable / Disable | Sends status change notification |
| Send config | Fetches `.conf` from slave, generates download token, emails with `master/dl/s/…` link |

Portal links always use `master/portal/s/:instanceId/:viewToken`. The master proxies the client data from the slave transparently.

---

## Security model

- The slave token is stored as a **SHA-256 hash** in the slave DB. The raw `vs_...` value is printed once at boot and never persisted in plain text.
- The master stores the raw token encrypted in its own DB and uses it only for server-side requests — it is never sent to the browser.
- All slave API calls go through the master's `/api/v1/instances/:id/proxy` endpoint, which requires JWT authentication from the admin.
- The slave's internal URL and token are **never exposed to the browser**.

---

## Audit Log

The master's Audit Log tracks **both local and remote mutations** in one unified timeline.

When any mutating operation (create, update, delete, enable, disable, up, down…) is executed on a slave through the proxy, the master automatically writes an audit entry with an inferred action name:

| Operation | Audit action |
|---|---|
| Interface brought up on slave | `slave.interface.up` |
| Client disabled on slave | `slave.client.disable` |
| Client deleted on slave | `slave.client.delete` |
| Client created on slave | `slave.client.create` |

The **Slave** category pill in the Audit Log page filters to these entries. Detail includes the slave name, HTTP method, and path for full traceability.

> Slave operations are logged on the **master** only. Slaves do not expose an audit log endpoint.

---

## AdGuard Home Federation

Slaves can optionally expose an AdGuard Home instance and have it managed from the master UI.

### Per-slave toggle

In the master UI → **Instances** → select a slave → enable **AdGuard** toggle. This sets `adguard_enabled = true` on the instance record. Once enabled, the slave appears in the **AdGuard** page instance selector alongside the master.

All AdGuard API calls to a slave are proxied through the master's `/api/v1/instances/:id/adguard/proxy` endpoint using the same slave token as all other federated calls.

### Automatic sync

Enable **Auto-sync** on an instance (`adguard_sync_enabled = true`) to have the master periodically push its own AdGuard configuration to that slave. The sync job runs **every 5 minutes** and copies:

| What is synced | Notes |
|---|---|
| Blocklist filters | Full list with enabled/disabled state |
| Custom rules | User-defined DNS block/allow rules |
| DNS rewrites | All `domain → answer` mappings |
| Safe Browsing | Enabled/disabled |
| Parental Control | Enabled/disabled |
| Safe Search | Master's per-engine settings |
| Blocked services | Master's service block list |
| Filtering enabled | Master's global filtering toggle |

The sync is **one-way**: master → slave. Manual changes made directly on the slave's AdGuard Home UI may be overwritten on the next sync cycle.

### Manual sync / pull

- **Sync now** — pushes the master's current configuration to the slave immediately (same payload as the auto-sync job)
- **Pull from AdGuard** — re-fetches the live AdGuard state for the currently selected source (master or slave) and invalidates all cached query data in the UI. Use this after making changes directly in the AdGuard Home interface to bring Velar in sync with reality

### Services tab

The **Services** tab in the AdGuard page shows every service AdGuard Home knows about, grouped into categories (Social Networks, Streaming, Gaming, etc.). Services currently blocked by AdGuard are highlighted. You can:

- Toggle individual services
- **Block all** / **Unblock all** per category or globally
- Search by service name — matching categories expand automatically

---

## Limitations

| Limitation | Details |
|---|---|
| No slave SMTP | Slaves cannot send emails on their own. All notifications are routed through the master. If the master has no SMTP configured, email features are silently disabled for slaves too. |
| No slave WebSocket | The master polls `/api/v1/stats` on slaves every 5 s instead. Latency is slightly higher than the local 5 s WebSocket push. |
| Jobs run on every instance | Background jobs (quota enforcement, expiry checks, DDNS refresh, bandwidth snapshots) run independently on each slave. Expiry/quota emails from jobs are silently skipped on slaves since SMTP is not configured. |
| AdGuard availability | AdGuard Home is optional per slave — enable it in the Instances page. The slave must be running AdGuard Home and have it reachable from the master. |
| Slave traffic history | The dashboard traffic history chart shows local snapshots only. Slave 24 h / 7 d totals are included in the stat cards but not overlaid on the historical chart. |
