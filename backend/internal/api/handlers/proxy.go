package handlers

import (
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/AlexArtaud-Dev/velar/backend/internal/auth"
	"github.com/AlexArtaud-Dev/velar/backend/internal/config"
	"github.com/AlexArtaud-Dev/velar/backend/internal/database"
	"github.com/AlexArtaud-Dev/velar/backend/internal/models"
	"github.com/gin-gonic/gin"
)

type proxyRequest struct {
	TokenID     uint              `json:"token_id" binding:"required"`
	Path        string            `json:"path" binding:"required"`
	QueryParams map[string]string `json:"query_params"`
	Headers     map[string]string `json:"headers"`
}

// DevProxy executes an API request server-side on behalf of a PAT.
// The raw token is never sent to the browser — it is decrypted here and used
// for an internal loopback HTTP call.
//
// Route: POST /api/v1/dev/proxy  (JWT-only — web app route)
func DevProxy(c *gin.Context) {
	var req proxyRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	adminID := adminIDFromCtx(c)

	// Fetch PAT — must belong to the logged-in admin.
	var pat models.PersonalAccessToken
	if err := database.DB.Where("id = ? AND admin_id = ?", req.TokenID, adminID).First(&pat).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "token not found"})
		return
	}
	if pat.ExpiresAt != nil && pat.ExpiresAt.Before(time.Now()) {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": "token is expired"})
		return
	}
	if pat.TokenEncrypted == "" {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": "token predates encryption support — revoke it and create a new one"})
		return
	}

	// Decrypt the raw token — never leaves the server.
	rawToken, err := auth.Decrypt(pat.TokenEncrypted, config.C.AppSecret)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "token decryption failed"})
		return
	}

	// Build the loopback URL.
	base := fmt.Sprintf("http://127.0.0.1:%s%s", config.C.AppPort, req.Path)
	httpReq, err := http.NewRequest(http.MethodGet, base, nil)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "request build failed"})
		return
	}

	// Attach query params.
	q := httpReq.URL.Query()
	for k, v := range req.QueryParams {
		if v != "" {
			q.Set(k, v)
		}
	}
	httpReq.URL.RawQuery = q.Encode()

	// Attach custom headers (e.g. Accept).
	for k, v := range req.Headers {
		if v != "" {
			httpReq.Header.Set(k, v)
		}
	}
	httpReq.Header.Set("Authorization", "Bearer "+rawToken)

	// Execute.
	client := &http.Client{Timeout: 15 * time.Second}
	t0 := time.Now()
	resp, err := client.Do(httpReq)
	durationMS := time.Since(t0).Milliseconds()
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "proxy request failed: " + err.Error()})
		return
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	contentType := resp.Header.Get("Content-Type")

	c.JSON(http.StatusOK, gin.H{
		"status":       resp.StatusCode,
		"status_text":  resp.Status,
		"content_type": contentType,
		"body":         string(body),
		"duration_ms":  durationMS,
	})
}
