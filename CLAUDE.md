# Velar — Project Governance

## What this project is

Velar is a self-hosted WireGuard multi-interface management platform with a modern web dashboard. It runs as Docker containers on a Proxmox/Debian homelab behind a SWAG reverse proxy.

## Repository layout

```
velar/
├── backend/        Go 1.22, Gin, GORM, SQLite
├── frontend/       React 18, TypeScript, Vite, Tailwind, shadcn/ui
├── docker-compose.yml
├── .env            (gitignored — copy from .env.example)
├── Makefile
└── CLAUDE.md
```

## Golden rule

`backend/` and `frontend/` never import from each other. They communicate **only** via the HTTP API and WebSocket. No symlinks, no shared packages.

## Backend conventions

- **Router**: Gin, versioned at `/api/v1/`
- **ORM**: GORM with `github.com/glebarez/sqlite` (CGO-free)
- **Errors**: never panic in production; propagate errors, log with `slog`
- **Services**: always define an interface before the implementation
- **Config**: environment variables via godotenv; no hardcoded secrets
- **Encryption**: WireGuard private keys encrypted with AES-256-GCM; tokens stored as SHA-256 hashes
- **Auth**: bcrypt passwords, JWT access (15 min) + refresh (7 d, httpOnly cookie), optional TOTP
- **Rate limiting**: 10 req/min on `/auth/login`

## Frontend conventions

- **Data fetching**: React Query v5 for everything — no raw `fetch` in components
- **State**: Zustand for auth state (`stores/auth.ts`) and theme (`stores/theme.ts`)
- **Auth security**: JWT access token kept in memory only — never written to `localStorage`. On reload, `AuthInit` silently calls `/auth/refresh` using the httpOnly cookie.
- **UI**: Tailwind + shadcn/ui; light/dark theme switchable, dark by default
- **Theme**: CSS variables dual-theme (`:root` = light, `.dark` = dark); preference persisted in `localStorage` via `useThemeStore`; no-flash inline script in `index.html`
- **Routing**: React Router v6
- **WebSocket**: custom hook `useWebSocket` for live stats
- **Mobile**: bottom nav bar on `< lg`, responsive top bar, `max-lg:pb-14` on main to clear nav

## Environment

The `.env` at the repo root is the **single source of truth** for configuration. Sub-folder `.env` files must not exist.

## Docker

- `api` service: `network_mode: host`, `cap_add: [NET_ADMIN, SYS_MODULE]`
- `ui` service: Nginx serving Vite build, proxying `/api`, `/dl/`, `/ws/` to the backend
- `adguard` service: adguard/adguardhome

## Commands

```bash
make dev      # hot-reload dev stack
make build    # full rebuild (--no-cache)
make up       # detached production stack
make down
make logs
make test-go
make lint-go
make lint-ts
```

## WireGuard privileged operations

Any service call that executes `wg`, `wg-quick`, or writes to `/etc/wireguard/` requires `NET_ADMIN` capability. Set `WG_MOCK=true` in `.env` to disable real wg calls during development.

## LAN access

Interfaces have a `lan_access` toggle. When enabled:
- `DetectLANSubnet()` reads the host's default interface subnet via `ip addr`
- Client configs use split-tunnel `AllowedIPs` = `<vpn_subnet>, <lan_subnet>` instead of `0.0.0.0/0`
- All existing clients on the interface are updated automatically
- Requires `net.ipv4.ip_forward = 1` on the Docker host

## Email notifications (SMTP)

Configured via `SMTP_HOST`, `SMTP_FROM`, `SMTP_USER`, `SMTP_PASS`, `SMTP_PORT`, `ADMIN_EMAIL`, `APP_URL`.
- `mailer.Send*` — admin notifications
- `mailer.SendTo*` / `mailer.SendHTMLTo` — client notifications
- `APP_URL` is used to build one-time config download links (`/dl/<token>`)

## Sensitive data

- `APP_SECRET` must be ≥ 32 characters — it derives the AES key for DB-stored WireGuard private keys
- Never log private keys, tokens, or password hashes
- JWT access tokens must never be persisted to `localStorage` or any client-side storage
