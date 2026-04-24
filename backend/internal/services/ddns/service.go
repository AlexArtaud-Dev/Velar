package ddns

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"sync"
	"time"
)

type Service struct {
	mu        sync.RWMutex
	currentIP string
	http      *http.Client
}

func NewService() *Service {
	return &Service{
		http: &http.Client{Timeout: 10 * time.Second},
	}
}

func (s *Service) CurrentIP() string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.currentIP
}

func (s *Service) Refresh() (changed bool, newIP string, err error) {
	ip, err := s.fetchPublicIP()
	if err != nil {
		return false, "", err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if ip != s.currentIP {
		slog.Info("public IP changed", "old", s.currentIP, "new", ip)
		s.currentIP = ip
		return true, ip, nil
	}
	return false, ip, nil
}

func (s *Service) fetchPublicIP() (string, error) {
	resp, err := s.http.Get("https://api.ipify.org?format=json")
	if err != nil {
		return "", fmt.Errorf("ipify: %w", err)
	}
	defer resp.Body.Close()

	var result struct {
		IP string `json:"ip"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", err
	}
	return result.IP, nil
}
