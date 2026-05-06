package middleware

import (
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"strings"
	"time"

	"github.com/AlexArtaud-Dev/velar/backend/internal/auth"
	"github.com/AlexArtaud-Dev/velar/backend/internal/config"
	"github.com/AlexArtaud-Dev/velar/backend/internal/database"
	"github.com/AlexArtaud-Dev/velar/backend/internal/models"
	"github.com/gin-gonic/gin"
)

// JWT validates a short-lived JWT access token only.
// Used for all normal web-app routes — PATs are not accepted here.
func JWT() gin.HandlerFunc {
	return func(c *gin.Context) {
		raw, ok := bearerToken(c)
		if !ok {
			return
		}
		claims, err := auth.ParseAccessToken(raw, config.C.AppSecret)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "invalid or expired token"})
			return
		}
		c.Set("admin_id", claims.AdminID)
		c.Set("username", claims.Username)
		c.Next()
	}
}

// JWTORPAT accepts either a short-lived JWT or a Personal Access Token.
// Used for external/developer API routes (metrics, audit, etc.) that need
// to be callable from scripts and monitoring tools.
func JWTORPAT() gin.HandlerFunc {
	return func(c *gin.Context) {
		raw, ok := bearerToken(c)
		if !ok {
			return
		}

		// Personal Access Token — prefix "vp_"
		if strings.HasPrefix(raw, "vp_") {
			sum := sha256.Sum256([]byte(raw))
			hash := hex.EncodeToString(sum[:])

			var pat models.PersonalAccessToken
			if err := database.DB.Where("token_hash = ?", hash).First(&pat).Error; err != nil {
				c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "invalid or revoked token"})
				return
			}
			if pat.ExpiresAt != nil && pat.ExpiresAt.Before(time.Now()) {
				c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "token expired"})
				return
			}
			// Update last_used_at (best-effort, fire-and-forget).
			now := time.Now()
			database.DB.Model(&pat).Update("last_used_at", &now)

			c.Set("admin_id", pat.AdminID)
			c.Set("username", "pat:"+pat.Name)
			c.Next()
			return
		}

		// JWT fallback
		claims, err := auth.ParseAccessToken(raw, config.C.AppSecret)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "invalid or expired token"})
			return
		}
		c.Set("admin_id", claims.AdminID)
		c.Set("username", claims.Username)
		c.Next()
	}
}

// MasterToken validates a vs_ slave token.
// Used for all routes in slave mode — accepts only master-issued slave tokens.
func MasterToken() gin.HandlerFunc {
	return func(c *gin.Context) {
		raw, ok := bearerToken(c)
		if !ok {
			return
		}
		if !strings.HasPrefix(raw, "vs_") {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "invalid token format — expected vs_ slave token"})
			return
		}
		sum := sha256.Sum256([]byte(raw))
		hash := hex.EncodeToString(sum[:])

		var st models.SlaveToken
		if err := database.DB.Where("token_hash = ?", hash).First(&st).Error; err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "invalid or unknown slave token"})
			return
		}

		// Use the first admin in DB as the request context identity (audit logs etc.)
		var admin models.Admin
		if err := database.DB.First(&admin).Error; err != nil {
			c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{"error": "no admin configured on this slave"})
			return
		}
		c.Set("admin_id", admin.ID)
		c.Set("username", "master")
		c.Next()
	}
}

// bearerToken extracts and validates the "Bearer <token>" header format.
// Aborts the request with 401 and returns false if the header is missing or malformed.
func bearerToken(c *gin.Context) (string, bool) {
	h := c.GetHeader("Authorization")
	if h == "" {
		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "missing authorization header"})
		return "", false
	}
	parts := strings.SplitN(h, " ", 2)
	if len(parts) != 2 || parts[0] != "Bearer" {
		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "invalid authorization format"})
		return "", false
	}
	return parts[1], true
}
