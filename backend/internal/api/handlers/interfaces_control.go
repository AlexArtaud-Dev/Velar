package handlers

import (
	"fmt"
	"log/slog"
	"net/http"
	"strconv"

	"github.com/AlexArtaud-Dev/velar/backend/internal/config"
	"github.com/AlexArtaud-Dev/velar/backend/internal/database"
	"github.com/AlexArtaud-Dev/velar/backend/internal/models"
	bwsvc "github.com/AlexArtaud-Dev/velar/backend/internal/services/bandwidth"
	"github.com/gin-gonic/gin"
)

// BringUp starts a WireGuard interface with wg-quick and marks it enabled in the
// DB. Bandwidth limits for all enabled peers are reapplied — tc rules are lost
// when the interface goes down and must be reinstated on each bring-up.
func (h *InterfaceHandler) BringUp(c *gin.Context) {
	id, _ := strconv.ParseUint(c.Param("id"), 10, 64)
	var iface models.Interface
	if err := database.DB.First(&iface, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}
	if err := h.wg.BringUp(iface.Name); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	database.DB.Model(&iface).Update("enabled", true)

	// Reapply tc rules — they do not survive interface restarts.
	if !config.C.WGMock {
		var clients []models.Client
		database.DB.Where(
			"interface_id = ? AND enabled = true AND (bandwidth_limit_down > 0 OR bandwidth_limit_up > 0)",
			iface.ID,
		).Find(&clients)
		for _, cl := range clients {
			if err := bwsvc.Apply(iface.Name, cl.AssignedIP, cl.BandwidthLimitDown, cl.BandwidthLimitUp); err != nil {
				slog.Warn("bringup: reapply bandwidth", "client", cl.Name, "err", err)
			}
		}
	}

	auditLog(c, "interface.up", "interface", iface.ID, iface.Name,
		fmt.Sprintf("port=%d", iface.Port))

	c.JSON(http.StatusOK, gin.H{"message": "up"})
}

// BringDown stops a WireGuard interface with wg-quick and marks it disabled.
func (h *InterfaceHandler) BringDown(c *gin.Context) {
	id, _ := strconv.ParseUint(c.Param("id"), 10, 64)
	var iface models.Interface
	if err := database.DB.First(&iface, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}
	if err := h.wg.BringDown(iface.Name); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	database.DB.Model(&iface).Update("enabled", false)

	auditLog(c, "interface.down", "interface", iface.ID, iface.Name,
		fmt.Sprintf("port=%d", iface.Port))

	c.JSON(http.StatusOK, gin.H{"message": "down"})
}

// Check verifies that the interface is UP in the kernel and that its UDP port
// is bound. Useful for diagnosing connectivity issues from the dashboard.
func (h *InterfaceHandler) Check(c *gin.Context) {
	id, _ := strconv.ParseUint(c.Param("id"), 10, 64)
	var iface models.Interface
	if err := database.DB.First(&iface, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}

	status, _ := h.wg.GetInterfaceStatus(iface.Name)
	portBound := checkUDPPort(iface.Port)

	c.JSON(http.StatusOK, gin.H{
		"interface_up": status.Up,
		"port_bound":   portBound,
		"port":         iface.Port,
		"interface":    iface.Name,
	})
}

// StatusOverview returns a live status snapshot for every interface in one call.
// Each entry combines DB metadata with a kernel-level check (interface up + UDP
// port bound) and the count of currently enabled peers.
//
// Route: GET /api/v1/interfaces/overview  (JWT or PAT)
func (h *InterfaceHandler) StatusOverview(c *gin.Context) {
	var ifaces []models.Interface
	database.DB.Find(&ifaces)

	type entry struct {
		ID          uint   `json:"id"`
		Name        string `json:"name"`
		Port        int    `json:"port"`
		Subnet      string `json:"subnet"`
		Enabled     bool   `json:"enabled"`
		InterfaceUp bool   `json:"interface_up"`
		PortBound   bool   `json:"port_bound"`
		ClientCount int64  `json:"client_count"`
	}

	result := make([]entry, 0, len(ifaces))
	for _, iface := range ifaces {
		kStatus, _ := h.wg.GetInterfaceStatus(iface.Name)
		var count int64
		database.DB.Model(&models.Client{}).
			Where("interface_id = ? AND enabled = true", iface.ID).
			Count(&count)

		result = append(result, entry{
			ID:          iface.ID,
			Name:        iface.Name,
			Port:        iface.Port,
			Subnet:      iface.Subnet,
			Enabled:     iface.Enabled,
			InterfaceUp: kStatus.Up,
			PortBound:   checkUDPPort(iface.Port),
			ClientCount: count,
		})
	}

	c.JSON(http.StatusOK, result)
}
