package handlers

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/AlexArtaud-Dev/velar/backend/internal/auth"
	"github.com/AlexArtaud-Dev/velar/backend/internal/config"
	"github.com/AlexArtaud-Dev/velar/backend/internal/database"
	"github.com/AlexArtaud-Dev/velar/backend/internal/models"
	"github.com/gin-gonic/gin"
)

// createPATRequest is the JSON body for POST /api/v1/tokens.
type createPATRequest struct {
	Name      string     `json:"name" binding:"required"`
	ExpiresAt *time.Time `json:"expires_at"` // nil = never
}

// ListPATs returns all personal access tokens for the authenticated admin.
// Token hashes are never returned; only display metadata.
func ListPATs(c *gin.Context) {
	adminID := adminIDFromCtx(c)
	var tokens []models.PersonalAccessToken
	database.DB.Where("admin_id = ?", adminID).Order("created_at DESC").Find(&tokens)
	c.JSON(http.StatusOK, tokens)
}

// CreatePAT generates a new personal access token.
// The raw token value is returned ONCE in the response — it cannot be retrieved
// again. Only the SHA-256 hash is stored in the database.
func CreatePAT(c *gin.Context) {
	var req createPATRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Generate 32 random bytes → 64-char hex string.
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "token generation failed"})
		return
	}
	rawHex := hex.EncodeToString(raw)
	token := "vp_" + rawHex // full token shown to user

	// Store only the SHA-256 hash for lookup.
	sum := sha256.Sum256([]byte(token))
	hash := hex.EncodeToString(sum[:])

	encToken, err := auth.Encrypt(token, config.C.AppSecret)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "token encryption failed"})
		return
	}

	pat := models.PersonalAccessToken{
		AdminID:        adminIDFromCtx(c),
		Name:           req.Name,
		TokenPrefix:    token[:8], // "vp_" + first 5 hex chars for display
		TokenHash:      hash,
		TokenEncrypted: encToken,
		ExpiresAt:      req.ExpiresAt,
	}
	if err := database.DB.Create(&pat).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	patExpiry := "never"
	if pat.ExpiresAt != nil {
		patExpiry = pat.ExpiresAt.UTC().Format("2006-01-02")
	}
	auditLog(c, "token.create", "admin", pat.ID, pat.Name,
		fmt.Sprintf("prefix=%s expires=%s", pat.TokenPrefix, patExpiry))

	// Respond with the record + the raw token (only time it's visible).
	c.JSON(http.StatusCreated, gin.H{
		"id":           pat.ID,
		"name":         pat.Name,
		"token_prefix": pat.TokenPrefix,
		"expires_at":   pat.ExpiresAt,
		"created_at":   pat.CreatedAt,
		"token":        token, // shown once
	})
}

// DeletePAT revokes (deletes) a personal access token by ID.
// Admins can only revoke their own tokens.
func DeletePAT(c *gin.Context) {
	id, _ := strconv.ParseUint(c.Param("id"), 10, 64)
	adminID := adminIDFromCtx(c)

	var pat models.PersonalAccessToken
	if err := database.DB.Where("id = ? AND admin_id = ?", id, adminID).First(&pat).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "token not found"})
		return
	}

	database.DB.Delete(&pat)

	auditLog(c, "token.delete", "admin", pat.ID, pat.Name,
		fmt.Sprintf("prefix=%s revoked=true", pat.TokenPrefix))

	c.JSON(http.StatusOK, gin.H{"message": "token revoked"})
}

// HashPAT returns the SHA-256 hex hash of a raw token string.
// Used by the auth middleware for PAT lookup.
func HashPAT(raw string) string {
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}
