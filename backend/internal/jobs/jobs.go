package jobs

import (
	"fmt"
	"log/slog"
	"math"
	"net"
	"strings"
	"sync"
	"time"

	"github.com/AlexArtaud-Dev/velar/backend/internal/config"
	"github.com/AlexArtaud-Dev/velar/backend/internal/database"
	"github.com/AlexArtaud-Dev/velar/backend/internal/models"
	"github.com/AlexArtaud-Dev/velar/backend/internal/services/ddns"
	"github.com/AlexArtaud-Dev/velar/backend/internal/services/mailer"
	tokensvc "github.com/AlexArtaud-Dev/velar/backend/internal/services/token"
	wgsvc "github.com/AlexArtaud-Dev/velar/backend/internal/services/wireguard"
	"github.com/robfig/cron/v3"
)

const disconnectThreshold = 3 * time.Minute
const snapshotRetention = 7 * 24 * time.Hour
const eventRetention = 30 * 24 * time.Hour

// ── Connection event tracking ─────────────────────────────────────────────────

type connState struct {
	connected     bool
	lastHandshake time.Time
}

var (
	connMu          sync.Mutex
	connStateMap    = make(map[uint]*connState) // clientID → state
	connInitialized bool
)

// ── Bandwidth snapshot tracking ───────────────────────────────────────────────

var (
	snapMu     sync.Mutex
	snapLastRx = make(map[uint]int64) // clientID → last cumulative bytes_rx from wg
	snapLastTx = make(map[uint]int64) // clientID → last cumulative bytes_tx from wg
)

func Start(wg wgsvc.Service, ddnsSvc *ddns.Service) {
	c := cron.New()

	// Expire peers every minute
	c.AddFunc("@every 1m", func() { expirePeers(wg) })

	// Notify admin about peers expiring in the next 24 h (runs every hour)
	c.AddFunc("@every 1h", notifyExpiringSoon)

	// Clean up used/expired download tokens every hour
	c.AddFunc("@every 1h", cleanupTokens)

	// DDNS refresh every 5 minutes
	c.AddFunc("@every 5m", func() { refreshDDNS(ddnsSvc) })

	// Connection event detection every 15 seconds
	c.AddFunc("@every 15s", func() { pollConnectionEvents(wg) })

	// Bandwidth snapshots every minute
	c.AddFunc("@every 1m", func() { snapshotBandwidth(wg) })

	// Purge old snapshots and events every hour
	c.AddFunc("@every 1h", purgeOldData)

	// Check data quotas every 15 seconds (uses live wg stats + DB snapshots)
	c.AddFunc("@every 15s", func() { checkQuotas(wg) })

	c.Start()
	slog.Info("background jobs started")
}

func expirePeers(wg wgsvc.Service) {
	var expired []models.Client
	result := database.DB.
		Preload("Interface").
		Where("expires_at IS NOT NULL AND expires_at < ? AND enabled = true", time.Now()).
		Find(&expired)
	if result.Error != nil {
		slog.Error("expirePeers query", "err", result.Error)
		return
	}
	for _, cl := range expired {
		if err := wg.RemovePeer(cl.Interface.Name, cl.PublicKey); err != nil {
			slog.Error("expirePeers remove peer", "client", cl.Name, "err", err)
			continue
		}
		database.DB.Model(&cl).Update("enabled", false)
		slog.Info("peer expired", "client", cl.Name, "interface", cl.Interface.Name)
		mailer.SendHTML(
			fmt.Sprintf("Client expired: %s", cl.Name),
			mailer.HTMLAdminClientExpired(cl.Name, cl.AssignedIP, cl.Interface.Name),
		)
		if cl.Email != "" {
			mailer.SendHTMLTo(cl.Email,
				fmt.Sprintf("VPN access expired: %s", cl.Name),
				mailer.HTMLClientExpired(cl.Name, cl.AssignedIP, cl.Interface.Name),
			)
		}
	}
}

func notifyExpiringSoon() {
	in24h := time.Now().Add(24 * time.Hour)
	var expiring []models.Client
	database.DB.Preload("Interface").
		Where("expires_at IS NOT NULL AND expires_at > ? AND expires_at < ? AND enabled = true", time.Now(), in24h).
		Find(&expiring)

	for _, cl := range expiring {
		expiresAt := cl.ExpiresAt.UTC().Format("2006-01-02 15:04 UTC")
		mailer.SendHTML(
			fmt.Sprintf("Client expiring soon: %s", cl.Name),
			mailer.HTMLAdminClientExpiringSoon(cl.Name, cl.AssignedIP, cl.Interface.Name, expiresAt),
		)
		if cl.Email != "" {
			mailer.SendHTMLTo(cl.Email,
				fmt.Sprintf("VPN access expiring soon: %s", cl.Name),
				mailer.HTMLClientExpiringSoon(cl.Name, cl.AssignedIP, cl.Interface.Name, expiresAt),
			)
		}
		slog.Info("expiry notification sent", "client", cl.Name)
	}
}

func cleanupTokens() {
	result := database.DB.
		Where("(used = true OR expires_at < ?) AND created_at < ?", time.Now(), time.Now().Add(-24*time.Hour)).
		Delete(&models.DownloadToken{})
	if result.RowsAffected > 0 {
		slog.Info("cleaned up download tokens", "count", result.RowsAffected)
	}
}

func refreshDDNS(ddnsSvc *ddns.Service) {
	changed, newIP, err := ddnsSvc.Refresh()
	if err != nil {
		slog.Error("ddns refresh", "err", err)
		return
	}
	if !changed {
		return
	}

	oldHost := config.C.WGHost
	slog.Info("public IP updated", "old", oldHost, "new", newIP)

	// Only update WGHost and notify clients when the configured endpoint is a
	// raw IP address.  If it is a domain name the DDNS record update is enough
	// and client configs (which use the domain) keep working without changes.
	if net.ParseIP(oldHost) == nil {
		slog.Info("WG_HOST is a domain — skipping client notification", "host", oldHost)
		return
	}

	if oldHost == newIP {
		return
	}

	// Update in-memory endpoint so newly generated configs use the new IP.
	config.C.WGHost = newIP

	// Notify admin
	mailer.SendHTML(
		fmt.Sprintf("Public IP changed: %s → %s", oldHost, newIP),
		mailer.HTMLAdminIPChanged(oldHost, newIP),
	)

	// Notify every enabled client that has an email address
	notifyIPChanged(oldHost, newIP)
}

// notifyIPChanged sends a new one-time download link to every enabled client
// that has an email address, across all interfaces.
func notifyIPChanged(oldIP, newIP string) {
	if !mailer.SMTPEnabled() {
		return
	}

	changes := []string{
		fmt.Sprintf("Server endpoint: %s &rarr; %s", oldIP, newIP),
	}

	var clients []models.Client
	database.DB.Preload("Interface").Where("email != '' AND enabled = true").Find(&clients)

	for _, cl := range clients {
		rawToken, _, err := tokensvc.Generate(cl.ID)
		if err != nil {
			slog.Warn("notifyIPChanged: token gen failed", "client", cl.Name, "err", err)
			continue
		}
		mailer.SendHTMLTo(
			cl.Email,
			fmt.Sprintf("Your VPN config needs updating — %s", cl.Name),
			mailer.HTMLClientInterfaceUpdated(cl.Name, cl.AssignedIP, changes, jobsBuildDownloadURL(rawToken)),
		)
		slog.Info("IP change notification sent", "client", cl.Name)
	}
}

// jobsBuildDownloadURL mirrors the same helper in the handlers package.
func jobsBuildDownloadURL(rawToken string) string {
	if base := config.C.AppURL; base != "" {
		return strings.TrimRight(base, "/") + "/dl/" + rawToken
	}
	return "/dl/" + rawToken
}

// pollConnectionEvents detects WireGuard peer connect/disconnect transitions by
// comparing live last_handshake timestamps against the previous poll state.
// On the first run it only records the baseline state — no events are emitted.
func pollConnectionEvents(wg wgsvc.Service) {
	var ifaces []models.Interface
	if err := database.DB.Where("enabled = true").Find(&ifaces).Error; err != nil {
		return
	}

	// Index all enabled clients by public key
	var clients []models.Client
	database.DB.Where("enabled = true").Find(&clients)
	pubToClient := make(map[string]*models.Client, len(clients))
	for i := range clients {
		pubToClient[clients[i].PublicKey] = &clients[i]
	}

	now := time.Now()

	// Gather live handshake state across all interfaces
	type liveState struct {
		handshake time.Time
		endpoint  string
	}
	livePeers := make(map[uint]liveState)
	for _, iface := range ifaces {
		stats, err := wg.GetStats(iface.Name)
		if err != nil {
			continue
		}
		for _, s := range stats {
			cl, ok := pubToClient[s.PublicKey]
			if !ok || s.LastHandshake == 0 {
				continue
			}
			livePeers[cl.ID] = liveState{
				handshake: time.Unix(s.LastHandshake, 0),
				endpoint:  s.Endpoint,
			}
		}
	}

	connMu.Lock()
	defer connMu.Unlock()

	if !connInitialized {
		// First run: record baseline without emitting events
		for clientID, live := range livePeers {
			connStateMap[clientID] = &connState{
				connected:     now.Sub(live.handshake) < disconnectThreshold,
				lastHandshake: live.handshake,
			}
		}
		for _, cl := range clients {
			if _, inLive := livePeers[cl.ID]; !inLive {
				connStateMap[cl.ID] = &connState{connected: false}
			}
		}
		connInitialized = true
		return
	}

	// Subsequent runs: compare and emit events
	for clientID, live := range livePeers {
		isConnected := now.Sub(live.handshake) < disconnectThreshold
		prev := connStateMap[clientID]
		if prev == nil {
			connStateMap[clientID] = &connState{connected: isConnected, lastHandshake: live.handshake}
			if isConnected {
				emitConnectionEvent(clientID, "connected", live.endpoint)
			}
			continue
		}
		if !prev.connected && isConnected {
			emitConnectionEvent(clientID, "connected", live.endpoint)
		} else if prev.connected && !isConnected {
			emitConnectionEvent(clientID, "disconnected", "")
		}
		prev.connected = isConnected
		prev.lastHandshake = live.handshake
	}

	// Clients absent from live stats → disconnected
	for _, cl := range clients {
		if _, inLive := livePeers[cl.ID]; !inLive {
			if prev := connStateMap[cl.ID]; prev != nil && prev.connected {
				emitConnectionEvent(cl.ID, "disconnected", "")
				prev.connected = false
			}
		}
	}
}

func emitConnectionEvent(clientID uint, eventType, endpoint string) {
	event := models.ConnectionEvent{
		ClientID:  clientID,
		EventType: eventType,
		SourceIP:  extractEndpointIP(endpoint),
		Timestamp: time.Now(),
	}
	if err := database.DB.Create(&event).Error; err != nil {
		slog.Error("emitConnectionEvent", "err", err)
		return
	}
	slog.Info("connection event", "client_id", clientID, "type", eventType)
}

func extractEndpointIP(endpoint string) string {
	if endpoint == "" || endpoint == "(none)" {
		return ""
	}
	host, _, err := net.SplitHostPort(endpoint)
	if err != nil {
		return endpoint
	}
	return host
}

// snapshotBandwidth polls wg stats every minute and stores per-client byte
// deltas. Handles counter resets (peer reconnection) by treating the new
// cumulative value as the delta for that interval.
func snapshotBandwidth(wg wgsvc.Service) {
	var ifaces []models.Interface
	if err := database.DB.Where("enabled = true").Find(&ifaces).Error; err != nil {
		return
	}

	var clients []models.Client
	database.DB.Where("enabled = true").Find(&clients)
	pubToID := make(map[string]uint, len(clients))
	for _, cl := range clients {
		pubToID[cl.PublicKey] = cl.ID
	}

	now := time.Now()

	snapMu.Lock()
	defer snapMu.Unlock()

	for _, iface := range ifaces {
		stats, err := wg.GetStats(iface.Name)
		if err != nil {
			continue
		}
		for _, s := range stats {
			clientID, ok := pubToID[s.PublicKey]
			if !ok {
				continue
			}

			prevRx, hadPrev := snapLastRx[clientID]
			prevTx := snapLastTx[clientID]

			// Always update the last-known value
			snapLastRx[clientID] = s.BytesRx
			snapLastTx[clientID] = s.BytesTx

			if !hadPrev {
				// First observation — record baseline, no delta yet
				continue
			}

			// Compute delta; counter resets on peer reconnect so treat new
			// cumulative as the delta for that interval.
			var deltaRx, deltaTx int64
			if s.BytesRx >= prevRx {
				deltaRx = s.BytesRx - prevRx
			} else {
				deltaRx = s.BytesRx
			}
			if s.BytesTx >= prevTx {
				deltaTx = s.BytesTx - prevTx
			} else {
				deltaTx = s.BytesTx
			}

			if deltaRx == 0 && deltaTx == 0 {
				continue // nothing to store
			}

			snap := models.PeerSnapshot{
				ClientID:  clientID,
				Timestamp: now,
				BytesRx:   deltaRx,
				BytesTx:   deltaTx,
			}
			if err := database.DB.Create(&snap).Error; err != nil {
				slog.Error("snapshotBandwidth: save", "err", err)
			}
		}
	}
}

// quotaPeriodStart returns the beginning of the current quota period.
// "total" returns a zero time (no lower bound — sum all snapshots).
func quotaPeriodStart(period string) time.Time {
	now := time.Now()
	switch period {
	case "weekly":
		weekday := int(now.Weekday())
		if weekday == 0 {
			weekday = 7 // treat Sunday as day 7
		}
		start := now.AddDate(0, 0, -(weekday - 1))
		return time.Date(start.Year(), start.Month(), start.Day(), 0, 0, 0, 0, now.Location())
	case "total":
		return time.Time{}
	default: // monthly
		return time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, now.Location())
	}
}

// formatQuotaBytes formats bytes as a human-readable string for emails.
func formatQuotaBytes(b int64) string {
	const unit = 1024
	if b < unit {
		return fmt.Sprintf("%d B", b)
	}
	div, exp := int64(unit), 0
	for n := b / unit; n >= unit; n /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f %cB", float64(b)/float64(div), "KMGTPE"[exp])
}

// checkQuotas runs every minute and enforces per-client data quotas.
// At 80% it sends a warning email (once per period). At 100% it disables the client.
func checkQuotas(wg wgsvc.Service) {
	var clients []models.Client
	if err := database.DB.Preload("Interface").
		Where("enabled = true AND data_quota_bytes > 0").
		Find(&clients).Error; err != nil {
		return
	}

	for _, cl := range clients {
		periodStart := quotaPeriodStart(cl.QuotaPeriod)
		// A manual reset overrides the natural period start
		if cl.QuotaResetAt != nil && cl.QuotaResetAt.After(periodStart) {
			periodStart = *cl.QuotaResetAt
		}

		var result struct{ Total int64 }
		q := database.DB.Model(&models.PeerSnapshot{}).
			Select("COALESCE(SUM(bytes_rx + bytes_tx), 0) as total").
			Where("client_id = ?", cl.ID)
		if !periodStart.IsZero() {
			q = q.Where("timestamp >= ?", periodStart)
		}
		q.Scan(&result)
		used := result.Total

		usedStr := formatQuotaBytes(used)
		quotaStr := formatQuotaBytes(cl.DataQuotaBytes)

		// Over quota → disable the peer
		if used >= cl.DataQuotaBytes {
			if err := wg.RemovePeer(cl.Interface.Name, cl.PublicKey); err != nil {
				slog.Error("checkQuotas: remove peer", "client", cl.Name, "err", err)
			}
			database.DB.Model(&cl).Update("enabled", false)
			slog.Info("client suspended: quota exceeded", "client", cl.Name,
				"used", used, "quota", cl.DataQuotaBytes)

			mailer.SendHTML(
				fmt.Sprintf("Data quota exceeded: %s", cl.Name),
				mailer.HTMLAdminQuotaExceeded(cl.Name, cl.AssignedIP, cl.Interface.Name, usedStr, quotaStr, cl.QuotaPeriod),
			)
			if cl.Email != "" {
				mailer.SendHTMLTo(cl.Email,
					fmt.Sprintf("VPN access suspended: data quota exceeded — %s", cl.Name),
					mailer.HTMLClientQuotaExceeded(cl.Name, cl.AssignedIP, usedStr, quotaStr, cl.QuotaPeriod),
				)
			}
			continue
		}

		// 80% warning — send at most once per period
		threshold := int64(math.Round(float64(cl.DataQuotaBytes) * 0.8))
		if used >= threshold {
			alreadyWarned := cl.QuotaWarnedAt != nil &&
				(periodStart.IsZero() || cl.QuotaWarnedAt.After(periodStart))
			if !alreadyWarned {
				now := time.Now()
				database.DB.Model(&cl).Update("quota_warned_at", &now)
				slog.Info("client quota warning sent", "client", cl.Name,
					"used", used, "quota", cl.DataQuotaBytes)

				mailer.SendHTML(
					fmt.Sprintf("Data quota warning (80%%): %s", cl.Name),
					mailer.HTMLAdminQuotaWarning(cl.Name, cl.AssignedIP, cl.Interface.Name, usedStr, quotaStr, cl.QuotaPeriod),
				)
				if cl.Email != "" {
					mailer.SendHTMLTo(cl.Email,
						fmt.Sprintf("VPN data quota warning — %s", cl.Name),
						mailer.HTMLClientQuotaWarning(cl.Name, cl.AssignedIP, usedStr, quotaStr, cl.QuotaPeriod),
					)
				}
			}
		}
	}
}

// purgeOldData removes PeerSnapshot rows older than 7 days and
// ConnectionEvent rows older than 30 days.
func purgeOldData() {
	snapshotCutoff := time.Now().Add(-snapshotRetention)
	res := database.DB.Where("timestamp < ?", snapshotCutoff).Delete(&models.PeerSnapshot{})
	if res.RowsAffected > 0 {
		slog.Info("purged old bandwidth snapshots", "count", res.RowsAffected)
	}

	eventCutoff := time.Now().Add(-eventRetention)
	res = database.DB.Where("timestamp < ?", eventCutoff).Delete(&models.ConnectionEvent{})
	if res.RowsAffected > 0 {
		slog.Info("purged old connection events", "count", res.RowsAffected)
	}
}
