package adguard

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// ── Types ─────────────────────────────────────────────────────────────────────

type Status struct {
	Running         bool     `json:"running"`
	Version         string   `json:"version"`
	DNSAddresses    []string `json:"dns_addresses"`
	DNSPort         int      `json:"dns_port"`
	QueryLogEnabled bool     `json:"querylog_enabled"`
}

type Stats struct {
	NumDNSQueries           int64   `json:"num_dns_queries"`
	NumBlockedFiltering     int64   `json:"num_blocked_filtering"`
	NumReplacedSafebrowsing int64   `json:"num_replaced_safebrowsing"`
	NumReplacedParental     int64   `json:"num_replaced_parental"`
	AvgProcessingTime       float64 `json:"avg_processing_time"`
}

type FilteringStatus struct {
	Enabled  bool     `json:"enabled"`
	Interval int      `json:"interval"`
	Filters  []Filter `json:"filters"`
}

type Filter struct {
	ID      int64  `json:"id"`
	URL     string `json:"url"`
	Name    string `json:"name"`
	Enabled bool   `json:"enabled"`
	RulesCount int `json:"rules_count"`
}

type FilteringConfig struct {
	Enabled  bool `json:"enabled"`
	Interval int  `json:"interval"`
}

type AddFilterRequest struct {
	URL     string `json:"url"`
	Name    string `json:"name"`
	Enabled bool   `json:"whitelist"`
}

type FilterURL struct {
	URL     string `json:"url"`
	Whitelist bool `json:"whitelist"`
}

type FilterURLUpdate struct {
	URL  string `json:"url"`
	Data Filter `json:"data"`
}

type UserRules struct {
	Rules []string `json:"rules"`
}

type DNSRewrite struct {
	Domain string `json:"domain"`
	Answer string `json:"answer"`
}

type DNSRewriteList struct {
	Rewrites []DNSRewrite `json:"rewrites"`
}

// ── Client ────────────────────────────────────────────────────────────────────

type Client struct {
	baseURL  string
	username string
	password string
	http     *http.Client
}

func NewClient(baseURL, username, password string) *Client {
	return &Client{
		baseURL:  baseURL,
		username: username,
		password: password,
		http:     &http.Client{Timeout: 10 * time.Second},
	}
}

// ── Helpers ───────────────────────────────────────────────────────────────────

func (c *Client) do(method, path string, body any) (*http.Response, error) {
	var r io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		r = bytes.NewReader(b)
	}
	req, err := http.NewRequest(method, c.baseURL+path, r)
	if err != nil {
		return nil, err
	}
	req.SetBasicAuth(c.username, c.password)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("adguard unreachable: %w", err)
	}
	return resp, nil
}

func (c *Client) get(path string, out any) error {
	resp, err := c.do(http.MethodGet, path, nil)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("adguard returned %d", resp.StatusCode)
	}
	if out != nil {
		return json.NewDecoder(resp.Body).Decode(out)
	}
	return nil
}

func (c *Client) post(path string, body any) error {
	resp, err := c.do(http.MethodPost, path, body)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		b, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("adguard returned %d: %s", resp.StatusCode, string(b))
	}
	return nil
}

func (c *Client) put(path string, body any) error {
	resp, err := c.do(http.MethodPut, path, body)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("adguard returned %d: %s", resp.StatusCode, string(b))
	}
	return nil
}

func (c *Client) delete(path string, body any) error {
	resp, err := c.do(http.MethodDelete, path, body)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("adguard returned %d: %s", resp.StatusCode, string(b))
	}
	return nil
}

// ── API methods ───────────────────────────────────────────────────────────────

func (c *Client) GetStatus() (*Status, error) {
	var s Status
	return &s, c.get("/control/status", &s)
}

func (c *Client) GetStats() (*Stats, error) {
	var s Stats
	return &s, c.get("/control/stats", &s)
}

func (c *Client) GetFilteringStatus() (*FilteringStatus, error) {
	var s FilteringStatus
	return &s, c.get("/control/filtering/status", &s)
}

func (c *Client) SetFilteringConfig(cfg FilteringConfig) error {
	return c.post("/control/filtering/config", cfg)
}

func (c *Client) AddFilter(url, name string) error {
	return c.post("/control/filtering/add_url", map[string]any{
		"url":       url,
		"name":      name,
		"whitelist": false,
	})
}

func (c *Client) RemoveFilter(url string) error {
	return c.post("/control/filtering/remove_url", FilterURL{URL: url})
}

func (c *Client) RefreshFilters() error {
	return c.post("/control/filtering/refresh", map[string]bool{"whitelist": false})
}

func (c *Client) GetUserRules() ([]string, error) {
	var out UserRules
	if err := c.get("/control/filtering/get_user_rules", &out); err != nil {
		return nil, err
	}
	return out.Rules, nil
}

func (c *Client) SetUserRules(rules []string) error {
	return c.post("/control/filtering/set_rules", UserRules{Rules: rules})
}

func (c *Client) GetDNSRewrites() ([]DNSRewrite, error) {
	var out DNSRewriteList
	if err := c.get("/control/rewrite/list", &out); err != nil {
		return nil, err
	}
	return out.Rewrites, nil
}

func (c *Client) AddDNSRewrite(domain, answer string) error {
	return c.post("/control/rewrite/add", DNSRewrite{Domain: domain, Answer: answer})
}

func (c *Client) DeleteDNSRewrite(domain, answer string) error {
	return c.delete("/control/rewrite/delete", DNSRewrite{Domain: domain, Answer: answer})
}
