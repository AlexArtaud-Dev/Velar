package handlers

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/AlexArtaud-Dev/velar/backend/internal/auth"
	"github.com/AlexArtaud-Dev/velar/backend/internal/config"
	"github.com/AlexArtaud-Dev/velar/backend/internal/database"
	"github.com/AlexArtaud-Dev/velar/backend/internal/models"
	"github.com/AlexArtaud-Dev/velar/backend/internal/services/mailer"
	"github.com/gin-gonic/gin"
)

// InstanceHandler manages remote slave instances from the master.
type InstanceHandler struct{}

func NewInstanceHandler() *InstanceHandler { return &InstanceHandler{} }

// registerInstanceRequest is the JSON body for POST /api/v1/instances.
type registerInstanceRequest struct {
	Name  string `json:"name" binding:"required"`
	URL   string `json:"url" binding:"required"`
	Token string `json:"token" binding:"required"` // vs_… slave token
}

// instanceProxyRequest is the JSON body for POST /api/v1/instances/:id/proxy.
type instanceProxyRequest struct {
	Method string          `json:"method" binding:"required"`
	Path   string          `json:"path" binding:"required"`
	Body   json.RawMessage `json:"body"`
}

// List returns all registered remote instances.
//
// Route: GET /api/v1/instances
func (h *InstanceHandler) List(c *gin.Context) {
	var instances []models.RemoteInstance
	database.DB.Order("created_at DESC").Find(&instances)
	c.JSON(http.StatusOK, instances)
}

// Register adds a new slave instance to the master.
// It verifies reachability via the slave's public /health endpoint before saving.
//
// Route: POST /api/v1/instances
func (h *InstanceHandler) Register(c *gin.Context) {
	var req registerInstanceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if !strings.HasPrefix(req.Token, "vs_") {
		c.JSON(http.StatusBadRequest, gin.H{"error": "token must start with vs_"})
		return
	}

	// Verify the slave is reachable before storing
	baseURL := strings.TrimRight(req.URL, "/")
	hc := &http.Client{Timeout: 5 * time.Second}
	resp, err := hc.Get(baseURL + "/health")
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "slave unreachable: " + err.Error()})
		return
	}
	resp.Body.Close()

	encToken, err := auth.Encrypt(req.Token, config.C.AppSecret)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "token encryption failed"})
		return
	}

	instance := models.RemoteInstance{
		Name:           req.Name,
		URL:            baseURL,
		TokenEncrypted: encToken,
		TokenPrefix:    req.Token[:8], // "vs_" + 5 chars
	}
	if err := database.DB.Create(&instance).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	auditLog(c, "instance.register", "instance", instance.ID, instance.Name,
		fmt.Sprintf("url=%s token_prefix=%s", instance.URL, instance.TokenPrefix))

	c.JSON(http.StatusCreated, instance)
}

// Delete removes a slave instance from the master.
//
// Route: DELETE /api/v1/instances/:id
func (h *InstanceHandler) Delete(c *gin.Context) {
	id, _ := strconv.ParseUint(c.Param("id"), 10, 64)
	var instance models.RemoteInstance
	if err := database.DB.First(&instance, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "instance not found"})
		return
	}
	database.DB.Delete(&instance)

	auditLog(c, "instance.delete", "instance", instance.ID, instance.Name,
		fmt.Sprintf("url=%s", instance.URL))

	c.JSON(http.StatusOK, gin.H{"message": "instance removed"})
}

// Ping checks the health of a remote slave by calling its public /health endpoint.
// No token needed — /health is public on the slave.
//
// Route: GET /api/v1/instances/:id/ping
func (h *InstanceHandler) Ping(c *gin.Context) {
	id, _ := strconv.ParseUint(c.Param("id"), 10, 64)
	var instance models.RemoteInstance
	if err := database.DB.First(&instance, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "instance not found"})
		return
	}

	hc := &http.Client{Timeout: 5 * time.Second}
	resp, err := hc.Get(instance.URL + "/health")
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"reachable": false, "error": err.Error()})
		return
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	now := time.Now()
	database.DB.Model(&instance).Update("last_seen_at", &now)

	var health map[string]any
	_ = json.Unmarshal(body, &health)
	c.JSON(http.StatusOK, gin.H{"reachable": true, "health": health})
}

// Proxy forwards an arbitrary authenticated request to a slave instance.
// The slave token is decrypted server-side and never sent to the browser.
//
// Route: POST /api/v1/instances/:id/proxy
func (h *InstanceHandler) Proxy(c *gin.Context) {
	id, _ := strconv.ParseUint(c.Param("id"), 10, 64)

	var req instanceProxyRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var instance models.RemoteInstance
	if err := database.DB.First(&instance, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "instance not found"})
		return
	}

	token, err := auth.Decrypt(instance.TokenEncrypted, config.C.AppSecret)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "token decryption failed"})
		return
	}

	targetURL := instance.URL + req.Path

	var bodyReader io.Reader
	if len(req.Body) > 0 && string(req.Body) != "null" {
		bodyReader = bytes.NewReader(req.Body)
	}

	method := strings.ToUpper(req.Method)
	httpReq, err := http.NewRequest(method, targetURL, bodyReader)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "request build failed"})
		return
	}
	httpReq.Header.Set("Authorization", "Bearer "+token)
	if bodyReader != nil {
		httpReq.Header.Set("Content-Type", "application/json")
	}

	hc := &http.Client{Timeout: 15 * time.Second}
	t0 := time.Now()
	resp, err := hc.Do(httpReq)
	durationMS := time.Since(t0).Milliseconds()
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "slave unreachable: " + err.Error()})
		return
	}
	defer resp.Body.Close()

	now := time.Now()
	database.DB.Model(&instance).Update("last_seen_at", &now)

	respBody, _ := io.ReadAll(resp.Body)
	ct := resp.Header.Get("Content-Type")

	// Master-side audit for all mutating slave proxy calls
	if method != http.MethodGet && resp.StatusCode < 400 {
		action := inferSlaveAction(method, req.Path)
		auditLog(c, action, "instance", instance.ID, instance.Name,
			fmt.Sprintf("slave=%s method=%s path=%s status=%d", instance.Name, method, req.Path, resp.StatusCode))
	}

	c.JSON(http.StatusOK, gin.H{
		"status":       resp.StatusCode,
		"status_text":  resp.Status,
		"content_type": ct,
		"body":         string(respBody),
		"duration_ms":  durationMS,
	})
}

// inferSlaveAction converts a proxy method+path into a human-readable audit action.
// Examples:
//
//	POST   /api/v1/interfaces          → "slave.interface.create"
//	PUT    /api/v1/interfaces/3        → "slave.interface.update"
//	DELETE /api/v1/clients/7          → "slave.client.delete"
//	POST   /api/v1/interfaces/3/up    → "slave.interface.up"
//	POST   /api/v1/clients/7/enable   → "slave.client.enable"
func inferSlaveAction(method, path string) string {
	// Strip leading /api/v1/ or /api/ prefix
	p := path
	for _, prefix := range []string{"/api/v1/", "/api/"} {
		if strings.HasPrefix(p, prefix) {
			p = strings.TrimPrefix(p, prefix)
			break
		}
	}
	parts := strings.Split(strings.Trim(p, "/"), "/")
	if len(parts) == 0 || parts[0] == "" {
		return "slave.proxy"
	}

	// Singularise the resource name (interfaces→interface, clients→client)
	resource := strings.TrimSuffix(parts[0], "s")

	// /resource/:id/<action>  e.g. interfaces/3/up, clients/7/enable
	if len(parts) >= 3 {
		return "slave." + resource + "." + parts[2]
	}

	// /resource  or  /resource/:id
	switch strings.ToUpper(method) {
	case http.MethodPost:
		return "slave." + resource + ".create"
	case http.MethodPut, http.MethodPatch:
		return "slave." + resource + ".update"
	case http.MethodDelete:
		return "slave." + resource + ".delete"
	default:
		return "slave.proxy"
	}
}

// slaveClient is a minimal subset of the slave's client JSON used by SendSlaveClientConfig.
type slaveClient struct {
	ID         uint    `json:"id"`
	Name       string  `json:"name"`
	Email      string  `json:"email"`
	AssignedIP string  `json:"assigned_ip"`
	OwnerLabel string  `json:"owner_label"`
	ExpiresAt  *string `json:"expires_at"`
	ViewToken  string  `json:"view_token"`
}

// slaveClientNotifyRequest is the body for POST /instances/:id/clients/notify.
type slaveClientNotifyRequest struct {
	// Event is one of: created, updated, deleted, enabled, disabled.
	Event  string      `json:"event" binding:"required"`
	Client slaveClient `json:"client" binding:"required"`
	// InterfaceName is optional — used in admin email subject lines when known.
	InterfaceName string `json:"interface_name"`
}

// slaveDownloadLink is the response from POST /api/v1/clients/:id/download-link on the slave.
type slaveDownloadLink struct {
	Token string `json:"token"`
	URL   string `json:"url"`
}

// SendSlaveClientConfig sends a one-time config download email for a client
// hosted on a slave instance, using the master's SMTP configuration.
//
// Flow:
//  1. Master fetches client data from the slave.
//  2. Master creates a one-time download token on the slave.
//  3. Master sends the email via its own SMTP.
//
// Route: POST /api/v1/instances/:id/clients/:clientId/send-config
func (h *InstanceHandler) SendSlaveClientConfig(c *gin.Context) {
	instanceID, _ := strconv.ParseUint(c.Param("id"), 10, 64)
	clientID := c.Param("clientId")

	// 1. Check master SMTP
	if !mailer.SMTPEnabled() {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "SMTP is not configured on this server"})
		return
	}

	// 2. Load slave instance
	var instance models.RemoteInstance
	if err := database.DB.First(&instance, instanceID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "instance not found"})
		return
	}

	token, err := auth.Decrypt(instance.TokenEncrypted, config.C.AppSecret)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "token decryption failed"})
		return
	}

	hc := &http.Client{Timeout: 15 * time.Second}

	// 3. Fetch client from slave
	clientURL := instance.URL + "/api/v1/clients/" + clientID
	getReq, _ := http.NewRequest(http.MethodGet, clientURL, nil)
	getReq.Header.Set("Authorization", "Bearer "+token)
	getResp, err := hc.Do(getReq)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "could not reach slave: " + err.Error()})
		return
	}
	defer getResp.Body.Close()
	if getResp.StatusCode != http.StatusOK {
		c.JSON(http.StatusBadGateway, gin.H{"error": fmt.Sprintf("slave returned %d when fetching client", getResp.StatusCode)})
		return
	}
	var sc slaveClient
	if err := json.NewDecoder(getResp.Body).Decode(&sc); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not parse client data from slave"})
		return
	}
	if sc.Email == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "this client has no email address"})
		return
	}

	// 4. Create one-time download token on the slave
	dlURL := instance.URL + "/api/v1/clients/" + clientID + "/download-link"
	dlReq, _ := http.NewRequest(http.MethodPost, dlURL, nil)
	dlReq.Header.Set("Authorization", "Bearer "+token)
	dlResp, err := hc.Do(dlReq)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "could not create download link on slave: " + err.Error()})
		return
	}
	defer dlResp.Body.Close()
	if dlResp.StatusCode != http.StatusOK {
		c.JSON(http.StatusBadGateway, gin.H{"error": fmt.Sprintf("slave returned %d when creating download link", dlResp.StatusCode)})
		return
	}
	var dl slaveDownloadLink
	if err := json.NewDecoder(dlResp.Body).Decode(&dl); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not parse download link from slave"})
		return
	}

	// 5. Build the download URL — routed through the master so the slave's
	//    internal URL never appears in the email.
	var downloadURL string
	if base := config.C.AppURL; base != "" {
		downloadURL = strings.TrimRight(base, "/") + "/dl/s/" + strconv.FormatUint(instanceID, 10) + "/" + dl.Token
	} else {
		downloadURL = "/dl/s/" + strconv.FormatUint(instanceID, 10) + "/" + dl.Token
	}

	expiry := "No expiry"
	if sc.ExpiresAt != nil && *sc.ExpiresAt != "" {
		t, err := time.Parse(time.RFC3339, *sc.ExpiresAt)
		if err == nil {
			expiry = t.UTC().Format("2006-01-02 15:04 UTC")
		}
	}

	portalURL := ""
	if base := config.C.AppURL; base != "" && sc.ViewToken != "" {
		portalURL = strings.TrimRight(base, "/") + "/portal/s/" + strconv.FormatUint(instanceID, 10) + "/" + sc.ViewToken
	}

	mailer.SendHTMLTo(
		sc.Email,
		fmt.Sprintf("Your VPN profile: %s", sc.Name),
		mailer.HTMLClientWelcome(sc.Name, sc.AssignedIP, expiry, downloadURL, portalURL),
	)

	auditLog(c, "instance.send_config", "instance", instance.ID, instance.Name,
		fmt.Sprintf("client=%s email=%s", sc.Name, sc.Email))

	c.JSON(http.StatusOK, gin.H{"message": "email sent"})
}

// NotifySlaveClient sends email notifications for client lifecycle events that
// happened on a slave instance, where SMTP is not configured.
// The master handles all email sending using its own SMTP credentials.
//
// Route: POST /api/v1/instances/:id/clients/notify
func (h *InstanceHandler) NotifySlaveClient(c *gin.Context) {
	instanceID, _ := strconv.ParseUint(c.Param("id"), 10, 64)

	if !mailer.SMTPEnabled() {
		// Silently succeed — no SMTP configured, nothing to do.
		c.JSON(http.StatusOK, gin.H{"message": "smtp not configured, skipped"})
		return
	}

	var req slaveClientNotifyRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	cl := req.Client
	ifaceName := req.InterfaceName
	if ifaceName == "" {
		ifaceName = "—"
	}
	owner := cl.OwnerLabel
	if owner == "" {
		owner = "—"
	}

	switch req.Event {
	case "created":
		// For a new client we need a one-time download link from the slave.
		var instance models.RemoteInstance
		if err := database.DB.First(&instance, instanceID).Error; err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "instance not found"})
			return
		}
		token, err := auth.Decrypt(instance.TokenEncrypted, config.C.AppSecret)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "token decryption failed"})
			return
		}

		hc := &http.Client{Timeout: 10 * time.Second}
		dlURL := instance.URL + "/api/v1/clients/" + strconv.FormatUint(uint64(cl.ID), 10) + "/download-link"
		dlReq, _ := http.NewRequest(http.MethodPost, dlURL, nil)
		dlReq.Header.Set("Authorization", "Bearer "+token)
		dlResp, err := hc.Do(dlReq)
		if err == nil && dlResp.StatusCode == http.StatusOK {
			defer dlResp.Body.Close()
			var dl slaveDownloadLink
			if json.NewDecoder(dlResp.Body).Decode(&dl) == nil {
				downloadURL := strings.TrimRight(instance.URL, "/")
				if base := config.C.AppURL; base != "" {
					downloadURL = strings.TrimRight(base, "/") + "/dl/s/" + strconv.FormatUint(instanceID, 10) + "/" + dl.Token
				} else {
					downloadURL = "/dl/s/" + strconv.FormatUint(instanceID, 10) + "/" + dl.Token
				}

				expiry := "No expiry"
				if cl.ExpiresAt != nil && *cl.ExpiresAt != "" {
					if t, err := time.Parse(time.RFC3339, *cl.ExpiresAt); err == nil {
						expiry = t.UTC().Format("2006-01-02 15:04 UTC")
					}
				}
				portalURL := ""
				if base := config.C.AppURL; base != "" && cl.ViewToken != "" {
					portalURL = strings.TrimRight(base, "/") + "/portal/s/" + strconv.FormatUint(instanceID, 10) + "/" + cl.ViewToken
				}

				if cl.Email != "" {
					mailer.SendHTMLTo(cl.Email,
						fmt.Sprintf("Your VPN access is ready: %s", cl.Name),
						mailer.HTMLClientWelcome(cl.Name, cl.AssignedIP, expiry, downloadURL, portalURL),
					)
				}
			}
		}
		// Admin notification (best-effort, doesn't need the download link)
		mailer.SendHTML(
			fmt.Sprintf("New client added: %s", cl.Name),
			mailer.HTMLAdminClientCreated(cl.Name, cl.AssignedIP, ifaceName, owner),
		)

	case "updated":
		if cl.Email != "" {
			mailer.SendHTMLTo(cl.Email,
				fmt.Sprintf("Your VPN config was updated: %s", cl.Name),
				mailer.HTMLClientUpdated(cl.Name, cl.AssignedIP),
			)
		}
		mailer.SendHTML(
			fmt.Sprintf("Client updated: %s", cl.Name),
			mailer.HTMLAdminClientUpdated(cl.Name, cl.AssignedIP, ifaceName),
		)

	case "deleted":
		if cl.Email != "" {
			mailer.SendHTMLTo(cl.Email,
				fmt.Sprintf("VPN access revoked: %s", cl.Name),
				mailer.HTMLClientDeleted(cl.Name, cl.AssignedIP),
			)
		}

	case "enabled":
		if cl.Email != "" {
			mailer.SendHTMLTo(cl.Email,
				fmt.Sprintf("VPN access re-enabled: %s", cl.Name),
				mailer.HTMLClientEnabled(cl.Name, cl.AssignedIP),
			)
		}

	case "disabled":
		if cl.Email != "" {
			mailer.SendHTMLTo(cl.Email,
				fmt.Sprintf("VPN access disabled: %s", cl.Name),
				mailer.HTMLClientDisabled(cl.Name, cl.AssignedIP),
			)
		}

	default:
		c.JSON(http.StatusBadRequest, gin.H{"error": "unknown event: " + req.Event})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "notification queued"})
}

// GetSlaveClientPortal proxies a public portal data request to a slave instance
// so the portal page can display data for slave-hosted clients without exposing
// the slave's internal URL.
//
// Route: GET /api/v1/public/client/s/:instanceId/:token  (public — no auth)
func (h *InstanceHandler) GetSlaveClientPortal(c *gin.Context) {
	instanceID, err := strconv.ParseUint(c.Param("instanceId"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid instance id"})
		return
	}
	viewToken := c.Param("token")

	var instance models.RemoteInstance
	if err := database.DB.First(&instance, instanceID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "instance not found"})
		return
	}

	// /api/v1/public/client/:token is public on the slave — no bearer token needed
	targetURL := strings.TrimRight(instance.URL, "/") + "/api/v1/public/client/" + viewToken
	hc := &http.Client{Timeout: 10 * time.Second}
	resp, err := hc.Get(targetURL)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "could not reach slave: " + err.Error()})
		return
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	c.Data(resp.StatusCode, "application/json", body)
}

// DownloadSlaveConfig proxies a one-time config download from a slave instance
// through the master, so the slave's internal URL never appears in emails.
//
// Route: GET /dl/s/:instanceId/:token  (public — no auth)
func (h *InstanceHandler) DownloadSlaveConfig(c *gin.Context) {
	instanceID, err := strconv.ParseUint(c.Param("instanceId"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid instance id"})
		return
	}
	rawToken := c.Param("token")

	var instance models.RemoteInstance
	if err := database.DB.First(&instance, instanceID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "instance not found"})
		return
	}

	// /dl/:token on the slave is public — no bearer token required
	targetURL := strings.TrimRight(instance.URL, "/") + "/dl/" + rawToken
	hc := &http.Client{Timeout: 15 * time.Second}
	resp, err := hc.Get(targetURL)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "could not reach slave: " + err.Error()})
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		c.Data(resp.StatusCode, resp.Header.Get("Content-Type"), body)
		return
	}

	// Forward the content-disposition so the browser triggers a file download
	if cd := resp.Header.Get("Content-Disposition"); cd != "" {
		c.Header("Content-Disposition", cd)
	}
	body, _ := io.ReadAll(resp.Body)
	c.Data(http.StatusOK, "text/plain", body)
}
