package handlers

import (
	"net/http"
	"sort"
	"time"

	"github.com/AlexArtaud-Dev/velar/backend/internal/database"
	"github.com/AlexArtaud-Dev/velar/backend/internal/models"
	"github.com/gin-gonic/gin"
)

type DashboardHandler struct{}

func NewDashboardHandler() *DashboardHandler { return &DashboardHandler{} }

// SnapshotPoint is a single time-bucketed bandwidth data point returned by
// the snapshots endpoints.
type SnapshotPoint struct {
	Timestamp time.Time `json:"timestamp"`
	BytesRx   int64     `json:"bytes_rx"`
	BytesTx   int64     `json:"bytes_tx"`
}

type trafficSum struct {
	TotalRx int64
	TotalTx int64
}

type eventWithMeta struct {
	ID            uint      `json:"id"`
	ClientID      uint      `json:"client_id"`
	ClientName    string    `json:"client_name"`
	InterfaceName string    `json:"interface_name"`
	EventType     string    `json:"event_type"`
	SourceIP      string    `json:"source_ip"`
	Timestamp     time.Time `json:"timestamp"`
}

// Get returns historical traffic totals and the 20 most recent connection
// events across all interfaces.
func (h *DashboardHandler) Get(c *gin.Context) {
	now := time.Now()

	var sum24h, sum7d trafficSum
	database.DB.Model(&models.PeerSnapshot{}).
		Where("timestamp > ?", now.Add(-24*time.Hour)).
		Select("COALESCE(SUM(bytes_rx),0) as total_rx, COALESCE(SUM(bytes_tx),0) as total_tx").
		Scan(&sum24h)
	database.DB.Model(&models.PeerSnapshot{}).
		Where("timestamp > ?", now.Add(-7*24*time.Hour)).
		Select("COALESCE(SUM(bytes_rx),0) as total_rx, COALESCE(SUM(bytes_tx),0) as total_tx").
		Scan(&sum7d)

	var events []models.ConnectionEvent
	database.DB.Preload("Client").Preload("Client.Interface").
		Order("timestamp DESC").Limit(20).
		Find(&events)

	meta := make([]eventWithMeta, 0, len(events))
	for _, e := range events {
		ifaceName := ""
		if e.Client.Interface.ID != 0 {
			ifaceName = e.Client.Interface.Name
		}
		meta = append(meta, eventWithMeta{
			ID:            e.ID,
			ClientID:      e.ClientID,
			ClientName:    e.Client.Name,
			InterfaceName: ifaceName,
			EventType:     e.EventType,
			SourceIP:      e.SourceIP,
			Timestamp:     e.Timestamp,
		})
	}

	c.JSON(http.StatusOK, gin.H{
		"traffic_24h":   gin.H{"rx": sum24h.TotalRx, "tx": sum24h.TotalTx},
		"traffic_7d":    gin.H{"rx": sum7d.TotalRx, "tx": sum7d.TotalTx},
		"recent_events": meta,
	})
}

// GetSnapshots returns bandwidth history aggregated across ALL clients,
// bucketed by time. Accepts ?range=24h (default) or ?range=7d.
func (h *DashboardHandler) GetSnapshots(c *gin.Context) {
	since, bucketDur := parseRange(c.DefaultQuery("range", "24h"))

	var snapshots []models.PeerSnapshot
	database.DB.
		Where("timestamp > ?", time.Now().Add(-since)).
		Order("timestamp ASC").
		Find(&snapshots)

	c.JSON(http.StatusOK, bucketSnapshots(snapshots, bucketDur))
}

// ── helpers ──────────────────────────────────────────────────────────────────

func parseRange(r string) (since time.Duration, bucketDur time.Duration) {
	switch r {
	case "7d":
		return 7 * 24 * time.Hour, 2 * time.Hour
	default: // 24h
		return 24 * time.Hour, 15 * time.Minute
	}
}

func parseRangeClient(r string) (since time.Duration, bucketDur time.Duration) {
	switch r {
	case "1h":
		return 1 * time.Hour, 1 * time.Minute
	case "7d":
		return 7 * 24 * time.Hour, 2 * time.Hour
	default: // 24h
		return 24 * time.Hour, 15 * time.Minute
	}
}

// bucketSnapshots groups PeerSnapshot records into time buckets and sums
// the bytes within each bucket. Used by both dashboard and client endpoints.
func bucketSnapshots(snapshots []models.PeerSnapshot, bucketDur time.Duration) []SnapshotPoint {
	type bucket struct{ rx, tx int64 }
	m := make(map[int64]*bucket)
	var keys []int64

	for _, s := range snapshots {
		t := s.Timestamp.Truncate(bucketDur).Unix()
		if b, ok := m[t]; ok {
			b.rx += s.BytesRx
			b.tx += s.BytesTx
		} else {
			m[t] = &bucket{rx: s.BytesRx, tx: s.BytesTx}
			keys = append(keys, t)
		}
	}

	sort.Slice(keys, func(i, j int) bool { return keys[i] < keys[j] })

	result := make([]SnapshotPoint, len(keys))
	for i, t := range keys {
		b := m[t]
		result[i] = SnapshotPoint{
			Timestamp: time.Unix(t, 0).UTC(),
			BytesRx:   b.rx,
			BytesTx:   b.tx,
		}
	}
	return result
}
