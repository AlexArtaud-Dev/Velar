package main

import (
	"log/slog"
	"math/rand"
	"net/http"
	"os"
	"time"

	"github.com/AlexArtaud-Dev/velar/backend/internal/api"
	"github.com/AlexArtaud-Dev/velar/backend/internal/api/handlers"
	"github.com/AlexArtaud-Dev/velar/backend/internal/auth"
	"github.com/AlexArtaud-Dev/velar/backend/internal/config"
	"github.com/AlexArtaud-Dev/velar/backend/internal/database"
	"github.com/AlexArtaud-Dev/velar/backend/internal/jobs"
	"github.com/AlexArtaud-Dev/velar/backend/internal/models"
	"github.com/AlexArtaud-Dev/velar/backend/internal/services/adguard"
	"github.com/AlexArtaud-Dev/velar/backend/internal/services/ddns"
	wgsvc "github.com/AlexArtaud-Dev/velar/backend/internal/services/wireguard"
	"github.com/joho/godotenv"
)

func main() {
	// Structured logging
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	})))

	// Load .env if present (ignore error — env vars may already be set)
	_ = godotenv.Load()
	config.Load()

	// Database
	if err := database.Init(config.C.DBPath); err != nil {
		slog.Error("database init failed", "err", err)
		os.Exit(1)
	}
	if err := database.AutoMigrate(); err != nil {
		slog.Error("migration failed", "err", err)
		os.Exit(1)
	}

	// Seed admin if none exists
	seedAdmin()

	// Services
	var wg wgsvc.Service
	if config.C.WGMock {
		slog.Info("WireGuard mock mode enabled")
		wg = wgsvc.NewMockService()
	} else {
		wg = wgsvc.NewService(config.C.WGConfigDir)
	}

	ag := adguard.NewClient(config.C.AdguardURL, config.C.AdguardUser, config.C.AdguardPass)
	ddnsSvc := ddns.NewService()

	// Initial DDNS fetch (best effort)
	if _, _, err := ddnsSvc.Refresh(); err != nil {
		slog.Warn("initial DDNS fetch failed", "err", err)
	}

	// WebSocket hub
	hub := handlers.NewWSHub(wg)

	// Background jobs
	jobs.Start(wg, ddnsSvc)

	// HTTP router
	router := api.NewRouter(wg, ag, ddnsSvc, hub)

	srv := &http.Server{
		Addr:         ":" + config.C.AppPort,
		Handler:      router,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 30 * time.Second,
	}

	slog.Info("Velar API starting", "port", config.C.AppPort, "env", config.C.AppEnv)
	if err := srv.ListenAndServe(); err != nil {
		slog.Error("server error", "err", err)
		os.Exit(1)
	}
}

func seedAdmin() {
	var count int64
	database.DB.Model(&models.Admin{}).Count(&count)
	if count > 0 {
		return
	}

	password := randomPassword(16)
	hash, err := auth.HashPassword(password)
	if err != nil {
		slog.Error("seed admin: hash password", "err", err)
		os.Exit(1)
	}

	admin := models.Admin{
		Username:    "admin",
		PasswordHash: hash,
	}
	if err := database.DB.Create(&admin).Error; err != nil {
		slog.Error("seed admin: create", "err", err)
		os.Exit(1)
	}

	// Print credentials once — this is the only time the password is visible
	slog.Info("┌─────────────────────────────────────────┐")
	slog.Info("│  INITIAL ADMIN CREDENTIALS              │")
	slog.Info("│  username : admin                       │")
	slog.Info("│  password : "+password+"  │")
	slog.Info("│  Change this password after first login │")
	slog.Info("└─────────────────────────────────────────┘")
}

const charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$"

func randomPassword(n int) string {
	rng := rand.New(rand.NewSource(time.Now().UnixNano()))
	b := make([]byte, n)
	for i := range b {
		b[i] = charset[rng.Intn(len(charset))]
	}
	return string(b)
}
