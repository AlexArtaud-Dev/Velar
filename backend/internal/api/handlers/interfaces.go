package handlers

import (
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os/exec"
	"strconv"
	"strings"

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

type InterfaceHandler struct {
	wg wgsvc.Service
}

func NewInterfaceHandler(wg wgsvc.Service) *InterfaceHandler {
	return &InterfaceHandler{wg: wg}
}

type createInterfaceRequest struct {
	Name          string `json:"name" binding:"required"`
	Port          int    `json:"port" binding:"required,min=1,max=65535"`
	Subnet        string `json:"subnet" binding:"required"`
	DNSServer     string `json:"dns_server"`
	ListenAddress string `json:"listen_address"`
	PostUp        string `json:"post_up"`
	PostDown      string `json:"post_down"`
	LanAccess     bool   `json:"lan_access"`
}

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
	mainIface := wgsvc.DetectMainInterface()
	postUp := req.PostUp
	if postUp == "" {
		postUp = fmt.Sprintf("iptables -A FORWARD -i %%i -j ACCEPT; iptables -A FORWARD -m state --state RELATED,ESTABLISHED -j ACCEPT; iptables -t nat -A POSTROUTING -o %s -j MASQUERADE", mainIface)
	}
	postDown := req.PostDown
	if postDown == "" {
		postDown = fmt.Sprintf("iptables -D FORWARD -i %%i -j ACCEPT; iptables -D FORWARD -m state --state RELATED,ESTABLISHED -j ACCEPT; iptables -t nat -D POSTROUTING -o %s -j MASQUERADE", mainIface)
	}

	lanSubnet := ""
	if req.LanAccess {
		lanSubnet = wgsvc.DetectLANSubnet()
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
	// Port conflict check
	var portCount int64
	database.DB.Model(&models.Interface{}).Where("port = ?", req.Port).Count(&portCount)
	if portCount > 0 {
		c.JSON(http.StatusConflict, gin.H{"error": "port already in use by another interface"})
		return
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

	c.JSON(http.StatusCreated, iface)
}

func (h *InterfaceHandler) Get(c *gin.Context) {
	id, _ := strconv.ParseUint(c.Param("id"), 10, 64)
	var iface models.Interface
	if err := database.DB.Preload("Clients").First(&iface, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}
	c.JSON(http.StatusOK, iface)
}

func (h *InterfaceHandler) Update(c *gin.Context) {
	id, _ := strconv.ParseUint(c.Param("id"), 10, 64)
	var iface models.Interface
	if err := database.DB.First(&iface, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}

	var req struct {
		DNSServer string `json:"dns_server"`
		PostUp    string `json:"post_up"`
		PostDown  string `json:"post_down"`
		Port      *int   `json:"port"`
		Subnet    string `json:"subnet"`
		LanAccess *bool  `json:"lan_access"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Port conflict check
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
			detected := wgsvc.DetectLANSubnet()
			updates["lan_subnet"] = detected
		} else {
			updates["lan_subnet"] = ""
		}
	}

	if len(updates) > 0 {
		database.DB.Model(&iface).Updates(updates)
		database.DB.First(&iface, id)
	}

	// Re-allocate client IPs when subnet changes (preserve last-octet offset)
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
				// Preserve the host offset (last octet for /24 subnets)
				newBase := make(net.IP, 4)
				copy(newBase, newNet.IP.To4())
				newBase[3] = oldIP[3]
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

	// Update all clients' AllowedIPs when lan_access is toggled
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

	// Notify all clients with an email address when their config is affected
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

func (h *InterfaceHandler) Delete(c *gin.Context) {
	id, _ := strconv.ParseUint(c.Param("id"), 10, 64)
	var iface models.Interface
	if err := database.DB.First(&iface, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}

	// Best-effort — don't block DB cleanup on WG errors
	if err := h.wg.DeleteInterface(iface.Name); err != nil {
		slog.Warn("delete interface wg", "name", iface.Name, "err", err)
	}
	if !config.C.WGMock {
		bwsvc.RemoveAll(iface.Name)
	}

	database.DB.Where("interface_id = ?", iface.ID).Delete(&models.Client{})
	database.DB.Delete(&iface)
	c.JSON(http.StatusOK, gin.H{"message": "deleted"})
}

func (h *InterfaceHandler) BringUp(c *gin.Context) {
	id, _ := strconv.ParseUint(c.Param("id"), 10, 64)
	var iface models.Interface
	if err := database.DB.First(&iface, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}
	if err := h.wg.BringUp(iface.Name); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	database.DB.Model(&iface).Update("enabled", true)

	// Reapply bandwidth limits — tc rules are lost when the interface goes down.
	if !config.C.WGMock {
		var clients []models.Client
		database.DB.Where("interface_id = ? AND enabled = true AND (bandwidth_limit_down > 0 OR bandwidth_limit_up > 0)", iface.ID).Find(&clients)
		for _, cl := range clients {
			if err := bwsvc.Apply(iface.Name, cl.AssignedIP, cl.BandwidthLimitDown, cl.BandwidthLimitUp); err != nil {
				slog.Warn("bringup: reapply bandwidth", "client", cl.Name, "err", err)
			}
		}
	}

	c.JSON(http.StatusOK, gin.H{"message": "up"})
}

func (h *InterfaceHandler) BringDown(c *gin.Context) {
	id, _ := strconv.ParseUint(c.Param("id"), 10, 64)
	var iface models.Interface
	if err := database.DB.First(&iface, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}
	if err := h.wg.BringDown(iface.Name); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	database.DB.Model(&iface).Update("enabled", false)
	c.JSON(http.StatusOK, gin.H{"message": "down"})
}

// Check verifies that the interface is UP and its UDP port is bound.
func (h *InterfaceHandler) Check(c *gin.Context) {
	id, _ := strconv.ParseUint(c.Param("id"), 10, 64)
	var iface models.Interface
	if err := database.DB.First(&iface, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}

	status, _ := h.wg.GetInterfaceStatus(iface.Name)
	portBound := checkUDPPort(iface.Port)

	c.JSON(http.StatusOK, gin.H{
		"interface_up": status.Up,
		"port_bound":   portBound,
		"port":         iface.Port,
		"interface":    iface.Name,
	})
}

// defaultClientAllowedIPs returns the AllowedIPs string to use for clients on the given interface.
// When LAN access is enabled it returns a split-tunnel value (VPN subnet + LAN subnet).
// Otherwise it returns a full-tunnel value.
func defaultClientAllowedIPs(iface models.Interface) string {
	if iface.LanAccess && iface.LanSubnet != "" {
		_, vpnNet, err := net.ParseCIDR(iface.Subnet)
		if err == nil {
			return vpnNet.String() + ", " + iface.LanSubnet
		}
		return iface.LanSubnet
	}
	return "0.0.0.0/0, ::/0"
}

// checkUDPPort returns true if a UDP socket is listening on the given port.
func checkUDPPort(port int) bool {
	out, err := exec.Command("sh", "-c", fmt.Sprintf("ss -uln 2>/dev/null | grep ':%d '", port)).Output()
	if err != nil {
		return false
	}
	return len(strings.TrimSpace(string(out))) > 0
}
