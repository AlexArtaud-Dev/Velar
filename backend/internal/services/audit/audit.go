// Package audit provides a lightweight helper for recording admin mutations.
// It writes a single row to the audit_logs table and never panics — failures
// are logged but do not block the caller.
package audit

import (
	"log/slog"

	"github.com/AlexArtaud-Dev/velar/backend/internal/database"
	"github.com/AlexArtaud-Dev/velar/backend/internal/models"
)

// Log writes one audit entry. adminID may be 0 for system-initiated actions.
// action should follow the "<target>.<verb>" convention, e.g. "client.create".
func Log(adminID uint, action, targetType string, targetID uint, targetName, detail string) {
	entry := models.AuditLog{
		AdminID:    adminID,
		Action:     action,
		TargetType: targetType,
		TargetID:   targetID,
		TargetName: targetName,
		Detail:     detail,
	}
	if err := database.DB.Create(&entry).Error; err != nil {
		slog.Warn("audit: failed to write log", "action", action, "err", err)
	}
}
