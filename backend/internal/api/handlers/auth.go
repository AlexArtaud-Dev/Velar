package handlers

import (
	"net/http"
	"time"

	"github.com/AlexArtaud-Dev/velar/backend/internal/auth"
	"github.com/AlexArtaud-Dev/velar/backend/internal/config"
	"github.com/AlexArtaud-Dev/velar/backend/internal/database"
	"github.com/AlexArtaud-Dev/velar/backend/internal/models"
	"github.com/AlexArtaud-Dev/velar/backend/internal/services/token"
	"github.com/gin-gonic/gin"
)

type loginRequest struct {
	Username string `json:"username" binding:"required"`
	Password string `json:"password" binding:"required"`
	TOTPCode string `json:"totp_code"`
}

func Login() gin.HandlerFunc {
	return func(c *gin.Context) {
		var req loginRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		var admin models.Admin
		if err := database.DB.Where("username = ?", req.Username).First(&admin).Error; err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid credentials"})
			return
		}

		if !auth.CheckPassword(admin.PasswordHash, req.Password) {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid credentials"})
			return
		}

		if admin.TOTPEnabled {
			if req.TOTPCode == "" {
				c.JSON(http.StatusUnauthorized, gin.H{"error": "totp_required", "totp_required": true})
				return
			}
			if !auth.ValidateTOTP(admin.TOTPSecret, req.TOTPCode) {
				c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid TOTP code"})
				return
			}
		}

		accessToken, err := auth.NewAccessToken(admin.ID, admin.Username, config.C.AppSecret)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "could not issue token"})
			return
		}

		rawRefresh, err := auth.GenerateRefreshToken()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "could not issue refresh token"})
			return
		}

		rt := models.RefreshToken{
			AdminID:   admin.ID,
			TokenHash: token.HashRefreshToken(rawRefresh),
			ExpiresAt: time.Now().Add(auth.RefreshTokenTTL),
		}
		if err := database.DB.Create(&rt).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "could not persist refresh token"})
			return
		}

		c.SetCookie("refresh_token", rawRefresh, int(auth.RefreshTokenTTL.Seconds()), "/", "", config.C.AppEnv == "production", true)
		c.JSON(http.StatusOK, gin.H{
			"access_token": accessToken,
			"admin": gin.H{
				"id":           admin.ID,
				"username":     admin.Username,
				"totp_enabled": admin.TOTPEnabled,
			},
		})
	}
}

func RefreshToken() gin.HandlerFunc {
	return func(c *gin.Context) {
		rawRefresh, err := c.Cookie("refresh_token")
		if err != nil || rawRefresh == "" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "missing refresh token"})
			return
		}

		hash := token.HashRefreshToken(rawRefresh)
		var rt models.RefreshToken
		if err := database.DB.
			Preload("Admin").
			Where("token_hash = ? AND revoked = false AND expires_at > ?", hash, time.Now()).
			First(&rt).Error; err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid or expired refresh token"})
			return
		}

		accessToken, err := auth.NewAccessToken(rt.Admin.ID, rt.Admin.Username, config.C.AppSecret)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "could not issue token"})
			return
		}

		c.JSON(http.StatusOK, gin.H{"access_token": accessToken})
	}
}

func Logout() gin.HandlerFunc {
	return func(c *gin.Context) {
		rawRefresh, _ := c.Cookie("refresh_token")
		if rawRefresh != "" {
			hash := token.HashRefreshToken(rawRefresh)
			database.DB.Model(&models.RefreshToken{}).
				Where("token_hash = ?", hash).
				Update("revoked", true)
		}
		c.SetCookie("refresh_token", "", -1, "/", "", false, true)
		c.JSON(http.StatusOK, gin.H{"message": "logged out"})
	}
}

func TOTPSetup() gin.HandlerFunc {
	return func(c *gin.Context) {
		username := c.GetString("username")
		setup, err := auth.GenerateTOTP(username, "Velar")
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		adminID := c.GetUint("admin_id")
		if err := database.DB.Model(&models.Admin{}).
			Where("id = ?", adminID).
			Update("totp_secret", setup.Secret).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "could not save TOTP secret"})
			return
		}

		c.JSON(http.StatusOK, setup)
	}
}

func TOTPActivate() gin.HandlerFunc {
	return func(c *gin.Context) {
		var req struct {
			Code string `json:"code" binding:"required"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		adminID := c.GetUint("admin_id")
		var admin models.Admin
		if err := database.DB.First(&admin, adminID).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "admin not found"})
			return
		}

		if !auth.ValidateTOTP(admin.TOTPSecret, req.Code) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid TOTP code"})
			return
		}

		database.DB.Model(&admin).Update("totp_enabled", true)
		c.JSON(http.StatusOK, gin.H{"message": "TOTP activated"})
	}
}

func GetMe() gin.HandlerFunc {
	return func(c *gin.Context) {
		adminID := c.GetUint("admin_id")
		var admin models.Admin
		if err := database.DB.First(&admin, adminID).Error; err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
			return
		}
		c.JSON(http.StatusOK, admin)
	}
}

// BackupDB streams the SQLite file as a download.
func BackupDB() gin.HandlerFunc {
	return func(c *gin.Context) {
		dbPath := config.C.DBPath
		c.Header("Content-Disposition", "attachment; filename=velar_backup.db")
		c.Header("Content-Type", "application/octet-stream")
		c.File(dbPath)
	}
}

