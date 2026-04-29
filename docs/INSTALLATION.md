# Velar — Installation Guide

This guide walks you through setting up Velar on a fresh Linux server (Debian/Ubuntu recommended).

---

## Table of Contents

1. [Server requirements](#1-server-requirements)
2. [WireGuard kernel module](#2-wireguard-kernel-module)
3. [Install Docker & Docker Compose](#3-install-docker--docker-compose)
4. [Clone and configure Velar](#4-clone-and-configure-velar)
5. [Start the stack](#5-start-the-stack)
6. [Port forwarding on your router](#6-port-forwarding-on-your-router)
7. [Static / fixed IP](#7-static--fixed-ip)
8. [First login](#8-first-login)
9. [Putting it behind a reverse proxy (HTTPS)](#9-putting-it-behind-a-reverse-proxy-https)
10. [Updating Velar](#10-updating-velar)
11. [Troubleshooting](#11-troubleshooting)

---

## 1. Server requirements

| | Minimum | Recommended |
|---|---|---|
| **OS** | Debian 11 / Ubuntu 22.04 | Debian 12 / Ubuntu 24.04 |
| **CPU** | 1 vCPU | 2 vCPU |
| **RAM** | 512 MB | 1 GB |
| **Disk** | 4 GB | 10 GB |
| **Kernel** | 5.6+ (WireGuard built-in) | latest LTS |

> **VPS / VM note:** Make sure your provider allows `NET_ADMIN` capabilities and kernel module loading. Most KVM-based VPS do. OpenVZ-based containers often do not.

---

## 2. WireGuard kernel module

On modern kernels (5.6+), WireGuard is built in. Just make sure the tools are installed:

```bash
apt update && apt install -y wireguard wireguard-tools
```

Verify the module loads:

```bash
modprobe wireguard && echo "WireGuard OK"
```

Enable IP forwarding permanently (Velar sets this at runtime too, but set it in sysctl for persistence across reboots):

```bash
echo "net.ipv4.ip_forward=1" >> /etc/sysctl.conf
echo "net.ipv6.conf.all.forwarding=1" >> /etc/sysctl.conf
sysctl -p
```

---

## 3. Install Docker & Docker Compose

```bash
# Install Docker
curl -fsSL https://get.docker.com | sh

# Add your user to the docker group (optional, avoids sudo)
usermod -aG docker $USER

# Verify
docker --version
docker compose version
```

> Docker Compose v2 is required (`docker compose`, not `docker-compose`).

---

## 4. Clone and configure Velar

```bash
git clone https://github.com/AlexArtaud-Dev/Velar.git
cd Velar
cp .env.example .env
```

Open `.env` and edit the required values:

```bash
nano .env
```

### Required settings

| Variable | Description | Example |
|---|---|---|
| `APP_SECRET` | Random secret ≥ 32 chars. Used to encrypt WireGuard private keys in the DB. **Change this before first launch.** | `openssl rand -hex 32` |
| `WG_HOST` | Your server's **public IP** or DDNS hostname. Clients will use this as the VPN endpoint. | `203.0.113.42` or `vpn.example.com` |

### Optional but useful

| Variable | Description | Default |
|---|---|---|
| `APP_PORT` | API listen port | `8080` |
| `ADGUARD_USER` | AdGuard Home admin username | `admin` |
| `ADGUARD_PASSWORD` | AdGuard Home admin password | `changeme` |
| `CORS_ORIGIN` | Allowed origin for the UI | `http://localhost:5173` |

> **Generate a strong `APP_SECRET`:**
> ```bash
> openssl rand -hex 32
> ```
> Paste the output into `.env`. Never share or commit this value.

---

## 5. Start the stack

```bash
docker compose up -d
```

This starts three containers:
- **api** — the Go backend (WireGuard management, auth, API)
- **ui** — the Nginx frontend serving the React app on port 80
- **adguard** — AdGuard Home DNS filtering on port 3000 (web UI) and 53 (DNS)

Check that everything is running:

```bash
docker compose ps
docker compose logs -f api
```

Look for the temporary admin password in the logs:

```bash
docker compose logs api | grep -i password
```

---

## 6. Port forwarding on your router

For VPN clients to reach your server from the internet, you need to **forward the WireGuard UDP port** through your router.

### Default ports used by Velar
| Service | Protocol | Port |
|---|---|---|
| Velar Web UI | TCP | 80 (or 443 if behind HTTPS proxy) |
| WireGuard interface | UDP | Whatever you set per interface (e.g. 51820) |
| AdGuard Home UI | TCP | 3000 |

### How to forward a port

1. Log in to your router's admin panel (usually `192.168.1.1` or `192.168.0.1`)
2. Find **Port Forwarding** / **NAT** / **Virtual Servers** section
3. Create a rule:
   - **External port:** your WireGuard port (e.g. `51820`)
   - **Internal IP:** your server's local IP (e.g. `192.168.1.100`)
   - **Internal port:** same as external
   - **Protocol:** `UDP`
4. Save and apply

Repeat for each WireGuard interface you create (each uses a different UDP port).

> 💡 **Check your public IP:**
> ```bash
> curl -s https://api.ipify.org
> ```
> Make sure this matches `WG_HOST` in your `.env`.

### Test the port is reachable

Use the built-in **connectivity checker** in the Velar UI (shield icon on each interface) to verify the interface is UP and the UDP port is bound server-side.

For external reachability, you can use online tools like:
- [https://www.yougetsignal.com/tools/open-ports/](https://www.yougetsignal.com/tools/open-ports/) (note: UDP testing from browser is limited)
- Ask a device on a different network to attempt a connection

---

## 7. Static / fixed IP

If your server's public IP changes frequently, VPN clients will lose connectivity. Solutions:

### Option A — Static IP from your ISP
Contact your ISP and request a static public IP (often available for a small monthly fee).

### Option B — DDNS (Dynamic DNS)
Use a free DDNS provider to assign a hostname that always points to your current IP:

- [Duck DNS](https://www.duckdns.org/) — free, simple
- [No-IP](https://www.noip.com/)
- [Cloudflare](https://developers.cloudflare.com/dns/manage-dns-records/how-to/managing-dynamic-ip-addresses/)

Set `WG_HOST` in `.env` to your DDNS hostname (e.g. `myvpn.duckdns.org`). Velar's DDNS service will keep the public IP up to date automatically.

On your server, install a DDNS updater script or use your provider's Docker image to update the DNS record whenever your IP changes.

### Option C — Your server has a fixed LAN IP assigned by DHCP reservation

Log in to your router and assign a **static DHCP lease** to your server's MAC address so it always gets the same local IP. This ensures port forwarding always hits the right machine.

---

## 8. First login

1. Open `http://your-server-ip` in your browser
2. Log in with:
   - **Username:** `admin`
   - **Password:** the temporary password from the logs (`docker compose logs api | grep -i password`)
3. You will be **forced to change your password** immediately
4. (Optional) Go to **Settings → Two-factor authentication** and enable TOTP

---

## 9. Putting it behind a reverse proxy (HTTPS)

Running Velar over HTTPS is strongly recommended, especially if exposed to the internet. Use [SWAG](https://docs.linuxserver.io/general/swag/), [Nginx Proxy Manager](https://nginxproxymanager.com/), Traefik, or Caddy.

### Example: Caddy (simplest)

```caddyfile
vpn.example.com {
    reverse_proxy localhost:80
}
```

### Example: Nginx

```nginx
server {
    listen 443 ssl;
    server_name vpn.example.com;

    ssl_certificate     /etc/letsencrypt/live/vpn.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/vpn.example.com/privkey.pem;

    location / {
        proxy_pass http://localhost:80;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

> Update `CORS_ORIGIN` in `.env` to your HTTPS domain after setting this up, then restart: `docker compose restart api`

---

## 10. Updating Velar

```bash
git pull
docker compose down
docker compose up -d --build
```

Your data (SQLite database, WireGuard configs) is stored in Docker named volumes and persists across updates.

---

## 11. Troubleshooting

### Interface is DOWN after server reboot

WireGuard interfaces are brought up by Velar at startup. Make sure Docker is set to start on boot:

```bash
systemctl enable docker
```

And that containers have `restart: unless-stopped` (already set in `docker-compose.yml`).

### Clients can connect but have no internet

- Check that `net.ipv4.ip_forward=1` is active: `sysctl net.ipv4.ip_forward`
- Check iptables NAT rules: `iptables -t nat -L POSTROUTING -nv`
- Make sure the PostUp/PostDown rules reference the correct network interface (Velar auto-detects this via `ip route show default`)

### `wg-quick: /etc/wireguard/wgX.conf does not exist`

The WireGuard config volume may have been recreated. Restart the API container — it will regenerate all configs from the database:

```bash
docker compose restart api
```

### Cannot scan QR code

Make sure you're using the WireGuard mobile app (not a generic QR scanner). The config QR codes encode WireGuard-specific syntax.

### Forgot admin password

Reset the database and start fresh:

```bash
docker compose down
docker volume rm velar_sqlite_data
docker compose up -d
docker compose logs api | grep -i password
```

> ⚠️ This deletes **all** interfaces, clients, and configuration.

---

*For issues or questions, open a GitHub issue or contact alexandre.artaud.dev@gmail.com*
