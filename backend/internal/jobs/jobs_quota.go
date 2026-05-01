package jobs

import (
	"fmt"
	"log/slog"
	"math"
	"strings"
	"time"

	"github.com/AlexArtaud-Dev/velar/backend/internal/config"
	"github.com/AlexArtaud-Dev/velar/backend/internal/database"
	"github.com/AlexArtaud-Dev/velar/backend/internal/models"
	"github.com/AlexArtaud-Dev/velar/backend/internal/services/mailer"
	nftquota "github.com/AlexArtaud-Dev/velar/backend/internal/services/nftquota"
	wgsvc "github.com/AlexArtaud-Dev/velar/backend/internal/services/wireguard"
)

// portalURL returns the public portal URL for a client, or empty string when
// the client has no view token yet (pre-v0.9 backfill hasn't run).
func portalURL(cl models.Client) string {
	if cl.ViewToken == "" {
		return ""
	}
	if base := config.C.AppURL; base != "" {
		return strings.TrimRight(base, "/") + "/portal/" + cl.ViewToken
	}
	return ""
}

// peerLive holds the live cumulative WireGuard byte counters for a single peer.
type peerLive struct{ rx, tx int64 }

// checkQuotas runs every 15 seconds and enforces per-client data quotas.
//
// With nftables enforcement the kernel drops packets the instant the budget is
// exhausted — no overshoot. This job's role is therefore:
//
//  1. Detect period rollovers and reset nftables counters to the full quota.
//  2. Detect when nftables reports a quota as exceeded, update the DB flag, and
//     send alert emails (the peer is removed from WireGuard for clean state).
//  3. Send a single 80 % warning email per period (still DB-based — accurate
//     historical count independent of the nftables counter).
func checkQuotas(wg wgsvc.Service, nft nftquota.Service) {
	var clients []models.Client
	if err := database.DB.Preload("Interface").
		Where("enabled = true AND data_quota_bytes > 0").
		Find(&clients).Error; err != nil {
		return
	}

	// Pre-load live WireGuard stats per interface — one GetStats call per
	// interface rather than one per client.
	ifaceLive := make(map[string]map[string]peerLive) // iface → pubkey → bytes
	seenIfaces := make(map[string]bool)
	for _, cl := range clients {
		seenIfaces[cl.Interface.Name] = true
	}
	for ifaceName := range seenIfaces {
		stats, err := wg.GetStats(ifaceName)
		if err != nil {
			continue
		}
		m := make(map[string]peerLive, len(stats))
		for _, s := range stats {
			m[s.PublicKey] = peerLive{rx: s.BytesRx, tx: s.BytesTx}
		}
		ifaceLive[ifaceName] = m
	}

	for _, cl := range clients {
		periodStart := quotaPeriodStart(cl.QuotaPeriod)
		// A manual reset overrides the natural period start when it is more recent.
		if cl.QuotaResetAt != nil && cl.QuotaResetAt.After(periodStart) {
			periodStart = *cl.QuotaResetAt
		}

		// ── Period rollover detection ─────────────────────────────────────────
		// When the natural period boundary just passed (within the last 30 s),
		// reset the nftables counter so the client gets a fresh full budget.
		// Only relevant for monthly/weekly periods; "total" has no rollover.
		if cl.QuotaPeriod != "total" && !periodStart.IsZero() && time.Since(periodStart) < 30*time.Second {
			if err := nft.Reset(cl.AssignedIP, cl.DataQuotaBytes); err != nil {
				slog.Warn("checkQuotas: period rollover nft reset", "client", cl.Name, "err", err)
			}
			// Clear the warned flag for the new period.
			database.DB.Model(&cl).Update("quota_warned_at", nil)
			slog.Info("quota period rolled over", "client", cl.Name, "period", cl.QuotaPeriod)
		}

		// ── Enforcement ───────────────────────────────────────────────────────
		// Primary: nftables drops packets instantly at kernel level; we just
		// detect the exceeded state and update DB + send emails.
		// Fallback: if nft is unavailable or the rule is missing, compare DB
		// usage directly (old behaviour — up to ~15 s overshoot).
		if !cl.QuotaSuspended {
			used := dbPlusLiveUsed(cl, periodStart, ifaceLive)
			_, nftExceeded, nftErr := nft.GetUsage(cl.AssignedIP)
			exceeded := (nftErr == nil && nftExceeded) || (nftErr != nil && used >= cl.DataQuotaBytes)

			if exceeded {
				usedStr := formatQuotaBytes(used)
				quotaStr := formatQuotaBytes(cl.DataQuotaBytes)

				if err := wg.RemovePeer(cl.Interface.Name, cl.PublicKey); err != nil {
					slog.Error("checkQuotas: remove peer", "client", cl.Name, "err", err)
				}
				// Clean up nftables rule — peer is gone so no traffic to drop.
				nft.Remove(cl.AssignedIP) //nolint:errcheck

				database.DB.Model(&cl).Updates(map[string]interface{}{"enabled": false, "quota_suspended": true})
				slog.Info("client suspended: quota exceeded",
					"client", cl.Name, "used", used, "quota", cl.DataQuotaBytes)

				mailer.SendHTML(
					fmt.Sprintf("Data quota exceeded: %s", cl.Name),
					mailer.HTMLAdminQuotaExceeded(cl.Name, cl.AssignedIP, cl.Interface.Name, usedStr, quotaStr, cl.QuotaPeriod),
				)
				if cl.Email != "" {
					mailer.SendHTMLTo(cl.Email,
						fmt.Sprintf("VPN access suspended: data quota exceeded — %s", cl.Name),
						mailer.HTMLClientQuotaExceeded(cl.Name, cl.AssignedIP, usedStr, quotaStr, cl.QuotaPeriod, portalURL(cl)),
					)
				}
				continue
			}
		}

		// ── 80 % warning — DB-based, sent at most once per period ────────────
		used := dbPlusLiveUsed(cl, periodStart, ifaceLive)
		threshold := int64(math.Round(float64(cl.DataQuotaBytes) * 0.8))
		if used >= threshold {
			alreadyWarned := cl.QuotaWarnedAt != nil &&
				(periodStart.IsZero() || cl.QuotaWarnedAt.After(periodStart))
			if !alreadyWarned {
				usedStr := formatQuotaBytes(used)
				quotaStr := formatQuotaBytes(cl.DataQuotaBytes)
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
						mailer.HTMLClientQuotaWarning(cl.Name, cl.AssignedIP, usedStr, quotaStr, cl.QuotaPeriod, portalURL(cl)),
					)
				}
			}
		}
	}
}

// dbPlusLiveUsed computes bytes used in the current period from DB snapshots
// plus the unsnapshotted live WG delta. Mirrors the quota-usage endpoint logic.
func dbPlusLiveUsed(cl models.Client, periodStart time.Time, ifaceLive map[string]map[string]peerLive) int64 {
	var result struct{ Total int64 }
	q := database.DB.Model(&models.PeerSnapshot{}).
		Select("COALESCE(SUM(bytes_rx + bytes_tx), 0) as total").
		Where("client_id = ?", cl.ID)
	if !periodStart.IsZero() {
		q = q.Where("timestamp >= ?", periodStart)
	}
	q.Scan(&result)
	used := result.Total

	if ifaceStats, ok := ifaceLive[cl.Interface.Name]; ok {
		if live, ok := ifaceStats[cl.PublicKey]; ok {
			prevRx, prevTx, baselineSet := GetLastSnapshotBaseline(cl.ID)
			if baselineSet {
				var deltaRx, deltaTx int64
				if live.rx >= prevRx {
					deltaRx = live.rx - prevRx
				} else {
					deltaRx = live.rx
				}
				if live.tx >= prevTx {
					deltaTx = live.tx - prevTx
				} else {
					deltaTx = live.tx
				}
				used += deltaRx + deltaTx
			}
		}
	}
	return used
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
