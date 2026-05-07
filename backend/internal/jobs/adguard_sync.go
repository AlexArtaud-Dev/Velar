package jobs

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"time"

	"github.com/AlexArtaud-Dev/velar/backend/internal/auth"
	"github.com/AlexArtaud-Dev/velar/backend/internal/config"
	"github.com/AlexArtaud-Dev/velar/backend/internal/database"
	"github.com/AlexArtaud-Dev/velar/backend/internal/models"
	"github.com/AlexArtaud-Dev/velar/backend/internal/services/adguard"
)

// syncAllAdguardSlaves syncs master AdGuard config to every slave with sync enabled.
func syncAllAdguardSlaves(ag *adguard.Client) {
	var instances []models.RemoteInstance
	database.DB.Where("adguard_enabled = true AND adguard_sync_enabled = true").Find(&instances)
	for _, inst := range instances {
		if err := syncAdguardToInstance(inst, ag); err != nil {
			slog.Warn("adguard sync failed", "instance", inst.Name, "err", err)
		} else {
			slog.Info("adguard sync done", "instance", inst.Name)
		}
	}
}

// SyncInstance syncs master AdGuard config to a specific slave instance.
// Exported so it can be triggered on-demand via the API handler.
func SyncInstance(instanceID uint, ag *adguard.Client) error {
	var inst models.RemoteInstance
	if err := database.DB.First(&inst, instanceID).Error; err != nil {
		return fmt.Errorf("instance not found: %w", err)
	}
	if !inst.AdguardEnabled {
		return fmt.Errorf("adguard not configured for this instance")
	}
	return syncAdguardToInstance(inst, ag)
}

func syncAdguardToInstance(inst models.RemoteInstance, ag *adguard.Client) error {
	token, err := auth.Decrypt(inst.TokenEncrypted, config.C.AppSecret)
	if err != nil {
		return fmt.Errorf("decrypt token: %w", err)
	}

	base := inst.URL + "/api/v1/adguard"
	hc := &http.Client{Timeout: 15 * time.Second}

	// Each section is fully independent — failures are warned but never abort the sync.

	// Global protection
	if status, err := ag.GetStatus(); err != nil {
		slog.Warn("adguard sync: get status", "instance", inst.Name, "err", err)
	} else if err := slavePost(hc, base+"/protection", token, map[string]any{"enabled": status.ProtectionEnabled}); err != nil {
		slog.Warn("adguard sync: protection", "instance", inst.Name, "err", err)
	}

	// Filtering config
	if fs, err := ag.GetFilteringStatus(); err != nil {
		slog.Warn("adguard sync: get filtering status", "instance", inst.Name, "err", err)
	} else if err := slavePut(hc, base+"/filtering/config", token, map[string]any{
		"enabled":  fs.Enabled,
		"interval": fs.Interval,
	}); err != nil {
		slog.Warn("adguard sync: filtering/config", "instance", inst.Name, "err", err)
	}

	// User rules
	if rules, err := ag.GetUserRules(); err != nil {
		slog.Warn("adguard sync: get user rules", "instance", inst.Name, "err", err)
	} else if err := slavePut(hc, base+"/rules", token, map[string]any{"rules": rules}); err != nil {
		slog.Warn("adguard sync: rules", "instance", inst.Name, "err", err)
	}

	// Safe browsing
	if sbEnabled, err := ag.GetSafeBrowsingStatus(); err != nil {
		slog.Warn("adguard sync: get safebrowsing", "instance", inst.Name, "err", err)
	} else if err := slavePut(hc, base+"/safebrowsing", token, map[string]bool{"enabled": sbEnabled}); err != nil {
		slog.Warn("adguard sync: safebrowsing", "instance", inst.Name, "err", err)
	}

	// Parental control
	if parEnabled, err := ag.GetParentalStatus(); err != nil {
		slog.Warn("adguard sync: get parental", "instance", inst.Name, "err", err)
	} else if err := slavePut(hc, base+"/parental", token, map[string]bool{"enabled": parEnabled}); err != nil {
		slog.Warn("adguard sync: parental", "instance", inst.Name, "err", err)
	}

	// Safe search
	if ssSettings, err := ag.GetSafeSearchStatus(); err != nil {
		slog.Warn("adguard sync: get safesearch", "instance", inst.Name, "err", err)
	} else if err := slavePut(hc, base+"/safesearch", token, ssSettings); err != nil {
		slog.Warn("adguard sync: safesearch", "instance", inst.Name, "err", err)
	}

	// Blocked services
	if blocked, err := ag.GetBlockedServices(); err != nil {
		slog.Warn("adguard sync: get blocked services", "instance", inst.Name, "err", err)
	} else if err := slavePut(hc, base+"/services", token, map[string]any{"ids": blocked}); err != nil {
		slog.Warn("adguard sync: blocked services", "instance", inst.Name, "err", err)
	}

	// DNS rewrites — diff master vs slave, add missing, remove extra
	if masterRewrites, err := ag.GetDNSRewrites(); err != nil {
		slog.Warn("adguard sync: get dns rewrites", "instance", inst.Name, "err", err)
	} else {
		var slaveResp struct {
			Rewrites []adguard.DNSRewrite `json:"rewrites"`
		}
		if err := slaveGetJSON(hc, base+"/rewrites", token, &slaveResp); err != nil {
			slog.Warn("adguard sync: get slave rewrites", "instance", inst.Name, "err", err)
		} else {
			slaveSet := make(map[string]bool, len(slaveResp.Rewrites))
			for _, r := range slaveResp.Rewrites {
				slaveSet[r.Domain+"|"+r.Answer] = true
			}
			masterSet := make(map[string]bool, len(masterRewrites))
			for _, r := range masterRewrites {
				masterSet[r.Domain+"|"+r.Answer] = true
				if !slaveSet[r.Domain+"|"+r.Answer] {
					if err := slavePost(hc, base+"/rewrites", token, r); err != nil {
						slog.Warn("adguard sync: add rewrite", "instance", inst.Name, "domain", r.Domain, "err", err)
					}
				}
			}
			for _, r := range slaveResp.Rewrites {
				if !masterSet[r.Domain+"|"+r.Answer] {
					if err := slaveDelete(hc, base+"/rewrites", token, r); err != nil {
						slog.Warn("adguard sync: del rewrite", "instance", inst.Name, "domain", r.Domain, "err", err)
					}
				}
			}
		}
	}

	return nil
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

func slavePut(hc *http.Client, url, token string, body any) error {
	return slaveReq(hc, http.MethodPut, url, token, body)
}

func slavePost(hc *http.Client, url, token string, body any) error {
	return slaveReq(hc, http.MethodPost, url, token, body)
}

func slaveDelete(hc *http.Client, url, token string, body any) error {
	return slaveReq(hc, http.MethodDelete, url, token, body)
}

func slaveReq(hc *http.Client, method, url, token string, body any) error {
	var bodyReader io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return err
		}
		bodyReader = bytes.NewReader(b)
	}
	req, err := http.NewRequest(method, url, bodyReader)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	if bodyReader != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := hc.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return fmt.Errorf("slave returned %d", resp.StatusCode)
	}
	return nil
}

func slaveGetJSON(hc *http.Client, url, token string, out any) error {
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := hc.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return fmt.Errorf("slave returned %d", resp.StatusCode)
	}
	return json.NewDecoder(resp.Body).Decode(out)
}
