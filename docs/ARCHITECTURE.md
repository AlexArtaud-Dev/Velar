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
│   │   ├── handlers/    HTTP handlers (clients, interfaces, auth, settings, backup…)
│   │   └── middleware/  JWT auth, rate limiting
│   ├── auth/            JWT generation/validation, AES-256-GCM encryption, bcrypt
│   ├── config/          Environment variable loading (godotenv)
│   ├── database/        GORM init, AutoMigrate
│   ├── jobs/            Background jobs (quota enforcement, peer snapshots, expiry checks)
│   ├── models/          GORM models (Interface, Client, Admin, …)
│   └── services/
│       ├── bandwidth/   Linux tc wrapper (HTB egress + ingress police)
│       ├── ddns/        Public IP tracking
│       ├── mailer/      SMTP email (admin + client notifications)
│       ├── token/       One-time download token generation
│       └── wireguard/   wg / wg-quick abstraction, config builder, IP allocator
```

### Request lifecycle

1. Request hits Nginx → proxied to Go API at `:8080`
2. `middleware/auth.go` validates the JWT `Authorization: Bearer` header
3. Handler reads/writes via GORM to SQLite
4. For WireGuard changes: handler calls `wgsvc.Service` interface → writes `.conf` → runs `wg syncconf`
5. For bandwidth changes: handler calls `bwsvc.Apply` → executes `tc` commands

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

---

## Backup & Restore

`GET /api/v1/admin/backup` serializes all interfaces and clients to a versioned JSON file. WireGuard keys are **never included** in the export — they are security-sensitive and cannot be safely transported.

`POST /api/v1/admin/restore` imports a backup file. For each interface and client, fresh WireGuard keypairs and preshared keys are generated, encrypted, and stored. Clients that have an email address are automatically notified with a one-time download link so they can fetch their new config.

The optional `?wipe=true` query parameter deletes all existing interfaces, clients, and related records (in FK-safe order) before importing. The admin account and refresh tokens are never touched.

Backup format is versioned (`"version": "2"`). Attempting to restore an older format returns a `400` with a clear error message.

---

## Docker

The `api` service runs with `network_mode: host` and `cap_add: [NET_ADMIN, SYS_MODULE]` — required for WireGuard and `tc` operations.

The `ui` service is a standard Nginx container serving the Vite build. It proxies `/api/`, `/ws/`, and `/dl/` paths to the backend.

WireGuard configs and the SQLite database are stored in named Docker volumes (`wireguard_configs`, `sqlite_data`) so they survive container recreation.
