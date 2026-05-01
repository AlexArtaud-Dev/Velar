package handlers

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"github.com/AlexArtaud-Dev/velar/backend/internal/auth"
	"github.com/AlexArtaud-Dev/velar/backend/internal/config"
	"github.com/AlexArtaud-Dev/velar/backend/internal/database"
	"github.com/AlexArtaud-Dev/velar/backend/internal/models"
	bwsvc "github.com/AlexArtaud-Dev/velar/backend/internal/services/bandwidth"
	"github.com/AlexArtaud-Dev/velar/backend/internal/services/mailer"
	tokensvc "github.com/AlexArtaud-Dev/velar/backend/internal/services/token"
	wgsvc "github.com/AlexArtaud-Dev/velar/backend/internal/services/wireguard"
	"github.com/gin-gonic/gin"
)

// ── Backup format ─────────────────────────────────────────────────────────────

const backupVersion = "2" // bumped: keys no longer exported

// BackupFile is the top-level structure of a Velar backup.
// WireGuard keys are NOT included — fresh keys are generated on restore.
type BackupFile struct {
	Version    string            `json:"version"`
	ExportedAt time.Time         `json:"exported_at"`
	Interfaces []BackupInterface `json:"interfaces"`
}

type BackupInterface struct {
	Name          string         `json:"name"`
	Port          int            `json:"port"`
	Subnet        string         `json:"subnet"`
	DNSServer     string         `json:"dns_server"`
	ListenAddress string         `json:"listen_address"`
	PostUp        string         `json:"post_up"`
	PostDown      string         `json:"post_down"`
	LanAccess     bool           `json:"lan_access"`
	LanSubnet     string         `json:"lan_subnet"`
	Enabled       bool           `json:"enabled"`
	Clients       []BackupClient `json:"clients"`
}

type BackupClient struct {
	Name               string     `json:"name"`
	OwnerLabel         string     `json:"owner_label"`
	Email              string     `json:"email"`
	AllowedIPs         string     `json:"allowed_ips"`
	AssignedIP         string     `json:"assigned_ip"`
	BandwidthLimitDown int        `json:"bandwidth_limit_down"`
	BandwidthLimitUp   int        `json:"bandwidth_limit_up"`
	DataQuotaBytes     int64      `json:"data_quota_bytes"`
	QuotaPeriod        string     `json:"quota_period"`
	ExpiresAt          *time.Time `json:"expires_at"`
	Enabled            bool       `json:"enabled"`
}

// ── Handler ───────────────────────────────────────────────────────────────────

type BackupHandler struct {
	wg wgsvc.Service
}

func NewBackupHandler(wg wgsvc.Service) *BackupHandler {
	return &BackupHandler{wg: wg}
}

// Export builds and serves a Velar backup JSON file.
// WireGuard keys are intentionally omitted — they will be regenerated on restore.
func (h *BackupHandler) Export(c *gin.Context) {
	var ifaces []models.Interface
	if err := database.DB.Find(&ifaces).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	bf := BackupFile{
		Version:    backupVersion,
		ExportedAt: time.Now().UTC(),
		Interfaces: make([]BackupInterface, 0, len(ifaces)),
	}

	for _, iface := range ifaces {
		var clients []models.Client
		database.DB.Where("interface_id = ?", iface.ID).Find(&clients)

		bi := BackupInterface{
			Name:          iface.Name,
			Port:          iface.Port,
			Subnet:        iface.Subnet,
			DNSServer:     iface.DNSServer,
			ListenAddress: iface.ListenAddress,
			PostUp:        iface.PostUp,
			PostDown:      iface.PostDown,
			LanAccess:     iface.LanAccess,
			LanSubnet:     iface.LanSubnet,
			Enabled:       iface.Enabled,
			Clients:       make([]BackupClient, 0, len(clients)),
		}

		for _, cl := range clients {
			bi.Clients = append(bi.Clients, BackupClient{
				Name:               cl.Name,
				OwnerLabel:         cl.OwnerLabel,
				Email:              cl.Email,
				AllowedIPs:         cl.AllowedIPs,
				AssignedIP:         cl.AssignedIP,
				BandwidthLimitDown: cl.BandwidthLimitDown,
				BandwidthLimitUp:   cl.BandwidthLimitUp,
				DataQuotaBytes:     cl.DataQuotaBytes,
				QuotaPeriod:        cl.QuotaPeriod,
				ExpiresAt:          cl.ExpiresAt,
				Enabled:            cl.Enabled,
			})
		}

		bf.Interfaces = append(bf.Interfaces, bi)
	}

	data, err := json.MarshalIndent(bf, "", "  ")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "marshal failed"})
		return
	}

	filename := fmt.Sprintf("velar-backup-%s.json", time.Now().UTC().Format("2006-01-02"))
	c.Header("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, filename))
	c.Data(http.StatusOK, "application/json", data)
	slog.Info("backup exported", "interfaces", len(bf.Interfaces))
}

// Restore imports a Velar backup file.
// Fresh WireGuard keys are generated for every interface and client.
// Query param ?wipe=true drops all existing interfaces, clients and their
// dependent records (except the admin account) before restoring.
func (h *BackupHandler) Restore(c *gin.Context) {
	wipe := c.Query("wipe") == "true"

	file, err := c.FormFile("backup")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "backup file required (multipart field: backup)"})
		return
	}

	f, err := file.Open()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "cannot open upload"})
		return
	}
	defer f.Close()

	var bf BackupFile
	if err := json.NewDecoder(f).Decode(&bf); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid backup file: " + err.Error()})
		return
	}
	if bf.Version != backupVersion {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("unsupported backup version: %s (expected %s)", bf.Version, backupVersion)})
		return
	}

	// ── Optional full wipe (everything except Admin + RefreshToken) ───────────
	if wipe {
		if err := wipeData(h.wg); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "wipe failed: " + err.Error()})
			return
		}
		slog.Info("restore: existing data wiped")
	}

	result := restoreReport{
		InterfacesCreated: 0,
		ClientsCreated:    0,
		Errors:            []string{},
	}

	// ── Restore interfaces and clients ────────────────────────────────────────
	for _, bi := range bf.Interfaces {
		// Generate a fresh keypair for the interface
		privKey, pubKey, err := h.wg.GenerateKeyPair()
		if err != nil {
			msg := fmt.Sprintf("generate keys for interface %s: %v", bi.Name, err)
			slog.Error("restore: " + msg)
			result.Errors = append(result.Errors, msg)
			continue
		}

		encPriv, _ := auth.Encrypt(privKey, config.C.AppSecret)

		iface := models.Interface{
			Name:          bi.Name,
			Port:          bi.Port,
			Subnet:        bi.Subnet,
			PrivateKey:    encPriv,
			PublicKey:     pubKey,
			DNSServer:     bi.DNSServer,
			ListenAddress: bi.ListenAddress,
			PostUp:        bi.PostUp,
			PostDown:      bi.PostDown,
			LanAccess:     bi.LanAccess,
			LanSubnet:     bi.LanSubnet,
			Enabled:       bi.Enabled,
		}

		if err := database.DB.Create(&iface).Error; err != nil {
			msg := fmt.Sprintf("create interface %s: %v", bi.Name, err)
			slog.Error("restore: " + msg)
			result.Errors = append(result.Errors, msg)
			continue
		}
		result.InterfacesCreated++

		// Write conf + bring up
		if err := h.wg.EnsureInterface(iface.Name, iface.Port, privKey, iface.Subnet, iface.PostUp, iface.PostDown, []wgsvc.PeerEntry{}); err != nil {
			slog.Warn("restore: ensure interface", "iface", iface.Name, "err", err)
		}

		// ── Clients ───────────────────────────────────────────────────────────
		for _, bc := range bi.Clients {
			// Generate fresh keypair + PSK for each client
			cPrivKey, cPubKey, err := h.wg.GenerateKeyPair()
			if err != nil {
				msg := fmt.Sprintf("generate keys for client %s: %v", bc.Name, err)
				slog.Error("restore: " + msg)
				result.Errors = append(result.Errors, msg)
				continue
			}
			psk, err := h.wg.GeneratePSK()
			if err != nil {
				msg := fmt.Sprintf("generate psk for client %s: %v", bc.Name, err)
				slog.Error("restore: " + msg)
				result.Errors = append(result.Errors, msg)
				continue
			}

			encCPriv, _ := auth.Encrypt(cPrivKey, config.C.AppSecret)
			encPSK, _ := auth.Encrypt(psk, config.C.AppSecret)

			client := models.Client{
				InterfaceID:        iface.ID,
				Name:               bc.Name,
				OwnerLabel:         bc.OwnerLabel,
				Email:              bc.Email,
				PublicKey:          cPubKey,
				PrivateKey:         encCPriv,
				PresharedKey:       encPSK,
				AllowedIPs:         bc.AllowedIPs,
				AssignedIP:         bc.AssignedIP,
				BandwidthLimitDown: bc.BandwidthLimitDown,
				BandwidthLimitUp:   bc.BandwidthLimitUp,
				DataQuotaBytes:     bc.DataQuotaBytes,
				QuotaPeriod:        bc.QuotaPeriod,
				ExpiresAt:          bc.ExpiresAt,
				Enabled:            bc.Enabled,
			}

			if err := database.DB.Create(&client).Error; err != nil {
				msg := fmt.Sprintf("create client %s: %v", bc.Name, err)
				slog.Error("restore: " + msg)
				result.Errors = append(result.Errors, msg)
				continue
			}
			result.ClientsCreated++

			// Add peer to WireGuard kernel state
			if client.Enabled {
				if err := h.wg.AddPeer(iface.Name, client.PublicKey, psk, client.AssignedIP+"/32"); err != nil {
					slog.Warn("restore: add peer", "client", client.Name, "err", err)
				}

				// Reapply bandwidth limits
				if !config.C.WGMock && (client.BandwidthLimitDown > 0 || client.BandwidthLimitUp > 0) {
					if err := bwsvc.Apply(iface.Name, client.AssignedIP, client.BandwidthLimitDown, client.BandwidthLimitUp); err != nil {
						slog.Warn("restore: apply bandwidth", "client", client.Name, "err", err)
					}
				}
			}

			// Send welcome email with one-time download link (new keys = new config)
			if client.Email != "" {
				rawToken, _, err := tokensvc.Generate(client.ID)
				if err == nil {
					expiry := "No expiry"
					if client.ExpiresAt != nil {
						expiry = client.ExpiresAt.UTC().Format("2006-01-02 15:04 UTC")
					}
					mailer.SendHTMLTo(
						client.Email,
						fmt.Sprintf("Your VPN access has been restored: %s", client.Name),
						mailer.HTMLClientWelcome(client.Name, client.AssignedIP, expiry, buildDownloadURL(rawToken)),
					)
				}
			}
		}

		// Rebuild conf with all peers and syncconf
		var allClients []models.Client
		database.DB.Where("interface_id = ? AND enabled = true", iface.ID).Find(&allClients)
		peerEntries := make([]wgsvc.PeerEntry, 0, len(allClients))
		for _, cl := range allClients {
			psk, _ := auth.Decrypt(cl.PresharedKey, config.C.AppSecret)
			peerEntries = append(peerEntries, wgsvc.PeerEntry{
				Comment:    cl.Name,
				PublicKey:  cl.PublicKey,
				PSK:        psk,
				AllowedIPs: cl.AssignedIP + "/32",
			})
		}
		if err := h.wg.EnsureInterface(iface.Name, iface.Port, privKey, iface.Subnet, iface.PostUp, iface.PostDown, peerEntries); err != nil {
			slog.Warn("restore: final ensure interface", "iface", iface.Name, "err", err)
		}

		// Try syncconf (best-effort — interface may still be down)
		path := fmt.Sprintf("%s/%s.conf", config.C.WGConfigDir, iface.Name)
		h.wg.SyncConf(iface.Name, path) //nolint:errcheck
	}

	slog.Info("restore complete",
		"interfaces", result.InterfacesCreated,
		"clients", result.ClientsCreated,
		"errors", len(result.Errors),
	)
	c.JSON(http.StatusOK, result)
}

type restoreReport struct {
	InterfacesCreated int      `json:"interfaces_created"`
	ClientsCreated    int      `json:"clients_created"`
	Errors            []string `json:"errors"`
}

// wipeData removes all application data except Admin and RefreshToken records.
func wipeData(wg wgsvc.Service) error {
	// Bring down and delete all WireGuard interfaces first
	var ifaces []models.Interface
	database.DB.Find(&ifaces)
	for _, iface := range ifaces {
		wg.DeleteInterface(iface.Name) //nolint:errcheck
	}

	// Delete in FK-safe order
	database.DB.Where("1 = 1").Delete(&models.PeerSnapshot{})
	database.DB.Where("1 = 1").Delete(&models.ConnectionEvent{})
	database.DB.Where("1 = 1").Delete(&models.DownloadToken{})
	database.DB.Where("1 = 1").Delete(&models.Client{})
	database.DB.Where("1 = 1").Delete(&models.Interface{})

	return nil
}
