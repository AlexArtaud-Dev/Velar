package handlers

import (
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"strconv"

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

// List returns all interfaces with their live up/down status and enabled peer count.
func (h *InterfaceHandler) List(c *gin.Context) {
	var ifaces []models.Interface
	if err := database.DB.Find(&ifaces).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	type ifaceWithStatus struct {
		models.Interface
		Up        bool `json:"up"`
		PeerCount int  `json:"peer_count"`
	}

	result := make([]ifaceWithStatus, 0, len(ifaces))
	for _, iface := range ifaces {
		var count int64
		database.DB.Model(&models.Client{}).Where("interface_id = ? AND enabled = true", iface.ID).Count(&count)
		status, _ := h.wg.GetInterfaceStatus(iface.Name)
		result = append(result, ifaceWithStatus{
			Interface: iface,
			Up:        status.Up,
			PeerCount: int(count),
		})
	}
	c.JSON(http.StatusOK, result)
}

// Get returns a single interface by ID with its Clients preloaded.
func (h *InterfaceHandler) Get(c *gin.Context) {
	id, _ := strconv.ParseUint(c.Param("id"), 10, 64)
	var iface models.Interface
	if err := database.DB.Preload("Clients").First(&iface, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}
	c.JSON(http.StatusOK, iface)
}

// Create provisions a new WireGuard interface: generates a keypair, builds
// default PostUp/PostDown iptables rules, writes the .conf, and brings the
// interface up with wg-quick.
func (h *InterfaceHandler) Create(c *gin.Context) {
	var req createInterfaceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	privKey, pubKey, err := h.wg.GenerateKeyPair()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "key generation failed"})
		return
	}

	encPriv, err := auth.Encrypt(privKey, config.C.AppSecret)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "encryption failed"})
		return
	}

	dns := req.DNSServer
	if dns == "" {
		dns = "1.1.1.1"
	}

	// Build default NAT rules based on the host's main outbound interface.
	mainIface := wgsvc.DetectMainInterface()
	postUp := req.PostUp
	if postUp == "" {
		postUp = fmt.Sprintf(
			"iptables -A FORWARD -i %%i -j ACCEPT; iptables -A FORWARD -m state --state RELATED,ESTABLISHED -j ACCEPT; iptables -t nat -A POSTROUTING -o %s -j MASQUERADE",
			mainIface,
		)
	}
	postDown := req.PostDown
	if postDown == "" {
		postDown = fmt.Sprintf(
			"iptables -D FORWARD -i %%i -j ACCEPT; iptables -D FORWARD -m state --state RELATED,ESTABLISHED -j ACCEPT; iptables -t nat -D POSTROUTING -o %s -j MASQUERADE",
			mainIface,
		)
	}

	lanSubnet := ""
	if req.LanAccess {
		lanSubnet = wgsvc.DetectLANSubnet()
	}

	// Check for port conflicts before persisting.
	var portCount int64
	database.DB.Model(&models.Interface{}).Where("port = ?", req.Port).Count(&portCount)
	if portCount > 0 {
		c.JSON(http.StatusConflict, gin.H{"error": "port already in use by another interface"})
		return
	}

	iface := models.Interface{
		Name:          req.Name,
		Port:          req.Port,
		Subnet:        req.Subnet,
		PrivateKey:    encPriv,
		PublicKey:     pubKey,
		DNSServer:     dns,
		ListenAddress: req.ListenAddress,
		PostUp:        postUp,
		PostDown:      postDown,
		LanAccess:     req.LanAccess,
		LanSubnet:     lanSubnet,
		Enabled:       true,
	}
	if err := database.DB.Create(&iface).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	if err := h.wg.EnsureInterface(iface.Name, iface.Port, privKey, iface.Subnet, postUp, postDown, nil); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "wg conf write failed: " + err.Error()})
		return
	}
	if err := h.wg.BringUp(iface.Name); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "wg-quick up failed: " + err.Error()})
		return
	}

	auditLog(c, "interface.create", "interface", iface.ID, iface.Name,
		fmt.Sprintf("port=%d subnet=%s", iface.Port, iface.Subnet))

	c.JSON(http.StatusCreated, iface)
}

// updateInterfaceRequest is the JSON body for PUT /interfaces/:id.
type updateInterfaceRequest struct {
	DNSServer string `json:"dns_server"`
	PostUp    string `json:"post_up"`
	PostDown  string `json:"post_down"`
	Port      *int   `json:"port"`
	Subnet    string `json:"subnet"`
	LanAccess *bool  `json:"lan_access"`
}

// Update applies a partial update to an interface.
// Port / subnet / PostUp / PostDown changes require a full restart (bring-down +
// rewrite + bring-up). Subnet changes re-allocate client IPs to preserve host
// offsets. LAN access toggles update all clients' AllowedIPs. Clients are
// notified by email when subnet or DNS changes require re-importing their config.
func (h *InterfaceHandler) Update(c *gin.Context) {
	id, _ := strconv.ParseUint(c.Param("id"), 10, 64)
	var iface models.Interface
	if err := database.DB.First(&iface, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}

	var req updateInterfaceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Port conflict check (only when changing to a different port).
	if req.Port != nil && *req.Port != iface.Port {
		var count int64
		database.DB.Model(&models.Interface{}).Where("port = ? AND id != ?", *req.Port, iface.ID).Count(&count)
		if count > 0 {
			c.JSON(http.StatusConflict, gin.H{"error": "port already in use by another interface"})
			return
		}
	}

	needsRestart := false
	subnetChanged := false
	dnsChanged := false
	oldSubnet := iface.Subnet
	oldDNS := iface.DNSServer

	updates := map[string]interface{}{}
	if req.DNSServer != "" && req.DNSServer != iface.DNSServer {
		updates["dns_server"] = req.DNSServer
		dnsChanged = true
	}
	if req.PostUp != "" && req.PostUp != iface.PostUp {
		updates["post_up"] = req.PostUp
		needsRestart = true
	}
	if req.PostDown != "" && req.PostDown != iface.PostDown {
		updates["post_down"] = req.PostDown
		needsRestart = true
	}
	if req.Port != nil && *req.Port != iface.Port {
		updates["port"] = *req.Port
		needsRestart = true
	}
	if req.Subnet != "" && req.Subnet != iface.Subnet {
		updates["subnet"] = req.Subnet
		needsRestart = true
		subnetChanged = true
	}

	lanAccessChanged := false
	if req.LanAccess != nil && *req.LanAccess != iface.LanAccess {
		lanAccessChanged = true
		updates["lan_access"] = *req.LanAccess
		if *req.LanAccess {
			updates["lan_subnet"] = wgsvc.DetectLANSubnet()
		} else {
			updates["lan_subnet"] = ""
		}
	}

	if len(updates) > 0 {
		database.DB.Model(&iface).Updates(updates)
		database.DB.First(&iface, id)
	}

	// Re-allocate client IPs when the subnet changes, preserving the host offset.
	if subnetChanged {
		_, oldNet, errOld := net.ParseCIDR(oldSubnet)
		_, newNet, errNew := net.ParseCIDR(iface.Subnet)
		if errOld == nil && errNew == nil {
			var allClients []models.Client
			database.DB.Where("interface_id = ?", iface.ID).Find(&allClients)
			for i := range allClients {
				cl := allClients[i]
				oldIP := net.ParseIP(cl.AssignedIP).To4()
				if oldIP == nil || !oldNet.Contains(oldIP) {
					continue
				}
				newBase := make(net.IP, 4)
				copy(newBase, newNet.IP.To4())
				newBase[3] = oldIP[3] // preserve last-octet host offset
				if newNet.Contains(newBase) {
					database.DB.Model(&cl).Update("assigned_ip", newBase.String())
					slog.Info("re-IP client", "client", cl.Name, "old", cl.AssignedIP, "new", newBase.String())
				}
			}
		}
	}

	if needsRestart {
		privKey, err := auth.Decrypt(iface.PrivateKey, config.C.AppSecret)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "decrypt failed"})
			return
		}
		var clients []models.Client
		database.DB.Where("interface_id = ? AND enabled = true", iface.ID).Find(&clients)
		peers := make([]wgsvc.PeerEntry, 0, len(clients))
		for _, cl := range clients {
			psk, _ := auth.Decrypt(cl.PresharedKey, config.C.AppSecret)
			peers = append(peers, wgsvc.PeerEntry{
				Comment: cl.Name, PublicKey: cl.PublicKey, PSK: psk,
				AllowedIPs: cl.AssignedIP + "/32",
			})
		}
		_ = h.wg.BringDown(iface.Name)
		if err := h.wg.EnsureInterface(iface.Name, iface.Port, privKey, iface.Subnet, iface.PostUp, iface.PostDown, peers); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "conf write failed: " + err.Error()})
			return
		}
		if err := h.wg.BringUp(iface.Name); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "wg-quick up failed: " + err.Error()})
			return
		}
	}

	// Update AllowedIPs on all clients when LAN access is toggled.
	if lanAccessChanged {
		var allClients []models.Client
		database.DB.Where("interface_id = ?", iface.ID).Find(&allClients)
		newAllowedIPs := defaultClientAllowedIPs(iface)
		for _, cl := range allClients {
			database.DB.Model(&cl).Update("allowed_ips", newAllowedIPs)
		}
		slog.Info("lan_access toggled: updated client AllowedIPs",
			"iface", iface.Name, "lan_access", iface.LanAccess,
			"allowed_ips", newAllowedIPs, "clients", len(allClients))
	}

	// Notify enabled clients by email when subnet or DNS changes require
	// re-importing the VPN profile.
	if subnetChanged || dnsChanged {
		var changes []string
		if subnetChanged {
			changes = append(changes, fmt.Sprintf("Subnet: %s &rarr; %s", oldSubnet, iface.Subnet))
		}
		if dnsChanged {
			changes = append(changes, fmt.Sprintf("DNS server: %s &rarr; %s", oldDNS, iface.DNSServer))
		}

		var notifyClients []models.Client
		database.DB.Where("interface_id = ? AND email != '' AND enabled = true", iface.ID).Find(&notifyClients)
		for _, cl := range notifyClients {
			rawToken, _, err := tokensvc.Generate(cl.ID)
			if err != nil {
				slog.Warn("interface update: token gen for client email", "client", cl.Name, "err", err)
				continue
			}
			mailer.SendHTMLTo(
				cl.Email,
				fmt.Sprintf("Your VPN config needs updating — %s", cl.Name),
				mailer.HTMLClientInterfaceUpdated(cl.Name, cl.AssignedIP, changes, buildDownloadURL(rawToken)),
			)
		}
	}

	c.JSON(http.StatusOK, iface)
}

// Delete brings down and removes the WireGuard interface, cascade-deletes all
// associated clients and their child records, and removes the DB row.
func (h *InterfaceHandler) Delete(c *gin.Context) {
	id, _ := strconv.ParseUint(c.Param("id"), 10, 64)
	var iface models.Interface
	if err := database.DB.First(&iface, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}

	// Cascade-delete all child records for every client before deleting clients.
	// PRAGMA foreign_keys=ON blocks parent DELETEs if children still exist.
	var clients []models.Client
	database.DB.Where("interface_id = ?", iface.ID).Find(&clients)
	for _, cl := range clients {
		database.DB.Where("client_id = ?", cl.ID).Delete(&models.DownloadToken{})
		database.DB.Where("client_id = ?", cl.ID).Delete(&models.ConnectionEvent{})
		database.DB.Where("client_id = ?", cl.ID).Delete(&models.PeerSnapshot{})
	}

	if err := database.DB.Where("interface_id = ?", iface.ID).Delete(&models.Client{}).Error; err != nil {
		slog.Error("delete interface: cascade clients", "iface", iface.Name, "err", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "cascade delete clients: " + err.Error()})
		return
	}

	// Bring down and remove the wg conf (best-effort — don't block DB cleanup).
	if err := h.wg.DeleteInterface(iface.Name); err != nil {
		slog.Warn("delete interface: wg", "name", iface.Name, "err", err)
	}
	if !config.C.WGMock {
		bwsvc.RemoveAll(iface.Name)
	}

	if err := database.DB.Delete(&iface).Error; err != nil {
		slog.Error("delete interface: db", "iface", iface.Name, "err", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "database error: " + err.Error()})
		return
	}

	auditLog(c, "interface.delete", "interface", iface.ID, iface.Name,
		fmt.Sprintf("clients_removed=%d", len(clients)))

	c.JSON(http.StatusOK, gin.H{"message": "deleted"})
}
