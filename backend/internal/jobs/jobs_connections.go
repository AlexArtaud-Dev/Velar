package jobs

import (
	"log/slog"
	"net"
	"sync"
	"time"

	"github.com/AlexArtaud-Dev/velar/backend/internal/database"
	"github.com/AlexArtaud-Dev/velar/backend/internal/models"
	wgsvc "github.com/AlexArtaud-Dev/velar/backend/internal/services/wireguard"
)

// connState tracks the last-known connection status of a single peer.
type connState struct {
	connected     bool
	lastHandshake time.Time
}

var (
	connMu          sync.Mutex
	connStateMap    = make(map[uint]*connState) // clientID → last-known state
	connInitialized bool                        // false until the first poll baseline is set
)

// pollConnectionEvents detects WireGuard peer connect/disconnect transitions by
// comparing live last_handshake timestamps against the previous poll state.
//
// On the first invocation it only records the baseline — no events are emitted —
// to avoid a flood of spurious "connected" events on startup.
func pollConnectionEvents(wg wgsvc.Service) {
	var ifaces []models.Interface
	if err := database.DB.Where("enabled = true").Find(&ifaces).Error; err != nil {
		return
	}

	// Index all enabled clients by public key for O(1) lookup.
	var clients []models.Client
	database.DB.Where("enabled = true").Find(&clients)
	pubToClient := make(map[string]*models.Client, len(clients))
	for i := range clients {
		pubToClient[clients[i].PublicKey] = &clients[i]
	}

	now := time.Now()

	// Gather live handshake state across all interfaces.
	type liveState struct {
		handshake time.Time
		endpoint  string
	}
	livePeers := make(map[uint]liveState)
	for _, iface := range ifaces {
		stats, err := wg.GetStats(iface.Name)
		if err != nil {
			continue
		}
		for _, s := range stats {
			cl, ok := pubToClient[s.PublicKey]
			if !ok || s.LastHandshake == 0 {
				continue
			}
			livePeers[cl.ID] = liveState{
				handshake: time.Unix(s.LastHandshake, 0),
				endpoint:  s.Endpoint,
			}
		}
	}

	connMu.Lock()
	defer connMu.Unlock()

	if !connInitialized {
		// First run: record baseline without emitting events.
		for clientID, live := range livePeers {
			connStateMap[clientID] = &connState{
				connected:     now.Sub(live.handshake) < disconnectThreshold,
				lastHandshake: live.handshake,
			}
		}
		for _, cl := range clients {
			if _, inLive := livePeers[cl.ID]; !inLive {
				connStateMap[cl.ID] = &connState{connected: false}
			}
		}
		connInitialized = true
		return
	}

	// Subsequent runs: compare with previous state and emit events on transition.
	for clientID, live := range livePeers {
		isConnected := now.Sub(live.handshake) < disconnectThreshold
		prev := connStateMap[clientID]
		if prev == nil {
			connStateMap[clientID] = &connState{connected: isConnected, lastHandshake: live.handshake}
			if isConnected {
				emitConnectionEvent(clientID, "connected", live.endpoint)
			}
			continue
		}
		if !prev.connected && isConnected {
			emitConnectionEvent(clientID, "connected", live.endpoint)
		} else if prev.connected && !isConnected {
			emitConnectionEvent(clientID, "disconnected", "")
		}
		prev.connected = isConnected
		prev.lastHandshake = live.handshake
	}

	// Clients absent from live stats are treated as disconnected.
	for _, cl := range clients {
		if _, inLive := livePeers[cl.ID]; !inLive {
			if prev := connStateMap[cl.ID]; prev != nil && prev.connected {
				emitConnectionEvent(cl.ID, "disconnected", "")
				prev.connected = false
			}
		}
	}
}

// emitConnectionEvent persists a ConnectionEvent row and logs the transition.
func emitConnectionEvent(clientID uint, eventType, endpoint string) {
	event := models.ConnectionEvent{
		ClientID:  clientID,
		EventType: eventType,
		SourceIP:  extractEndpointIP(endpoint),
		Timestamp: time.Now(),
	}
	if err := database.DB.Create(&event).Error; err != nil {
		slog.Error("emitConnectionEvent", "err", err)
		return
	}
	slog.Info("connection event", "client_id", clientID, "type", eventType)
}

// extractEndpointIP parses the IP address from a WireGuard endpoint string
// ("host:port" format). Returns an empty string for unknown or empty endpoints.
func extractEndpointIP(endpoint string) string {
	if endpoint == "" || endpoint == "(none)" {
		return ""
	}
	host, _, err := net.SplitHostPort(endpoint)
	if err != nil {
		return endpoint
	}
	return host
}
