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

// GetQuotaUsage returns the client's data usage for the current quota period.
// The calculation mirrors the quota job exactly: it sums PeerSnapshot bytes
// from the effective period start (natural calendar start or manual reset,
// whichever is more recent). This gives the frontend a single accurate number
// to display without relying on the snapshot chart range.
func (h *ClientHandler) GetQuotaUsage(c *gin.Context) {
	id, _ := strconv.ParseUint(c.Param("id"), 10, 64)
	var client models.Client
	if err := database.DB.First(&client, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}

	periodStart := quotaUsagePeriodStart(client.QuotaPeriod)
	if client.QuotaResetAt != nil && client.QuotaResetAt.After(periodStart) {
		periodStart = *client.QuotaResetAt
	}

	var result struct{ Total int64 }
	q := database.DB.Model(&models.PeerSnapshot{}).
		Select("COALESCE(SUM(bytes_rx + bytes_tx), 0) as total").
		Where("client_id = ?", client.ID)
	if !periodStart.IsZero() {
		q = q.Where("timestamp >= ?", periodStart)
	}
	q.Scan(&result)

	c.JSON(http.StatusOK, gin.H{
		"used":         result.Total,
		"quota":        client.DataQuotaBytes,
		"period":       client.QuotaPeriod,
		"period_start": periodStart,
	})
}

// quotaUsagePeriodStart returns the natural calendar start of the current
// quota period. Identical to jobs.quotaPeriodStart but local to avoid an
// import cycle between the handlers and jobs packages.
func quotaUsagePeriodStart(period string) time.Time {
	now := time.Now()
	switch period {
	case "weekly":
		weekday := int(now.Weekday())
		if weekday == 0 {
			weekday = 7
		}
		start := now.AddDate(0, 0, -(weekday - 1))
		return time.Date(start.Year(), start.Month(), start.Day(), 0, 0, 0, 0, now.Location())
	case "total":
		return time.Time{}
	default: // monthly
		return time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, now.Location())
	}
}

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
