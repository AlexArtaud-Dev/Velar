package main

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"log/slog"
	mrand "math/rand"
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
	nftquota "github.com/AlexArtaud-Dev/velar/backend/internal/services/nftquota"
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

	// Slave mode: generate/display master token instead of seeding a human admin
	if config.C.VelarMode == "slave" {
		slog.Info("starting in slave mode — web UI disabled")
		ensureSlaveSystemAdmin()
		ensureSlaveToken()
	} else {
		// Seed admin if none exists (standalone / master mode only)
		seedAdmin()
	}

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

	// nftables quota service
	nft := nftquota.New(config.C.WGMock)
	if !config.C.WGMock {
		if err := nft.Setup(); err != nil {
			slog.Warn("nftquota setup failed", "err", err)
		}
		restoreQuotas(nft)
	}

	// AdGuard client — initialised on both master and slave nodes.
	// On slaves, the handler exposes /api/v1/adguard/* under MasterToken so the
	// master can proxy all AdGuard management calls through the slave API.
	ag := adguard.NewClient(config.C.AdguardURL, config.C.AdguardUser, config.C.AdguardPass)
	ddnsSvc := ddns.NewService()

	// Initial DDNS fetch (best effort)
	if _, _, err := ddnsSvc.Refresh(); err != nil {
		slog.Warn("initial DDNS fetch failed", "err", err)
	}

	// WebSocket hub
	hub := handlers.NewWSHub(wg)

	// Background jobs
	jobs.Start(wg, nft, ddnsSvc)

	// HTTP router
	router := api.NewRouter(wg, nft, ag, ddnsSvc, hub)

	srv := &http.Server{
		Addr:         ":" + config.C.AppPort,
		Handler:      router,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 30 * time.Second,
	}

	slog.Info("Velar API starting", "port", config.C.AppPort, "env", config.C.AppEnv, "mode", config.C.VelarMode)
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

// restoreQuotas re-installs nftables quota rules after a server restart.
// For each enabled client with a data quota it computes the bytes remaining in
// the current period (quota − persisted snapshot usage) and calls nft.Apply so
// the kernel picks up from where it left off rather than granting a full fresh
// budget.
func restoreQuotas(nft nftquota.Service) {
	var clients []models.Client
	if err := database.DB.Where("enabled = true AND data_quota_bytes > 0").Find(&clients).Error; err != nil {
		slog.Error("restoreQuotas: query failed", "err", err)
		return
	}

	for _, cl := range clients {
		periodStart := quotaRestorePeriodStart(cl.QuotaPeriod)
		if cl.QuotaResetAt != nil && cl.QuotaResetAt.After(periodStart) {
			periodStart = *cl.QuotaResetAt
		}

		var result struct{ Total int64 }
		q := database.DB.Model(&models.PeerSnapshot{}).
			Select("COALESCE(SUM(bytes_rx + bytes_tx), 0) as total").
			Where("client_id = ?", cl.ID)
		if !periodStart.IsZero() {
			q = q.Where("timestamp >= ?", periodStart)
		}
		q.Scan(&result)

		remaining := cl.DataQuotaBytes - result.Total
		if remaining < 1 {
			remaining = 1 // client was at/over quota — block immediately
		}

		if err := nft.Apply(cl.AssignedIP, remaining); err != nil {
			slog.Warn("restoreQuotas: apply", "client", cl.Name, "err", err)
		} else {
			slog.Info("restoreQuotas: applied", "client", cl.Name, "remaining_bytes", remaining)
		}
	}
}

// quotaRestorePeriodStart is a local copy of the period-start logic used by
// the jobs package. Duplicated here to avoid a circular import.
func quotaRestorePeriodStart(period string) time.Time {
	now := time.Now()
	switch period {
	case "weekly":
		weekday := int(now.Weekday())
		if weekday == 0 {
			weekday = 7
		}
		start := now.AddDate(0, 0, -(weekday - 1))
		return time.Date(start.Year(), start.Month(), start.Day(), 0, 0, 0, 0, now.Location())
	case "total":
		return time.Time{}
	default: // monthly
		return time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, now.Location())
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

// ensureSlaveToken generates a vs_ master token on first boot in slave mode.
// The raw token is printed to stdout exactly once; only the SHA-256 hash is
// persisted. Set SLAVE_TOKEN_RESET=true to force regeneration.
func ensureSlaveToken() {
	var count int64
	database.DB.Model(&models.SlaveToken{}).Count(&count)

	if count > 0 && !config.C.SlaveTokenReset {
		slog.Info("slave token already configured")
		return
	}

	// Wipe existing token if reset is requested
	if config.C.SlaveTokenReset {
		database.DB.Exec("DELETE FROM slave_tokens")
		slog.Info("slave token reset — generating new token")
	}

	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		slog.Error("slave token generation failed", "err", err)
		os.Exit(1)
	}
	token := "vs_" + hex.EncodeToString(raw)

	sum := sha256.Sum256([]byte(token))
	hash := hex.EncodeToString(sum[:])

	if err := database.DB.Create(&models.SlaveToken{TokenHash: hash}).Error; err != nil {
		slog.Error("slave token persist failed", "err", err)
		os.Exit(1)
	}

	// Print once — this is the only time the token is visible
	fmt.Println()
	fmt.Println("╔══════════════════════════════════════════════════════════════════╗")
	fmt.Println("║  SLAVE TOKEN — copy this into your master instance              ║")
	fmt.Printf( "║  %-66s║\n", token)
	fmt.Println("║  This will NOT be shown again. Set SLAVE_TOKEN_RESET=true       ║")
	fmt.Println("║  to regenerate if lost.                                         ║")
	fmt.Println("╚══════════════════════════════════════════════════════════════════╝")
	fmt.Println()
}

// ensureSlaveSystemAdmin creates a non-loginable system admin on the slave so
// that MasterToken middleware can set a valid admin_id in the request context.
// Handlers use this ID for audit logs and ownership — the account has no
// usable password and is never exposed via the web UI.
func ensureSlaveSystemAdmin() {
	var count int64
	database.DB.Model(&models.Admin{}).Count(&count)
	if count > 0 {
		return
	}
	admin := models.Admin{
		Username:           "system",
		PasswordHash:       "", // intentionally unusable — no login possible
		MustChangePassword: false,
	}
	if err := database.DB.Create(&admin).Error; err != nil {
		slog.Error("slave: create system admin", "err", err)
		os.Exit(1)
	}
	slog.Info("slave: system admin created", "id", admin.ID)
}

const charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$"

func randomPassword(n int) string {
	rng := mrand.New(mrand.NewSource(time.Now().UnixNano()))
	b := make([]byte, n)
	for i := range b {
		b[i] = charset[rng.Intn(len(charset))]
	}
	return string(b)
}
