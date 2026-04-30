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
      Velar &mdash; VPN Management Platform<br>
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

func highlight(text string) string {
	return fmt.Sprintf(`<p style="margin:0 0 16px;background:#0f172a;border-left:3px solid #6366f1;padding:12px 16px;border-radius:0 8px 8px 0;color:#e2e8f0;font-size:14px;line-height:1.75;">%s</p>`, text)
}

func note(text string) string {
	return fmt.Sprintf(`<p style="margin:16px 0 0;color:#475569;font-size:12px;line-height:1.6;text-align:center;">%s</p>`, text)
}

func divider() string {
	return `<div style="height:1px;background:#334155;margin:24px 0;"></div>`
}

// stepsList renders a numbered list of instructions.
func stepsList(steps []string) string {
	rows := ""
	for i, s := range steps {
		rows += fmt.Sprintf(`<tr>
  <td style="padding:8px 12px 8px 0;vertical-align:top;width:36px;">
    <div style="background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;font-weight:800;font-size:12px;width:26px;height:26px;border-radius:50%%;text-align:center;line-height:26px;">%d</div>
  </td>
  <td style="padding:8px 0;color:#cbd5e1;font-size:14px;line-height:1.65;vertical-align:top;">%s</td>
</tr>`, i+1, s)
	}
	return fmt.Sprintf(`<table cellpadding="0" cellspacing="0" border="0" width="100%%" style="margin:16px 0 20px;">
<tbody>%s</tbody>
</table>`, rows)
}

// ── Client-facing templates ───────────────────────────────────────────────────
// Written in plain language for non-technical users.
// No jargon: "WireGuard" → "VPN app", "config" → "VPN profile", etc.

// HTMLClientWelcome is sent on client creation with a one-time download link.
func HTMLClientWelcome(name, ip, expiry, downloadURL string) string {
	rows := infoRow("Your name", name) + infoRow("Your VPN address", ip) + infoRow("Access expires on", expiry)
	body := h2("Welcome! Your VPN access is ready &#x1F389;") +
		para("Your VPN access has been set up. To start using it, you need to download your personal VPN profile and load it into the <strong style=\"color:#f1f5f9;\">WireGuard</strong> app on your device.") +
		infoTable(rows) +
		para("<strong style=\"color:#f1f5f9;\">Click the button below to download your profile.</strong> The link is personal, works only once, and expires in 1&nbsp;hour &mdash; so download it now.") +
		ctaButton("&#x2B07;&nbsp; Download my VPN profile", downloadURL) +
		divider() +
		para("<strong style=\"color:#f1f5f9;\">How to install it on your phone or tablet:</strong>") +
		stepsList([]string{
			"Open the <strong style=\"color:#f1f5f9;\">WireGuard</strong> app (download it free from the App Store or Google Play if you don't have it).",
			"Tap the <strong style=\"color:#f1f5f9;\">+</strong> button, then choose <strong style=\"color:#f1f5f9;\">&ldquo;Import from file or archive&rdquo;</strong>.",
			"Select the file you just downloaded. Your VPN is ready to use.",
		}) +
		para("<strong style=\"color:#f1f5f9;\">How to install it on your computer:</strong>") +
		stepsList([]string{
			"Open the <strong style=\"color:#f1f5f9;\">WireGuard</strong> app (download it free from wireguard.com if you don't have it).",
			"Click <strong style=\"color:#f1f5f9;\">&ldquo;Import tunnel(s) from file&rdquo;</strong>.",
			"Select the file you just downloaded. Your VPN is ready to use.",
		}) +
		note("&#x1F512;&nbsp; Your VPN profile is personal — like a password. Never share this file or this link with anyone.")
	return baseHTML("Your VPN Access", body)
}

// HTMLClientUpdated is sent to the client when their account settings are edited by an admin.
func HTMLClientUpdated(name, ip string) string {
	rows := infoRow("Your name", name) + infoRow("Your VPN address", ip)
	body := h2("Your VPN account was updated") +
		para("Your VPN account has been updated by your administrator. In most cases, <strong style=\"color:#f1f5f9;\">no action is needed on your side</strong> &mdash; you can keep using your VPN normally.") +
		infoTable(rows) +
		highlight("If your VPN stops working or you notice anything unexpected after this change, contact your administrator &mdash; they may need to send you a new profile.") +
		para("Otherwise, everything should continue working as before.")
	return baseHTML("Account Updated", body)
}

// HTMLClientInterfaceUpdated is sent when a subnet or DNS change requires re-importing the VPN profile.
func HTMLClientInterfaceUpdated(name, ip string, changes []string, downloadURL string) string {
	rows := infoRow("Your name", name) + infoRow("Your VPN address", ip)
	body := h2("&#x26A0;&#xFE0F;&nbsp; Action required &mdash; update your VPN app") +
		badge("You need to act", "#fbbf24", "#451a03") +
		`<br><br>` +
		para("Your administrator has updated the VPN server settings. Because of this change, <strong style=\"color:#f1f5f9;\">your current VPN setup will no longer work</strong> and you need to replace it with a new one.") +
		para("Don't worry &mdash; it only takes a minute. Just follow the steps below.") +
		infoTable(rows) +
		ctaButton("&#x2B07;&nbsp; Download my new VPN profile", downloadURL) +
		divider() +
		para("<strong style=\"color:#f1f5f9;\">Steps to update (phone or tablet):</strong>") +
		stepsList([]string{
			"Click the button above and download your new VPN profile.",
			"Open the <strong style=\"color:#f1f5f9;\">WireGuard</strong> app.",
			"Find your old profile named <strong style=\"color:#f1f5f9;\">&ldquo;" + name + "&rdquo;</strong> and delete it (swipe left on mobile, or select and click the trash icon).",
			"Tap <strong style=\"color:#f1f5f9;\">+</strong> &rarr; <strong style=\"color:#f1f5f9;\">&ldquo;Import from file&rdquo;</strong> and select the file you just downloaded.",
			"Done! Your VPN is working again.",
		}) +
		note("&#x1F512;&nbsp; This link works only once and expires in 1&nbsp;hour. Download your profile now.<br>Contact your administrator if you missed the window.")
	return baseHTML("Action Required — Update Your VPN", body)
}

// HTMLClientEnabled is sent when access is re-enabled by an admin.
func HTMLClientEnabled(name, ip string) string {
	rows := infoRow("Your name", name) + infoRow("Your VPN address", ip)
	body := h2("Good news &mdash; your VPN access is back! &#x2705;") +
		badge("Active", "#34d399", "#064e3b") +
		`<br><br>` +
		para("Your VPN access has been restored by your administrator. You can connect right now &mdash; <strong style=\"color:#f1f5f9;\">no changes are needed in your app</strong>.") +
		infoTable(rows) +
		highlight("Just open the WireGuard app and toggle your VPN on as usual. Everything should work immediately.") +
		para("If you have any trouble connecting, contact your administrator.")
	return baseHTML("VPN Access Restored", body)
}

// HTMLClientDisabled is sent when access is temporarily disabled.
func HTMLClientDisabled(name, ip string) string {
	rows := infoRow("Your name", name) + infoRow("Your VPN address", ip)
	body := h2("Your VPN access has been paused") +
		badge("Suspended", "#fbbf24", "#451a03") +
		`<br><br>` +
		para("Your VPN access has been temporarily suspended by your administrator. <strong style=\"color:#f1f5f9;\">You will not be able to connect to the VPN</strong> until your access is restored.") +
		infoTable(rows) +
		highlight("This suspension is usually temporary. Your VPN profile is still saved on your device &mdash; you won't need to reconfigure anything when access is restored.") +
		divider() +
		para("If you think this is a mistake, or need your access restored urgently, please contact your administrator.")
	return baseHTML("VPN Access Paused", body)
}

// HTMLClientDeleted is sent when access is permanently revoked.
func HTMLClientDeleted(name, ip string) string {
	rows := infoRow("Your name", name) + infoRow("Former VPN address", ip)
	body := h2("Your VPN access has been removed") +
		badge("Removed", "#f87171", "#450a0a") +
		`<br><br>` +
		para("Your VPN access has been permanently removed by your administrator. <strong style=\"color:#f1f5f9;\">You will no longer be able to connect</strong> using the VPN profile on your device.") +
		infoTable(rows) +
		highlight("You can safely delete the profile named &ldquo;" + name + "&rdquo; from your WireGuard app &mdash; it will not work anymore.") +
		divider() +
		para("If you believe this was done in error, or if you need VPN access again in the future, please contact your administrator.")
	return baseHTML("VPN Access Removed", body)
}

// HTMLClientExpired is sent when a peer's access expires automatically.
func HTMLClientExpired(name, ip, iface string) string {
	rows := infoRow("Your name", name) + infoRow("Your VPN address", ip)
	body := h2("Your VPN access has expired") +
		badge("Expired", "#f87171", "#450a0a") +
		`<br><br>` +
		para("Your VPN access was set up with an expiry date, and that date has now passed. As a result, <strong style=\"color:#f1f5f9;\">your VPN has been automatically disconnected</strong> and you can no longer connect.") +
		infoTable(rows) +
		highlight("Think of it like a visitor badge that was valid for a limited time &mdash; it has simply run out. Your administrator can renew your access if needed.") +
		divider() +
		para("Contact your administrator to renew your VPN access.")
	return baseHTML("VPN Access Expired", body)
}

// HTMLClientExpiringSoon is sent ~24h before expiry.
func HTMLClientExpiringSoon(name, ip, iface, expiresAt string) string {
	rows := infoRow("Your name", name) + infoRow("Your VPN address", ip) + infoRow("Stops working on", expiresAt)
	body := h2("&#x23F0;&nbsp; Your VPN access expires soon") +
		badge("Expiring Soon", "#fbbf24", "#451a03") +
		`<br><br>` +
		para("Your VPN access is set to expire within the next <strong style=\"color:#f1f5f9;\">24 hours</strong>. Once it expires, you will no longer be able to connect &mdash; until your administrator renews it.") +
		infoTable(rows) +
		highlight("&#x1F514;&nbsp; To avoid any interruption, contact your administrator as soon as possible and ask them to extend your access.") +
		divider() +
		para("If your VPN access is not renewed in time, don't worry &mdash; your profile will still be on your device and will work again once the administrator re-enables it.")
	return baseHTML("VPN Access Expiring Soon", body)
}

// ── Admin-facing templates ────────────────────────────────────────────────────
// These are intended for the technical administrator, so more detail is kept.

// HTMLAdminClientCreated is sent to the admin when a new client is created.
func HTMLAdminClientCreated(name, ip, iface, owner string) string {
	rows := infoRow("Client name", name) + infoRow("Assigned IP", ip) + infoRow("Interface", iface) + infoRow("Owner", owner)
	body := h2("New client provisioned") +
		badge("Created", "#34d399", "#064e3b") +
		`<br><br>` +
		para("A new WireGuard peer has been added to your Velar instance. If the client had an email address set, they have already received a one-time download link for their config.") +
		infoTable(rows) +
		para("Manage this client from the Velar dashboard.")
	return baseHTML("New Client Created", body)
}

// HTMLAdminClientUpdated is sent to the admin when a client is edited.
func HTMLAdminClientUpdated(name, ip, iface string) string {
	rows := infoRow("Client name", name) + infoRow("Assigned IP", ip) + infoRow("Interface", iface)
	body := h2("Client configuration updated") +
		para("A WireGuard peer configuration has been modified on your Velar instance.") +
		infoTable(rows)
	return baseHTML("Client Updated", body)
}

// HTMLAdminClientExpired is sent to the admin when a peer expires automatically.
func HTMLAdminClientExpired(name, ip, iface string) string {
	rows := infoRow("Client name", name) + infoRow("Assigned IP", ip) + infoRow("Interface", iface)
	body := h2("Peer expired &mdash; access automatically disabled") +
		badge("Expired", "#f87171", "#450a0a") +
		`<br><br>` +
		para("A WireGuard peer has reached its configured expiry date and has been automatically disabled. The peer has been removed from the active interface and can no longer connect.") +
		infoTable(rows) +
		divider() +
		para("You can re-enable (and extend the expiry) or permanently delete this client from the Velar dashboard.")
	return baseHTML("Client Expired", body)
}

// HTMLAdminIPChanged is sent to the admin when the public IP changes.
func HTMLAdminIPChanged(oldIP, newIP string) string {
	rows := infoRow("Previous IP", oldIP) + infoRow("New IP", newIP)
	body := h2("&#x1F310;&nbsp; Public IP address changed") +
		badge("IP Updated", "#60a5fa", "#1e3a5f") +
		`<br><br>` +
		para("The server&rsquo;s public IP address has changed. The in-memory <code style=\"color:#a78bfa;\">WGHost</code> value has been updated so that any new client configs generated from now on will use the correct IP.") +
		infoTable(rows) +
		para("All enabled clients that had an email address have been notified automatically and sent a new one-time download link so they can re-import their config with the updated endpoint.") +
		divider() +
		para("&#x26A0;&#xFE0F;&nbsp; Clients without an email address still have the old IP in their config and will need to be updated manually. WireGuard interfaces remain up &mdash; currently connected peers will drop and need to reconnect.")
	return baseHTML("Public IP Changed", body)
}

// HTMLAdminClientExpiringSoon is sent to the admin for peers expiring within 24h.
func HTMLAdminClientExpiringSoon(name, ip, iface, expiresAt string) string {
	rows := infoRow("Client name", name) + infoRow("Assigned IP", ip) + infoRow("Interface", iface) + infoRow("Expires at (UTC)", expiresAt)
	body := h2("&#x23F0;&nbsp; Peer expiring in less than 24 hours") +
		badge("Expiring Soon", "#fbbf24", "#451a03") +
		`<br><br>` +
		para("A WireGuard peer will reach its expiry date within the next 24 hours and will be automatically disabled by the expiry job.") +
		infoTable(rows) +
		divider() +
		para("If this client still needs access, extend their expiry date from the Velar dashboard before the deadline.")
	return baseHTML("Client Expiring Soon", body)
}

// HTMLAdminQuotaWarning is sent to the admin when a client reaches 80% of their data quota.
func HTMLAdminQuotaWarning(name, ip, iface, used, quota, period string) string {
	rows := infoRow("Client name", name) + infoRow("Assigned IP", ip) + infoRow("Interface", iface) +
		infoRow("Used", used) + infoRow("Quota", quota) + infoRow("Period", period)
	body := h2("&#x26A0;&#xFE0F;&nbsp; Data quota warning (80%)") +
		badge("Quota Warning", "#fbbf24", "#451a03") +
		`<br><br>` +
		para("A WireGuard client has consumed 80% of their allocated data quota for the current period. Access will be automatically suspended when the quota is fully consumed.") +
		infoTable(rows) +
		divider() +
		para("You can raise or remove the quota from the Velar dashboard at any time.")
	return baseHTML("Data Quota Warning", body)
}

// HTMLAdminQuotaExceeded is sent to the admin when a client is suspended for exceeding their quota.
func HTMLAdminQuotaExceeded(name, ip, iface, used, quota, period string) string {
	rows := infoRow("Client name", name) + infoRow("Assigned IP", ip) + infoRow("Interface", iface) +
		infoRow("Used", used) + infoRow("Quota", quota) + infoRow("Period", period)
	body := h2("&#x1F6AB;&nbsp; Data quota exceeded — access suspended") +
		badge("Quota Exceeded", "#f87171", "#450a0a") +
		`<br><br>` +
		para("A WireGuard client has exceeded their allocated data quota and has been automatically suspended for the current period.") +
		infoTable(rows) +
		divider() +
		para("To restore access, raise or remove the quota from the Velar dashboard.")
	return baseHTML("Data Quota Exceeded", body)
}

// HTMLClientQuotaWarning is sent to the client when they reach 80% of their quota.
func HTMLClientQuotaWarning(name, ip, used, quota, period string) string {
	rows := infoRow("Account", name) + infoRow("Assigned IP", ip) +
		infoRow("Used", used) + infoRow("Quota", quota) + infoRow("Period", period)
	body := h2("&#x26A0;&#xFE0F;&nbsp; You have used 80% of your data quota") +
		badge("Quota Warning", "#fbbf24", "#451a03") +
		`<br><br>` +
		para("You are approaching your VPN data limit for the current period. Your access will be automatically suspended when the quota is fully consumed.") +
		infoTable(rows) +
		divider() +
		para("Contact your administrator if you need more data.")
	return baseHTML("Data Quota Warning", body)
}

// HTMLClientQuotaExceeded is sent to the client when their access is suspended due to quota.
func HTMLClientQuotaExceeded(name, ip, used, quota, period string) string {
	rows := infoRow("Account", name) + infoRow("Assigned IP", ip) +
		infoRow("Used", used) + infoRow("Quota", quota) + infoRow("Period", period)
	body := h2("&#x1F6AB;&nbsp; Data quota exceeded — VPN access suspended") +
		badge("Quota Exceeded", "#f87171", "#450a0a") +
		`<br><br>` +
		para("Your VPN access has been automatically suspended because you have exceeded your data quota for the current period.") +
		infoTable(rows) +
		divider() +
		para("Please contact your administrator to restore access or increase your quota.")
	return baseHTML("Data Quota Exceeded", body)
}
