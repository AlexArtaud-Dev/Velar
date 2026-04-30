# Velar — Reverse Proxy Setup

Running Velar behind a reverse proxy is strongly recommended for any internet-facing deployment. This gives you HTTPS, a clean domain name, and optionally authentication middleware like Authelia.

---

## What needs to be proxied

| Path | Destination | Notes |
|---|---|---|
| `/` | `http://localhost:80` | React SPA (served by the `ui` Nginx container) |
| `/api/` | proxied by `ui` to `http://localhost:8080` | Already handled by the `ui` container — no need to proxy directly |
| `/ws/` | proxied by `ui` to `http://localhost:8080` | WebSocket — requires `Upgrade` headers |
| `/dl/` | proxied by `ui` to `http://localhost:8080` | One-time config downloads |

**You only need to proxy port 80 (the `ui` container).** The `ui` Nginx config already forwards `/api/`, `/ws/`, and `/dl/` to the backend internally.

---

## Caddy (simplest)

```caddyfile
vpn.example.com {
    reverse_proxy localhost:80
}
```

Caddy handles TLS automatically via Let's Encrypt.

---

## Nginx (manual)

```nginx
server {
    listen 443 ssl http2;
    server_name vpn.example.com;

    ssl_certificate     /etc/letsencrypt/live/vpn.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/vpn.example.com/privkey.pem;

    location / {
        proxy_pass http://localhost:80;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebSocket support
        proxy_set_header Upgrade    $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 3600s;
    }
}

server {
    listen 80;
    server_name vpn.example.com;
    return 301 https://$host$request_uri;
}
```

> **Note:** Do NOT add `proxy_http_version 1.1;` if your `proxy.conf` include already sets it — it will cause a duplicate directive error.

---

## SWAG (LinuxServer)

SWAG is a pre-configured Nginx + Certbot container. Drop this file into `config/nginx/proxy-confs/velar.subdomain.conf`:

```nginx
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;

    server_name velar.*;

    include /config/nginx/ssl.conf;
    client_max_body_size 0;

    location / {
        include /config/nginx/proxy.conf;
        include /config/nginx/resolver.conf;
        set $upstream_app    velar-ui;   # or localhost if on the same host
        set $upstream_port   80;
        set $upstream_proto  http;
        proxy_pass $upstream_proto://$upstream_app:$upstream_port;
    }
}
```

---

## SWAG + Authelia (recommended for homelab)

Protect the dashboard behind Authelia SSO. Use a `subfolder` or `subdomain` Authelia config depending on your setup.

```nginx
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;

    server_name velar.*;

    include /config/nginx/ssl.conf;
    client_max_body_size 0;

    # Authelia SSO
    include /config/nginx/authelia-server.conf;

    location / {
        include /config/nginx/proxy.conf;
        include /config/nginx/resolver.conf;
        include /config/nginx/authelia-location.conf;

        set $upstream_app    velar-ui;
        set $upstream_port   80;
        set $upstream_proto  http;
        proxy_pass $upstream_proto://$upstream_app:$upstream_port;
    }
}
```

> **Note:** The WebSocket connection (`/ws/stats`) must be excluded from Authelia's authentication check, or the live stats will stop working after the proxy intercepts the upgrade. Add a dedicated location block before the catch-all:
>
> ```nginx
> location /ws/ {
>     include /config/nginx/proxy.conf;
>     # No authelia-location here
>     set $upstream_app   velar-ui;
>     set $upstream_port  80;
>     set $upstream_proto http;
>     proxy_pass $upstream_proto://$upstream_app:$upstream_port;
> }
> ```

---

## AdGuard Home (separate subdomain)

AdGuard Home runs on port 3000 (or 3001 depending on your `.env`). It needs its own subdomain:

```nginx
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;

    server_name adguard.*;

    include /config/nginx/ssl.conf;

    location / {
        include /config/nginx/proxy.conf;
        include /config/nginx/resolver.conf;
        # Optional: protect with Authelia
        include /config/nginx/authelia-location.conf;

        set $upstream_app    localhost;
        set $upstream_port   3001;   # match ADGUARD_URL port in .env
        set $upstream_proto  http;
        proxy_pass $upstream_proto://$upstream_app:$upstream_port;
    }
}
```

---

## After setting up HTTPS

Update your `.env`:

```bash
CORS_ORIGIN=https://vpn.example.com
APP_URL=https://vpn.example.com
```

Then restart the backend:

```bash
docker compose restart api
```
