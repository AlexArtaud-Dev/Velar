package handlers

import (
	"io"
	"net/http"
	"os"
	"time"

	"github.com/AlexArtaud-Dev/velar/backend/internal/auth"
	"github.com/AlexArtaud-Dev/velar/backend/internal/config"
	"github.com/AlexArtaud-Dev/velar/backend/internal/database"
	"github.com/AlexArtaud-Dev/velar/backend/internal/models"
	auditsvc "github.com/AlexArtaud-Dev/velar/backend/internal/services/audit"
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

		auditsvc.Log(admin.ID, "admin.login", "admin", admin.ID, admin.Username, "ip="+c.ClientIP())

		c.SetCookie("refresh_token", rawRefresh, int(auth.RefreshTokenTTL.Seconds()), "/", "", config.C.AppEnv == "production", true)
		c.JSON(http.StatusOK, gin.H{
			"access_token": accessToken,
			"admin": gin.H{
				"id":                   admin.ID,
				"username":             admin.Username,
				"totp_enabled":         admin.TOTPEnabled,
				"must_change_password": admin.MustChangePassword,
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
		auditLog(c, "admin.logout", "admin", adminIDFromCtx(c), c.GetString("username"), "ip="+c.ClientIP())

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

		auditLog(c, "admin.totp_setup", "admin", adminID, username, "secret_generated=true status=pending_activation")

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

		auditLog(c, "admin.totp_enable", "admin", admin.ID, admin.Username, "2fa=enabled code_verified=true")

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

func ChangePassword() gin.HandlerFunc {
	return func(c *gin.Context) {
		var req struct {
			CurrentPassword string `json:"current_password" binding:"required"`
			NewPassword     string `json:"new_password" binding:"required,min=8"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		adminID := c.GetUint("admin_id")
		var admin models.Admin
		if err := database.DB.First(&admin, adminID).Error; err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
			return
		}

		if !auth.CheckPassword(admin.PasswordHash, req.CurrentPassword) {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "current password is incorrect"})
			return
		}

		hash, err := auth.HashPassword(req.NewPassword)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "could not hash password"})
			return
		}

		database.DB.Model(&admin).Updates(map[string]interface{}{
			"password_hash":        hash,
			"must_change_password": false,
		})

		auditLog(c, "admin.password_change", "admin", admin.ID, admin.Username, "ip="+c.ClientIP())

		c.JSON(http.StatusOK, gin.H{"message": "password updated"})
	}
}

// TOTPDisable verifies the current TOTP code then disables 2FA.
func TOTPDisable() gin.HandlerFunc {
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

		database.DB.Model(&admin).Updates(map[string]interface{}{
			"totp_enabled": false,
			"totp_secret":  "",
		})

		auditLog(c, "admin.totp_disable", "admin", admin.ID, admin.Username, "2fa=disabled code_verified=true")

		c.JSON(http.StatusOK, gin.H{"message": "TOTP disabled"})
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

// RestoreDB replaces the current SQLite database with the uploaded file.
func RestoreDB() gin.HandlerFunc {
	return func(c *gin.Context) {
		file, err := c.FormFile("file")
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "no file provided"})
			return
		}

		src, err := file.Open()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "cannot open uploaded file"})
			return
		}
		defer src.Close()

		// Write to a temp file first to avoid corrupting the DB on partial write
		tmpPath := config.C.DBPath + ".restore_tmp"
		dst, err := os.Create(tmpPath)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "cannot create temp file"})
			return
		}
		if _, err := io.Copy(dst, src); err != nil {
			dst.Close()
			os.Remove(tmpPath)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "write failed"})
			return
		}
		dst.Close()

		// Validate that the uploaded file is a real SQLite database before replacing
		if err := database.ValidateSQLite(tmpPath); err != nil {
			os.Remove(tmpPath)
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid SQLite file: " + err.Error()})
			return
		}

		// Close the current DB connection before replacing the file
		sqlDB, err := database.DB.DB()
		if err == nil {
			sqlDB.Close()
		}

		if err := os.Rename(tmpPath, config.C.DBPath); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "could not replace database: " + err.Error()})
			return
		}

		// Re-open the database
		if err := database.Init(config.C.DBPath); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "restored but failed to reopen DB: " + err.Error()})
			return
		}

		// Run migrations so any tables added since the backup was taken are created
		if err := database.AutoMigrate(); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "restored but migration failed: " + err.Error()})
			return
		}

		auditLog(c, "admin.db_restore", "admin", 0, "database",
			fmt.Sprintf("file=%s size_bytes=%d ip=%s", file.Filename, file.Size, c.ClientIP()))

		c.JSON(http.StatusOK, gin.H{"message": "database restored successfully"})
	}
}

