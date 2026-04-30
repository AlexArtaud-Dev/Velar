# Velar — LAN Access

The **LAN access** toggle on a WireGuard interface enables connected clients to reach devices on the same local network as the Docker host — not just the VPN subnet.

---

## What it does

When LAN access is **disabled** (default), clients use full-tunnel routing:

```
AllowedIPs = 0.0.0.0/0, ::/0
```

All traffic (including internet) is routed through the VPN.

When LAN access is **enabled**, clients switch to split-tunnel:

```
AllowedIPs = <vpn_subnet>, <lan_subnet>
e.g.         10.0.0.0/24, 192.168.1.0/24
```

Only VPN-bound traffic and LAN-bound traffic go through the tunnel. Internet traffic uses the client's local connection directly.

---

## How Velar detects the LAN subnet

When you toggle LAN access on, Velar runs:

```bash
ip -o -f inet addr show <default_interface>
```

It finds the host's primary network interface (via `ip route show default`), reads its assigned subnet, and uses that as `lan_subnet` (e.g. `192.168.1.0/24`).

The detected subnet is saved on the interface record and shown in the UI next to the LAN badge.

---

## Applying the toggle

Toggling LAN access updates **all existing clients** on that interface automatically — their `AllowedIPs` are rewritten immediately. Clients need to re-download their config (or re-scan the QR code) to get the updated `AllowedIPs`.

> Velar sends email notifications to clients with an email address when their config changes (including subnet or DNS changes).

---

## Requirements

### On the Docker host

IP forwarding must be enabled:

```bash
sysctl net.ipv4.ip_forward   # should be 1
```

To persist across reboots:

```bash
echo "net.ipv4.ip_forward=1" >> /etc/sysctl.conf
sysctl -p
```

### iptables NAT

The WireGuard interface's `PostUp` rules must include a MASQUERADE rule for the LAN subnet, or use a broad rule:

```bash
PostUp = iptables -A FORWARD -i %i -j ACCEPT; iptables -t nat -A POSTROUTING -o eth0 -j MASQUERADE
PostDown = iptables -D FORWARD -i %i -j ACCEPT; iptables -t nat -D POSTROUTING -o eth0 -j MASQUERADE
```

Velar generates these automatically using the detected default interface. If your network setup is unusual (bonding, bridges, multiple interfaces), you may need to set PostUp/PostDown manually in the interface settings.

### Container network mode

The `api` container runs with `network_mode: host` — it has direct access to the host's network interfaces, which is required for WireGuard and for LAN subnet detection to work correctly.

---

## Example

**Setup:**
- Docker host: `192.168.1.14`
- Host LAN: `192.168.1.0/24`
- VPN subnet: `10.0.1.0/24`
- LAN access: enabled

**Result — client config AllowedIPs:**
```ini
AllowedIPs = 10.0.1.0/24, 192.168.1.0/24
```

**What the client can reach after connecting:**
- `10.0.1.x` — other VPN clients
- `192.168.1.1` — your router
- `192.168.1.14` — your server
- `192.168.1.x` — NAS, printers, cameras, other LAN devices
- Internet — via local connection (not through VPN)
