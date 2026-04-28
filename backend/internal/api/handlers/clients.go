package handlers

import (
	"encoding/base64"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"github.com/AlexArtaud-Dev/velar/backend/internal/auth"
	"github.com/AlexArtaud-Dev/velar/backend/internal/config"
	"github.com/AlexArtaud-Dev/velar/backend/internal/database"
	"github.com/AlexArtaud-Dev/velar/backend/internal/models"
	tokensvc "github.com/AlexArtaud-Dev/velar/backend/internal/services/token"
	wgsvc "github.com/AlexArtaud-Dev/velar/backend/internal/services/wireguard"
	"github.com/gin-gonic/gin"
	"github.com/skip2/go-qrcode"
)

type ClientHandler struct {
	wg wgsvc.Service
}

func NewClientHandler(wg wgsvc.Service) *ClientHandler {
	return &ClientHandler{wg: wg}
}

type createClientRequest struct {
	InterfaceID uint       `json:"interface_id" binding:"required"`
	Name        string     `json:"name" binding:"required"`
	OwnerLabel  string     `json:"owner_label"`
	AllowedIPs  string     `json:"allowed_ips"`
	ExpiresAt   *time.Time `json:"expires_at"`
}

func (h *ClientHandler) List(c *gin.Context) {
	ifaceID := c.Query("interface_id")
	query := database.DB.Model(&models.Client{})
	if ifaceID != "" {
		query = query.Where("interface_id = ?", ifaceID)
	}
	var clients []models.Client
	query.Find(&clients)
	c.JSON(http.StatusOK, clients)
}

func (h *ClientHandler) Create(c *gin.Context) {
	var req createClientRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var iface models.Interface
	if err := database.DB.First(&iface, req.InterfaceID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "interface not found"})
		return
	}

	// Collect used IPs
	var usedClients []models.Client
	database.DB.Where("interface_id = ?", iface.ID).Find(&usedClients)
	usedIPs := make([]string, 0, len(usedClients))
	for _, cl := range usedClients {
		usedIPs = append(usedIPs, cl.AssignedIP)
	}

	assignedIP, err := wgsvc.AllocateNextIP(iface.Subnet, usedIPs)
	if err != nil {
		c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
		return
	}

	privKey, pubKey, err := h.wg.GenerateKeyPair()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "key generation failed"})
		return
	}
	psk, err := h.wg.GeneratePSK()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "psk generation failed"})
		return
	}

	encPriv, _ := auth.Encrypt(privKey, config.C.AppSecret)
	encPSK, _ := auth.Encrypt(psk, config.C.AppSecret)

	allowedIPs := req.AllowedIPs
	if allowedIPs == "" {
		allowedIPs = "0.0.0.0/0, ::/0"
	}

	client := models.Client{
		InterfaceID:  iface.ID,
		Name:         req.Name,
		OwnerLabel:   req.OwnerLabel,
		PublicKey:    pubKey,
		PrivateKey:   encPriv,
		PresharedKey: encPSK,
		AllowedIPs:   allowedIPs,
		AssignedIP:   assignedIP,
		Enabled:      true,
		ExpiresAt:    req.ExpiresAt,
	}
	if err := database.DB.Create(&client).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	if err := h.wg.AddPeer(iface.Name, pubKey, psk, assignedIP+"/32"); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "wg add peer: " + err.Error()})
		return
	}
	h.syncConf(iface)

	c.JSON(http.StatusCreated, client)
}

func (h *ClientHandler) Get(c *gin.Context) {
	id, _ := strconv.ParseUint(c.Param("id"), 10, 64)
	var client models.Client
	if err := database.DB.Preload("Interface").First(&client, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}
	c.JSON(http.StatusOK, client)
}

func (h *ClientHandler) Update(c *gin.Context) {
	id, _ := strconv.ParseUint(c.Param("id"), 10, 64)
	var client models.Client
	if err := database.DB.First(&client, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}
	var req struct {
		Name       string     `json:"name"`
		OwnerLabel string     `json:"owner_label"`
		AllowedIPs string     `json:"allowed_ips"`
		ExpiresAt  *time.Time `json:"expires_at"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	updates := map[string]interface{}{}
	if req.Name != "" {
		updates["name"] = req.Name
	}
	if req.OwnerLabel != "" {
		updates["owner_label"] = req.OwnerLabel
	}
	if req.AllowedIPs != "" {
		updates["allowed_ips"] = req.AllowedIPs
	}
	if req.ExpiresAt != nil {
		updates["expires_at"] = req.ExpiresAt
	}
	database.DB.Model(&client).Updates(updates)
	c.JSON(http.StatusOK, client)
}

func (h *ClientHandler) Delete(c *gin.Context) {
	id, _ := strconv.ParseUint(c.Param("id"), 10, 64)
	var client models.Client
	if err := database.DB.Preload("Interface").First(&client, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}
	h.wg.RemovePeer(client.Interface.Name, client.PublicKey)
	h.syncConf(client.Interface)
	database.DB.Delete(&client)
	c.JSON(http.StatusOK, gin.H{"message": "deleted"})
}

func (h *ClientHandler) Enable(c *gin.Context) {
	h.setEnabled(c, true)
}

func (h *ClientHandler) Disable(c *gin.Context) {
	h.setEnabled(c, false)
}

func (h *ClientHandler) setEnabled(c *gin.Context, enabled bool) {
	id, _ := strconv.ParseUint(c.Param("id"), 10, 64)
	var client models.Client
	if err := database.DB.Preload("Interface").First(&client, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}

	if enabled {
		psk, _ := auth.Decrypt(client.PresharedKey, config.C.AppSecret)
		h.wg.AddPeer(client.Interface.Name, client.PublicKey, psk, client.AssignedIP+"/32")
	} else {
		h.wg.RemovePeer(client.Interface.Name, client.PublicKey)
	}
	database.DB.Model(&client).Update("enabled", enabled)
	h.syncConf(client.Interface)
	c.JSON(http.StatusOK, gin.H{"enabled": enabled})
}

func (h *ClientHandler) GetConfig(c *gin.Context) {
	conf, _, err := h.buildClientConf(c)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=%s.conf", "client"))
	c.Data(http.StatusOK, "text/plain", []byte(conf))
}

func (h *ClientHandler) GetQR(c *gin.Context) {
	conf, _, err := h.buildClientConf(c)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	png, err := qrcode.Encode(conf, qrcode.Medium, 256)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "qr generation failed"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"qr_code": base64.StdEncoding.EncodeToString(png)})
}

func (h *ClientHandler) CreateDownloadLink(c *gin.Context) {
	id, _ := strconv.ParseUint(c.Param("id"), 10, 64)
	var client models.Client
	if err := database.DB.First(&client, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}
	rawToken, _, err := tokensvc.Generate(client.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"token": rawToken, "url": "/dl/" + rawToken})
}

func (h *ClientHandler) buildClientConf(c *gin.Context) (string, *models.Client, error) {
	id, _ := strconv.ParseUint(c.Param("id"), 10, 64)
	var client models.Client
	if err := database.DB.Preload("Interface").First(&client, id).Error; err != nil {
		return "", nil, fmt.Errorf("not found")
	}

	privKey, err := auth.Decrypt(client.PrivateKey, config.C.AppSecret)
	if err != nil {
		return "", nil, fmt.Errorf("decrypt private key: %w", err)
	}
	psk, err := auth.Decrypt(client.PresharedKey, config.C.AppSecret)
	if err != nil {
		return "", nil, fmt.Errorf("decrypt psk: %w", err)
	}

	endpoint := fmt.Sprintf("%s:%d", config.C.WGHost, client.Interface.Port)
	conf := wgsvc.BuildClientConf(
		privKey,
		client.AssignedIP,
		client.Interface.DNSServer,
		client.Interface.PublicKey,
		psk,
		endpoint,
		client.AllowedIPs,
	)
	return conf, &client, nil
}

func (h *ClientHandler) syncConf(iface models.Interface) {
	privKey, err := auth.Decrypt(iface.PrivateKey, config.C.AppSecret)
	if err != nil {
		slog.Error("syncConf decrypt iface key", "err", err)
		return
	}

	var clients []models.Client
	database.DB.Where("interface_id = ? AND enabled = true", iface.ID).Find(&clients)

	peers := make([]wgsvc.PeerEntry, 0, len(clients))
	for _, cl := range clients {
		psk, _ := auth.Decrypt(cl.PresharedKey, config.C.AppSecret)
		peers = append(peers, wgsvc.PeerEntry{
			Comment:    cl.Name,
			PublicKey:  cl.PublicKey,
			PSK:        psk,
			AllowedIPs: cl.AssignedIP + "/32",
		})
	}

	if err := h.wg.EnsureInterface(iface.Name, iface.Port, privKey, iface.Subnet, iface.PostUp, iface.PostDown, peers); err != nil {
		slog.Error("syncConf write", "err", err)
		return
	}

	path := fmt.Sprintf("%s/%s.conf", config.C.WGConfigDir, iface.Name)
	if err := h.wg.SyncConf(iface.Name, path); err != nil {
		slog.Error("syncConf sync", "err", err)
	}
}
