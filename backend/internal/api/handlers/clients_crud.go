package handlers

import (
	"crypto/rand"
	"encoding/hex"
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
)

// generateViewToken creates a cryptographically random 32-byte hex token
// used for the read-only client portal URL.
func generateViewToken() string {
	b := make([]byte, 32)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// buildPortalURL constructs the public portal URL for a client view token.
func buildPortalURL(viewToken string) string {
	if base := config.C.AppURL; base != "" {
		return strings.TrimRight(base, "/") + "/portal/" + viewToken
	}
	return "/portal/" + viewToken
}

// quotaRemaining computes how many bytes a client has left in the current quota
// period by summing PeerSnapshot rows since the period start. The result is
// clamped to a minimum of 1 so that "just exceeded" clients immediately block
// again after a re-add.
//
// Note: this uses only persisted snapshots (not the live WG delta) which
// introduces a small undercount of up to one snapshot interval (~60 s), but
// that is acceptable when setting up a fresh nftables rule.
func quotaRemaining(client models.Client) int64 {
	periodStart := quotaUsagePeriodStart(client.QuotaPeriod)
	if client.QuotaResetAt != nil && client.QuotaResetAt.After(periodStart) {
		periodStart = *client.QuotaResetAt
	}

	var result struct{ Total int64 }
	q := database.DB.Model(&models.PeerSnapshot{}).
		Select("COALESCE(SUM(bytes_rx + bytes_tx), 0) as total").
		Where("client_id = ?", client.ID)
	if !periodStart.IsZero() {
		q = q.Where("timestamp >= ?", periodStart)
	}
	q.Scan(&result)

	remaining := client.DataQuotaBytes - result.Total
	if remaining < 1 {
		remaining = 1
	}
	return remaining
}

// createClientRequest is the JSON body for POST /clients.
type createClientRequest struct {
	InterfaceID        uint       `json:"interface_id" binding:"required"`
	Name               string     `json:"name" binding:"required"`
	OwnerLabel         string     `json:"owner_label"`
	Email              string     `json:"email"`
	AllowedIPs         string     `json:"allowed_ips"`
	ExpiresAt          *time.Time `json:"expires_at"`
	BandwidthLimitDown int        `json:"bandwidth_limit_down"` // Mbps, 0 = unlimited
	BandwidthLimitUp   int        `json:"bandwidth_limit_up"`   // Mbps, 0 = unlimited
}

// List returns all clients, optionally filtered by ?interface_id=<id>.
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

// Get returns a single client by ID, with its Interface preloaded.
func (h *ClientHandler) Get(c *gin.Context) {
	id, _ := strconv.ParseUint(c.Param("id"), 10, 64)
	var client models.Client
	if err := database.DB.Preload("Interface").First(&client, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}
	c.JSON(http.StatusOK, client)
}

// Create provisions a new WireGuard peer: generates a fresh keypair and PSK,
// allocates an IP from the interface subnet, persists the record, adds the peer
// to the running wg state, and optionally sends a welcome email.
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

	// Collect IPs already in use to avoid conflicts during allocation.
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
		InterfaceID:        iface.ID,
		Name:               req.Name,
		OwnerLabel:         req.OwnerLabel,
		Email:              req.Email,
		PublicKey:          pubKey,
		PrivateKey:         encPriv,
		PresharedKey:       encPSK,
		AllowedIPs:         allowedIPs,
		AssignedIP:         assignedIP,
		BandwidthLimitDown: req.BandwidthLimitDown,
		BandwidthLimitUp:   req.BandwidthLimitUp,
		Enabled:            true,
		ExpiresAt:          req.ExpiresAt,
		ViewToken:          generateViewToken(),
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

	// Notify admin.
	// Note: quota is intentionally NOT set at creation time — it is configured
	// later via the Update endpoint, which calls nft.Apply at that point.
	owner := client.OwnerLabel
	if owner == "" {
		owner = "—"
	}
	mailer.SendHTML(
		fmt.Sprintf("New client added: %s", client.Name),
		mailer.HTMLAdminClientCreated(client.Name, client.AssignedIP, iface.Name, owner),
	)

	// Send one-time download link to client if an email address is set.
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
				mailer.HTMLClientWelcome(client.Name, client.AssignedIP, expiry, buildDownloadURL(rawToken), buildPortalURL(client.ViewToken)),
			)
		} else {
			slog.Warn("create client: generate download token for email", "client", client.Name, "err", err)
		}
	}

	expiryStr := "never"
	if client.ExpiresAt != nil {
		expiryStr = client.ExpiresAt.UTC().Format("2006-01-02")
	}
	ownerStr := client.OwnerLabel
	if ownerStr == "" {
		ownerStr = "—"
	}
	auditLog(c, "client.create", "client", client.ID, client.Name,
		fmt.Sprintf("interface=%s ip=%s email=%s owner=%s bw_down=%dMbps bw_up=%dMbps expires=%s",
			iface.Name, assignedIP, client.Email, ownerStr,
			client.BandwidthLimitDown, client.BandwidthLimitUp, expiryStr))

	c.JSON(http.StatusCreated, client)
}

// updateClientRequest is the JSON body for PUT /clients/:id.
// Pointer fields allow distinguishing "not sent" from zero values.
type updateClientRequest struct {
	Name           string     `json:"name"`
	OwnerLabel     string     `json:"owner_label"`
	Email          string     `json:"email"`
	AllowedIPs     string     `json:"allowed_ips"`
	ExpiresAt      *time.Time `json:"expires_at"`
	// ClearExpiresAt explicitly nullifies the expiry date.
	// Required because *time.Time cannot distinguish JSON null from "field omitted".
	ClearExpiresAt     bool   `json:"clear_expires_at"`
	BandwidthLimitDown *int   `json:"bandwidth_limit_down"` // Mbps; nil = no change, 0 = unlimited
	BandwidthLimitUp   *int   `json:"bandwidth_limit_up"`   // Mbps; nil = no change, 0 = unlimited
	DataQuotaBytes     *int64 `json:"data_quota_bytes"`     // bytes; nil = no change, 0 = unlimited
	QuotaPeriod        string `json:"quota_period"`         // monthly | weekly | total
}

// Update applies a partial update to a client record.
// Bandwidth changes are applied live; quota changes reset the warning state.
func (h *ClientHandler) Update(c *gin.Context) {
	id, _ := strconv.ParseUint(c.Param("id"), 10, 64)
	var client models.Client
	if err := database.DB.Preload("Interface").First(&client, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}

	var req updateClientRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Remember quota-suspension state before building the update map.
	wasQuotaSuspended := client.QuotaSuspended

	updates := map[string]interface{}{}
	if req.Name != "" {
		updates["name"] = req.Name
	}
	if req.OwnerLabel != "" {
		updates["owner_label"] = req.OwnerLabel
	}
	// Allow clearing email by sending an explicit empty string.
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
		// Reset warning flag so the new threshold triggers a fresh warning.
		updates["quota_warned_at"] = nil
		// If the client was auto-suspended by the quota job, re-enable it now
		// that the admin has raised (or cleared) the quota.
		if wasQuotaSuspended {
			updates["enabled"] = true
			updates["quota_suspended"] = false
		}
	}
	if req.QuotaPeriod != "" {
		updates["quota_period"] = req.QuotaPeriod
		updates["quota_warned_at"] = nil
	}

	database.DB.Model(&client).Updates(updates)
	database.DB.Preload("Interface").First(&client, id)

	// Handle nftables quota rules whenever the quota value changes.
	if req.DataQuotaBytes != nil && !config.C.WGMock {
		if *req.DataQuotaBytes == 0 {
			// Quota removed — tear down any existing nft rule.
			h.nft.Remove(client.AssignedIP) //nolint:errcheck
		} else if client.Enabled {
			// Quota set or changed while client is active — reset the kernel
			// counter to the current remaining budget.
			if err := h.nft.Reset(client.AssignedIP, quotaRemaining(client)); err != nil {
				slog.Warn("update client: nft reset quota", "client", client.Name, "err", err)
			}
		}
	}

	// If the quota update re-enabled a previously suspended client, re-add the
	// peer to the running WireGuard interface so it can connect immediately.
	if req.DataQuotaBytes != nil && wasQuotaSuspended {
		psk, _ := auth.Decrypt(client.PresharedKey, config.C.AppSecret)
		if err := h.wg.AddPeer(client.Interface.Name, client.PublicKey, psk, client.AssignedIP+"/32"); err != nil {
			slog.Warn("update client: re-add quota-suspended peer", "client", client.Name, "err", err)
		}
		// Re-apply the nft rule now that the peer is active again.
		if !config.C.WGMock && client.DataQuotaBytes > 0 {
			if err := h.nft.Apply(client.AssignedIP, quotaRemaining(client)); err != nil {
				slog.Warn("update client: nft apply after re-enable", "client", client.Name, "err", err)
			}
		}
		h.syncConf(client.Interface)
	}

	// Apply / clear bandwidth shaping after the DB update.
	if (req.BandwidthLimitDown != nil || req.BandwidthLimitUp != nil) && !config.C.WGMock && client.Enabled {
		if err := bwsvc.Apply(client.Interface.Name, client.AssignedIP, client.BandwidthLimitDown, client.BandwidthLimitUp); err != nil {
			slog.Warn("update client: apply bandwidth limit", "client", client.Name, "err", err)
		}
	}

	// Email notifications (best-effort — failures are logged, not propagated).
	mailer.SendHTMLTo(
		client.Email,
		fmt.Sprintf("Your VPN config was updated: %s", client.Name),
		mailer.HTMLClientUpdated(client.Name, client.AssignedIP),
	)
	mailer.SendHTML(
		fmt.Sprintf("Client updated: %s", client.Name),
		mailer.HTMLAdminClientUpdated(client.Name, client.AssignedIP, client.Interface.Name),
	)

	changedKeys := make([]string, 0, len(updates))
	for k := range updates {
		changedKeys = append(changedKeys, k)
	}
	auditLog(c, "client.update", "client", client.ID, client.Name,
		fmt.Sprintf("interface=%s ip=%s email=%s changed=[%s]",
			client.Interface.Name, client.AssignedIP, client.Email, strings.Join(changedKeys, ",")))

	c.JSON(http.StatusOK, client)
}

// Delete removes a client from the DB and from the running WireGuard interface.
// Child records (DownloadToken, ConnectionEvent, PeerSnapshot) are cascade-deleted
// first because PRAGMA foreign_keys=ON would otherwise block the parent DELETE.
func (h *ClientHandler) Delete(c *gin.Context) {
	id, _ := strconv.ParseUint(c.Param("id"), 10, 64)
	var client models.Client
	if err := database.DB.Preload("Interface").First(&client, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}

	// Notify the client before touching any records.
	mailer.SendHTMLTo(
		client.Email,
		fmt.Sprintf("VPN access revoked: %s", client.Name),
		mailer.HTMLClientDeleted(client.Name, client.AssignedIP),
	)

	// Cascade-delete children before the parent to satisfy FK constraints.
	database.DB.Where("client_id = ?", client.ID).Delete(&models.DownloadToken{})
	database.DB.Where("client_id = ?", client.ID).Delete(&models.ConnectionEvent{})
	database.DB.Where("client_id = ?", client.ID).Delete(&models.PeerSnapshot{})

	// Delete from DB first — syncConf rebuilds from DB, so deleting before
	// syncConf ensures the peer is absent from the new .conf.
	if err := database.DB.Delete(&client).Error; err != nil {
		slog.Error("delete client: db", "client", client.Name, "err", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "database error: " + err.Error()})
		return
	}

	// Remove peer from the running wg state (best-effort — may fail if the
	// interface is currently down; the conf rebuild handles it on next bring-up).
	if err := h.wg.RemovePeer(client.Interface.Name, client.PublicKey); err != nil {
		slog.Warn("delete client: remove peer", "iface", client.Interface.Name, "err", err)
	}
	if !config.C.WGMock {
		bwsvc.Remove(client.Interface.Name, client.AssignedIP) //nolint:errcheck
		if client.DataQuotaBytes > 0 {
			h.nft.Remove(client.AssignedIP) //nolint:errcheck
		}
	}

	h.syncConf(client.Interface)

	auditLog(c, "client.delete", "client", client.ID, client.Name,
		fmt.Sprintf("interface=%s ip=%s email=%s owner=%s",
			client.Interface.Name, client.AssignedIP, client.Email, client.OwnerLabel))

	c.JSON(http.StatusOK, gin.H{"message": "deleted"})
}
