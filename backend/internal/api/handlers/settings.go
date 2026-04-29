package handlers

import (
	"net/http"

	"github.com/AlexArtaud-Dev/velar/backend/internal/config"
	"github.com/AlexArtaud-Dev/velar/backend/internal/services/adguard"
	"github.com/AlexArtaud-Dev/velar/backend/internal/services/ddns"
	"github.com/AlexArtaud-Dev/velar/backend/internal/services/mailer"
	"github.com/gin-gonic/gin"
)

type SettingsHandler struct {
	adguard *adguard.Client
	ddns    *ddns.Service
}

func NewSettingsHandler(ag *adguard.Client, ddnsSvc *ddns.Service) *SettingsHandler {
	return &SettingsHandler{adguard: ag, ddns: ddnsSvc}
}

func (h *SettingsHandler) GetPublicIP(c *gin.Context) {
	ip := h.ddns.CurrentIP()
	c.JSON(http.StatusOK, gin.H{"ip": ip})
}

func (h *SettingsHandler) GetNotificationStatus(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"enabled":     mailer.Enabled(),
		"smtp_host":   config.C.SMTPHost,
		"smtp_from":   config.C.SMTPFrom,
		"admin_email": config.C.AdminEmail,
	})
}

func (h *SettingsHandler) GetAdguardStatus(c *gin.Context) {
	status, err := h.adguard.GetStatus()
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": err.Error(), "running": false})
		return
	}
	c.JSON(http.StatusOK, status)
}
