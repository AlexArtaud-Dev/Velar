package jobs

import (
	"log/slog"
	"sync"
	"time"

	"github.com/AlexArtaud-Dev/velar/backend/internal/database"
	"github.com/AlexArtaud-Dev/velar/backend/internal/models"
	wgsvc "github.com/AlexArtaud-Dev/velar/backend/internal/services/wireguard"
)

var (
	snapMu     sync.Mutex
	snapLastRx = make(map[uint]int64) // clientID → last cumulative bytes_rx from wg
	snapLastTx = make(map[uint]int64) // clientID → last cumulative bytes_tx from wg
)

// GetLastSnapshotBaseline returns the cumulative WireGuard byte counters that
// were observed the last time snapshotBandwidth ran for the given client, plus
// a flag indicating whether a baseline has been established at all.
// Returns (0, 0, false) for clients not yet seen since the last server start.
// Used by the quota job and quota-usage endpoint to compute the unsnapshotted
// traffic delta between snapshot intervals.
func GetLastSnapshotBaseline(clientID uint) (rx, tx int64, ok bool) {
	snapMu.Lock()
	defer snapMu.Unlock()
	rx, ok = snapLastRx[clientID]
	tx = snapLastTx[clientID]
	return
}

// snapshotBandwidth polls wg stats every minute and stores per-client byte
// deltas as PeerSnapshot rows. Counter resets (caused by peer reconnection)
// are handled by treating the new cumulative value as the delta for that
// interval rather than a negative delta.
func snapshotBandwidth(wg wgsvc.Service) {
	var ifaces []models.Interface
	if err := database.DB.Where("enabled = true").Find(&ifaces).Error; err != nil {
		return
	}

	var clients []models.Client
	database.DB.Where("enabled = true").Find(&clients)
	pubToID := make(map[string]uint, len(clients))
	for _, cl := range clients {
		pubToID[cl.PublicKey] = cl.ID
	}

	now := time.Now()

	snapMu.Lock()
	defer snapMu.Unlock()

	for _, iface := range ifaces {
		stats, err := wg.GetStats(iface.Name)
		if err != nil {
			continue
		}
		for _, s := range stats {
			clientID, ok := pubToID[s.PublicKey]
			if !ok {
				continue
			}

			prevRx, hadPrev := snapLastRx[clientID]
			prevTx := snapLastTx[clientID]

			snapLastRx[clientID] = s.BytesRx
			snapLastTx[clientID] = s.BytesTx

			if !hadPrev {
				// First observation — record baseline only; no delta to store yet.
				continue
			}

			// Compute deltas; treat counter reset as a fresh start.
			var deltaRx, deltaTx int64
			if s.BytesRx >= prevRx {
				deltaRx = s.BytesRx - prevRx
			} else {
				deltaRx = s.BytesRx
			}
			if s.BytesTx >= prevTx {
				deltaTx = s.BytesTx - prevTx
			} else {
				deltaTx = s.BytesTx
			}

			if deltaRx == 0 && deltaTx == 0 {
				continue
			}

			snap := models.PeerSnapshot{
				ClientID:  clientID,
				Timestamp: now,
				BytesRx:   deltaRx,
				BytesTx:   deltaTx,
			}
			if err := database.DB.Create(&snap).Error; err != nil {
				slog.Error("snapshotBandwidth: save", "err", err)
			}
		}
	}
}

// purgeOldData removes PeerSnapshot rows older than 7 days and ConnectionEvent
// rows older than 30 days to keep the database from growing unbounded.
func purgeOldData() {
	snapshotCutoff := time.Now().Add(-snapshotRetention)
	res := database.DB.Where("timestamp < ?", snapshotCutoff).Delete(&models.PeerSnapshot{})
	if res.RowsAffected > 0 {
		slog.Info("purged old bandwidth snapshots", "count", res.RowsAffected)
	}

	eventCutoff := time.Now().Add(-eventRetention)
	res = database.DB.Where("timestamp < ?", eventCutoff).Delete(&models.ConnectionEvent{})
	if res.RowsAffected > 0 {
		slog.Info("purged old connection events", "count", res.RowsAffected)
	}
}
