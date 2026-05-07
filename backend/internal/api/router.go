package api

import (
	"net/http"
	"time"

	"github.com/AlexArtaud-Dev/velar/backend/internal/api/handlers"
	"github.com/AlexArtaud-Dev/velar/backend/internal/api/middleware"
	"github.com/AlexArtaud-Dev/velar/backend/internal/config"
	"github.com/AlexArtaud-Dev/velar/backend/internal/services/adguard"
	"github.com/AlexArtaud-Dev/velar/backend/internal/services/ddns"
	nftquota "github.com/AlexArtaud-Dev/velar/backend/internal/services/nftquota"
	"github.com/AlexArtaud-Dev/velar/backend/internal/services/wireguard"
	"github.com/gin-gonic/gin"
)

func NewRouter(
	wg wireguard.Service,
	nft nftquota.Service,
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

	// Public health check — always available regardless of mode
	r.GET("/health", handlers.HealthCheck(ag))

	// ── Slave mode — stripped router, all routes under MasterToken ────────────
	if config.C.VelarMode == "slave" {
		buildSlaveRoutes(r, wg, nft, ag, ddnsSvc, hub)
		return r
	}

	// ── Standalone / master mode ───────────────────────────────────────────────

	// Public endpoints
	r.GET("/dl/:token", handlers.DownloadConfig(wg))
	instanceHandler := handlers.NewInstanceHandler()
	r.GET("/dl/s/:instanceId/:token", instanceHandler.DownloadSlaveConfig)
	r.GET("/api/v1/public/client/:token", handlers.GetClientPortal)
	r.GET("/api/v1/public/client/s/:instanceId/:token", instanceHandler.GetSlaveClientPortal)

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

	// Shared handler instances
	ifaceHandler := handlers.NewInterfaceHandler(wg)

	// Protected API (JWT only — web app)
	api := r.Group("/api/v1", middleware.JWT())
	{
		api.GET("/me", handlers.GetMe())

		ifaces := api.Group("/interfaces")
		{
			ifaces.GET("", ifaceHandler.List)
			ifaces.POST("", ifaceHandler.Create)
			ifaces.GET("/:id", ifaceHandler.Get)
			ifaces.PUT("/:id", ifaceHandler.Update)
			ifaces.DELETE("/:id", ifaceHandler.Delete)
			ifaces.POST("/:id/up", ifaceHandler.BringUp)
			ifaces.POST("/:id/down", ifaceHandler.BringDown)
		}

		clientHandler := handlers.NewClientHandler(wg, nft)
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
			clients.POST("/:id/quota-reset", clientHandler.QuotaReset)
			clients.GET("/:id/quota-usage", clientHandler.GetQuotaUsage)
			clients.POST("/bulk/enable", clientHandler.BulkEnable)
			clients.POST("/bulk/disable", clientHandler.BulkDisable)
			clients.POST("/bulk/delete", clientHandler.BulkDelete)
			clients.GET("/:id/snapshots", clientHandler.GetSnapshots)
			clients.GET("/:id/events", clientHandler.GetEvents)
		}

		settingsHandler := handlers.NewSettingsHandler(ag, ddnsSvc)
		settings := api.Group("/settings")
		{
			settings.GET("/public-ip", settingsHandler.GetPublicIP)
			settings.GET("/adguard", settingsHandler.GetAdguardStatus)
			settings.GET("/notifications", settingsHandler.GetNotificationStatus)
		}

		agHandler := handlers.NewAdguardHandler(ag)
		agGroup := api.Group("/adguard")
		{
			agGroup.GET("/status", agHandler.GetStatus)
			agGroup.GET("/stats", agHandler.GetStats)
			agGroup.GET("/filtering", agHandler.GetFilteringStatus)
			agGroup.PUT("/filtering/config", agHandler.SetFilteringConfig)
			agGroup.POST("/filtering/add", agHandler.AddFilter)
			agGroup.POST("/filtering/remove", agHandler.RemoveFilter)
			agGroup.POST("/filtering/refresh", agHandler.RefreshFilters)
			agGroup.GET("/rules", agHandler.GetUserRules)
			agGroup.PUT("/rules", agHandler.SetUserRules)
			agGroup.GET("/rewrites", agHandler.GetRewrites)
			agGroup.POST("/rewrites", agHandler.AddRewrite)
			agGroup.DELETE("/rewrites", agHandler.DeleteRewrite)
		}

		adminHandler := handlers.NewAdminHandler(wg)
		backupHandler := handlers.NewBackupHandler(wg)
		admin := api.Group("/admin")
		{
			admin.POST("/sync", adminHandler.SyncState)
			admin.GET("/backup", backupHandler.Export)
			admin.POST("/restore", backupHandler.Restore)
		}

		dashboardHandler := handlers.NewDashboardHandler()
		dashboard := api.Group("/dashboard")
		{
			dashboard.GET("", dashboardHandler.Get)
			dashboard.GET("/snapshots", dashboardHandler.GetSnapshots)
		}

		// Personal Access Tokens
		tokenRL := middleware.NewRateLimiter(20, time.Minute)
		api.GET("/tokens", handlers.ListPATs)
		api.POST("/tokens", tokenRL.Middleware(), handlers.CreatePAT)
		api.DELETE("/tokens/:id", handlers.DeletePAT)

		// Developer proxy — server-side API tester
		proxyRL := middleware.NewRateLimiter(60, time.Minute)
		api.POST("/dev/proxy", proxyRL.Middleware(), handlers.DevProxy)

		// Remote instances (slave management)
		instances := api.Group("/instances")
		{
			instances.GET("", instanceHandler.List)
			instances.POST("", instanceHandler.Register)
			instances.PUT("/:id", instanceHandler.Update)
			instances.DELETE("/:id", instanceHandler.Delete)
			instances.GET("/:id/ping", instanceHandler.Ping)
			instances.POST("/:id/proxy", proxyRL.Middleware(), instanceHandler.Proxy)
			instances.PUT("/:id/adguard", instanceHandler.UpdateAdguardCredentials)
			instances.POST("/:id/adguard/proxy", proxyRL.Middleware(), instanceHandler.ProxyAdguard)
			instances.POST("/:id/clients/:clientId/send-config", instanceHandler.SendSlaveClientConfig)
			instances.POST("/:id/clients/notify", instanceHandler.NotifySlaveClient)
		}
	}

	// External / developer API — accepts JWT or PAT
	extAPI := r.Group("/api/v1", middleware.JWTORPAT())
	{
		extAPI.GET("/metrics", handlers.GetMetrics)
		extAPI.GET("/audit", handlers.ListAuditLogs)
		extAPI.GET("/interfaces/overview", ifaceHandler.StatusOverview)
		extAPI.GET("/interfaces/:id/check", ifaceHandler.Check)
		extAPI.GET("/stats", handlers.StatsHandler(hub))
	}

	return r
}

// buildSlaveRoutes wires up the stripped slave router.
// All operational routes are gated by MasterToken — no JWT, no UI, no PAT management.
func buildSlaveRoutes(
	r *gin.Engine,
	wg wireguard.Service,
	nft nftquota.Service,
	ag *adguard.Client,
	ddnsSvc *ddns.Service,
	hub *handlers.WSHub,
) {
	// Public routes — no auth (same as master)
	r.GET("/dl/:token", handlers.DownloadConfig(wg))
	r.GET("/api/v1/public/client/:token", handlers.GetClientPortal)

	slave := r.Group("/api/v1", middleware.MasterToken())

	ifaceHandler := handlers.NewInterfaceHandler(wg)
	ifaces := slave.Group("/interfaces")
	{
		ifaces.GET("", ifaceHandler.List)
		ifaces.POST("", ifaceHandler.Create)
		ifaces.GET("/overview", ifaceHandler.StatusOverview)
		ifaces.GET("/:id", ifaceHandler.Get)
		ifaces.PUT("/:id", ifaceHandler.Update)
		ifaces.DELETE("/:id", ifaceHandler.Delete)
		ifaces.POST("/:id/up", ifaceHandler.BringUp)
		ifaces.POST("/:id/down", ifaceHandler.BringDown)
		ifaces.GET("/:id/check", ifaceHandler.Check)
	}

	clientHandler := handlers.NewClientHandler(wg, nft)
	clients := slave.Group("/clients")
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
		clients.POST("/:id/quota-reset", clientHandler.QuotaReset)
		clients.GET("/:id/quota-usage", clientHandler.GetQuotaUsage)
		clients.POST("/bulk/enable", clientHandler.BulkEnable)
		clients.POST("/bulk/disable", clientHandler.BulkDisable)
		clients.POST("/bulk/delete", clientHandler.BulkDelete)
		clients.GET("/:id/snapshots", clientHandler.GetSnapshots)
		clients.GET("/:id/events", clientHandler.GetEvents)
	}

	settingsHandler := handlers.NewSettingsHandler(ag, ddnsSvc)
	settings := slave.Group("/settings")
	{
		settings.GET("/public-ip", settingsHandler.GetPublicIP)
		settings.GET("/adguard", settingsHandler.GetAdguardStatus)
	}

	agHandler := handlers.NewAdguardHandler(ag)
	agGroup := slave.Group("/adguard")
	{
		agGroup.GET("/status", agHandler.GetStatus)
		agGroup.GET("/stats", agHandler.GetStats)
		agGroup.GET("/filtering", agHandler.GetFilteringStatus)
		agGroup.PUT("/filtering/config", agHandler.SetFilteringConfig)
		agGroup.POST("/filtering/add", agHandler.AddFilter)
		agGroup.POST("/filtering/remove", agHandler.RemoveFilter)
		agGroup.POST("/filtering/refresh", agHandler.RefreshFilters)
		agGroup.GET("/rules", agHandler.GetUserRules)
		agGroup.PUT("/rules", agHandler.SetUserRules)
		agGroup.GET("/rewrites", agHandler.GetRewrites)
		agGroup.POST("/rewrites", agHandler.AddRewrite)
		agGroup.DELETE("/rewrites", agHandler.DeleteRewrite)
	}

	slave.GET("/metrics", handlers.GetMetrics)
	slave.GET("/audit", handlers.ListAuditLogs)
	slave.GET("/stats", handlers.StatsHandler(hub))
}
