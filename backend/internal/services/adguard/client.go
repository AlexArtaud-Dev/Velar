package adguard

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

type Status struct {
	Running        bool   `json:"running"`
	Version        string `json:"version"`
	DNSAddresses   []string `json:"dns_addresses"`
	DNSPort        int    `json:"dns_port"`
	QueryLogEnabled bool  `json:"querylog_enabled"`
}

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
		http:     &http.Client{Timeout: 5 * time.Second},
	}
}

func (c *Client) GetStatus() (*Status, error) {
	req, err := http.NewRequest("GET", c.baseURL+"/control/status", nil)
	if err != nil {
		return nil, err
	}
	req.SetBasicAuth(c.username, c.password)

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("adguard unreachable: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("adguard returned %d", resp.StatusCode)
	}

	var s Status
	if err := json.NewDecoder(resp.Body).Decode(&s); err != nil {
		return nil, err
	}
	return &s, nil
}
