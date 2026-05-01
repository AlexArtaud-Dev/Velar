package handlers

import (
	"encoding/base64"
	"fmt"
	"net/http"
	"strconv"

	"github.com/AlexArtaud-Dev/velar/backend/internal/auth"
	"github.com/AlexArtaud-Dev/velar/backend/internal/config"
	"github.com/AlexArtaud-Dev/velar/backend/internal/database"
	"github.com/AlexArtaud-Dev/velar/backend/internal/models"
	"github.com/AlexArtaud-Dev/velar/backend/internal/services/mailer"
	tokensvc "github.com/AlexArtaud-Dev/velar/backend/internal/services/token"
	wgsvc "github.com/AlexArtaud-Dev/velar/backend/internal/services/wireguard"
	"github.com/gin-gonic/gin"
	"github.com/skip2/go-qrcode"
)

// GetConfig serves the client's WireGuard .conf file as a download attachment.
func (h *ClientHandler) GetConfig(c *gin.Context) {
	conf, _, err := h.buildClientConf(c)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=%s.conf", "client"))
	c.Data(http.StatusOK, "text/plain", []byte(conf))
}

// GetQR generates a QR code PNG from the client's WireGuard config and returns
// it as a base64-encoded string inside a JSON response.
func (h *ClientHandler) GetQR(c *gin.Context) {
	conf, _, err := h.buildClientConf(c)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	png, err := qrcode.Encode(conf, qrcode.Low, 512)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "qr generation failed"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"qr_code": base64.StdEncoding.EncodeToString(png)})
}

// SendConfig generates a fresh one-time download link and emails it to the
// client. Can be triggered manually from the dashboard at any time.
func (h *ClientHandler) SendConfig(c *gin.Context) {
	id, _ := strconv.ParseUint(c.Param("id"), 10, 64)
	var client models.Client
	if err := database.DB.Preload("Interface").First(&client, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}
	if client.Email == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "this client has no email address"})
		return
	}
	if !mailer.SMTPEnabled() {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "SMTP is not configured on this server"})
		return
	}

	rawToken, _, err := tokensvc.Generate(client.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not generate download link"})
		return
	}

	expiry := "No expiry"
	if client.ExpiresAt != nil {
		expiry = client.ExpiresAt.UTC().Format("2006-01-02 15:04 UTC")
	}

	mailer.SendHTMLTo(
		client.Email,
		fmt.Sprintf("Your VPN profile: %s", client.Name),
		mailer.HTMLClientWelcome(client.Name, client.AssignedIP, expiry, buildDownloadURL(rawToken), buildPortalURL(client.ViewToken)),
	)

	c.JSON(http.StatusOK, gin.H{"message": "email sent"})
}

// CreateDownloadLink generates a new one-time download token and returns both
// the raw token and the full download path. The link expires in 1 hour.
func (h *ClientHandler) CreateDownloadLink(c *gin.Context) {
	id, _ := strconv.ParseUint(c.Param("id"), 10, 64)
	var client models.Client
	if err := database.DB.First(&client, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}
	rawToken, _, err := tokensvc.Generate(client.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"token": rawToken, "url": "/dl/" + rawToken})
}

// buildClientConf decrypts the client's private key and PSK, then returns the
// rendered WireGuard .conf text together with the client record.
func (h *ClientHandler) buildClientConf(c *gin.Context) (string, *models.Client, error) {
	id, _ := strconv.ParseUint(c.Param("id"), 10, 64)
	var client models.Client
	if err := database.DB.Preload("Interface").First(&client, id).Error; err != nil {
		return "", nil, fmt.Errorf("not found")
	}

	privKey, err := auth.Decrypt(client.PrivateKey, config.C.AppSecret)
	if err != nil {
		return "", nil, fmt.Errorf("decrypt private key: %w", err)
	}
	psk, err := auth.Decrypt(client.PresharedKey, config.C.AppSecret)
	if err != nil {
		return "", nil, fmt.Errorf("decrypt psk: %w", err)
	}

	endpoint := fmt.Sprintf("%s:%d", config.C.WGHost, client.Interface.Port)
	conf := wgsvc.BuildClientConf(
		privKey,
		client.AssignedIP,
		client.Interface.DNSServer,
		client.Interface.PublicKey,
		psk,
		endpoint,
		client.AllowedIPs,
	)
	return conf, &client, nil
}

// buildConfString constructs a WireGuard client .conf from already-decrypted
// keys. Use this when plain keys are already in memory to avoid a redundant
// decrypt round-trip (e.g. immediately after key generation).
func buildConfString(client models.Client, iface models.Interface, privKey, psk string) string {
	endpoint := fmt.Sprintf("%s:%d", config.C.WGHost, iface.Port)
	return wgsvc.BuildClientConf(privKey, client.AssignedIP, iface.DNSServer, iface.PublicKey, psk, endpoint, client.AllowedIPs)
}
