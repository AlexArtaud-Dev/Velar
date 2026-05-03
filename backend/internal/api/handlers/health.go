package handlers

import (
	"net/http"
	"time"

	"github.com/AlexArtaud-Dev/velar/backend/internal/config"
	"github.com/AlexArtaud-Dev/velar/backend/internal/database"
	"github.com/AlexArtaud-Dev/velar/backend/internal/services/adguard"
	"github.com/gin-gonic/gin"
)

// appStartTime is recorded once when the binary starts.
var appStartTime = time.Now()

// HealthCheck returns a public liveness/readiness summary.
// It is intentionally unauthenticated so uptime monitors and probes
// can use it without a token.
//
// Route: GET /health  (public — no auth required)
func HealthCheck(ag *adguard.Client) gin.HandlerFunc {
	return func(c *gin.Context) {
		overall := "ok"

		// ── Database ─────────────────────────────────────────────────────────
		dbStatus := "ok"
		if sqlDB, err := database.DB.DB(); err != nil || sqlDB.Ping() != nil {
			dbStatus = "error"
			overall = "down"
		}

		// ── AdGuard ──────────────────────────────────────────────────────────
		var agCheck gin.H
		if ag == nil {
			agCheck = gin.H{"configured": false}
		} else {
			status, err := ag.GetStatus()
			if err != nil {
				agCheck = gin.H{
					"configured": true,
					"status":     "unreachable",
					"error":      err.Error(),
				}
				if overall == "ok" {
					overall = "degraded"
				}
			} else {
				agStatus := "ok"
				if !status.Running {
					agStatus = "stopped"
					if overall == "ok" {
						overall = "degraded"
					}
				}
				agCheck = gin.H{
					"configured": true,
					"status":     agStatus,
					"running":    status.Running,
					"version":    status.Version,
					"dns_port":   status.DNSPort,
				}
			}
		}

		// ── Response ─────────────────────────────────────────────────────────
		c.JSON(http.StatusOK, gin.H{
			"status":         overall,
			"version":        config.AppVersion,
			"environment":    config.C.AppEnv,
			"uptime_seconds": int64(time.Since(appStartTime).Seconds()),
			"checks": gin.H{
				"database":  gin.H{"status": dbStatus},
				"adguard":   agCheck,
				"wireguard": gin.H{"mock": config.C.WGMock},
			},
		})
	}
}
