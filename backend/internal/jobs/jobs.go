package jobs

import (
	"fmt"
	"log/slog"
	"net"
	"strings"
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
