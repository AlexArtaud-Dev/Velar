package jobs

import (
	"fmt"
	"log/slog"
	"math"
	"time"

	"github.com/AlexArtaud-Dev/velar/backend/internal/database"
	"github.com/AlexArtaud-Dev/velar/backend/internal/models"
	"github.com/AlexArtaud-Dev/velar/backend/internal/services/mailer"
	wgsvc "github.com/AlexArtaud-Dev/velar/backend/internal/services/wireguard"
)

// checkQuotas runs every 15 seconds and enforces per-client data quotas.
// At 80% usage it sends a single warning email per period.
// At 100% it removes the peer from WireGuard and disables the client in the DB.
func checkQuotas(wg wgsvc.Service) {
	var clients []models.Client
	if err := database.DB.Preload("Interface").
		Where("enabled = true AND data_quota_bytes > 0").
		Find(&clients).Error; err != nil {
		return
	}

	for _, cl := range clients {
		periodStart := quotaPeriodStart(cl.QuotaPeriod)
		// A manual reset overrides the natural period start when it is more recent.
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
		used := result.Total

		usedStr := formatQuotaBytes(used)
		quotaStr := formatQuotaBytes(cl.DataQuotaBytes)

		// Over quota — remove peer and disable the client.
		if used >= cl.DataQuotaBytes {
			if err := wg.RemovePeer(cl.Interface.Name, cl.PublicKey); err != nil {
				slog.Error("checkQuotas: remove peer", "client", cl.Name, "err", err)
			}
			database.DB.Model(&cl).Update("enabled", false)
			slog.Info("client suspended: quota exceeded",
				"client", cl.Name, "used", used, "quota", cl.DataQuotaBytes)

			mailer.SendHTML(
				fmt.Sprintf("Data quota exceeded: %s", cl.Name),
				mailer.HTMLAdminQuotaExceeded(cl.Name, cl.AssignedIP, cl.Interface.Name, usedStr, quotaStr, cl.QuotaPeriod),
			)
			if cl.Email != "" {
				mailer.SendHTMLTo(cl.Email,
					fmt.Sprintf("VPN access suspended: data quota exceeded — %s", cl.Name),
					mailer.HTMLClientQuotaExceeded(cl.Name, cl.AssignedIP, usedStr, quotaStr, cl.QuotaPeriod),
				)
			}
			continue
		}

		// 80% warning — send at most once per period.
		threshold := int64(math.Round(float64(cl.DataQuotaBytes) * 0.8))
		if used >= threshold {
			alreadyWarned := cl.QuotaWarnedAt != nil &&
				(periodStart.IsZero() || cl.QuotaWarnedAt.After(periodStart))
			if !alreadyWarned {
				now := time.Now()
				database.DB.Model(&cl).Update("quota_warned_at", &now)
				slog.Info("client quota warning sent",
					"client", cl.Name, "used", used, "quota", cl.DataQuotaBytes)

				mailer.SendHTML(
					fmt.Sprintf("Data quota warning (80%%): %s", cl.Name),
					mailer.HTMLAdminQuotaWarning(cl.Name, cl.AssignedIP, cl.Interface.Name, usedStr, quotaStr, cl.QuotaPeriod),
				)
				if cl.Email != "" {
					mailer.SendHTMLTo(cl.Email,
						fmt.Sprintf("VPN data quota warning — %s", cl.Name),
						mailer.HTMLClientQuotaWarning(cl.Name, cl.AssignedIP, usedStr, quotaStr, cl.QuotaPeriod),
					)
				}
			}
		}
	}
}

// quotaPeriodStart returns the beginning of the current quota period for the
// given period string. "total" returns a zero time (no lower bound — all
// snapshots are summed regardless of age).
func quotaPeriodStart(period string) time.Time {
	now := time.Now()
	switch period {
	case "weekly":
		weekday := int(now.Weekday())
		if weekday == 0 {
			weekday = 7 // treat Sunday as day 7 so Monday is always day 1
		}
		start := now.AddDate(0, 0, -(weekday - 1))
		return time.Date(start.Year(), start.Month(), start.Day(), 0, 0, 0, 0, now.Location())
	case "total":
		return time.Time{}
	default: // monthly
		return time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, now.Location())
	}
}

// formatQuotaBytes formats a byte count as a human-readable string for use in
// email bodies (e.g. "1.5 GB").
func formatQuotaBytes(b int64) string {
	const unit = 1024
	if b < unit {
		return fmt.Sprintf("%d B", b)
	}
	div, exp := int64(unit), 0
	for n := b / unit; n >= unit; n /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f %cB", float64(b)/float64(div), "KMGTPE"[exp])
}
