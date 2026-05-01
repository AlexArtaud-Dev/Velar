package handlers

import (
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
