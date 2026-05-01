package jobs

import (
	"fmt"
	"log/slog"
	"net"
	"strings"

	"github.com/AlexArtaud-Dev/velar/backend/internal/config"
	"github.com/AlexArtaud-Dev/velar/backend/internal/database"
	"github.com/AlexArtaud-Dev/velar/backend/internal/models"
	"github.com/AlexArtaud-Dev/velar/backend/internal/services/ddns"
	"github.com/AlexArtaud-Dev/velar/backend/internal/services/mailer"
	tokensvc "github.com/AlexArtaud-Dev/velar/backend/internal/services/token"
)

// refreshDDNS polls the current public IP. When it has changed it updates the
// in-memory WGHost value, notifies the admin, and emails every enabled client
// that has an address so they can re-import their config with the new endpoint.
//
// If WG_HOST is a domain name rather than a raw IP address, the DDNS record
// update is assumed to be sufficient and client configs are left unchanged.
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
	// raw IP address. If it is a domain name the DDNS record update is enough
	// and client configs (which use the domain) keep working without changes.
	if net.ParseIP(oldHost) == nil {
		slog.Info("WG_HOST is a domain — skipping client notification", "host", oldHost)
		return
	}

	if oldHost == newIP {
		return
	}

	// Update the in-memory endpoint so newly generated configs use the new IP.
	config.C.WGHost = newIP

	mailer.SendHTML(
		fmt.Sprintf("Public IP changed: %s → %s", oldHost, newIP),
		mailer.HTMLAdminIPChanged(oldHost, newIP),
	)

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

// jobsBuildDownloadURL mirrors the equivalent helper in the handlers package.
// The jobs package cannot import handlers (import cycle), so we duplicate the
// tiny URL-building logic here.
func jobsBuildDownloadURL(rawToken string) string {
	if base := config.C.AppURL; base != "" {
		return strings.TrimRight(base, "/") + "/dl/" + rawToken
	}
	return "/dl/" + rawToken
}
