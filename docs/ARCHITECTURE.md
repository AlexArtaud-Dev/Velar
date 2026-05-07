# Velar — Architecture

## Overview

Velar is a three-container Docker stack. The frontend (Nginx + React SPA) proxies all API traffic to the backend (Go). The backend owns all privileged operations — WireGuard management, database, authentication, and Linux traffic control.

```
Browser
  │  HTTPS
  ▼
┌─────────────────────────────┐
│  ui  (Nginx + React SPA)    │  :80
│  Serves static build        │
│  Proxies /api /ws /dl       │──────────────────────┐
└─────────────────────────────┘                      │
                                                     │ HTTP
                                          ┌──────────▼──────────┐
                                          │  api  (Go + Gin)    │  :8080
                                          │  JWT · TOTP · GORM  │
                                          │  wg-quick · iptables│
                                          │  tc (bandwidth)     │
                                          └──────────┬──────────┘
                                                     │
                                        ┌────────────┴────────────┐
                                        │                         │
                              ┌─────────▼─────────┐   ┌──────────▼──────────┐
                              │  SQLite DB         │   │  AdGuard Home       │
                              │  (named volume)    │   │  :3000 (UI)         │
                              └───────────────────┘   │  :53  (DNS)         │
                                                       └─────────────────────┘
```

---

## Backend (`backend/`)

**Language:** Go 1.22  
**Framework:** Gin  
**ORM:** GORM with `github.com/glebarez/sqlite` (CGO-free)

### Package structure

```
backend/
├── cmd/server/          Main entrypoint, router setup
├── internal/
│   ├── api/
│   │   ├── handlers/    HTTP handlers (clients, interfaces, auth, audit, backup…)
│   │   └── middleware/  JWT auth, rate limiting (per-route token buckets)
│   ├── auth/            JWT generation/validation, AES-256-GCM encryption, bcrypt, TOTP
│   ├── config/          Environment variable loading (godotenv); AppVersion injectable via ldflags
│   ├── database/        GORM init, AutoMigrate
│   ├── jobs/            Background jobs (quota enforcement, peer snapshots, expiry checks)
│   ├── models/          GORM models (Interface, Client, Admin, AuditLog, …)
│   └── services/
│       ├── audit/       Audit log writer — called by every mutating handler
│       ├── bandwidth/   Linux tc wrapper (HTB egress + ingress police)
│       ├── ddns/        Public IP tracking
│       ├── mailer/      SMTP email (admin + client notifications)
│       ├── token/       One-time download token generation
│       └── wireguard/   wg / wg-quick abstraction, config builder, IP allocator
```

### Request lifecycle

1. Request hits Nginx → proxied to Go API at `:8080`
2. `middleware/auth.go` validates the JWT `Authorization: Bearer` header (or PAT hash)
3. Rate limiter middleware (per-route token bucket) enforces per-minute caps on sensitive endpoints
4. Handler reads/writes via GORM to SQLite
5. For WireGuard changes: handler calls `wgsvc.Service` interface → writes `.conf` → runs `wg syncconf`
6. For bandwidth changes: handler calls `bwsvc.Apply` → executes `tc` commands
7. Every mutating handler calls `auditsvc.Log(...)` → inserts a row into `audit_logs`

### Authentication flow

```
POST /auth/login  →  bcrypt verify  →  issue access token (15 min, memory)
                                   →  issue refresh token (7 d, httpOnly cookie, SHA-256 hash in DB)

On page reload:
  AuthInit (React)  →  POST /auth/refresh (sends cookie automatically)
                    →  new access token returned in JSON body
                    →  stored in Zustand state (memory only, never localStorage)
```

### WireGuard service abstraction

`wgsvc.Service` is an interface with two implementations:

- **Real** (`wireguard/service.go`) — calls `wg`, `wg-quick`, writes `/etc/wireguard/*.conf`
- **Mock** (`wireguard/mock.go`) — no-ops, used when `WG_MOCK=true`

This allows running the full stack on a development machine without root or WireGuard installed.

---

## Frontend (`frontend/`)

**Framework:** React 18 + TypeScript  
**Build tool:** Vite  
**Styling:** Tailwind CSS + shadcn/ui  
**State:** Zustand (auth in memory, theme in localStorage)  
**Data fetching:** TanStack Query v5 (React Query)  
**Routing:** React Router v6  
**Live data:** Custom `useWebSocket` hook → `/ws/stats`

### Key design decisions

**JWT never in localStorage** — The access token lives only in Zustand memory state. It is explicitly excluded from the `persist` middleware. On page reload, `AuthInit` silently calls `/auth/refresh` using the httpOnly cookie to recover the token before rendering protected routes.

**No-flash dark mode** — An inline `<script>` in `index.html` reads `localStorage` and applies the `.dark` class to `<html>` before React renders, preventing the light-flash on load.

**Theme system** — CSS variables on `:root` (light) and `.dark` (dark). Tailwind uses `darkMode: ['class']`. The `useThemeStore` Zustand store persists the preference and applies the class on hydration.

---

## Database

SQLite with WAL journal mode and foreign key enforcement. GORM `AutoMigrate` runs on every startup — it adds missing columns automatically without touching existing data. No manual migrations needed.

### Models

| Model | Purpose |
|---|---|
| `Admin` | Single admin account with TOTP support |
| `RefreshToken` | Hashed refresh tokens with expiry |
| `Interface` | WireGuard interface config |
| `Client` | VPN peer with keys, IPs, bandwidth limits, data quota |
| `DownloadToken` | One-time config download tokens |
| `ConnectionEvent` | Peer connect/disconnect history |
| `PeerSnapshot` | Periodic traffic snapshots used for quota enforcement and history charts |
| `AuditLog` | Timestamped record of every admin-initiated mutation (action, target, detail, admin ID) |
| `PersonalAccessToken` | Long-lived API tokens (PATs) for programmatic access |
| `RemoteInstance` | Registered slave nodes — stores encrypted token and last-seen timestamp |

---

## Backup & Restore

`GET /api/v1/admin/backup` serializes all interfaces and clients to a versioned JSON file. WireGuard keys are **never included** in the export — they are security-sensitive and cannot be safely transported.

`POST /api/v1/admin/restore` imports a backup file. For each interface and client, fresh WireGuard keypairs and preshared keys are generated, encrypted, and stored. Clients that have an email address are automatically notified with a one-time download link so they can fetch their new config.

The optional `?wipe=true` query parameter deletes all existing interfaces, clients, and related records (in FK-safe order) before importing. The admin account and refresh tokens are never touched.

Backup format is versioned (`"version": "2"`). Attempting to restore an older format returns a `400` with a clear error message.

---

## Federation (Master / Slave)

Velar supports a multi-instance deployment model. One node acts as the **master** (full UI + SMTP + admin); any number of remote nodes run as **slaves** (stripped API, no UI, no email).

### Topology

```
Browser
  │
  ▼
┌─────────────────────────┐
│   Master (standalone)   │   Full UI, JWT auth, SMTP, AdGuard
│   Velar + ui container  │
└──────────┬──────────────┘
           │  HTTPS  (server-side proxy — never exposes slave URL to browser)
           │
    ┌──────▼──────┐    ┌─────────────┐
    │  Slave A    │    │  Slave B    │   Stripped API only
    │  MasterToken│    │  MasterToken│   No web UI, no SMTP
    └─────────────┘    └─────────────┘
```

### Slave router

When `VELAR_MODE=slave` the entire JWT/auth/UI layer is stripped. A single `MasterToken` middleware gates all API routes. The slave exposes:

- Full client & interface CRUD
- `GET /api/v1/stats` — live WireGuard peer stats (same payload as master's WebSocket)
- `GET /api/v1/interfaces/overview` — interface up/down + enabled client counts
- `GET /dl/:token` and `GET /api/v1/public/client/:token` — public routes for config download and portal (no auth)

### Proxy layer (master side)

`POST /api/v1/instances/:id/proxy` accepts `{method, path, body}` and executes the request server-side against the slave using the stored token. The browser never sees the slave's internal URL or token.

Additional master endpoints for slave operations:

| Endpoint | Purpose |
|---|---|
| `GET /dl/s/:instanceId/:token` | Proxy config download from slave through master |
| `GET /api/v1/public/client/s/:instanceId/:token` | Proxy portal data from slave |
| `POST /api/v1/instances/:id/clients/notify` | Unified lifecycle email handler (create/update/delete/enable/disable) |
| `POST /api/v1/instances/:id/clients/:clientId/send-config` | Send config email for a slave client via master SMTP |

### Email routing

Slaves have no SMTP. All emails (lifecycle events, config delivery, download links, portal links) are sent by the master. Download links use the master URL pattern `/dl/s/:instanceId/:token`; portal links use `/portal/s/:instanceId/:token`. The master fetches the config from the slave transparently before emailing.

### Live stats

The master polls each slave's `GET /api/v1/stats` every 5 seconds via the proxy layer. This enables:
- Live connected/total peer counts per slave interface
- RX/TX updates on client cards (same cadence as the local WebSocket)
- Slave traffic contributions to the live bandwidth chart

### Audit log — federation

When the master's `Proxy` handler forwards a mutating request (POST / PUT / PATCH / DELETE) to a slave and the slave returns a success status (`< 400`), the master writes an audit entry. The action name is inferred from the HTTP method and path:

| Proxy call | Audit action written on master |
|---|---|
| `POST /api/v1/interfaces/3/up` | `slave.interface.up` |
| `DELETE /api/v1/clients/7` | `slave.client.delete` |
| `POST /api/v1/clients/7/enable` | `slave.client.enable` |
| `PUT /api/v1/clients/7` | `slave.client.update` |

This means the master's Audit Log page shows a complete trail covering both local and remote mutations.

---

## Docker

The `api` service runs with `network_mode: host` and `cap_add: [NET_ADMIN, SYS_MODULE]` — required for WireGuard and `tc` operations.

The `ui` service is a standard Nginx container serving the Vite build. It proxies `/api/`, `/ws/`, and `/dl/` paths to the backend.

WireGuard configs and the SQLite database are stored in named Docker volumes (`wireguard_configs`, `sqlite_data`) so they survive container recreation.
