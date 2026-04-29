package mailer

import "fmt"

// ── Layout helpers ────────────────────────────────────────────────────────────

// baseHTML wraps content in a branded Velar email layout.
func baseHTML(subtitle, bodyContent string) string {
	return fmt.Sprintf(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Velar</title>
</head>
<body style="margin:0;padding:0;background:#0f172a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<table width="100%%" cellpadding="0" cellspacing="0" border="0" style="background:#0f172a;padding:40px 16px;">
<tr><td align="center">
<table cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%%;background:#1e293b;border-radius:16px;overflow:hidden;border:1px solid #334155;">

  <!-- Header -->
  <tr>
    <td style="background:linear-gradient(135deg,#6366f1 0%%,#8b5cf6 100%%);padding:36px 40px;text-align:center;">
      <div style="font-size:28px;font-weight:800;color:#ffffff;letter-spacing:-0.5px;">&#x2B22; Velar</div>
      <div style="color:rgba(255,255,255,0.75);font-size:14px;margin-top:8px;font-weight:400;">%s</div>
    </td>
  </tr>

  <!-- Body -->
  <tr>
    <td style="padding:36px 40px;">
      %s
    </td>
  </tr>

  <!-- Footer -->
  <tr>
    <td style="padding:20px 40px;border-top:1px solid #334155;text-align:center;color:#475569;font-size:12px;line-height:1.7;">
      Velar &mdash; WireGuard Management Platform<br>
      <span style="color:#334155;">This is an automated notification. Do not reply to this email.</span>
    </td>
  </tr>

</table>
</td></tr>
</table>
</body>
</html>`, subtitle, bodyContent)
}

func infoRow(label, value string) string {
	return fmt.Sprintf(`<tr>
  <td style="padding:10px 16px;border-bottom:1px solid #1e293b;color:#64748b;font-size:13px;white-space:nowrap;vertical-align:top;">%s</td>
  <td style="padding:10px 16px;border-bottom:1px solid #1e293b;color:#e2e8f0;font-size:13px;font-family:'Courier New',Courier,monospace;word-break:break-all;">%s</td>
</tr>`, label, value)
}

func infoTable(rows string) string {
	return fmt.Sprintf(`<table cellpadding="0" cellspacing="0" border="0" width="100%%" style="background:#0f172a;border-radius:10px;border:1px solid #334155;margin:20px 0;overflow:hidden;">
  <tbody>%s</tbody>
</table>`, rows)
}

func ctaButton(label, url string) string {
	return fmt.Sprintf(`<div style="text-align:center;margin:28px 0 12px;">
  <a href="%s" style="display:inline-block;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#ffffff;text-decoration:none;padding:14px 36px;border-radius:10px;font-weight:700;font-size:15px;letter-spacing:0.2px;">%s</a>
</div>`, url, label)
}

func badge(label, color, bg string) string {
	return fmt.Sprintf(`<span style="display:inline-block;padding:4px 12px;border-radius:20px;font-size:12px;font-weight:700;color:%s;background:%s;letter-spacing:0.3px;">%s</span>`,
		color, bg, label)
}

func h2(text string) string {
	return fmt.Sprintf(`<h2 style="margin:0 0 12px;color:#f1f5f9;font-size:20px;font-weight:700;line-height:1.3;">%s</h2>`, text)
}

func para(text string) string {
	return fmt.Sprintf(`<p style="margin:0 0 16px;color:#94a3b8;font-size:14px;line-height:1.75;">%s</p>`, text)
}

func note(text string) string {
	return fmt.Sprintf(`<p style="margin:16px 0 0;color:#475569;font-size:12px;line-height:1.6;text-align:center;">%s</p>`, text)
}

func divider() string {
	return `<div style="height:1px;background:#334155;margin:20px 0;"></div>`
}

// ── Client-facing templates ───────────────────────────────────────────────────

// HTMLClientWelcome is sent on client creation with a one-time download link.
func HTMLClientWelcome(name, ip, expiry, downloadURL string) string {
	rows := infoRow("Name", name) + infoRow("VPN IP", ip) + infoRow("Expires", expiry)
	body := h2("Your VPN access is ready &#x1F389;") +
		para("Your WireGuard VPN configuration has been created. Use the button below to download your configuration file &mdash; the link is valid for <strong style=\"color:#f1f5f9;\">1 hour</strong> and can only be used once.") +
		infoTable(rows) +
		ctaButton("&#x2B07; Download my config", downloadURL) +
		divider() +
		note("Import the <code>.conf</code> file into the WireGuard app on any device.<br>&#x26A0;&#xFE0F; Do not share this file or link with anyone.")
	return baseHTML("WireGuard VPN Access", body)
}

// HTMLClientUpdated is sent to the client when their config metadata is edited.
func HTMLClientUpdated(name, ip string) string {
	rows := infoRow("Name", name) + infoRow("VPN IP", ip)
	body := h2("Your VPN configuration was updated") +
		para("An administrator has made changes to your WireGuard VPN access. If your allowed routes or expiry date changed, please check with your administrator.") +
		infoTable(rows) +
		para("Your existing configuration file remains valid unless the interface itself was reconfigured. Contact your administrator if you have questions.")
	return baseHTML("Configuration Updated", body)
}

// HTMLClientInterfaceUpdated is sent when a subnet or DNS change requires a new config.
func HTMLClientInterfaceUpdated(name, ip string, changes []string, downloadURL string) string {
	changesHTML := ""
	for _, ch := range changes {
		changesHTML += fmt.Sprintf(`<li style="color:#94a3b8;font-size:14px;margin-bottom:6px;line-height:1.6;">%s</li>`, ch)
	}
	changesList := fmt.Sprintf(`<ul style="margin:12px 0 20px;padding-left:20px;">%s</ul>`, changesHTML)

	rows := infoRow("Name", name) + infoRow("New VPN IP", ip)
	body := h2("&#x26A0;&#xFE0F; Your VPN config needs to be updated") +
		badge("Action Required", "#fbbf24", "#451a03") +
		`<br><br>` +
		para("Your VPN interface was reconfigured by an administrator. The following settings have changed:") +
		changesList +
		para("<strong style=\"color:#f1f5f9;\">You must download a new configuration file</strong> and re-import it into your WireGuard app. Your old config will no longer work.") +
		infoTable(rows) +
		ctaButton("&#x2B07; Download new config", downloadURL) +
		note("&#x26A0;&#xFE0F; Delete your old configuration and replace it with this new one.")
	return baseHTML("Interface Reconfigured", body)
}

// HTMLClientEnabled is sent when access is re-enabled.
func HTMLClientEnabled(name, ip string) string {
	rows := infoRow("Name", name) + infoRow("VPN IP", ip)
	body := h2("Your VPN access has been re-enabled &#x2705;") +
		badge("Active", "#34d399", "#064e3b") +
		`<br><br>` +
		para("Your WireGuard VPN access has been restored. You can connect immediately using your existing configuration file.") +
		infoTable(rows)
	return baseHTML("Access Re-enabled", body)
}

// HTMLClientDisabled is sent when access is temporarily disabled.
func HTMLClientDisabled(name, ip string) string {
	rows := infoRow("Name", name) + infoRow("VPN IP", ip)
	body := h2("Your VPN access has been temporarily disabled") +
		badge("Disabled", "#fbbf24", "#451a03") +
		`<br><br>` +
		para("Your WireGuard VPN access has been suspended by an administrator. Your configuration file is still valid and your access may be restored.") +
		infoTable(rows) +
		divider() +
		para("Contact your administrator if you believe this is an error or need your access restored.")
	return baseHTML("Access Suspended", body)
}

// HTMLClientDeleted is sent when access is permanently revoked.
func HTMLClientDeleted(name, ip string) string {
	rows := infoRow("Name", name) + infoRow("Former VPN IP", ip)
	body := h2("Your VPN access has been revoked") +
		badge("Revoked", "#f87171", "#450a0a") +
		`<br><br>` +
		para("Your WireGuard VPN access has been permanently removed. Your configuration file is no longer valid and connections will be rejected.") +
		infoTable(rows) +
		divider() +
		para("Contact your administrator if you have questions or need access restored.")
	return baseHTML("Access Revoked", body)
}

// HTMLClientExpired is sent when a peer's access expires automatically.
func HTMLClientExpired(name, ip, iface string) string {
	rows := infoRow("Name", name) + infoRow("VPN IP", ip) + infoRow("Interface", iface)
	body := h2("Your VPN access has expired") +
		badge("Expired", "#f87171", "#450a0a") +
		`<br><br>` +
		para("Your WireGuard VPN access has reached its scheduled expiry date and has been automatically disabled. You can no longer connect using your existing configuration.") +
		infoTable(rows) +
		divider() +
		para("Contact your administrator to renew your access.")
	return baseHTML("VPN Access Expired", body)
}

// HTMLClientExpiringSoon is sent ~24h before expiry.
func HTMLClientExpiringSoon(name, ip, iface, expiresAt string) string {
	rows := infoRow("Name", name) + infoRow("VPN IP", ip) + infoRow("Interface", iface) + infoRow("Expires at (UTC)", expiresAt)
	body := h2("&#x23F0; Your VPN access expires soon") +
		badge("Expiring Soon", "#fbbf24", "#451a03") +
		`<br><br>` +
		para("Your WireGuard VPN access will expire within the next <strong style=\"color:#f1f5f9;\">24 hours</strong> and will be automatically disabled.") +
		infoTable(rows) +
		divider() +
		para("Contact your administrator to extend your access before it expires.")
	return baseHTML("Access Expiring Soon", body)
}

// ── Admin-facing templates ────────────────────────────────────────────────────

// HTMLAdminClientCreated is sent to the admin when a new client is created.
func HTMLAdminClientCreated(name, ip, iface, owner string) string {
	rows := infoRow("Client name", name) + infoRow("VPN IP", ip) + infoRow("Interface", iface) + infoRow("Owner", owner)
	body := h2("New client added") +
		badge("Created", "#34d399", "#064e3b") +
		`<br><br>` +
		para("A new WireGuard client has been provisioned on your Velar instance.") +
		infoTable(rows) +
		para("You can manage this client from the Velar dashboard.")
	return baseHTML("New Client Created", body)
}

// HTMLAdminClientUpdated is sent to the admin when a client is edited.
func HTMLAdminClientUpdated(name, ip, iface string) string {
	rows := infoRow("Client name", name) + infoRow("VPN IP", ip) + infoRow("Interface", iface)
	body := h2("Client configuration updated") +
		para("A WireGuard client configuration has been modified.") +
		infoTable(rows)
	return baseHTML("Client Updated", body)
}

// HTMLAdminClientExpired is sent to the admin when a peer expires automatically.
func HTMLAdminClientExpired(name, ip, iface string) string {
	rows := infoRow("Client name", name) + infoRow("VPN IP", ip) + infoRow("Interface", iface)
	body := h2("Client peer expired and was disabled") +
		badge("Expired", "#f87171", "#450a0a") +
		`<br><br>` +
		para("A WireGuard peer has reached its expiry date and has been automatically disabled.") +
		infoTable(rows) +
		divider() +
		para("You can re-enable or permanently delete this client from the Velar dashboard.")
	return baseHTML("Client Expired", body)
}

// HTMLAdminIPChanged is sent to the admin when the public IP changes.
func HTMLAdminIPChanged(oldIP, newIP string) string {
	rows := infoRow("Previous IP", oldIP) + infoRow("New IP", newIP)
	body := h2("&#x1F310; Public IP address changed") +
		badge("IP Updated", "#60a5fa", "#1e3a5f") +
		`<br><br>` +
		para("The server's public IP address has changed. All clients whose VPN configuration hardcodes this IP have been notified by email and provided with a new one-time download link.") +
		infoTable(rows) +
		para("WireGuard interfaces remain up. Existing connected peers will reconnect automatically once they update their configuration.")
	return baseHTML("Public IP Changed", body)
}

// HTMLAdminClientExpiringSoon is sent to the admin for peers expiring within 24h.
func HTMLAdminClientExpiringSoon(name, ip, iface, expiresAt string) string {
	rows := infoRow("Client name", name) + infoRow("VPN IP", ip) + infoRow("Interface", iface) + infoRow("Expires at (UTC)", expiresAt)
	body := h2("&#x23F0; Client expiring in less than 24 hours") +
		badge("Expiring Soon", "#fbbf24", "#451a03") +
		`<br><br>` +
		para("A WireGuard peer will reach its expiry date within the next 24 hours and will be automatically disabled.") +
		infoTable(rows) +
		divider() +
		para("Extend its expiry or delete it from the Velar dashboard before it expires.")
	return baseHTML("Client Expiring Soon", body)
}
