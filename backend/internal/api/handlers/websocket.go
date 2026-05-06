package handlers

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/AlexArtaud-Dev/velar/backend/internal/auth"
	"github.com/AlexArtaud-Dev/velar/backend/internal/config"
	"github.com/AlexArtaud-Dev/velar/backend/internal/database"
	"github.com/AlexArtaud-Dev/velar/backend/internal/models"
	wgsvc "github.com/AlexArtaud-Dev/velar/backend/internal/services/wireguard"
	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		origin := r.Header.Get("Origin")
		// Same-origin requests (e.g. same-host Nginx proxy) have no Origin header.
		if origin == "" {
			return true
		}
		return origin == config.C.CORSOrigin
	},
}

type WSHub struct {
	mu      sync.RWMutex
	clients map[*websocket.Conn]bool
	wg      wgsvc.Service
}

func NewWSHub(wg wgsvc.Service) *WSHub {
	h := &WSHub{
		clients: make(map[*websocket.Conn]bool),
		wg:      wg,
	}
	go h.broadcastLoop()
	return h
}

func (h *WSHub) broadcast(msg []byte) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for conn := range h.clients {
		conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
		if err := conn.WriteMessage(websocket.TextMessage, msg); err != nil {
			conn.Close()
		}
	}
}

func (h *WSHub) remove(conn *websocket.Conn) {
	h.mu.Lock()
	delete(h.clients, conn)
	h.mu.Unlock()
}

func (h *WSHub) broadcastLoop() {
	ticker := time.NewTicker(5 * time.Second)
	for range ticker.C {
		stats := h.collectStats()
		data, err := json.Marshal(stats)
		if err != nil {
			slog.Error("ws marshal stats", "err", err)
			continue
		}
		h.broadcast(data)
	}
}

type StatsPayload struct {
	Timestamp  int64          `json:"ts"`
	Interfaces []IfaceStats   `json:"interfaces"`
}

type IfaceStats struct {
	ID        uint          `json:"id"`
	Name      string        `json:"name"`
	Up        bool          `json:"up"`
	Peers     []PeerStatOut `json:"peers"`
}

type PeerStatOut struct {
	ClientID      uint   `json:"client_id"`
	Name          string `json:"name"`
	PublicKey     string `json:"public_key"`
	LastHandshake int64  `json:"last_handshake"`
	BytesRx       int64  `json:"bytes_rx"`
	BytesTx       int64  `json:"bytes_tx"`
	Connected     bool   `json:"connected"`
}

func (h *WSHub) collectStats() StatsPayload {
	payload := StatsPayload{Timestamp: time.Now().Unix(), Interfaces: []IfaceStats{}}

	var ifaces []models.Interface
	database.DB.Find(&ifaces)

	for _, iface := range ifaces {
		status, _ := h.wg.GetInterfaceStatus(iface.Name)
		is := IfaceStats{ID: iface.ID, Name: iface.Name, Up: status.Up}

		stats, err := h.wg.GetStats(iface.Name)
		if err == nil {
			statMap := make(map[string]wgsvc.PeerStat, len(stats))
			for _, s := range stats {
				statMap[s.PublicKey] = s
			}

			var clients []models.Client
			database.DB.Where("interface_id = ? AND enabled = true", iface.ID).Find(&clients)

			now := time.Now().Unix()
			for _, cl := range clients {
				ps, ok := statMap[cl.PublicKey]
				connected := ok && (now-ps.LastHandshake) < 180

				if ok {
					// update DB stats
					t := time.Unix(ps.LastHandshake, 0)
					database.DB.Model(&cl).Updates(map[string]interface{}{
						"bytes_rx":       ps.BytesRx,
						"bytes_tx":       ps.BytesTx,
						"last_handshake": t,
					})
				}

				is.Peers = append(is.Peers, PeerStatOut{
					ClientID:      cl.ID,
					Name:          cl.Name,
					PublicKey:     cl.PublicKey,
					LastHandshake: ps.LastHandshake,
					BytesRx:       ps.BytesRx,
					BytesTx:       ps.BytesTx,
					Connected:     connected,
				})
			}
		}
		payload.Interfaces = append(payload.Interfaces, is)
	}
	return payload
}

// StatsHandler serves a one-shot JSON snapshot of the same peer statistics the
// WebSocket loop broadcasts. Intended for REST polling by the master on behalf
// of slaves (no WebSocket connection to slaves).
func StatsHandler(hub *WSHub) gin.HandlerFunc {
	return func(c *gin.Context) {
		c.JSON(http.StatusOK, hub.collectStats())
	}
}

func WSHandler(hub *WSHub) gin.HandlerFunc {
	return func(c *gin.Context) {
		// Accept token via query param for WS (browsers can't set headers on WS)
		tokenStr := c.Query("token")
		if tokenStr == "" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "missing token"})
			return
		}
		if _, err := auth.ParseAccessToken(tokenStr, config.C.AppSecret); err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid token"})
			return
		}

		conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
		if err != nil {
			slog.Error("ws upgrade", "err", err)
			return
		}

		hub.mu.Lock()
		hub.clients[conn] = true
		hub.mu.Unlock()

		// send initial stats immediately
		stats := hub.collectStats()
		data, _ := json.Marshal(stats)
		conn.WriteMessage(websocket.TextMessage, data)

		// read loop to detect disconnect
		for {
			if _, _, err := conn.ReadMessage(); err != nil {
				hub.remove(conn)
				return
			}
		}
	}
}
