package jobs

import (
	"fmt"
	"log/slog"
	"time"

	"github.com/AlexArtaud-Dev/velar/backend/internal/database"
	"github.com/AlexArtaud-Dev/velar/backend/internal/models"
	"github.com/AlexArtaud-Dev/velar/backend/internal/services/mailer"
	wgsvc "github.com/AlexArtaud-Dev/velar/backend/internal/services/wireguard"
)

// expirePeers runs every minute and disables any client whose expires_at has
// passed. The peer is removed from the live WireGuard interface and both the
// admin and the client (if they have an email) are notified.
func expirePeers(wg wgsvc.Service) {
	var expired []models.Client
	result := database.DB.
		Preload("Interface").
		Where("expires_at IS NOT NULL AND expires_at < ? AND enabled = true", time.Now()).
		Find(&expired)
	if result.Error != nil {
		slog.Error("expirePeers: query", "err", result.Error)
		return
	}

	for _, cl := range expired {
		if err := wg.RemovePeer(cl.Interface.Name, cl.PublicKey); err != nil {
			slog.Error("expirePeers: remove peer", "client", cl.Name, "err", err)
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

// notifyExpiringSoon runs every hour and sends warning emails for peers whose
// expires_at falls within the next 24 hours.
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

// cleanupTokens removes download tokens that have been used or have expired.
// A 24-hour grace period is applied before deletion to tolerate clock skew.
func cleanupTokens() {
	result := database.DB.
		Where("(used = true OR expires_at < ?) AND created_at < ?", time.Now(), time.Now().Add(-24*time.Hour)).
		Delete(&models.DownloadToken{})
	if result.RowsAffected > 0 {
		slog.Info("cleaned up download tokens", "count", result.RowsAffected)
	}
}
