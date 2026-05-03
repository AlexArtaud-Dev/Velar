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

// ── Data model ────────────────────────────────────────────────────────────────

// MetricsData is the canonical metrics payload. It is used for both the JSON
// response and the Prometheus text rendering, avoiding a double DB query.
type MetricsData struct {
	GeneratedAt time.Time     `json:"generated_at"`
	Interfaces  IfaceMetrics  `json:"interfaces"`
	Clients     ClientMetrics `json:"clients"`
	Peers       []PeerMetric  `json:"peers"`
}

type IfaceMetrics struct {
	Total   int `json:"total"`
	Enabled int `json:"enabled"`
}

type ClientMetrics struct {
	Total        int   `json:"total"`
	Enabled      int   `json:"enabled"`
	Connected    int   `json:"connected"`
	Suspended    int   `json:"suspended"`
	BytesRxTotal int64 `json:"bytes_rx_total"`
	BytesTxTotal int64 `json:"bytes_tx_total"`
}

type PeerMetric struct {
	ID                  uint    `json:"id"`
	Name                string  `json:"name"`
	Interface           string  `json:"interface"`
	Enabled             bool    `json:"enabled"`
	BytesRx             int64   `json:"bytes_rx"`
	BytesTx             int64   `json:"bytes_tx"`
	HandshakeAgeSeconds float64 `json:"handshake_age_seconds"` // -1 = never connected
	QuotaLimitBytes     int64   `json:"quota_limit_bytes"`     // 0 = unlimited
	QuotaUsedBytes      int64   `json:"quota_used_bytes"`
	QuotaSuspended      bool    `json:"quota_suspended"`
}

// ── Cache ─────────────────────────────────────────────────────────────────────

var metricsCache struct {
	sync.Mutex
	data      *MetricsData
	promBody  string // rendered Prometheus text
	expiresAt time.Time
}

// ── Handler ───────────────────────────────────────────────────────────────────

// GetMetrics serves server metrics with a 60-second server-side cache.
//
// Format selection via Accept header:
//   - Accept: application/json  → JSON object
//   - anything else             → Prometheus text (default)
//
// Route: GET /api/v1/metrics  (protected by JWTORPAT middleware)
func GetMetrics(c *gin.Context) {
	metricsCache.Lock()
	defer metricsCache.Unlock()

	if time.Now().Before(metricsCache.expiresAt) && metricsCache.data != nil {
		serveMetrics(c, metricsCache.data, metricsCache.promBody)
		return
	}

	data, err := collectMetrics()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to collect metrics"})
		return
	}
	promText := renderPrometheus(data)

	metricsCache.data = data
	metricsCache.promBody = promText
	metricsCache.expiresAt = time.Now().Add(60 * time.Second)

	serveMetrics(c, data, promText)
}

func serveMetrics(c *gin.Context, data *MetricsData, promText string) {
	if strings.Contains(c.GetHeader("Accept"), "application/json") {
		c.JSON(http.StatusOK, data)
		return
	}
	c.Data(http.StatusOK, "text/plain; version=0.0.4; charset=utf-8", []byte(promText))
}

// ── Data collection ───────────────────────────────────────────────────────────

func collectMetrics() (*MetricsData, error) {
	var interfaces []models.Interface
	if err := database.DB.Preload("Clients").Find(&interfaces).Error; err != nil {
		return nil, err
	}

	now := time.Now()
	data := &MetricsData{
		GeneratedAt: now,
		Peers:       make([]PeerMetric, 0),
	}

	data.Interfaces.Total = len(interfaces)
	for _, iface := range interfaces {
		if iface.Enabled {
			data.Interfaces.Enabled++
		}
		for _, cl := range iface.Clients {
			data.Clients.Total++
			if cl.Enabled {
				data.Clients.Enabled++
			}
			if cl.QuotaSuspended {
				data.Clients.Suspended++
			}
			data.Clients.BytesRxTotal += cl.BytesRx
			data.Clients.BytesTxTotal += cl.BytesTx

			age := -1.0
			if cl.LastHandshake != nil && cl.LastHandshake.Year() >= 2020 {
				age = now.Sub(*cl.LastHandshake).Seconds()
				if age < 3*60 {
					data.Clients.Connected++
				}
			}

			data.Peers = append(data.Peers, PeerMetric{
				ID:                  cl.ID,
				Name:                cl.Name,
				Interface:           iface.Name,
				Enabled:             cl.Enabled,
				BytesRx:             cl.BytesRx,
				BytesTx:             cl.BytesTx,
				HandshakeAgeSeconds: age,
				QuotaLimitBytes:     cl.DataQuotaBytes,
				QuotaUsedBytes:      cl.BytesRx + cl.BytesTx,
				QuotaSuspended:      cl.QuotaSuspended,
			})
		}
	}
	return data, nil
}

// ── Prometheus text renderer ──────────────────────────────────────────────────

func renderPrometheus(data *MetricsData) string {
	var sb strings.Builder

	writeLine(&sb, "# HELP velar_interfaces_total Total number of WireGuard interfaces.")
	writeLine(&sb, "# TYPE velar_interfaces_total gauge")
	writeFmt(&sb, "velar_interfaces_total %d\n", data.Interfaces.Total)

	writeLine(&sb, "# HELP velar_interfaces_enabled_total Number of enabled WireGuard interfaces.")
	writeLine(&sb, "# TYPE velar_interfaces_enabled_total gauge")
	writeFmt(&sb, "velar_interfaces_enabled_total %d\n", data.Interfaces.Enabled)

	writeLine(&sb, "# HELP velar_clients_total Total number of WireGuard clients.")
	writeLine(&sb, "# TYPE velar_clients_total gauge")
	writeFmt(&sb, "velar_clients_total %d\n", data.Clients.Total)

	writeLine(&sb, "# HELP velar_clients_enabled_total Number of enabled clients.")
	writeLine(&sb, "# TYPE velar_clients_enabled_total gauge")
	writeFmt(&sb, "velar_clients_enabled_total %d\n", data.Clients.Enabled)

	writeLine(&sb, "# HELP velar_clients_connected_total Clients with a handshake in the last 3 minutes.")
	writeLine(&sb, "# TYPE velar_clients_connected_total gauge")
	writeFmt(&sb, "velar_clients_connected_total %d\n", data.Clients.Connected)

	writeLine(&sb, "# HELP velar_clients_suspended_total Clients suspended due to quota exhaustion.")
	writeLine(&sb, "# TYPE velar_clients_suspended_total gauge")
	writeFmt(&sb, "velar_clients_suspended_total %d\n", data.Clients.Suspended)

	writeLine(&sb, "# HELP velar_traffic_rx_bytes_total Cumulative bytes received across all clients.")
	writeLine(&sb, "# TYPE velar_traffic_rx_bytes_total counter")
	writeFmt(&sb, "velar_traffic_rx_bytes_total %d\n", data.Clients.BytesRxTotal)

	writeLine(&sb, "# HELP velar_traffic_tx_bytes_total Cumulative bytes transmitted across all clients.")
	writeLine(&sb, "# TYPE velar_traffic_tx_bytes_total counter")
	writeFmt(&sb, "velar_traffic_tx_bytes_total %d\n", data.Clients.BytesTxTotal)

	writeLine(&sb, "# HELP velar_client_bytes_rx_total Cumulative bytes received by client.")
	writeLine(&sb, "# TYPE velar_client_bytes_rx_total counter")
	for _, p := range data.Peers {
		writeFmt(&sb, "velar_client_bytes_rx_total{%s} %d\n", peerLabels(p), p.BytesRx)
	}

	writeLine(&sb, "# HELP velar_client_bytes_tx_total Cumulative bytes transmitted by client.")
	writeLine(&sb, "# TYPE velar_client_bytes_tx_total counter")
	for _, p := range data.Peers {
		writeFmt(&sb, "velar_client_bytes_tx_total{%s} %d\n", peerLabels(p), p.BytesTx)
	}

	writeLine(&sb, "# HELP velar_client_handshake_age_seconds Seconds since last WireGuard handshake (-1 = never).")
	writeLine(&sb, "# TYPE velar_client_handshake_age_seconds gauge")
	for _, p := range data.Peers {
		writeFmt(&sb, "velar_client_handshake_age_seconds{%s} %.0f\n", peerLabels(p), p.HandshakeAgeSeconds)
	}

	writeLine(&sb, "# HELP velar_client_quota_limit_bytes Data quota limit in bytes (0 = unlimited).")
	writeLine(&sb, "# TYPE velar_client_quota_limit_bytes gauge")
	for _, p := range data.Peers {
		writeFmt(&sb, "velar_client_quota_limit_bytes{%s} %d\n", peerLabels(p), p.QuotaLimitBytes)
	}

	writeLine(&sb, "# HELP velar_client_quota_used_bytes Cumulative bytes counted toward quota (rx+tx).")
	writeLine(&sb, "# TYPE velar_client_quota_used_bytes gauge")
	for _, p := range data.Peers {
		writeFmt(&sb, "velar_client_quota_used_bytes{%s} %d\n", peerLabels(p), p.QuotaUsedBytes)
	}

	writeLine(&sb, "# HELP velar_client_enabled Whether the client is enabled (1) or disabled (0).")
	writeLine(&sb, "# TYPE velar_client_enabled gauge")
	for _, p := range data.Peers {
		val := 0
		if p.Enabled {
			val = 1
		}
		writeFmt(&sb, "velar_client_enabled{%s} %d\n", peerLabels(p), val)
	}

	return sb.String()
}

// ── helpers ───────────────────────────────────────────────────────────────────

func writeLine(sb *strings.Builder, s string) { sb.WriteString(s); sb.WriteByte('\n') }
func writeFmt(sb *strings.Builder, format string, args ...any) {
	sb.WriteString(fmt.Sprintf(format, args...))
}

func peerLabels(p PeerMetric) string {
	return fmt.Sprintf(`id="%d",name="%s",interface="%s"`,
		p.ID, promEscape(p.Name), promEscape(p.Interface))
}

func promEscape(s string) string {
	s = strings.ReplaceAll(s, `\`, `\\`)
	s = strings.ReplaceAll(s, `"`, `\"`)
	return s
}
