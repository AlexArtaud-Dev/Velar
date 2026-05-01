package handlers

import (
	"net/http"
	"time"

	"github.com/AlexArtaud-Dev/velar/backend/internal/database"
	"github.com/AlexArtaud-Dev/velar/backend/internal/models"
	"github.com/gin-gonic/gin"
)

// portalResponse is the sanitised, read-only view of a client exposed to the
// public portal page. It intentionally omits all cryptographic material,
// email addresses, and internal IDs.
type portalResponse struct {
	Name               string     `json:"name"`
	OwnerLabel         string     `json:"owner_label"`
	Status             string     `json:"status"` // connected | active | suspended | disabled | expired
	AssignedIP         string     `json:"assigned_ip"`
	InterfaceName      string     `json:"interface_name"`
	LastHandshake      *time.Time `json:"last_handshake"`
	BytesRx            int64      `json:"bytes_rx"`
	BytesTx            int64      `json:"bytes_tx"`
	BandwidthLimitDown int        `json:"bandwidth_limit_down"` // Mbps, 0 = unlimited
	BandwidthLimitUp   int        `json:"bandwidth_limit_up"`   // Mbps, 0 = unlimited
	DataQuotaBytes     int64      `json:"data_quota_bytes"`     // 0 = unlimited
	QuotaUsed          int64      `json:"quota_used"`
	QuotaPeriod        string     `json:"quota_period"`
	QuotaSuspended     bool       `json:"quota_suspended"`
	ExpiresAt          *time.Time `json:"expires_at"`
	CreatedAt          time.Time  `json:"created_at"`
}

// GetClientPortal is an unauthenticated endpoint that returns a sanitised
// read-only view of a client identified by its view token.
// Route: GET /public/client/:token  (no JWT middleware)
func GetClientPortal(c *gin.Context) {
	token := c.Param("token")
	if token == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "missing token"})
		return
	}

	var client models.Client
	if err := database.DB.Preload("Interface").
		Where("view_token = ?", token).
		First(&client).Error; err != nil {
		// Return 404 — don't leak whether the token is invalid vs. client deleted.
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}

	// Compute quota used for the current period (same logic as GetQuotaUsage).
	quotaUsed := quotaUsedForPortal(client)

	c.JSON(http.StatusOK, portalResponse{
		Name:               client.Name,
		OwnerLabel:         client.OwnerLabel,
		Status:             clientStatus(client),
		AssignedIP:         client.AssignedIP,
		InterfaceName:      client.Interface.Name,
		LastHandshake:      client.LastHandshake,
		BytesRx:            client.BytesRx,
		BytesTx:            client.BytesTx,
		BandwidthLimitDown: client.BandwidthLimitDown,
		BandwidthLimitUp:   client.BandwidthLimitUp,
		DataQuotaBytes:     client.DataQuotaBytes,
		QuotaUsed:          quotaUsed,
		QuotaPeriod:        client.QuotaPeriod,
		QuotaSuspended:     client.QuotaSuspended,
		ExpiresAt:          client.ExpiresAt,
		CreatedAt:          client.CreatedAt,
	})
}

// clientStatus derives a human-readable status string from the client record.
func clientStatus(cl models.Client) string {
	if cl.ExpiresAt != nil && time.Now().After(*cl.ExpiresAt) {
		return "expired"
	}
	if cl.QuotaSuspended {
		return "suspended"
	}
	if !cl.Enabled {
		return "disabled"
	}
	// Consider connected if last handshake was within the last 3 minutes.
	if cl.LastHandshake != nil && time.Since(*cl.LastHandshake) < 3*time.Minute {
		return "connected"
	}
	return "active"
}

// quotaUsedForPortal sums PeerSnapshot bytes for the current quota period.
// Mirrors the GetQuotaUsage handler logic without the live WG delta (portal
// is read-only and doesn't need real-time accuracy to the second).
func quotaUsedForPortal(cl models.Client) int64 {
	if cl.DataQuotaBytes == 0 {
		return 0
	}
	periodStart := quotaUsagePeriodStart(cl.QuotaPeriod)
	if cl.QuotaResetAt != nil && cl.QuotaResetAt.After(periodStart) {
		periodStart = *cl.QuotaResetAt
	}

	var result struct{ Total int64 }
	q := database.DB.Model(&models.PeerSnapshot{}).
		Select("COALESCE(SUM(bytes_rx + bytes_tx), 0) as total").
		Where("client_id = ?", cl.ID)
	if !periodStart.IsZero() {
		q = q.Where("timestamp >= ?", periodStart)
	}
	q.Scan(&result)
	return result.Total
}
