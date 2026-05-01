// Package handlers contains the HTTP request handlers for the Velar API.
// Each sub-domain (clients, interfaces, auth, settings…) lives in its own file.
package handlers

import (
	"fmt"
	"log/slog"
	"strings"

	"github.com/AlexArtaud-Dev/velar/backend/internal/auth"
	"github.com/AlexArtaud-Dev/velar/backend/internal/config"
	"github.com/AlexArtaud-Dev/velar/backend/internal/database"
	"github.com/AlexArtaud-Dev/velar/backend/internal/models"
	nftquota "github.com/AlexArtaud-Dev/velar/backend/internal/services/nftquota"
	wgsvc "github.com/AlexArtaud-Dev/velar/backend/internal/services/wireguard"
)

// ClientHandler handles all /clients API routes.
// It holds references to the WireGuard and nftables-quota services so that
// peer and quota changes are applied immediately without waiting for jobs.
type ClientHandler struct {
	wg  wgsvc.Service
	nft nftquota.Service
}

// NewClientHandler creates a ClientHandler backed by the given services.
func NewClientHandler(wg wgsvc.Service, nft nftquota.Service) *ClientHandler {
	return &ClientHandler{wg: wg, nft: nft}
}

// buildDownloadURL constructs a full one-time download URL from a raw token.
// When APP_URL is set the result is an absolute URL; otherwise it falls back
// to a root-relative path (/dl/<token>).
func buildDownloadURL(rawToken string) string {
	if base := config.C.AppURL; base != "" {
		return strings.TrimRight(base, "/") + "/dl/" + rawToken
	}
	return "/dl/" + rawToken
}

// syncConf rebuilds the WireGuard .conf for the given interface from the current
// DB state (enabled peers only) and applies it live with wg syncconf.
func (h *ClientHandler) syncConf(iface models.Interface) {
	privKey, err := auth.Decrypt(iface.PrivateKey, config.C.AppSecret)
	if err != nil {
		slog.Error("syncConf: decrypt interface private key", "iface", iface.Name, "err", err)
		return
	}

	var clients []models.Client
	database.DB.Where("interface_id = ? AND enabled = true", iface.ID).Find(&clients)

	peers := make([]wgsvc.PeerEntry, 0, len(clients))
	for _, cl := range clients {
		psk, _ := auth.Decrypt(cl.PresharedKey, config.C.AppSecret)
		peers = append(peers, wgsvc.PeerEntry{
			Comment:    cl.Name,
			PublicKey:  cl.PublicKey,
			PSK:        psk,
			AllowedIPs: cl.AssignedIP + "/32",
		})
	}

	if err := h.wg.EnsureInterface(iface.Name, iface.Port, privKey, iface.Subnet, iface.PostUp, iface.PostDown, peers); err != nil {
		slog.Error("syncConf: write interface config", "iface", iface.Name, "err", err)
		return
	}

	path := fmt.Sprintf("%s/%s.conf", config.C.WGConfigDir, iface.Name)
	if err := h.wg.SyncConf(iface.Name, path); err != nil {
		slog.Error("syncConf: apply syncconf", "iface", iface.Name, "err", err)
	}
}
