package handlers

import (
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"github.com/AlexArtaud-Dev/velar/backend/internal/auth"
	"github.com/AlexArtaud-Dev/velar/backend/internal/config"
	"github.com/AlexArtaud-Dev/velar/backend/internal/database"
	"github.com/AlexArtaud-Dev/velar/backend/internal/models"
	bwsvc "github.com/AlexArtaud-Dev/velar/backend/internal/services/bandwidth"
	"github.com/gin-gonic/gin"
)

// QuotaReset manually resets a client's data quota usage counter and
// re-enables the client if it was suspended due to quota exhaustion.
// The reset timestamp is stored so that the quota job treats it as the new
// period start (rather than the natural calendar start).
func (h *ClientHandler) QuotaReset(c *gin.Context) {
	id, _ := strconv.ParseUint(c.Param("id"), 10, 64)
	var client models.Client
	if err := database.DB.Preload("Interface").First(&client, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}

	now := time.Now()
	updates := map[string]interface{}{
		"quota_reset_at":   &now,
		"quota_warned_at":  nil,
		"quota_suspended":  false,
	}

	// Re-enable the client if it was auto-suspended by the quota job.
	wasDisabled := client.QuotaSuspended
	if wasDisabled {
		updates["enabled"] = true
	}

	if err := database.DB.Model(&client).Updates(updates).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	if wasDisabled {
		psk, _ := auth.Decrypt(client.PresharedKey, config.C.AppSecret)
		h.wg.AddPeer(client.Interface.Name, client.PublicKey, psk, client.AssignedIP+"/32") //nolint:errcheck
		if !config.C.WGMock && (client.BandwidthLimitDown > 0 || client.BandwidthLimitUp > 0) {
			bwsvc.Apply(client.Interface.Name, client.AssignedIP, client.BandwidthLimitDown, client.BandwidthLimitUp) //nolint:errcheck
		}
		h.syncConf(client.Interface)
	}

	slog.Info("quota reset", "client", client.Name)
	c.JSON(http.StatusOK, gin.H{"message": "quota reset", "reset_at": now})
}
