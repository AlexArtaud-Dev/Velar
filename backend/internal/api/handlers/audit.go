package handlers

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/AlexArtaud-Dev/velar/backend/internal/database"
	"github.com/AlexArtaud-Dev/velar/backend/internal/models"
	"github.com/AlexArtaud-Dev/velar/backend/internal/services/audit"
	"github.com/gin-gonic/gin"
)

// adminIDFromCtx extracts the admin ID set by the JWT middleware.
// Returns 0 if not present (e.g. system calls).
func adminIDFromCtx(c *gin.Context) uint {
	if v, ok := c.Get("admin_id"); ok {
		if id, ok := v.(uint); ok {
			return id
		}
	}
	return 0
}

// auditLog is a convenience wrapper around audit.Log that picks up the admin
// ID from the Gin context automatically.
func auditLog(c *gin.Context, action, targetType string, targetID uint, targetName, detail string) {
	audit.Log(adminIDFromCtx(c), action, targetType, targetID, targetName, detail)
}

// ListAuditLogs returns a paginated list of audit log entries, newest first.
// Query params:
//   - page   (default 1)
//   - limit  (default 50, max 200)
//   - action — prefix filter, e.g. "client." matches all client.* actions
//   - search — free-text filter across action, target_name, and detail
func ListAuditLogs(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	if page < 1 {
		page = 1
	}
	if limit < 1 || limit > 200 {
		limit = 50
	}
	offset := (page - 1) * limit

	action := c.Query("action")
	search := strings.TrimSpace(c.Query("search"))

	q := database.DB.Model(&models.AuditLog{}).Order("created_at DESC")

	// Prefix match: "client." → all client.* actions; exact match otherwise.
	if action != "" {
		if strings.HasSuffix(action, ".") {
			q = q.Where("action LIKE ?", action+"%")
		} else {
			q = q.Where("action LIKE ?", action+"%")
		}
	}

	// Free-text search across the three most useful columns.
	if search != "" {
		like := "%" + search + "%"
		q = q.Where(
			"action LIKE ? OR target_name LIKE ? OR detail LIKE ?",
			like, like, like,
		)
	}

	var total int64
	q.Count(&total)

	var logs []models.AuditLog
	q.Offset(offset).Limit(limit).Find(&logs)

	c.JSON(http.StatusOK, gin.H{
		"total": total,
		"page":  page,
		"limit": limit,
		"items": logs,
	})
}
