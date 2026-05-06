package handlers

import (
	"fmt"
	"log/slog"
	"net/http"
	"strings"

	"github.com/AlexArtaud-Dev/velar/backend/internal/auth"
	"github.com/AlexArtaud-Dev/velar/backend/internal/config"
	"github.com/AlexArtaud-Dev/velar/backend/internal/database"
	"github.com/AlexArtaud-Dev/velar/backend/internal/models"
	bwsvc "github.com/AlexArtaud-Dev/velar/backend/internal/services/bandwidth"
	"github.com/gin-gonic/gin"
)

// bulkRequest is the JSON body shared by all bulk operation endpoints.
type bulkRequest struct {
	IDs []uint `json:"ids" binding:"required"`
}

// BulkEnable enables all clients in the request body, adds each peer to
// WireGuard, reapplies bandwidth limits, and calls syncConf once per
// unique interface to minimise disruption.
func (h *ClientHandler) BulkEnable(c *gin.Context) {
	var req bulkRequest
	if err := c.ShouldBindJSON(&req); err != nil || len(req.IDs) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "ids required"})
		return
	}

	var clients []models.Client
	database.DB.Preload("Interface").Where("id IN ?", req.IDs).Find(&clients)

	// Track unique interfaces so we call syncConf exactly once each.
	ifacesSynced := map[uint]models.Interface{}
	for _, cl := range clients {
		if cl.Enabled {
			continue
		}
		psk, _ := auth.Decrypt(cl.PresharedKey, config.C.AppSecret)
		h.wg.AddPeer(cl.Interface.Name, cl.PublicKey, psk, cl.AssignedIP+"/32") //nolint:errcheck
		if !config.C.WGMock {
			if cl.BandwidthLimitDown > 0 || cl.BandwidthLimitUp > 0 {
				bwsvc.Apply(cl.Interface.Name, cl.AssignedIP, cl.BandwidthLimitDown, cl.BandwidthLimitUp) //nolint:errcheck
			}
			if cl.DataQuotaBytes > 0 {
				h.nft.Apply(cl.AssignedIP, quotaRemaining(cl)) //nolint:errcheck
			}
		}
		database.DB.Model(&cl).Update("enabled", true)
		ifacesSynced[cl.InterfaceID] = cl.Interface
	}
	for _, iface := range ifacesSynced {
		h.syncConf(iface)
	}

	names := make([]string, 0, len(clients))
	for _, cl := range clients {
		names = append(names, cl.Name)
	}
	auditLog(c, "client.bulk_enable", "client", 0, fmt.Sprintf("%d clients", len(clients)),
		fmt.Sprintf("count=%d names=%s", len(clients), strings.Join(names, ",")))

	c.JSON(http.StatusOK, gin.H{"updated": len(clients)})
}

// BulkDisable disables all clients in the request body, removes each peer from
// WireGuard, tears down bandwidth shaping, and syncs confs once per interface.
func (h *ClientHandler) BulkDisable(c *gin.Context) {
	var req bulkRequest
	if err := c.ShouldBindJSON(&req); err != nil || len(req.IDs) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "ids required"})
		return
	}

	var clients []models.Client
	database.DB.Preload("Interface").Where("id IN ?", req.IDs).Find(&clients)

	ifacesSynced := map[uint]models.Interface{}
	for _, cl := range clients {
		if !cl.Enabled {
			continue
		}
		h.wg.RemovePeer(cl.Interface.Name, cl.PublicKey) //nolint:errcheck
		if !config.C.WGMock {
			bwsvc.Remove(cl.Interface.Name, cl.AssignedIP) //nolint:errcheck
			if cl.DataQuotaBytes > 0 {
				h.nft.Remove(cl.AssignedIP) //nolint:errcheck
			}
		}
		database.DB.Model(&cl).Update("enabled", false)
		ifacesSynced[cl.InterfaceID] = cl.Interface
	}
	for _, iface := range ifacesSynced {
		h.syncConf(iface)
	}

	names := make([]string, 0, len(clients))
	for _, cl := range clients {
		names = append(names, cl.Name)
	}
	auditLog(c, "client.bulk_disable", "client", 0, fmt.Sprintf("%d clients", len(clients)),
		fmt.Sprintf("count=%d names=%s", len(clients), strings.Join(names, ",")))

	c.JSON(http.StatusOK, gin.H{"updated": len(clients)})
}

// BulkDelete permanently removes all clients in the request body.
// Child records are cascade-deleted first, peers are removed from WireGuard,
// and confs are synced once per unique interface.
func (h *ClientHandler) BulkDelete(c *gin.Context) {
	var req bulkRequest
	if err := c.ShouldBindJSON(&req); err != nil || len(req.IDs) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "ids required"})
		return
	}

	var clients []models.Client
	database.DB.Preload("Interface").Where("id IN ?", req.IDs).Find(&clients)

	ifacesSynced := map[uint]models.Interface{}
	for _, cl := range clients {
		// Cascade-delete children before the parent (FK constraint).
		database.DB.Where("client_id = ?", cl.ID).Delete(&models.DownloadToken{})
		database.DB.Where("client_id = ?", cl.ID).Delete(&models.ConnectionEvent{})
		database.DB.Where("client_id = ?", cl.ID).Delete(&models.PeerSnapshot{})

		if err := database.DB.Delete(&cl).Error; err != nil {
			slog.Error("bulk delete: db", "client", cl.Name, "err", err)
			continue
		}
		h.wg.RemovePeer(cl.Interface.Name, cl.PublicKey) //nolint:errcheck
		if !config.C.WGMock {
			bwsvc.Remove(cl.Interface.Name, cl.AssignedIP) //nolint:errcheck
			if cl.DataQuotaBytes > 0 {
				h.nft.Remove(cl.AssignedIP) //nolint:errcheck
			}
		}
		ifacesSynced[cl.InterfaceID] = cl.Interface
	}
	for _, iface := range ifacesSynced {
		h.syncConf(iface)
	}

	names := make([]string, 0, len(clients))
	for _, cl := range clients {
		names = append(names, cl.Name)
	}
	auditLog(c, "client.bulk_delete", "client", 0, fmt.Sprintf("%d clients", len(clients)),
		fmt.Sprintf("count=%d names=%s", len(clients), strings.Join(names, ",")))

	c.JSON(http.StatusOK, gin.H{"deleted": len(clients)})
}
