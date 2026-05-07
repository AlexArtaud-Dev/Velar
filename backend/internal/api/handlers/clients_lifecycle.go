package handlers

import (
	"fmt"
	"log/slog"
	"net/http"
	"strconv"

	"github.com/AlexArtaud-Dev/velar/backend/internal/auth"
	"github.com/AlexArtaud-Dev/velar/backend/internal/config"
	"github.com/AlexArtaud-Dev/velar/backend/internal/database"
	"github.com/AlexArtaud-Dev/velar/backend/internal/models"
	bwsvc "github.com/AlexArtaud-Dev/velar/backend/internal/services/bandwidth"
	"github.com/AlexArtaud-Dev/velar/backend/internal/services/mailer"
	"github.com/gin-gonic/gin"
)

// Enable re-adds the peer to WireGuard and marks the client as enabled in the DB.
func (h *ClientHandler) Enable(c *gin.Context) {
	h.setEnabled(c, true)
}

// Disable removes the peer from WireGuard and marks the client as disabled in the DB.
func (h *ClientHandler) Disable(c *gin.Context) {
	h.setEnabled(c, false)
}

// setEnabled is the shared implementation for Enable and Disable.
// When enabling: the peer is re-added to wg and bandwidth limits are reapplied.
// When disabling: the peer is removed from wg and tc rules are cleaned up.
func (h *ClientHandler) setEnabled(c *gin.Context, enabled bool) {
	id, _ := strconv.ParseUint(c.Param("id"), 10, 64)
	var client models.Client
	if err := database.DB.Preload("Interface").First(&client, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}

	if enabled {
		psk, _ := auth.Decrypt(client.PresharedKey, config.C.AppSecret)
		h.wg.AddPeer(client.Interface.Name, client.PublicKey, psk, client.AssignedIP+"/32") //nolint:errcheck
		if !config.C.WGMock {
			if client.BandwidthLimitDown > 0 || client.BandwidthLimitUp > 0 {
				if err := bwsvc.Apply(client.Interface.Name, client.AssignedIP, client.BandwidthLimitDown, client.BandwidthLimitUp); err != nil {
					slog.Warn("enable client: apply bandwidth limit", "client", client.Name, "err", err)
				}
			}
			if client.DataQuotaBytes > 0 {
				if err := h.nft.Apply(client.AssignedIP, quotaRemaining(client)); err != nil {
					slog.Warn("enable client: apply nft quota", "client", client.Name, "err", err)
				}
			}
		}
	} else {
		h.wg.RemovePeer(client.Interface.Name, client.PublicKey) //nolint:errcheck
		if !config.C.WGMock {
			bwsvc.Remove(client.Interface.Name, client.AssignedIP) //nolint:errcheck
			if client.DataQuotaBytes > 0 {
				h.nft.Remove(client.AssignedIP) //nolint:errcheck
			}
		}
	}

	database.DB.Model(&client).Update("enabled", enabled)
	h.syncConf(client.Interface)

	action := "client.disable"
	if enabled {
		action = "client.enable"
	}
	auditLog(c, action, "client", client.ID, client.Name,
		fmt.Sprintf("interface=%s ip=%s email=%s owner=%s",
			client.Interface.Name, client.AssignedIP, client.Email, client.OwnerLabel))

	// Notify the client of the status change.
	if enabled {
		mailer.SendHTMLTo(
			client.Email,
			fmt.Sprintf("VPN access re-enabled: %s", client.Name),
			mailer.HTMLClientEnabled(client.Name, client.AssignedIP),
		)
	} else {
		mailer.SendHTMLTo(
			client.Email,
			fmt.Sprintf("VPN access disabled: %s", client.Name),
			mailer.HTMLClientDisabled(client.Name, client.AssignedIP),
		)
	}

	c.JSON(http.StatusOK, gin.H{"enabled": enabled})
}
