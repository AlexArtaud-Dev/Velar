package handlers

import (
	"fmt"
	"log/slog"
	"net/http"
	"strconv"

	"github.com/AlexArtaud-Dev/velar/backend/internal/auth"
	"github.com/AlexArtaud-Dev/velar/backend/internal/config"
	"github.com/AlexArtaud-Dev/velar/backend/internal/database"
	"github.com/AlexArtaud-Dev/velar/backend/internal/models"
	wgsvc "github.com/AlexArtaud-Dev/velar/backend/internal/services/wireguard"
	"github.com/gin-gonic/gin"
)

type InterfaceHandler struct {
	wg wgsvc.Service
}

func NewInterfaceHandler(wg wgsvc.Service) *InterfaceHandler {
	return &InterfaceHandler{wg: wg}
}

type createInterfaceRequest struct {
	Name          string `json:"name" binding:"required"`
	Port          int    `json:"port" binding:"required,min=1,max=65535"`
	Subnet        string `json:"subnet" binding:"required"`
	DNSServer     string `json:"dns_server"`
	ListenAddress string `json:"listen_address"`
	PostUp        string `json:"post_up"`
	PostDown      string `json:"post_down"`
}

func (h *InterfaceHandler) List(c *gin.Context) {
	var ifaces []models.Interface
	if err := database.DB.Find(&ifaces).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	type ifaceWithStatus struct {
		models.Interface
		Up        bool `json:"up"`
		PeerCount int  `json:"peer_count"`
	}

	result := make([]ifaceWithStatus, 0, len(ifaces))
	for _, iface := range ifaces {
		var count int64
		database.DB.Model(&models.Client{}).Where("interface_id = ? AND enabled = true", iface.ID).Count(&count)
		status, _ := h.wg.GetInterfaceStatus(iface.Name)
		result = append(result, ifaceWithStatus{
			Interface: iface,
			Up:        status.Up,
			PeerCount: int(count),
		})
	}
	c.JSON(http.StatusOK, result)
}

func (h *InterfaceHandler) Create(c *gin.Context) {
	var req createInterfaceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	privKey, pubKey, err := h.wg.GenerateKeyPair()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "key generation failed"})
		return
	}

	encPriv, err := auth.Encrypt(privKey, config.C.AppSecret)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "encryption failed"})
		return
	}

	dns := req.DNSServer
	if dns == "" {
		dns = "1.1.1.1"
	}
	mainIface := wgsvc.DetectMainInterface()
	postUp := req.PostUp
	if postUp == "" {
		postUp = fmt.Sprintf("iptables -A FORWARD -i %%i -j ACCEPT; iptables -A FORWARD -m state --state RELATED,ESTABLISHED -j ACCEPT; iptables -t nat -A POSTROUTING -o %s -j MASQUERADE", mainIface)
	}
	postDown := req.PostDown
	if postDown == "" {
		postDown = fmt.Sprintf("iptables -D FORWARD -i %%i -j ACCEPT; iptables -D FORWARD -m state --state RELATED,ESTABLISHED -j ACCEPT; iptables -t nat -D POSTROUTING -o %s -j MASQUERADE", mainIface)
	}

	iface := models.Interface{
		Name:          req.Name,
		Port:          req.Port,
		Subnet:        req.Subnet,
		PrivateKey:    encPriv,
		PublicKey:     pubKey,
		DNSServer:     dns,
		ListenAddress: req.ListenAddress,
		PostUp:        postUp,
		PostDown:      postDown,
		Enabled:       true,
	}
	// Port conflict check
	var portCount int64
	database.DB.Model(&models.Interface{}).Where("port = ?", req.Port).Count(&portCount)
	if portCount > 0 {
		c.JSON(http.StatusConflict, gin.H{"error": "port already in use by another interface"})
		return
	}

	if err := database.DB.Create(&iface).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	if err := h.wg.EnsureInterface(iface.Name, iface.Port, privKey, iface.Subnet, postUp, postDown, nil); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "wg conf write failed: " + err.Error()})
		return
	}
	if err := h.wg.BringUp(iface.Name); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "wg-quick up failed: " + err.Error()})
		return
	}

	c.JSON(http.StatusCreated, iface)
}

func (h *InterfaceHandler) Get(c *gin.Context) {
	id, _ := strconv.ParseUint(c.Param("id"), 10, 64)
	var iface models.Interface
	if err := database.DB.Preload("Clients").First(&iface, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}
	c.JSON(http.StatusOK, iface)
}

func (h *InterfaceHandler) Update(c *gin.Context) {
	id, _ := strconv.ParseUint(c.Param("id"), 10, 64)
	var iface models.Interface
	if err := database.DB.First(&iface, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}

	var req struct {
		DNSServer string `json:"dns_server"`
		PostUp    string `json:"post_up"`
		PostDown  string `json:"post_down"`
		Port      *int   `json:"port"`
		Subnet    string `json:"subnet"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Port conflict check
	if req.Port != nil && *req.Port != iface.Port {
		var count int64
		database.DB.Model(&models.Interface{}).Where("port = ? AND id != ?", *req.Port, iface.ID).Count(&count)
		if count > 0 {
			c.JSON(http.StatusConflict, gin.H{"error": "port already in use by another interface"})
			return
		}
	}

	needsRestart := false
	updates := map[string]interface{}{}
	if req.DNSServer != "" && req.DNSServer != iface.DNSServer {
		updates["dns_server"] = req.DNSServer
	}
	if req.PostUp != "" && req.PostUp != iface.PostUp {
		updates["post_up"] = req.PostUp
		needsRestart = true
	}
	if req.PostDown != "" && req.PostDown != iface.PostDown {
		updates["post_down"] = req.PostDown
		needsRestart = true
	}
	if req.Port != nil && *req.Port != iface.Port {
		updates["port"] = *req.Port
		needsRestart = true
	}
	if req.Subnet != "" && req.Subnet != iface.Subnet {
		updates["subnet"] = req.Subnet
		needsRestart = true
	}

	if len(updates) > 0 {
		database.DB.Model(&iface).Updates(updates)
		database.DB.First(&iface, id)
	}

	if needsRestart {
		privKey, err := auth.Decrypt(iface.PrivateKey, config.C.AppSecret)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "decrypt failed"})
			return
		}
		var clients []models.Client
		database.DB.Where("interface_id = ? AND enabled = true", iface.ID).Find(&clients)
		peers := make([]wgsvc.PeerEntry, 0, len(clients))
		for _, cl := range clients {
			psk, _ := auth.Decrypt(cl.PresharedKey, config.C.AppSecret)
			peers = append(peers, wgsvc.PeerEntry{
				Comment: cl.Name, PublicKey: cl.PublicKey, PSK: psk,
				AllowedIPs: cl.AssignedIP + "/32",
			})
		}
		_ = h.wg.BringDown(iface.Name)
		if err := h.wg.EnsureInterface(iface.Name, iface.Port, privKey, iface.Subnet, iface.PostUp, iface.PostDown, peers); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "conf write failed: " + err.Error()})
			return
		}
		if err := h.wg.BringUp(iface.Name); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "wg-quick up failed: " + err.Error()})
			return
		}
	}

	c.JSON(http.StatusOK, iface)
}

func (h *InterfaceHandler) Delete(c *gin.Context) {
	id, _ := strconv.ParseUint(c.Param("id"), 10, 64)
	var iface models.Interface
	if err := database.DB.First(&iface, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}

	// Best-effort — don't block DB cleanup on WG errors
	if err := h.wg.DeleteInterface(iface.Name); err != nil {
		slog.Warn("delete interface wg", "name", iface.Name, "err", err)
	}

	database.DB.Where("interface_id = ?", iface.ID).Delete(&models.Client{})
	database.DB.Delete(&iface)
	c.JSON(http.StatusOK, gin.H{"message": "deleted"})
}

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
	c.JSON(http.StatusOK, gin.H{"message": "up"})
}

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
