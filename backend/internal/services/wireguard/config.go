package wireguard

import (
	"fmt"
	"net"
	"os"
	"strings"
)

type PeerEntry struct {
	Comment    string
	PublicKey  string
	PSK        string
	AllowedIPs string
}

func BuildServerConf(name string, port int, privateKey, subnet, postUp, postDown string, peers []PeerEntry) string {
	ip := serverIP(subnet)
	_, ipNet, _ := net.ParseCIDR(subnet)
	prefix, _ := ipNet.Mask.Size()

	sb := strings.Builder{}
	sb.WriteString("[Interface]\n")
	sb.WriteString(fmt.Sprintf("PrivateKey = %s\n", privateKey))
	sb.WriteString(fmt.Sprintf("Address = %s/%d\n", ip, prefix))
	sb.WriteString(fmt.Sprintf("ListenPort = %d\n", port))
	if postUp != "" {
		sb.WriteString(fmt.Sprintf("PostUp = %s\n", postUp))
	}
	if postDown != "" {
		sb.WriteString(fmt.Sprintf("PostDown = %s\n", postDown))
	}
	for _, p := range peers {
		sb.WriteString("\n")
		if p.Comment != "" {
			sb.WriteString(fmt.Sprintf("# %s\n", p.Comment))
		}
		sb.WriteString("[Peer]\n")
		sb.WriteString(fmt.Sprintf("PublicKey = %s\n", p.PublicKey))
		if p.PSK != "" {
			sb.WriteString(fmt.Sprintf("PresharedKey = %s\n", p.PSK))
		}
		sb.WriteString(fmt.Sprintf("AllowedIPs = %s\n", p.AllowedIPs))
	}
	return sb.String()
}

func BuildClientConf(clientPrivKey, clientAddr, dns, serverPubKey, psk, serverEndpoint, allowedIPs string) string {
	sb := strings.Builder{}
	sb.WriteString("[Interface]\n")
	sb.WriteString(fmt.Sprintf("PrivateKey = %s\n", clientPrivKey))
	sb.WriteString(fmt.Sprintf("Address = %s/32\n", clientAddr))
	if dns != "" {
		sb.WriteString(fmt.Sprintf("DNS = %s\n", dns))
	}
	sb.WriteString("\n[Peer]\n")
	sb.WriteString(fmt.Sprintf("PublicKey = %s\n", serverPubKey))
	if psk != "" {
		sb.WriteString(fmt.Sprintf("PresharedKey = %s\n", psk))
	}
	if allowedIPs == "" {
		allowedIPs = "0.0.0.0/0, ::/0"
	}
	sb.WriteString(fmt.Sprintf("AllowedIPs = %s\n", allowedIPs))
	sb.WriteString(fmt.Sprintf("Endpoint = %s\n", serverEndpoint))
	sb.WriteString("PersistentKeepalive = 25\n")
	return sb.String()
}

func serverIP(subnet string) string {
	ip, ipNet, err := net.ParseCIDR(subnet)
	if err != nil || ip == nil {
		return "10.0.0.1"
	}
	ip = ipNet.IP.To4()
	if ip == nil {
		return "10.0.0.1"
	}
	ip[3]++
	return ip.String()
}

func AllocateNextIP(subnet string, used []string) (string, error) {
	_, ipNet, err := net.ParseCIDR(subnet)
	if err != nil {
		return "", fmt.Errorf("invalid subnet: %w", err)
	}
	usedSet := make(map[string]bool, len(used))
	for _, u := range used {
		usedSet[u] = true
	}

	ip := ipNet.IP.To4()
	if ip == nil {
		return "", fmt.Errorf("only IPv4 subnets supported")
	}
	// skip network address (.0) and server address (.1)
	ip[3] += 2
	for ipNet.Contains(ip) {
		candidate := ip.String()
		if !usedSet[candidate] {
			return candidate, nil
		}
		ip[3]++
		if ip[3] == 0 {
			ip[2]++
		}
	}
	return "", fmt.Errorf("subnet %s is exhausted", subnet)
}

func writeFile(path, content string) error {
	return os.WriteFile(path, []byte(content), 0600)
}

func removeFile(path string) error {
	err := os.Remove(path)
	if os.IsNotExist(err) {
		return nil
	}
	return err
}
