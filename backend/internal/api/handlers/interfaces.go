package handlers

import (
	"fmt"
	"net"
	"os/exec"
	"strings"

	wgsvc "github.com/AlexArtaud-Dev/velar/backend/internal/services/wireguard"
	"github.com/AlexArtaud-Dev/velar/backend/internal/models"
)

// InterfaceHandler handles all /interfaces API routes.
// It wraps the WireGuard service so that interface lifecycle operations
// (create, bring-up, bring-down, delete) are applied immediately.
type InterfaceHandler struct {
	wg wgsvc.Service
}

// NewInterfaceHandler creates an InterfaceHandler backed by the given WireGuard service.
func NewInterfaceHandler(wg wgsvc.Service) *InterfaceHandler {
	return &InterfaceHandler{wg: wg}
}

// createInterfaceRequest is the JSON body for POST /interfaces.
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

// defaultClientAllowedIPs returns the AllowedIPs string for a new client on the
// given interface. When LAN access is enabled, a split-tunnel value is used
// (VPN subnet + detected LAN subnet). Otherwise full-tunnel is assumed.
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

// checkUDPPort returns true when a UDP socket is actively listening on port.
// It uses `ss -uln` which is available on all modern Linux systems.
func checkUDPPort(port int) bool {
	out, err := exec.Command("sh", "-c", fmt.Sprintf("ss -uln 2>/dev/null | grep ':%d '", port)).Output()
	if err != nil {
		return false
	}
	return len(strings.TrimSpace(string(out))) > 0
}
