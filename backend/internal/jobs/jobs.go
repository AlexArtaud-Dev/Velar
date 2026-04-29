package jobs

import (
	"fmt"
	"log/slog"
	"time"

	"github.com/AlexArtaud-Dev/velar/backend/internal/database"
	"github.com/AlexArtaud-Dev/velar/backend/internal/models"
	"github.com/AlexArtaud-Dev/velar/backend/internal/services/ddns"
	"github.com/AlexArtaud-Dev/velar/backend/internal/services/mailer"
	wgsvc "github.com/AlexArtaud-Dev/velar/backend/internal/services/wireguard"
	"github.com/robfig/cron/v3"
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
		mailer.Send(
			fmt.Sprintf("Client expired: %s", cl.Name),
			fmt.Sprintf("The WireGuard client \"%s\" (IP: %s, interface: %s) has expired and has been automatically disabled.\n\nYou can re-enable or delete it from the Velar dashboard.", cl.Name, cl.AssignedIP, cl.Interface.Name),
		)
	}
}

func notifyExpiringSoon() {
	in24h := time.Now().Add(24 * time.Hour)
	var expiring []models.Client
	database.DB.Preload("Interface").
		Where("expires_at IS NOT NULL AND expires_at > ? AND expires_at < ? AND enabled = true", time.Now(), in24h).
		Find(&expiring)

	for _, cl := range expiring {
		mailer.Send(
			fmt.Sprintf("Client expiring soon: %s", cl.Name),
			fmt.Sprintf("The WireGuard client \"%s\" (IP: %s, interface: %s) will expire on %s.\n\nExtend its expiry or delete it from the Velar dashboard.", cl.Name, cl.AssignedIP, cl.Interface.Name, cl.ExpiresAt.Format("2006-01-02 15:04 UTC")),
		)
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
	if changed {
		slog.Info("public IP updated", "ip", newIP)
	}
}
