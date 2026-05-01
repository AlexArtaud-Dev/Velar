package handlers

import (
	"net/http"
	"strconv"
	"time"

	"github.com/AlexArtaud-Dev/velar/backend/internal/database"
	"github.com/AlexArtaud-Dev/velar/backend/internal/models"
	"github.com/gin-gonic/gin"
)

// GetSnapshots returns per-client bandwidth history bucketed by time.
// Accepts ?range=1h | 24h (default) | 7d.
func (h *ClientHandler) GetSnapshots(c *gin.Context) {
	id, _ := strconv.ParseUint(c.Param("id"), 10, 64)
	since, bucketDur := parseRangeClient(c.DefaultQuery("range", "24h"))

	var snapshots []models.PeerSnapshot
	database.DB.
		Where("client_id = ? AND timestamp > ?", id, time.Now().Add(-since)).
		Order("timestamp ASC").
		Find(&snapshots)

	c.JSON(http.StatusOK, bucketSnapshots(snapshots, bucketDur))
}

// GetEvents returns the connection event history for a single client,
// ordered newest-first, capped at 100 records.
func (h *ClientHandler) GetEvents(c *gin.Context) {
	id, _ := strconv.ParseUint(c.Param("id"), 10, 64)

	var events []models.ConnectionEvent
	database.DB.
		Where("client_id = ?", id).
		Order("timestamp DESC").
		Limit(100).
		Find(&events)

	c.JSON(http.StatusOK, events)
}
