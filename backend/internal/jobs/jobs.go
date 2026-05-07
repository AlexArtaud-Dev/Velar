// Package jobs registers and starts all background cron jobs for Velar.
// Each concern (expiry, snapshots, quotas, DDNS, connections) lives in its
// own file within this package; this file only wires them together.
package jobs

import (
	"log/slog"
	"time"

	"github.com/AlexArtaud-Dev/velar/backend/internal/services/adguard"
	"github.com/AlexArtaud-Dev/velar/backend/internal/services/ddns"
	nftquota "github.com/AlexArtaud-Dev/velar/backend/internal/services/nftquota"
	wgsvc "github.com/AlexArtaud-Dev/velar/backend/internal/services/wireguard"
	"github.com/robfig/cron/v3"
)

// Retention constants control how long historical data is kept in the DB.
const (
	disconnectThreshold = 3 * time.Minute     // peer is considered disconnected after this gap
	snapshotRetention   = 7 * 24 * time.Hour  // bandwidth snapshots older than 7 days are purged
	eventRetention      = 30 * 24 * time.Hour // connection events older than 30 days are purged
	auditLogRetention   = 90 * 24 * time.Hour // audit log entries older than 90 days are purged
)

// Start registers all background jobs and begins the scheduler.
// It should be called once at application startup.
func Start(wg wgsvc.Service, nft nftquota.Service, ddnsSvc *ddns.Service, ag *adguard.Client) {
	c := cron.New()

	// Peer expiry — disable peers that have passed their expires_at date.
	c.AddFunc("@every 1m", func() { expirePeers(wg) })

	// Expiry warnings — notify admin about peers expiring within the next 24 h.
	c.AddFunc("@every 1h", notifyExpiringSoon)

	// Token cleanup — remove used or expired download tokens.
	c.AddFunc("@every 1h", cleanupTokens)

	// DDNS — refresh the public IP immediately at startup, then every 5 minutes.
	go refreshDDNS(ddnsSvc)
	c.AddFunc("@every 5m", func() { refreshDDNS(ddnsSvc) })

	// Connection events — detect peer connect/disconnect transitions.
	c.AddFunc("@every 15s", func() { pollConnectionEvents(wg) })

	// Bandwidth snapshots — store per-client traffic deltas.
	c.AddFunc("@every 1m", func() { snapshotBandwidth(wg) })

	// Data purge — remove snapshots and events beyond retention window.
	c.AddFunc("@every 1h", purgeOldData)

	// Quota enforcement — detect nftables-exceeded quotas, update DB, send emails.
	c.AddFunc("@every 15s", func() { checkQuotas(wg, nft) })

	// AdGuard sync — push master config to slaves that have sync enabled.
	if ag != nil {
		go syncAllAdguardSlaves(ag)
		c.AddFunc("@every 5m", func() { syncAllAdguardSlaves(ag) })
	}

	c.Start()
	slog.Info("background jobs started")
}
