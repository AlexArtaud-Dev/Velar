# Velar — Configuration Reference

All configuration is done via environment variables in the `.env` file at the repository root. Copy `.env.example` to `.env` before first launch.

---

## Required

| Variable | Description |
|---|---|
| `APP_SECRET` | Random secret **≥ 32 characters**. Used to derive the AES-256-GCM key that encrypts WireGuard private keys in the database. Generate with `openssl rand -hex 32`. **Never commit this value. Changing it after first launch will break decryption of existing keys.** |
| `WG_HOST` | Your server's **public IP address or DDNS hostname**. This is embedded in every client `.conf` as the VPN endpoint. Example: `203.0.113.42` or `vpn.example.com`. |

---

## Application

| Variable | Default | Description |
|---|---|---|
| `APP_PORT` | `8080` | Port the Go API listens on. |
| `APP_URL` | _(empty)_ | Full public URL of the app (e.g. `https://vpn.example.com`). Used to build one-time config download links. If empty, links are path-only (`/dl/<token>`). |
| `CORS_ORIGIN` | `http://localhost:5173` | Allowed origin for CORS. Set to your production domain when behind a reverse proxy. |
| `WG_MOCK` | `false` | Set to `true` to disable all real WireGuard and `tc` calls. Useful for local development on Windows/macOS or without root. |
| `WG_CONFIG_DIR` | `/etc/wireguard` | Directory where WireGuard `.conf` files are written. Must be writable by the container. |

---

## Database

| Variable | Default | Description |
|---|---|---|
| `DB_PATH` | `./data/velar.db` | Path to the SQLite database file. Backed by a Docker named volume in production. |

---

## Email / SMTP

All SMTP variables are optional. If `SMTP_HOST` is not set, email features are silently disabled.

| Variable | Default | Description |
|---|---|---|
| `SMTP_HOST` | _(empty)_ | SMTP server hostname (e.g. `smtp.gmail.com`). |
| `SMTP_PORT` | `587` | SMTP port. Use `465` for SSL, `587` for STARTTLS. |
| `SMTP_USER` | _(empty)_ | SMTP username / email address. |
| `SMTP_PASS` | _(empty)_ | SMTP password or app-specific password. |
| `SMTP_FROM` | _(empty)_ | `From` address shown in emails. Defaults to `SMTP_USER` if empty. |
| `ADMIN_EMAIL` | _(empty)_ | Admin email address for system notifications (new clients, deletions, etc.). |

---

## AdGuard Home

| Variable | Default | Description |
|---|---|---|
| `ADGUARD_URL` | `http://adguard:3000` | Internal URL of the AdGuard Home instance. Defaults to the Docker service name. |
| `ADGUARD_USER` | `admin` | AdGuard Home admin username. |
| `ADGUARD_PASSWORD` | `changeme` | AdGuard Home admin password. **Change this.** |

---

## Security Notes

- `APP_SECRET` is the most sensitive value in the config. Without it, encrypted WireGuard private keys in the database cannot be decrypted.
- Never commit `.env` to source control — it is gitignored by default.
- JWT access tokens have a 15-minute lifetime. Refresh tokens last 7 days and are stored as SHA-256 hashes in the DB.
- TOTP secrets are stored encrypted in the database using the same `APP_SECRET`-derived key.
