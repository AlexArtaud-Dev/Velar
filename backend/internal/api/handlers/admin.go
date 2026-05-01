package handlers

import (
	"fmt"
	"log/slog"
	"net/http"

	"github.com/AlexArtaud-Dev/velar/backend/internal/auth"
	"github.com/AlexArtaud-Dev/velar/backend/internal/config"
	"github.com/AlexArtaud-Dev/velar/backend/internal/database"
	"github.com/AlexArtaud-Dev/velar/backend/internal/models"
	bwsvc "github.com/AlexArtaud-Dev/velar/backend/internal/services/bandwidth"
	wgsvc "github.com/AlexArtaud-Dev/velar/backend/internal/services/wireguard"
	"github.com/gin-gonic/gin"
)

type AdminHandler struct {
	wg wgsvc.Service
}

func NewAdminHandler(wg wgsvc.Service) *AdminHandler {
	return &AdminHandler{wg: wg}
}

type ifaceSyncReport struct {
	Interface    string   `json:"interface"`
	PeersRemoved int      `json:"peers_removed"`
	PeersAdded   int      `json:"peers_added"`
	ConfSynced   bool     `json:"conf_synced"`
	Errors       []string `json:"errors,omitempty"`
}

// SyncState reconciles the running WireGuard state against the database for
// every interface. It removes stale peers (in wg but not in DB), re-adds
// missing peers (in DB but not in wg), rewrites every conf file from the DB,
// and reapplies bandwidth limits. Safe to call at any time — it is idempotent.
func (h *AdminHandler) SyncState(c *gin.Context) {
	var ifaces []models.Interface
	database.DB.Find(&ifaces)

	reports := make([]ifaceSyncReport, 0, len(ifaces))

	for _, iface := range ifaces {
		report := ifaceSyncReport{Interface: iface.Name}

		// ── 1. Gather live wg peers (skip gracefully if interface is DOWN) ───
		liveStats, err := h.wg.GetStats(iface.Name)
		ifaceUp := err == nil
		if !ifaceUp {
			slog.Info("sync: interface is down, skipping peer reconciliation — will rewrite conf only", "iface", iface.Name)
		}
		livePeers := make(map[string]bool, len(liveStats))
		for _, s := range liveStats {
			livePeers[s.PublicKey] = true
		}

		// ── 2. Gather DB enabled clients ─────────────────────────────────────
		var clients []models.Client
		database.DB.Where("interface_id = ? AND enabled = true", iface.ID).Find(&clients)
		dbPeers := make(map[string]models.Client, len(clients))
		for _, cl := range clients {
			dbPeers[cl.PublicKey] = cl
		}

		// ── 3 & 4. Peer reconciliation — only when interface is UP ────────────
		if ifaceUp {
			// Remove peers in wg but absent from DB
			for pubKey := range livePeers {
				if _, inDB := dbPeers[pubKey]; !inDB {
					if err := h.wg.RemovePeer(iface.Name, pubKey); err != nil {
						msg := fmt.Sprintf("remove stale peer %s: %v", pubKey[:8], err)
						slog.Warn("sync: "+msg, "iface", iface.Name)
						report.Errors = append(report.Errors, msg)
					} else {
						report.PeersRemoved++
						slog.Info("sync: removed stale peer", "iface", iface.Name, "pubkey", pubKey[:8])
					}
				}
			}
			// Re-add DB peers missing from wg
			for pubKey, cl := range dbPeers {
				if !livePeers[pubKey] {
					psk, _ := auth.Decrypt(cl.PresharedKey, config.C.AppSecret)
					if err := h.wg.AddPeer(iface.Name, pubKey, psk, cl.AssignedIP+"/32"); err != nil {
						msg := fmt.Sprintf("re-add missing peer %s: %v", cl.Name, err)
						slog.Warn("sync: "+msg, "iface", iface.Name)
						report.Errors = append(report.Errors, msg)
					} else {
						report.PeersAdded++
						slog.Info("sync: re-added missing peer", "iface", iface.Name, "client", cl.Name)
					}
				}
			}
		}

		// ── 5. Rebuild conf file + wg syncconf ───────────────────────────────
		privKey, err := auth.Decrypt(iface.PrivateKey, config.C.AppSecret)
		if err != nil {
			msg := fmt.Sprintf("decrypt iface key: %v", err)
			slog.Error("sync: "+msg, "iface", iface.Name)
			report.Errors = append(report.Errors, msg)
			reports = append(reports, report)
			continue
		}

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
			msg := fmt.Sprintf("ensure interface: %v", err)
			slog.Error("sync: "+msg, "iface", iface.Name)
			report.Errors = append(report.Errors, msg)
		} else {
			// Only call wg syncconf if the interface is actually up in the kernel
			if ifaceUp {
				path := fmt.Sprintf("%s/%s.conf", config.C.WGConfigDir, iface.Name)
				if err := h.wg.SyncConf(iface.Name, path); err != nil {
					msg := fmt.Sprintf("syncconf: %v", err)
					slog.Error("sync: "+msg, "iface", iface.Name)
					report.Errors = append(report.Errors, msg)
				} else {
					report.ConfSynced = true
				}
			} else {
				// Conf file rewritten — will be applied on next wg-quick up
				report.ConfSynced = true
			}
		}

		// ── 6. Reapply bandwidth limits ──────────────────────────────────────
		if !config.C.WGMock {
			for _, cl := range clients {
				if cl.BandwidthLimitDown > 0 || cl.BandwidthLimitUp > 0 {
					if err := bwsvc.Apply(iface.Name, cl.AssignedIP, cl.BandwidthLimitDown, cl.BandwidthLimitUp); err != nil {
						slog.Warn("sync: reapply bandwidth", "iface", iface.Name, "client", cl.Name, "err", err)
					}
				}
			}
		}

		slog.Info("sync complete", "iface", iface.Name,
			"removed", report.PeersRemoved, "added", report.PeersAdded, "conf_synced", report.ConfSynced)
		reports = append(reports, report)
	}

	totalRemoved, totalAdded := 0, 0
	for _, r := range reports {
		totalRemoved += r.PeersRemoved
		totalAdded += r.PeersAdded
	}

	c.JSON(http.StatusOK, gin.H{
		"interfaces_synced": len(reports),
		"peers_removed":     totalRemoved,
		"peers_added":       totalAdded,
		"report":            reports,
	})
}
