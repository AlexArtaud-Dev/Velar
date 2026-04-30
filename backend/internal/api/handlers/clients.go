package handlers

import (
	"encoding/base64"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/AlexArtaud-Dev/velar/backend/internal/auth"
	"github.com/AlexArtaud-Dev/velar/backend/internal/config"
	"github.com/AlexArtaud-Dev/velar/backend/internal/database"
	"github.com/AlexArtaud-Dev/velar/backend/internal/models"
	bwsvc "github.com/AlexArtaud-Dev/velar/backend/internal/services/bandwidth"
	"github.com/AlexArtaud-Dev/velar/backend/internal/services/mailer"
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
	InterfaceID    uint       `json:"interface_id" binding:"required"`
	Name           string     `json:"name" binding:"required"`
	OwnerLabel     string     `json:"owner_label"`
	Email          string     `json:"email"`
	AllowedIPs     string     `json:"allowed_ips"`
	ExpiresAt      *time.Time `json:"expires_at"`
	BandwidthLimitDown int    `json:"bandwidth_limit_down"` // Mbps, 0 = unlimited
	BandwidthLimitUp   int    `json:"bandwidth_limit_up"`   // Mbps, 0 = unlimited
}

// buildDownloadURL constructs a full download URL from a raw token.
// Falls back to the path-only form if APP_URL is not configured.
func buildDownloadURL(rawToken string) string {
	if base := config.C.AppURL; base != "" {
		return strings.TrimRight(base, "/") + "/dl/" + rawToken
	}
	return "/dl/" + rawToken
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
		allowedIPs = defaultClientAllowedIPs(iface)
	}

	client := models.Client{
		InterfaceID:    iface.ID,
		Name:           req.Name,
		OwnerLabel:     req.OwnerLabel,
		Email:          req.Email,
		PublicKey:      pubKey,
		PrivateKey:     encPriv,
		PresharedKey:   encPSK,
		AllowedIPs:     allowedIPs,
		AssignedIP:     assignedIP,
		BandwidthLimitDown: req.BandwidthLimitDown,
		BandwidthLimitUp:   req.BandwidthLimitUp,
		Enabled:        true,
		ExpiresAt:      req.ExpiresAt,
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

	if !config.C.WGMock && (client.BandwidthLimitDown > 0 || client.BandwidthLimitUp > 0) {
		if err := bwsvc.Apply(iface.Name, assignedIP, client.BandwidthLimitDown, client.BandwidthLimitUp); err != nil {
			slog.Warn("create client: apply bandwidth limit", "client", client.Name, "err", err)
		}
	}

	// --- Email: admin notification ---
	owner := client.OwnerLabel
	if owner == "" {
		owner = "—"
	}
	mailer.SendHTML(
		fmt.Sprintf("New client added: %s", client.Name),
		mailer.HTMLAdminClientCreated(client.Name, client.AssignedIP, iface.Name, owner),
	)

	// --- Email: send one-time download link to client ---
	if client.Email != "" {
		rawToken, _, err := tokensvc.Generate(client.ID)
		if err == nil {
			expiry := "No expiry"
			if client.ExpiresAt != nil {
				expiry = client.ExpiresAt.UTC().Format("2006-01-02 15:04 UTC")
			}
			mailer.SendHTMLTo(
				client.Email,
				fmt.Sprintf("Your VPN access is ready: %s", client.Name),
				mailer.HTMLClientWelcome(client.Name, client.AssignedIP, expiry, buildDownloadURL(rawToken)),
			)
		} else {
			slog.Warn("create client: failed to generate download token for email", "client", client.Name, "err", err)
		}
	}

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
	if err := database.DB.Preload("Interface").First(&client, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}
	var req struct {
		Name           string     `json:"name"`
		OwnerLabel     string     `json:"owner_label"`
		Email          string     `json:"email"`
		AllowedIPs     string     `json:"allowed_ips"`
		ExpiresAt      *time.Time `json:"expires_at"`
		// ClearExpiresAt explicitly removes the expiry date.
		// Needed because *time.Time cannot distinguish JSON null from "field omitted".
		ClearExpiresAt     bool   `json:"clear_expires_at"`
		BandwidthLimitDown *int   `json:"bandwidth_limit_down"` // Mbps; nil = no change, 0 = unlimited
		BandwidthLimitUp   *int   `json:"bandwidth_limit_up"`   // Mbps; nil = no change, 0 = unlimited
		DataQuotaBytes     *int64 `json:"data_quota_bytes"`     // bytes; nil = no change, 0 = unlimited
		QuotaPeriod        string `json:"quota_period"`         // monthly | weekly | total
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
	// Allow clearing email by sending empty string explicitly
	updates["email"] = req.Email
	if req.AllowedIPs != "" {
		updates["allowed_ips"] = req.AllowedIPs
	}
	if req.ClearExpiresAt {
		updates["expires_at"] = nil
	} else if req.ExpiresAt != nil {
		updates["expires_at"] = req.ExpiresAt
	}
	if req.BandwidthLimitDown != nil {
		updates["bandwidth_limit_down"] = *req.BandwidthLimitDown
	}
	if req.BandwidthLimitUp != nil {
		updates["bandwidth_limit_up"] = *req.BandwidthLimitUp
	}
	if req.DataQuotaBytes != nil {
		updates["data_quota_bytes"] = *req.DataQuotaBytes
		// Reset the warning flag when the quota changes so the new threshold triggers fresh
		updates["quota_warned_at"] = nil
	}
	if req.QuotaPeriod != "" {
		updates["quota_period"] = req.QuotaPeriod
		updates["quota_warned_at"] = nil
	}
	database.DB.Model(&client).Updates(updates)
	database.DB.Preload("Interface").First(&client, id)

	// Apply / remove bandwidth limit after DB update
	bwChanged := req.BandwidthLimitDown != nil || req.BandwidthLimitUp != nil
	if bwChanged && !config.C.WGMock && client.Enabled {
		if err := bwsvc.Apply(client.Interface.Name, client.AssignedIP, client.BandwidthLimitDown, client.BandwidthLimitUp); err != nil {
			slog.Warn("update client: apply bandwidth limit", "client", client.Name, "err", err)
		}
	}

	// Notify client of changes
	mailer.SendHTMLTo(
		client.Email,
		fmt.Sprintf("Your VPN config was updated: %s", client.Name),
		mailer.HTMLClientUpdated(client.Name, client.AssignedIP),
	)
	// Notify admin
	mailer.SendHTML(
		fmt.Sprintf("Client updated: %s", client.Name),
		mailer.HTMLAdminClientUpdated(client.Name, client.AssignedIP, client.Interface.Name),
	)

	c.JSON(http.StatusOK, client)
}

func (h *ClientHandler) Delete(c *gin.Context) {
	id, _ := strconv.ParseUint(c.Param("id"), 10, 64)
	var client models.Client
	if err := database.DB.Preload("Interface").First(&client, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}

	// Notify before touching anything
	mailer.SendHTMLTo(
		client.Email,
		fmt.Sprintf("VPN access revoked: %s", client.Name),
		mailer.HTMLClientDeleted(client.Name, client.AssignedIP),
	)

	// Cascade-delete child records first — PRAGMA foreign_keys=ON would otherwise
	// block the client DELETE with a constraint violation (silent 200 with no effect).
	database.DB.Where("client_id = ?", client.ID).Delete(&models.DownloadToken{})
	database.DB.Where("client_id = ?", client.ID).Delete(&models.ConnectionEvent{})

	// Delete from DB BEFORE syncConf — syncConf rebuilds the conf from the DB, so
	// deleting first ensures the peer is excluded from the generated config and
	// wg syncconf doesn't re-add it after RemovePeer.
	if err := database.DB.Delete(&client).Error; err != nil {
		slog.Error("delete client: db", "client", client.Name, "err", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "database error: " + err.Error()})
		return
	}

	// Remove from running wg state (best-effort — if the interface is down this will
	// error, but the conf rebuild below will handle it on next bring-up)
	if err := h.wg.RemovePeer(client.Interface.Name, client.PublicKey); err != nil {
		slog.Warn("delete client: remove peer wg", "iface", client.Interface.Name, "err", err)
	}
	if !config.C.WGMock {
		bwsvc.Remove(client.Interface.Name, client.AssignedIP) //nolint:errcheck
	}

	// Sync conf — now generated without the deleted client
	h.syncConf(client.Interface)

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
		if !config.C.WGMock && (client.BandwidthLimitDown > 0 || client.BandwidthLimitUp > 0) {
			if err := bwsvc.Apply(client.Interface.Name, client.AssignedIP, client.BandwidthLimitDown, client.BandwidthLimitUp); err != nil {
				slog.Warn("enable client: apply bandwidth limit", "client", client.Name, "err", err)
			}
		}
	} else {
		h.wg.RemovePeer(client.Interface.Name, client.PublicKey)
		if !config.C.WGMock {
			bwsvc.Remove(client.Interface.Name, client.AssignedIP) //nolint:errcheck
		}
	}
	database.DB.Model(&client).Update("enabled", enabled)
	h.syncConf(client.Interface)

	// Notify client
	if enabled {
		mailer.SendHTMLTo(
			client.Email,
			fmt.Sprintf("VPN access re-enabled: %s", client.Name),
			mailer.HTMLClientEnabled(client.Name, client.AssignedIP),
		)
	} else {
		mailer.SendHTMLTo(
			client.Email,
			fmt.Sprintf("VPN access disabled: %s", client.Name),
			mailer.HTMLClientDisabled(client.Name, client.AssignedIP),
		)
	}
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
	png, err := qrcode.Encode(conf, qrcode.Low, 512)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "qr generation failed"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"qr_code": base64.StdEncoding.EncodeToString(png)})
}

// SendConfig generates a fresh one-time download link and emails it to the
// client. Can be triggered manually from the dashboard at any time.
func (h *ClientHandler) SendConfig(c *gin.Context) {
	id, _ := strconv.ParseUint(c.Param("id"), 10, 64)
	var client models.Client
	if err := database.DB.Preload("Interface").First(&client, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}
	if client.Email == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "this client has no email address"})
		return
	}
	if !mailer.SMTPEnabled() {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "SMTP is not configured on this server"})
		return
	}

	rawToken, _, err := tokensvc.Generate(client.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not generate download link"})
		return
	}

	expiry := "No expiry"
	if client.ExpiresAt != nil {
		expiry = client.ExpiresAt.UTC().Format("2006-01-02 15:04 UTC")
	}

	mailer.SendHTMLTo(
		client.Email,
		fmt.Sprintf("Your VPN profile: %s", client.Name),
		mailer.HTMLClientWelcome(client.Name, client.AssignedIP, expiry, buildDownloadURL(rawToken)),
	)

	c.JSON(http.StatusOK, gin.H{"message": "email sent"})
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

// GetSnapshots returns per-client bandwidth history bucketed by time.
// Accepts ?range=1h (default 24h) | 24h | 7d.
func (h *ClientHandler) GetSnapshots(c *gin.Context) {
	id, _ := strconv.ParseUint(c.Param("id"), 10, 64)
	since, bucketDur := parseRangeClient(c.DefaultQuery("range", "24h"))

	var snapshots []models.PeerSnapshot
	database.DB.
		Where("client_id = ? AND timestamp > ?", id, time.Now().Add(-since)).
		Order("timestamp ASC").
		Find(&snapshots)

	c.JSON(http.StatusOK, bucketSnapshots(snapshots, bucketDur))
}

// GetEvents returns the connection event history for a single client.
func (h *ClientHandler) GetEvents(c *gin.Context) {
	id, _ := strconv.ParseUint(c.Param("id"), 10, 64)

	var events []models.ConnectionEvent
	database.DB.
		Where("client_id = ?", id).
		Order("timestamp DESC").
		Limit(100).
		Find(&events)

	c.JSON(http.StatusOK, events)
}

// ── Bulk operations ───────────────────────────────────────────────────────────

type bulkRequest struct {
	IDs []uint `json:"ids" binding:"required"`
}

func (h *ClientHandler) BulkEnable(c *gin.Context) {
	var req bulkRequest
	if err := c.ShouldBindJSON(&req); err != nil || len(req.IDs) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "ids required"})
		return
	}

	var clients []models.Client
	database.DB.Preload("Interface").Where("id IN ?", req.IDs).Find(&clients)

	ifacesSynced := map[uint]models.Interface{}
	for _, cl := range clients {
		if cl.Enabled {
			continue
		}
		psk, _ := auth.Decrypt(cl.PresharedKey, config.C.AppSecret)
		h.wg.AddPeer(cl.Interface.Name, cl.PublicKey, psk, cl.AssignedIP+"/32")
		if !config.C.WGMock && (cl.BandwidthLimitDown > 0 || cl.BandwidthLimitUp > 0) {
			bwsvc.Apply(cl.Interface.Name, cl.AssignedIP, cl.BandwidthLimitDown, cl.BandwidthLimitUp) //nolint:errcheck
		}
		database.DB.Model(&cl).Update("enabled", true)
		ifacesSynced[cl.InterfaceID] = cl.Interface
	}
	for _, iface := range ifacesSynced {
		h.syncConf(iface)
	}
	c.JSON(http.StatusOK, gin.H{"updated": len(clients)})
}

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
		h.wg.RemovePeer(cl.Interface.Name, cl.PublicKey)
		if !config.C.WGMock {
			bwsvc.Remove(cl.Interface.Name, cl.AssignedIP) //nolint:errcheck
		}
		database.DB.Model(&cl).Update("enabled", false)
		ifacesSynced[cl.InterfaceID] = cl.Interface
	}
	for _, iface := range ifacesSynced {
		h.syncConf(iface)
	}
	c.JSON(http.StatusOK, gin.H{"updated": len(clients)})
}

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
		// Cascade-delete child records
		database.DB.Where("client_id = ?", cl.ID).Delete(&models.DownloadToken{})
		database.DB.Where("client_id = ?", cl.ID).Delete(&models.ConnectionEvent{})
		database.DB.Where("client_id = ?", cl.ID).Delete(&models.PeerSnapshot{})

		if err := database.DB.Delete(&cl).Error; err != nil {
			slog.Error("bulk delete: db", "client", cl.Name, "err", err)
			continue
		}
		h.wg.RemovePeer(cl.Interface.Name, cl.PublicKey)
		if !config.C.WGMock {
			bwsvc.Remove(cl.Interface.Name, cl.AssignedIP) //nolint:errcheck
		}
		ifacesSynced[cl.InterfaceID] = cl.Interface
	}
	for _, iface := range ifacesSynced {
		h.syncConf(iface)
	}
	c.JSON(http.StatusOK, gin.H{"deleted": len(clients)})
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

// buildConfString constructs the WireGuard client config text from raw keys.
// Used when we have the plain (unencrypted) keys in hand.
func buildConfString(client models.Client, iface models.Interface, privKey, psk string) string {
	endpoint := fmt.Sprintf("%s:%d", config.C.WGHost, iface.Port)
	return wgsvc.BuildClientConf(privKey, client.AssignedIP, iface.DNSServer, iface.PublicKey, psk, endpoint, client.AllowedIPs)
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
