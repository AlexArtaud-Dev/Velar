package mailer

// Client-facing email templates.
// Language is intentionally non-technical: "WireGuard" → "VPN app",
// "config" → "VPN profile", etc.

// HTMLClientWelcome is sent on client creation (or restore) with a one-time
// download link. The link expires in 1 hour and is single-use.
// portalURL is the permanent read-only status page for this client.
func HTMLClientWelcome(name, ip, expiry, downloadURL, portalURL string) string {
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
		note("&#x1F512;&nbsp; Your VPN profile is personal — like a password. Never share this file or this link with anyone.") +
		portalSection(portalURL)
	return baseHTML("Your VPN Access", body)
}

// HTMLClientUpdated is sent when an admin edits the client's account settings.
func HTMLClientUpdated(name, ip string) string {
	rows := infoRow("Your name", name) + infoRow("Your VPN address", ip)
	body := h2("Your VPN account was updated") +
		para("Your VPN account has been updated by your administrator. In most cases, <strong style=\"color:#f1f5f9;\">no action is needed on your side</strong> &mdash; you can keep using your VPN normally.") +
		infoTable(rows) +
		highlight("If your VPN stops working or you notice anything unexpected after this change, contact your administrator &mdash; they may need to send you a new profile.") +
		para("Otherwise, everything should continue working as before.")
	return baseHTML("Account Updated", body)
}

// HTMLClientInterfaceUpdated is sent when a subnet or DNS change requires the
// client to re-import their VPN profile.
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

// HTMLClientEnabled is sent when an admin re-enables the client's access.
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

// HTMLClientDisabled is sent when an admin temporarily disables the client.
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

// HTMLClientExpiringSoon is sent approximately 24 hours before a peer expires.
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

// HTMLClientQuotaWarning is sent when a client reaches 80% of their data quota.
func HTMLClientQuotaWarning(name, ip, used, quota, period, portalURL string) string {
	rows := infoRow("Account", name) + infoRow("Assigned IP", ip) +
		infoRow("Used", used) + infoRow("Quota", quota) + infoRow("Period", period)
	body := h2("&#x26A0;&#xFE0F;&nbsp; You have used 80% of your data quota") +
		badge("Quota Warning", "#fbbf24", "#451a03") +
		`<br><br>` +
		para("You are approaching your VPN data limit for the current period. Your access will be automatically suspended when the quota is fully consumed.") +
		infoTable(rows) +
		divider() +
		para("Contact your administrator if you need more data.") +
		portalSection(portalURL)
	return baseHTML("Data Quota Warning", body)
}

// HTMLClientQuotaExceeded is sent when a client's access is suspended for exceeding
// their data quota.
func HTMLClientQuotaExceeded(name, ip, used, quota, period, portalURL string) string {
	rows := infoRow("Account", name) + infoRow("Assigned IP", ip) +
		infoRow("Used", used) + infoRow("Quota", quota) + infoRow("Period", period)
	body := h2("&#x1F6AB;&nbsp; Data quota exceeded — VPN access suspended") +
		badge("Quota Exceeded", "#f87171", "#450a0a") +
		`<br><br>` +
		para("Your VPN access has been automatically suspended because you have exceeded your data quota for the current period.") +
		infoTable(rows) +
		divider() +
		para("Please contact your administrator to restore access or increase your quota.") +
		portalSection(portalURL)
	return baseHTML("Data Quota Exceeded", body)
}
