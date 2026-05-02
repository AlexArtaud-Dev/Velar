package handlers

import (
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/AlexArtaud-Dev/velar/backend/internal/database"
	"github.com/AlexArtaud-Dev/velar/backend/internal/models"
	"github.com/gin-gonic/gin"
)

// metricsCache holds the last rendered Prometheus text payload and its
// expiry time. A 60-second TTL avoids hammering the DB on every scrape.
var metricsCache struct {
	sync.Mutex
	body      string
	expiresAt time.Time
}

// GetMetrics renders Prometheus-format metrics. Responses are cached for 60s.
// Route: GET /api/v1/metrics (protected by JWT)
func GetMetrics(c *gin.Context) {
	metricsCache.Lock()
	defer metricsCache.Unlock()

	if time.Now().Before(metricsCache.expiresAt) && metricsCache.body != "" {
		c.Data(http.StatusOK, "text/plain; version=0.0.4; charset=utf-8", []byte(metricsCache.body))
		return
	}

	body, err := buildMetrics()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to collect metrics"})
		return
	}

	metricsCache.body = body
	metricsCache.expiresAt = time.Now().Add(60 * time.Second)

	c.Data(http.StatusOK, "text/plain; version=0.0.4; charset=utf-8", []byte(body))
}

// buildMetrics queries the DB and renders all metrics as Prometheus text.
func buildMetrics() (string, error) {
	var interfaces []models.Interface
	if err := database.DB.Preload("Clients").Find(&interfaces).Error; err != nil {
		return "", err
	}

	var sb strings.Builder
	now := time.Now()

	// ── Interface-level metrics ────────────────────────────────────────────────

	totalInterfaces := len(interfaces)
	enabledInterfaces := 0
	for _, iface := range interfaces {
		if iface.Enabled {
			enabledInterfaces++
		}
	}

	writeLine(&sb, "# HELP velar_interfaces_total Total number of WireGuard interfaces.")
	writeLine(&sb, "# TYPE velar_interfaces_total gauge")
	writeFmt(&sb, "velar_interfaces_total %d\n", totalInterfaces)

	writeLine(&sb, "# HELP velar_interfaces_enabled_total Number of enabled WireGuard interfaces.")
	writeLine(&sb, "# TYPE velar_interfaces_enabled_total gauge")
	writeFmt(&sb, "velar_interfaces_enabled_total %d\n", enabledInterfaces)

	// ── Client aggregate metrics ───────────────────────────────────────────────

	var (
		totalClients     int
		enabledClients   int
		connectedClients int
		suspendedClients int
		totalRx          int64
		totalTx          int64
	)

	for _, iface := range interfaces {
		for _, cl := range iface.Clients {
			totalClients++
			if cl.Enabled {
				enabledClients++
			}
			if cl.QuotaSuspended {
				suspendedClients++
			}
			totalRx += cl.BytesRx
			totalTx += cl.BytesTx
			if cl.LastHandshake != nil && now.Sub(*cl.LastHandshake) < 3*time.Minute {
				connectedClients++
			}
		}
	}

	writeLine(&sb, "# HELP velar_clients_total Total number of WireGuard clients.")
	writeLine(&sb, "# TYPE velar_clients_total gauge")
	writeFmt(&sb, "velar_clients_total %d\n", totalClients)

	writeLine(&sb, "# HELP velar_clients_enabled_total Number of enabled clients.")
	writeLine(&sb, "# TYPE velar_clients_enabled_total gauge")
	writeFmt(&sb, "velar_clients_enabled_total %d\n", enabledClients)

	writeLine(&sb, "# HELP velar_clients_connected_total Clients with a handshake in the last 3 minutes.")
	writeLine(&sb, "# TYPE velar_clients_connected_total gauge")
	writeFmt(&sb, "velar_clients_connected_total %d\n", connectedClients)

	writeLine(&sb, "# HELP velar_clients_suspended_total Clients suspended due to quota exhaustion.")
	writeLine(&sb, "# TYPE velar_clients_suspended_total gauge")
	writeFmt(&sb, "velar_clients_suspended_total %d\n", suspendedClients)

	writeLine(&sb, "# HELP velar_traffic_rx_bytes_total Cumulative bytes received across all clients.")
	writeLine(&sb, "# TYPE velar_traffic_rx_bytes_total counter")
	writeFmt(&sb, "velar_traffic_rx_bytes_total %d\n", totalRx)

	writeLine(&sb, "# HELP velar_traffic_tx_bytes_total Cumulative bytes transmitted across all clients.")
	writeLine(&sb, "# TYPE velar_traffic_tx_bytes_total counter")
	writeFmt(&sb, "velar_traffic_tx_bytes_total %d\n", totalTx)

	// ── Per-client metrics ─────────────────────────────────────────────────────

	writeLine(&sb, "# HELP velar_client_bytes_rx_total Cumulative bytes received by client.")
	writeLine(&sb, "# TYPE velar_client_bytes_rx_total counter")
	for _, iface := range interfaces {
		for _, cl := range iface.Clients {
			labels := clientLabels(cl.ID, cl.Name, iface.Name)
			writeFmt(&sb, "velar_client_bytes_rx_total{%s} %d\n", labels, cl.BytesRx)
		}
	}

	writeLine(&sb, "# HELP velar_client_bytes_tx_total Cumulative bytes transmitted by client.")
	writeLine(&sb, "# TYPE velar_client_bytes_tx_total counter")
	for _, iface := range interfaces {
		for _, cl := range iface.Clients {
			labels := clientLabels(cl.ID, cl.Name, iface.Name)
			writeFmt(&sb, "velar_client_bytes_tx_total{%s} %d\n", labels, cl.BytesTx)
		}
	}

	writeLine(&sb, "# HELP velar_client_handshake_age_seconds Seconds since the last WireGuard handshake (-1 = never).")
	writeLine(&sb, "# TYPE velar_client_handshake_age_seconds gauge")
	for _, iface := range interfaces {
		for _, cl := range iface.Clients {
			labels := clientLabels(cl.ID, cl.Name, iface.Name)
			age := -1.0
			if cl.LastHandshake != nil && cl.LastHandshake.Year() >= 2020 {
				age = now.Sub(*cl.LastHandshake).Seconds()
			}
			writeFmt(&sb, "velar_client_handshake_age_seconds{%s} %.0f\n", labels, age)
		}
	}

	writeLine(&sb, "# HELP velar_client_quota_limit_bytes Data quota limit in bytes (0 = unlimited).")
	writeLine(&sb, "# TYPE velar_client_quota_limit_bytes gauge")
	for _, iface := range interfaces {
		for _, cl := range iface.Clients {
			labels := clientLabels(cl.ID, cl.Name, iface.Name)
			writeFmt(&sb, "velar_client_quota_limit_bytes{%s} %d\n", labels, cl.DataQuotaBytes)
		}
	}

	writeLine(&sb, "# HELP velar_client_quota_used_bytes Cumulative bytes counted toward quota (rx+tx).")
	writeLine(&sb, "# TYPE velar_client_quota_used_bytes gauge")
	for _, iface := range interfaces {
		for _, cl := range iface.Clients {
			labels := clientLabels(cl.ID, cl.Name, iface.Name)
			used := cl.BytesRx + cl.BytesTx
			writeFmt(&sb, "velar_client_quota_used_bytes{%s} %d\n", labels, used)
		}
	}

	writeLine(&sb, "# HELP velar_client_enabled Whether the client is enabled (1) or disabled (0).")
	writeLine(&sb, "# TYPE velar_client_enabled gauge")
	for _, iface := range interfaces {
		for _, cl := range iface.Clients {
			labels := clientLabels(cl.ID, cl.Name, iface.Name)
			val := 0
			if cl.Enabled {
				val = 1
			}
			writeFmt(&sb, "velar_client_enabled{%s} %d\n", labels, val)
		}
	}

	return sb.String(), nil
}

// ── helpers ───────────────────────────────────────────────────────────────────

func writeLine(sb *strings.Builder, s string) { sb.WriteString(s); sb.WriteByte('\n') }
func writeFmt(sb *strings.Builder, format string, args ...any) {
	sb.WriteString(fmt.Sprintf(format, args...))
}

// clientLabels builds a Prometheus label string for per-client metrics.
// Label values are sanitised: double-quotes and backslashes are escaped.
func clientLabels(id uint, name, iface string) string {
	return fmt.Sprintf(`id="%d",name="%s",interface="%s"`,
		id, promEscape(name), promEscape(iface))
}

// promEscape escapes double-quotes and backslashes inside label values.
func promEscape(s string) string {
	s = strings.ReplaceAll(s, `\`, `\\`)
	s = strings.ReplaceAll(s, `"`, `\"`)
	return s
}
