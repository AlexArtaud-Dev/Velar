package handlers

import (
	"fmt"
	"net/http"

	"github.com/AlexArtaud-Dev/velar/backend/internal/auth"
	"github.com/AlexArtaud-Dev/velar/backend/internal/config"
	"github.com/AlexArtaud-Dev/velar/backend/internal/database"
	"github.com/AlexArtaud-Dev/velar/backend/internal/models"
	tokensvc "github.com/AlexArtaud-Dev/velar/backend/internal/services/token"
	wgsvc "github.com/AlexArtaud-Dev/velar/backend/internal/services/wireguard"
	"github.com/gin-gonic/gin"
)

func DownloadConfig(wg wgsvc.Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		rawToken := c.Param("token")

		client, err := tokensvc.Consume(rawToken)
		if err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "token not found or already used"})
			return
		}

		var iface models.Interface
		if err := database.DB.First(&iface, client.InterfaceID).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "interface not found"})
			return
		}

		privKey, err := auth.Decrypt(client.PrivateKey, config.C.AppSecret)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "decrypt failed"})
			return
		}
		psk, err := auth.Decrypt(client.PresharedKey, config.C.AppSecret)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "decrypt failed"})
			return
		}

		endpoint := fmt.Sprintf("%s:%d", config.C.WGHost, iface.Port)
		conf := wgsvc.BuildClientConf(
			privKey,
			client.AssignedIP,
			iface.DNSServer,
			iface.PublicKey,
			psk,
			endpoint,
			client.AllowedIPs,
		)

		filename := fmt.Sprintf("%s.conf", client.Name)
		c.Header("Content-Disposition", "attachment; filename="+filename)
		c.Data(http.StatusOK, "text/plain; charset=utf-8", []byte(conf))
	}
}
