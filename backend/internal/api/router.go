package api

import (
	"net/http"
	"time"

	"github.com/AlexArtaud-Dev/velar/backend/internal/api/handlers"
	"github.com/AlexArtaud-Dev/velar/backend/internal/api/middleware"
	"github.com/AlexArtaud-Dev/velar/backend/internal/config"
	"github.com/AlexArtaud-Dev/velar/backend/internal/services/adguard"
	"github.com/AlexArtaud-Dev/velar/backend/internal/services/ddns"
	"github.com/AlexArtaud-Dev/velar/backend/internal/services/wireguard"
	"github.com/gin-gonic/gin"
)

func NewRouter(
	wg wireguard.Service,
	ag *adguard.Client,
	ddnsSvc *ddns.Service,
	hub *handlers.WSHub,
) *gin.Engine {
	if config.C.AppEnv == "production" {
		gin.SetMode(gin.ReleaseMode)
	}

	r := gin.New()
	r.Use(gin.Logger(), gin.Recovery())

	// CORS
	r.Use(func(c *gin.Context) {
		c.Header("Access-Control-Allow-Origin", config.C.CORSOrigin)
		c.Header("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS")
		c.Header("Access-Control-Allow-Headers", "Content-Type,Authorization")
		c.Header("Access-Control-Allow-Credentials", "true")
		if c.Request.Method == http.MethodOptions {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}
		c.Next()
	})

	// Public download endpoint
	r.GET("/dl/:token", handlers.DownloadConfig(wg))

	// WebSocket (JWT checked inside handler)
	r.GET("/ws/stats", handlers.WSHandler(hub))

	// Auth routes
	loginRL := middleware.NewRateLimiter(10, time.Minute)
	authGroup := r.Group("/api/v1/auth")
	{
		authGroup.POST("/login", loginRL.Middleware(), handlers.Login())
		authGroup.POST("/refresh", handlers.RefreshToken())
		authGroup.POST("/logout", middleware.JWT(), handlers.Logout())
		authGroup.PUT("/password", middleware.JWT(), handlers.ChangePassword())
		authGroup.GET("/totp/setup", middleware.JWT(), handlers.TOTPSetup())
		authGroup.POST("/totp/activate", middleware.JWT(), handlers.TOTPActivate())
		authGroup.POST("/totp/disable", middleware.JWT(), handlers.TOTPDisable())
	}

	// Protected API
	api := r.Group("/api/v1", middleware.JWT())
	{
		// Admin
		api.GET("/me", handlers.GetMe())

		// Interfaces
		ifaceHandler := handlers.NewInterfaceHandler(wg)
		ifaces := api.Group("/interfaces")
		{
			ifaces.GET("", ifaceHandler.List)
			ifaces.POST("", ifaceHandler.Create)
			ifaces.GET("/:id", ifaceHandler.Get)
			ifaces.PUT("/:id", ifaceHandler.Update)
			ifaces.DELETE("/:id", ifaceHandler.Delete)
			ifaces.POST("/:id/up", ifaceHandler.BringUp)
			ifaces.POST("/:id/down", ifaceHandler.BringDown)
			ifaces.GET("/:id/check", ifaceHandler.Check)
		}

		// Clients
		clientHandler := handlers.NewClientHandler(wg)
		clients := api.Group("/clients")
		{
			clients.GET("", clientHandler.List)
			clients.POST("", clientHandler.Create)
			clients.GET("/:id", clientHandler.Get)
			clients.PUT("/:id", clientHandler.Update)
			clients.DELETE("/:id", clientHandler.Delete)
			clients.POST("/:id/enable", clientHandler.Enable)
			clients.POST("/:id/disable", clientHandler.Disable)
			clients.GET("/:id/config", clientHandler.GetConfig)
			clients.GET("/:id/qr", clientHandler.GetQR)
			clients.POST("/:id/download-link", clientHandler.CreateDownloadLink)
			clients.POST("/:id/send-config", clientHandler.SendConfig)
		}

		// Settings
		settingsHandler := handlers.NewSettingsHandler(ag, ddnsSvc)
		settings := api.Group("/settings")
		{
			settings.GET("/public-ip", settingsHandler.GetPublicIP)
			settings.GET("/adguard", settingsHandler.GetAdguardStatus)
			settings.GET("/notifications", settingsHandler.GetNotificationStatus)
		}

		// Admin operations
		adminHandler := handlers.NewAdminHandler(wg)
		admin := api.Group("/admin")
		{
			admin.POST("/sync", adminHandler.SyncState)
		}

	}

	return r
}
