package mailer

// Admin-facing email templates.
// These are addressed to the technical operator and include more detail than
// the client-facing equivalents (interface names, IP addresses, etc.).

// HTMLAdminClientCreated is sent to the admin when a new client is provisioned.
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

// HTMLAdminClientUpdated is sent to the admin when a client's settings are edited.
func HTMLAdminClientUpdated(name, ip, iface string) string {
	rows := infoRow("Client name", name) + infoRow("Assigned IP", ip) + infoRow("Interface", iface)
	body := h2("Client configuration updated") +
		para("A WireGuard peer configuration has been modified on your Velar instance.") +
		infoTable(rows)
	return baseHTML("Client Updated", body)
}

// HTMLAdminClientExpired is sent when a peer is automatically disabled on expiry.
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

// HTMLAdminClientExpiringSoon is sent for peers expiring within the next 24 hours.
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

// HTMLAdminIPChanged is sent when the server's public IP changes.
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

// HTMLAdminQuotaWarning is sent when a client reaches 80% of their data quota.
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

// HTMLAdminQuotaExceeded is sent when a client is suspended for exceeding their quota.
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
