<div align="center">

# Velar

**A modern, self-hosted WireGuard management dashboard**

Manage multiple WireGuard VPN interfaces, peers, and DNS filtering — all from a clean web UI. No CLI required.

[![License: Proprietary](https://img.shields.io/badge/license-Proprietary-red.svg)](./LICENSE)
[![Go](https://img.shields.io/badge/Go-1.22-00ADD8?logo=go)](https://golang.org)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react)](https://react.dev)
[![Docker](https://img.shields.io/badge/Docker-ready-2496ED?logo=docker)](./docs/INSTALLATION.md)

</div>

---

## What is Velar?

Velar is a fully self-hosted VPN management platform built on top of WireGuard. It gives you a single, beautiful dashboard to create and manage multiple VPN interfaces, add and revoke peers, monitor live traffic, and optionally route DNS through an integrated AdGuard Home instance — without ever touching the command line.

Designed for homelabs, small teams, and privacy-conscious individuals who want full control over their network without relying on third-party VPN providers.

---

## Features

### WireGuard Management
- Create and manage **multiple WireGuard interfaces** with independent ports, subnets and keys
- Add, remove, enable and disable **peers (clients)** in real time
- Automatic **keypair generation** (server + client) — no manual `wg genkey` needed
- **Live traffic stats** per peer via WebSocket (bytes in/out, last handshake, connection status)
- Automatic **iptables NAT rules** with smart network interface detection

### Client Management
- Per-client **QR code** for instant mobile setup
- **Raw config viewer** — see the full `.conf` in the UI and copy it instantly
- **One-time download links** — share a single-use, time-limited URL to distribute configs without login
- Client **enable/disable** without deletion
- Optional **expiry dates** per client
- Owner labels to track who owns each peer

### Security
- **bcrypt** password hashing
- **JWT** access tokens (15 min) + **httpOnly refresh cookies** (7 days)
- **TOTP two-factor authentication** (Google Authenticator, Aegis, etc.)
- Forced password change on first login
- WireGuard private keys encrypted at rest with **AES-256-GCM**
- Rate limiting on the login endpoint

### DNS & Networking
- Built-in **AdGuard Home** integration for network-wide ad/tracker blocking
- DNS preset selector (Cloudflare, Google, Quad9, AdGuard auto-detected)
- **DDNS support** — automatic public IP tracking
- **Connectivity checker** per interface — verifies the interface is UP and UDP port is bound

### Operations
- **SQLite** database — zero external dependencies, single file
- One-click **database backup** download
- **Public IP auto-detection** with manual refresh
- Subnet editing with automatic **client IP re-allocation**
- Full **dark theme** UI out of the box

---

## Architecture

```
+-------------------------------------+
|           Browser (HTTPS)           |
+----------------+--------------------+
                 |
+----------------v--------------------+
|     Velar UI  (Nginx + React)       |  :80
|     proxies /api to backend         |
+----------------+--------------------+
                 |
+----------------v--------------------+
|   Velar API  (Go + Gin)             |  :8080
|   JWT . TOTP . GORM . SQLite        |
|   wg / wg-quick / iptables          |
+----------------+--------------------+
                 |
+----------------v--------------------+
|   AdGuard Home                      |  :3000 (web) / :53 (DNS)
+-------------------------------------+
```

**Stack:** Go 1.22 · Gin · GORM · SQLite · React 18 · TypeScript · Vite · Tailwind CSS · shadcn/ui · Docker

---

## Quick Start

See the full **[Installation Guide](./docs/INSTALLATION.md)** for step-by-step instructions including server prerequisites, WireGuard kernel setup, Docker installation, environment configuration, port forwarding, and first login.

> **TL;DR** for experienced users:
> ```bash
> git clone https://github.com/AlexArtaud-Dev/Velar.git && cd Velar
> cp .env.example .env          # edit WG_HOST and APP_SECRET at minimum
> docker compose up -d
> # open http://your-server-ip  ->  login: admin / see logs for temp password
> docker compose logs api | grep -i password
> ```

---

## License

This project is **proprietary software**. Source code is available for viewing and personal self-hosting only.  
Copying, redistribution, or commercial use **requires explicit written permission** from the author.

See [LICENSE](./LICENSE) for full terms — to request permission: smlartaudalexandre@gmail.com
