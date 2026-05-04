package handlers

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/AlexArtaud-Dev/velar/backend/internal/auth"
	"github.com/AlexArtaud-Dev/velar/backend/internal/config"
	"github.com/AlexArtaud-Dev/velar/backend/internal/database"
	"github.com/AlexArtaud-Dev/velar/backend/internal/models"
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

	c.JSON(http.StatusOK, gin.H{
		"status":       resp.StatusCode,
		"status_text":  resp.Status,
		"content_type": ct,
		"body":         string(respBody),
		"duration_ms":  durationMS,
	})
}
