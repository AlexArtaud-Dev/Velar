<div align="center">

# 🛡️ Velar

**The self-hosted WireGuard dashboard you actually want to use.**

Manage multiple VPN interfaces, control every peer, monitor live traffic, and enforce bandwidth policies — all from a single beautiful web UI. No CLI. No config files. No bullshit.

[![License: Proprietary](https://img.shields.io/badge/license-Proprietary-red.svg)](./LICENSE)
[![Go](https://img.shields.io/badge/Go-1.22-00ADD8?logo=go&logoColor=white)](https://golang.org)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Docker](https://img.shields.io/badge/Docker-ready-2496ED?logo=docker&logoColor=white)](./docs/INSTALLATION.md)
[![WireGuard](https://img.shields.io/badge/WireGuard-powered-88171A?logo=wireguard&logoColor=white)](https://www.wireguard.com)

</div>

---

## ✨ Why Velar?

Most WireGuard UIs are glorified config file editors. Velar is a full management platform — built for people who run real infrastructure and want a proper interface to go with it.

- **Multi-interface** — run separate VPN networks on the same server, isolated
- **Production-grade security** — JWT in memory, httpOnly cookies, AES-256 key encryption, TOTP
- **Batteries included** — AdGuard Home, bandwidth limiting, LAN access, email notifications, one-time config links
- **Zero dependencies** — SQLite, Docker, done

---

## 🚀 Features

### 🔌 Multi-Interface WireGuard Management
Create and manage **multiple WireGuard interfaces** independently — each with its own port, subnet, DNS, keys, and peer list. Bring interfaces up/down with one click. Velar writes and syncs `.conf` files automatically.

### 👥 Full Peer Lifecycle
Add, edit, disable, or delete **VPN clients** in seconds. No key management by hand — Velar generates keypairs, preshared keys, and assigns IPs automatically. Every change is live.

### 📊 Real-Time Traffic Monitoring
**Live stats per peer** via WebSocket — bytes transferred, last handshake time, connection status dot. The dashboard updates continuously without page refresh.

### ⚡ Per-Client Bandwidth Limiting
Cap **download and upload independently** per peer using Linux `tc` (traffic control). Set a 10 Mbps download limit on one client while leaving another unlimited. Limits survive interface restarts and are enforced at the kernel level.

- `↓ Download` — shapes egress via HTB qdisc (server → client)
- `↑ Upload` — polices ingress (client → server) with packet drop on excess
- Configurable per client from the dashboard, applied instantly

### 🏠 LAN Access Toggle
Enable **local network access** per interface with one click. Velar detects your host's LAN subnet automatically and switches all clients to split-tunnel mode (`VPN subnet + LAN subnet` instead of `0.0.0.0/0`). Connect to your VPN from anywhere and still reach `192.168.1.x` devices.

### 📱 Instant Client Onboarding
- **QR code** — scan with the WireGuard app, connected in 10 seconds
- **Config viewer** — read the full `.conf` in the UI and copy it with one click
- **One-time download links** — share a single-use, time-limited URL that delivers the config without requiring login
- **Email delivery** — send the config or a download link directly to the client's inbox

### 🛡️ Security First
- **TOTP two-factor authentication** (Google Authenticator, Aegis, any TOTP app)
- WireGuard private keys **encrypted at rest** with AES-256-GCM
- JWT access tokens kept in **memory only** — never written to `localStorage`
- **httpOnly refresh cookies** — immune to XSS token theft
- bcrypt password hashing + forced password change on first login
- Rate limiting on the login endpoint

### 🌐 DNS & Network
- Integrated **AdGuard Home** for network-wide ad and tracker blocking
- DNS preset selector — Cloudflare, Google, Quad9, or your own
- **DDNS support** — auto-tracks your public IP
- Per-interface **connectivity checker** — verifies the interface is UP and the UDP port is bound

### 🎨 Beautiful, Responsive UI
- **Dark mode by default**, switchable to light — preference persisted, no flash on reload
- Fully **mobile-responsive** — bottom nav bar on small screens, sidebar on desktop
- Thin themed scrollbar, smooth transitions, shadcn/ui component system
- Live connection indicator in the nav

### 📦 Data Quotas
Set a **monthly, weekly, or total data cap** per client. Enforcement is handled by **Linux nftables at the kernel level** — packets are dropped the instant the budget is exhausted, with zero overshoot. Velar sends warning emails at 80% usage and on suspension, and re-enables the peer automatically when the quota is raised or reset. Usage is tracked across server restarts.

### ✅ Bulk Client Operations
Select multiple clients and **enable, disable, or delete** them in one action — no clicking through each card individually.

### 🗄️ Ops-Friendly
- **SQLite** — single file, zero infrastructure, easy backup
- **Backup & Restore** — export all interfaces and clients as a JSON file; restore onto any Velar instance. Keys are never exported — fresh WireGuard keypairs are generated on restore and clients are notified by email automatically.
- Subnet editing with automatic **client IP re-allocation** (preserves host offset)
- `WG_MOCK=true` mode for development without root/WireGuard

---

## ⚡ Quick Start

```bash
git clone https://github.com/AlexArtaud-Dev/Velar.git && cd Velar
cp .env.example .env
# Set WG_HOST (your public IP) and APP_SECRET (openssl rand -hex 32)
nano .env
docker compose up -d
```

Open `http://your-server-ip` → login with `admin` + the temporary password from:

```bash
docker compose logs api | grep -i password
```

You'll be forced to change it on first login.

> For full setup instructions including WireGuard kernel setup, port forwarding, DDNS, and reverse proxy configuration, see the **[Installation Guide →](./docs/INSTALLATION.md)**

---

## 🧱 Stack

| Layer | Technology |
|---|---|
| Backend | Go 1.22, Gin, GORM, SQLite |
| Frontend | React 18, TypeScript, Vite, Tailwind CSS, shadcn/ui |
| Auth | bcrypt, JWT, httpOnly cookies, TOTP |
| VPN | WireGuard, wg-quick |
| Bandwidth | Linux tc (HTB + ingress police) |
| Quotas | Linux nftables (named quotas, kernel-level enforcement) |
| DNS | AdGuard Home |
| Runtime | Docker, Docker Compose |

---

## 📚 Documentation

| Document | Description |
|---|---|
| [Installation Guide](./docs/INSTALLATION.md) | Server setup, Docker, first login, port forwarding |
| [Configuration Reference](./docs/CONFIGURATION.md) | All environment variables explained |
| [Architecture](./docs/ARCHITECTURE.md) | How Velar works internally, request flow, services |
| [Bandwidth Limiting](./docs/BANDWIDTH.md) | How tc-based shaping works, limits and caveats |
| [Data Quotas](./docs/QUOTAS.md) | nftables kernel-level quota enforcement, periods, suspension flow |
| [LAN Access](./docs/LAN-ACCESS.md) | Split-tunnel setup, subnet detection, requirements |
| [Reverse Proxy](./docs/REVERSE-PROXY.md) | Nginx, Caddy, SWAG + Authelia examples |
| [Troubleshooting](./docs/TROUBLESHOOTING.md) | Common issues and fixes |

---

## 📄 License

Proprietary software — source available for personal self-hosting only.
Redistribution or commercial use requires written permission.
See [LICENSE](./LICENSE) · Contact: smlartaudalexandre@gmail.com
