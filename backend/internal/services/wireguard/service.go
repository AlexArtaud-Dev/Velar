package wireguard

import (
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"log/slog"
	"net"
	"os/exec"
	"strings"

	"golang.org/x/crypto/curve25519"
)

type InterfaceStatus struct {
	Name      string `json:"name"`
	Up        bool   `json:"up"`
	PeerCount int    `json:"peer_count"`
}

type PeerStat struct {
	PublicKey     string `json:"public_key"`
	LastHandshake int64  `json:"last_handshake"` // unix timestamp, 0 if never
	BytesRx       int64  `json:"bytes_rx"`
	BytesTx       int64  `json:"bytes_tx"`
	Endpoint      string `json:"endpoint"`
}

type Service interface {
	EnsureInterface(name string, port int, privateKey, subnet, postUp, postDown string, peers []PeerEntry) error
	BringUp(name string) error
	BringDown(name string) error
	DeleteInterface(name string) error
	AddPeer(ifaceName, pubKey, psk, allowedIPs string) error
	RemovePeer(ifaceName, pubKey string) error
	SyncConf(ifaceName, confPath string) error
	GetStats(ifaceName string) ([]PeerStat, error)
	GetInterfaceStatus(ifaceName string) (InterfaceStatus, error)
	GenerateKeyPair() (privateKey, publicKey string, err error)
	GeneratePSK() (string, error)
}

type RealService struct {
	configDir string
}

func NewService(configDir string) Service {
	return &RealService{configDir: configDir}
}

func (s *RealService) GenerateKeyPair() (string, string, error) {
	var priv [32]byte
	if _, err := rand.Read(priv[:]); err != nil {
		return "", "", err
	}
	priv[0] &= 248
	priv[31] &= 127
	priv[31] |= 64

	var pub [32]byte
	curve25519.ScalarBaseMult(&pub, &priv)

	privB64 := base64.StdEncoding.EncodeToString(priv[:])
	pubB64 := base64.StdEncoding.EncodeToString(pub[:])
	return privB64, pubB64, nil
}

func (s *RealService) GeneratePSK() (string, error) {
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(key), nil
}

func (s *RealService) EnsureInterface(name string, port int, privateKey, subnet, postUp, postDown string, peers []PeerEntry) error {
	conf := BuildServerConf(name, port, privateKey, subnet, postUp, postDown, peers)
	path := fmt.Sprintf("%s/%s.conf", s.configDir, name)
	if err := writeFile(path, conf); err != nil {
		return fmt.Errorf("write conf: %w", err)
	}
	return nil
}

func (s *RealService) BringUp(name string) error {
	return runWG("wg-quick", "up", name)
}

func (s *RealService) BringDown(name string) error {
	return runWG("wg-quick", "down", name)
}

func (s *RealService) DeleteInterface(name string) error {
	_ = runWG("wg-quick", "down", name)
	path := fmt.Sprintf("%s/%s.conf", s.configDir, name)
	return removeFile(path)
}

func (s *RealService) AddPeer(ifaceName, pubKey, psk, allowedIPs string) error {
	args := []string{"set", ifaceName,
		"peer", pubKey,
		"allowed-ips", allowedIPs,
	}
	if psk != "" {
		args = append(args, "preshared-key", "/dev/stdin")
	}
	cmd := exec.Command("wg", args...)
	if psk != "" {
		cmd.Stdin = strings.NewReader(psk)
	}
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("wg set peer: %s: %w", out, err)
	}
	return nil
}

func (s *RealService) RemovePeer(ifaceName, pubKey string) error {
	return runWG("wg", "set", ifaceName, "peer", pubKey, "remove")
}

func (s *RealService) SyncConf(ifaceName, confPath string) error {
	strip := exec.Command("wg-quick", "strip", confPath)
	stripped, err := strip.Output()
	if err != nil {
		return fmt.Errorf("wg-quick strip: %w", err)
	}
	sync := exec.Command("wg", "syncconf", ifaceName, "/dev/stdin")
	sync.Stdin = strings.NewReader(string(stripped))
	out, err := sync.CombinedOutput()
	if err != nil {
		return fmt.Errorf("wg syncconf: %s: %w", out, err)
	}
	return nil
}

func (s *RealService) GetStats(ifaceName string) ([]PeerStat, error) {
	out, err := exec.Command("wg", "show", ifaceName, "dump").Output()
	if err != nil {
		return nil, fmt.Errorf("wg show dump: %w", err)
	}
	return parseWGDump(string(out)), nil
}

func (s *RealService) GetInterfaceStatus(ifaceName string) (InterfaceStatus, error) {
	out, err := exec.Command("wg", "show", ifaceName).Output()
	up := err == nil && len(out) > 0
	return InterfaceStatus{Name: ifaceName, Up: up}, nil
}

func NextIP(subnet string) (string, error) {
	_, ipNet, err := net.ParseCIDR(subnet)
	if err != nil {
		return "", err
	}
	ip := ipNet.IP
	// server takes .1, allocate from .2
	ip[3]++
	ip[3]++
	return ip.String(), nil
}

func DetectMainInterface() string {
	out, err := exec.Command("ip", "route", "show", "default").Output()
	if err != nil {
		return "eth0"
	}
	parts := strings.Fields(string(out))
	for i, p := range parts {
		if p == "dev" && i+1 < len(parts) {
			return parts[i+1]
		}
	}
	return "eth0"
}

// DetectLANSubnet returns the CIDR subnet of the default network interface
// (e.g. "192.168.1.0/24"). Returns an empty string on failure.
func DetectLANSubnet() string {
	iface := DetectMainInterface()
	out, err := exec.Command("ip", "-o", "-f", "inet", "addr", "show", iface).Output()
	if err != nil {
		return ""
	}
	for _, line := range strings.Split(string(out), "\n") {
		fields := strings.Fields(line)
		for i, f := range fields {
			if f == "inet" && i+1 < len(fields) {
				_, ipNet, err := net.ParseCIDR(fields[i+1])
				if err == nil {
					return ipNet.String()
				}
			}
		}
	}
	return ""
}

func runWG(name string, args ...string) error {
	out, err := exec.Command(name, args...).CombinedOutput()
	if err != nil {
		return fmt.Errorf("%s %v: %s: %w", name, args, out, err)
	}
	return nil
}

func parseWGDump(raw string) []PeerStat {
	var stats []PeerStat
	lines := strings.Split(strings.TrimSpace(raw), "\n")
	// first line is interface — skip it
	for _, line := range lines[1:] {
		fields := strings.Fields(line)
		if len(fields) < 8 {
			continue
		}
		var s PeerStat
		s.PublicKey = fields[0]
		s.Endpoint = fields[2]
		fmt.Sscanf(fields[4], "%d", &s.LastHandshake)
		fmt.Sscanf(fields[5], "%d", &s.BytesRx)
		fmt.Sscanf(fields[6], "%d", &s.BytesTx)
		stats = append(stats, s)
	}
	return stats
}

// MockService returns stub data without executing wg commands.
type MockService struct{}

func NewMockService() Service { return &MockService{} }

func (m *MockService) GenerateKeyPair() (string, string, error) {
	svc := &RealService{}
	return svc.GenerateKeyPair()
}
func (m *MockService) GeneratePSK() (string, error) {
	svc := &RealService{}
	return svc.GeneratePSK()
}
func (m *MockService) EnsureInterface(name string, port int, privateKey, subnet, postUp, postDown string, peers []PeerEntry) error {
	slog.Info("[mock] EnsureInterface", "name", name)
	return nil
}
func (m *MockService) BringUp(name string) error {
	slog.Info("[mock] BringUp", "name", name)
	return nil
}
func (m *MockService) BringDown(name string) error {
	slog.Info("[mock] BringDown", "name", name)
	return nil
}
func (m *MockService) DeleteInterface(name string) error {
	slog.Info("[mock] DeleteInterface", "name", name)
	return nil
}
func (m *MockService) AddPeer(ifaceName, pubKey, psk, allowedIPs string) error {
	slog.Info("[mock] AddPeer", "iface", ifaceName, "pub", pubKey)
	return nil
}
func (m *MockService) RemovePeer(ifaceName, pubKey string) error {
	slog.Info("[mock] RemovePeer", "iface", ifaceName, "pub", pubKey)
	return nil
}
func (m *MockService) SyncConf(ifaceName, confPath string) error {
	slog.Info("[mock] SyncConf", "iface", ifaceName)
	return nil
}
func (m *MockService) GetStats(ifaceName string) ([]PeerStat, error) {
	return []PeerStat{}, nil
}
func (m *MockService) GetInterfaceStatus(ifaceName string) (InterfaceStatus, error) {
	return InterfaceStatus{Name: ifaceName, Up: true, PeerCount: 0}, nil
}
