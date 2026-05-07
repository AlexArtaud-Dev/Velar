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

## Limitations

| Limitation | Details |
|---|---|
| No slave SMTP | Slaves cannot send emails on their own. All notifications are routed through the master. If the master has no SMTP configured, email features are silently disabled for slaves too. |
| No slave WebSocket | The master polls `/api/v1/stats` on slaves every 5 s instead. Latency is slightly higher than the local 5 s WebSocket push. |
| Jobs run on every instance | Background jobs (quota enforcement, expiry checks, DDNS refresh, bandwidth snapshots) run independently on each slave. Expiry/quota emails from jobs are silently skipped on slaves since SMTP is not configured. |
| No slave AdGuard | AdGuard Home is only available on master-mode instances. |
| Slave traffic history | The dashboard traffic history chart shows local snapshots only. Slave 24 h / 7 d totals are included in the stat cards but not overlaid on the historical chart. |
