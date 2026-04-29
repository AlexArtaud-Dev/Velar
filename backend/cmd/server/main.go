package main

import (
	"log/slog"
	"math/rand"
	"net/http"
	"os"
	"os/exec"
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

	// System setup (best effort — requires NET_ADMIN)
	if !config.C.WGMock {
		setupSystem()
	}

	// Services
	var wg wgsvc.Service
	if config.C.WGMock {
		slog.Info("WireGuard mock mode enabled")
		wg = wgsvc.NewMockService()
	} else {
		wg = wgsvc.NewService(config.C.WGConfigDir)
		restoreInterfaces(wg)
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

// restoreInterfaces brings up all enabled interfaces from the DB after a reboot.
// It rebuilds each conf file (with all its peers) before calling wg-quick up.
func restoreInterfaces(wg wgsvc.Service) {
	var ifaces []models.Interface
	if err := database.DB.Where("enabled = true").Find(&ifaces).Error; err != nil {
		slog.Error("restoreInterfaces: query failed", "err", err)
		return
	}

	for _, iface := range ifaces {
		privKey, err := auth.Decrypt(iface.PrivateKey, config.C.AppSecret)
		if err != nil {
			slog.Warn("restoreInterfaces: decrypt key", "iface", iface.Name, "err", err)
			continue
		}

		var clients []models.Client
		database.DB.Where("interface_id = ? AND enabled = true", iface.ID).Find(&clients)

		peers := make([]wgsvc.PeerEntry, 0, len(clients))
		for _, cl := range clients {
			psk, _ := auth.Decrypt(cl.PresharedKey, config.C.AppSecret)
			peers = append(peers, wgsvc.PeerEntry{
				Comment:    cl.Name,
				PublicKey:  cl.PublicKey,
				PSK:        psk,
				AllowedIPs: cl.AssignedIP + "/32",
			})
		}

		if err := wg.EnsureInterface(iface.Name, iface.Port, privKey, iface.Subnet, iface.PostUp, iface.PostDown, peers); err != nil {
			slog.Warn("restoreInterfaces: write conf", "iface", iface.Name, "err", err)
			continue
		}

		// Only bring up if not already running
		status, _ := wg.GetInterfaceStatus(iface.Name)
		if status.Up {
			slog.Info("restoreInterfaces: already up", "iface", iface.Name)
			continue
		}

		if err := wg.BringUp(iface.Name); err != nil {
			slog.Warn("restoreInterfaces: bring up", "iface", iface.Name, "err", err)
		} else {
			slog.Info("restoreInterfaces: brought up", "iface", iface.Name, "peers", len(peers))
		}
	}
}

func setupSystem() {
	iface := wgsvc.DetectMainInterface()
	slog.Info("system setup", "main_iface", iface)

	if err := exec.Command("sysctl", "-w", "net.ipv4.ip_forward=1").Run(); err != nil {
		slog.Warn("sysctl ip_forward", "err", err)
	}
	if err := exec.Command("sysctl", "-w", "net.ipv6.conf.all.forwarding=1").Run(); err != nil {
		slog.Warn("sysctl ipv6_forward", "err", err)
	}
	// Ensure RELATED,ESTABLISHED forwarding (idempotent)
	check := exec.Command("iptables", "-C", "FORWARD", "-m", "state", "--state", "RELATED,ESTABLISHED", "-j", "ACCEPT")
	if check.Run() != nil {
		if err := exec.Command("iptables", "-A", "FORWARD", "-m", "state", "--state", "RELATED,ESTABLISHED", "-j", "ACCEPT").Run(); err != nil {
			slog.Warn("iptables RELATED,ESTABLISHED rule", "err", err)
		}
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
		Username:           "admin",
		PasswordHash:       hash,
		MustChangePassword: true,
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
