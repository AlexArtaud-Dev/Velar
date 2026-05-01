// Package nftquota manages Linux nftables named quotas for per-client data caps.
//
// Each client with a data quota gets a dedicated named quota object
// ("q_<sanitised_ip>") inside the "velar_quota" table. Two forwarding rules
// share that quota counter — one matching the client's IP as source (upload)
// and one matching it as destination (download) — so a single kernel counter
// tracks combined bidirectional traffic.
//
// When the counter exceeds the limit the kernel drops packets immediately,
// providing near-zero overshoot regardless of how quickly traffic flows.
//
// The background quota job still runs every 15 s to detect the exceeded state,
// update the DB flag, and send alert emails; it does NOT need to block traffic
// because nftables has already done so.
package nftquota

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log/slog"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
)

const (
	table = "velar_quota"
	chain = "forward"
)

// Service manages nftables named quotas.
type Service interface {
	// Setup creates the velar_quota table and forward chain. Idempotent; safe
	// to call on every server start.
	Setup() error

	// Apply installs (or replaces) a kernel-level quota for the given VPN IP.
	// bytesRemaining is the remaining budget for the current period; it must be
	// at least 1 (0 is clamped to 1 so the rule exists but blocks immediately).
	Apply(ip string, bytesRemaining int64) error

	// Remove deletes the quota rules and named quota object for an IP.
	// Safe to call even when no rules exist.
	Remove(ip string) error

	// Reset atomically removes then re-creates the quota with a fresh budget.
	// Use on period rollover, manual quota reset, and quota upgrades.
	Reset(ip string, bytesRemaining int64) error

	// GetUsage returns bytes counted by the kernel and whether the quota is
	// exceeded. Returns an error when no quota rule exists for that IP.
	GetUsage(ip string) (used int64, exceeded bool, err error)
}

// New returns the real nftables-backed service. When mock is true it returns a
// no-op implementation suitable for WG_MOCK=true development environments.
func New(mock bool) Service {
	if mock {
		return &mockService{}
	}
	return &realService{}
}

// quotaName derives a valid nftables identifier from a VPN-assigned IP address.
// Dots are replaced with underscores and the result is prefixed with "q_".
// Example: "10.0.0.2" → "q_10_0_0_2"
func quotaName(ip string) string {
	return "q_" + strings.ReplaceAll(ip, ".", "_")
}

// ── realService ───────────────────────────────────────────────────────────────

type realService struct{}

// Setup creates the velar_quota nftables table and the forward chain hooked at
// filter priority. Both operations are idempotent (existing objects are kept).
func (s *realService) Setup() error {
	// "add" is a no-op when the table already exists on modern kernels.
	if err := nftCmd("add", "table", "ip", table); err != nil {
		return fmt.Errorf("nftquota setup: add table: %w", err)
	}

	// Chain with type/hook/priority must be written as a script via stdin
	// because nft's command-line parser requires the definition as a block.
	script := fmt.Sprintf(
		"add chain ip %s %s { type filter hook forward priority filter; policy accept; }\n",
		table, chain,
	)
	if err := nftScript(script); err != nil {
		return fmt.Errorf("nftquota setup: add chain: %w", err)
	}

	slog.Info("nftquota: table and chain ready")
	return nil
}

// Apply creates the named quota and two forwarding rules (saddr + daddr) for ip.
// Any existing quota / rules for that IP are removed first (idempotent).
func (s *realService) Apply(ip string, bytesRemaining int64) error {
	if bytesRemaining < 1 {
		bytesRemaining = 1
	}
	name := quotaName(ip)

	// Remove any stale rules first so Apply is always safe to call repeatedly.
	s.Remove(ip) //nolint:errcheck

	// Create named quota object.
	if err := nftCmd("add", "quota", "ip", table, name,
		fmt.Sprintf("{ over %d bytes }", bytesRemaining)); err != nil {
		return fmt.Errorf("nftquota apply: add quota %s: %w", name, err)
	}

	// saddr rule — counts upload (client → server) and drops once exceeded.
	if err := nftCmd("add", "rule", "ip", table, chain,
		"ip", "saddr", ip, "quota", "name", name, "drop"); err != nil {
		return fmt.Errorf("nftquota apply: saddr rule for %s: %w", ip, err)
	}

	// daddr rule — counts download (server → client); shares the same counter.
	if err := nftCmd("add", "rule", "ip", table, chain,
		"ip", "daddr", ip, "quota", "name", name, "drop"); err != nil {
		return fmt.Errorf("nftquota apply: daddr rule for %s: %w", ip, err)
	}

	slog.Info("nftquota: applied", "ip", ip, "bytes_remaining", bytesRemaining)
	return nil
}

// Remove deletes the two forwarding rules and the named quota for ip.
func (s *realService) Remove(ip string) error {
	name := quotaName(ip)

	handles, err := ruleHandles(name)
	if err != nil {
		slog.Warn("nftquota remove: list handles", "ip", ip, "err", err)
	}
	for _, h := range handles {
		if err := nftCmd("delete", "rule", "ip", table, chain, "handle", strconv.Itoa(h)); err != nil {
			slog.Warn("nftquota remove: delete rule", "handle", h, "err", err)
		}
	}

	// Delete the named quota object; ignore "not found" style errors.
	if err := nftCmd("delete", "quota", "ip", table, name); err != nil {
		slog.Warn("nftquota remove: delete quota object", "name", name, "err", err)
	}

	slog.Info("nftquota: removed", "ip", ip)
	return nil
}

// Reset removes then re-creates the quota with a new budget.
func (s *realService) Reset(ip string, bytesRemaining int64) error {
	s.Remove(ip) //nolint:errcheck
	return s.Apply(ip, bytesRemaining)
}

// nftQuotaJSON mirrors the relevant fields of `nft -j list quota`.
type nftQuotaJSON struct {
	Nftables []struct {
		Quota *struct {
			Bytes int64 `json:"bytes"`
			Used  int64 `json:"used"`
		} `json:"quota"`
	} `json:"nftables"`
}

// GetUsage queries the kernel counter for ip's quota and returns the bytes
// consumed so far together with an exceeded flag.
func (s *realService) GetUsage(ip string) (used int64, exceeded bool, err error) {
	name := quotaName(ip)
	out, execErr := exec.Command("nft", "-j", "list", "quota", "ip", table, name).Output()
	if execErr != nil {
		return 0, false, fmt.Errorf("nft list quota %s: %w", name, execErr)
	}

	var parsed nftQuotaJSON
	if jsonErr := json.Unmarshal(out, &parsed); jsonErr != nil {
		return 0, false, fmt.Errorf("nft quota JSON parse: %w", jsonErr)
	}

	for _, entry := range parsed.Nftables {
		if entry.Quota != nil {
			used = entry.Quota.Used
			exceeded = used >= entry.Quota.Bytes
			return used, exceeded, nil
		}
	}
	return 0, false, fmt.Errorf("nftquota: quota %q not found in output", name)
}

// ── internal helpers ──────────────────────────────────────────────────────────

// handleRe matches lines produced by `nft --handle list chain` that reference
// a specific named quota, capturing the rule handle number.
// Example line: `ip saddr 10.0.0.2 quota name "q_10_0_0_2" drop # handle 7`
var handleRe = regexp.MustCompile(`quota\s+name\s+"?(\S+?)"?\s+drop\s*#\s*handle\s+(\d+)`)

// ruleHandles returns the nftables handle IDs of rules in the forward chain
// that reference the given quota name. These handles are used for deletion.
func ruleHandles(quotaName string) ([]int, error) {
	out, err := exec.Command("nft", "--handle", "list", "chain", "ip", table, chain).Output()
	if err != nil {
		return nil, fmt.Errorf("nft list chain: %w", err)
	}

	var handles []int
	for _, line := range strings.Split(string(out), "\n") {
		m := handleRe.FindStringSubmatch(line)
		if m == nil || m[1] != quotaName {
			continue
		}
		h, convErr := strconv.Atoi(m[2])
		if convErr != nil {
			continue
		}
		handles = append(handles, h)
	}
	return handles, nil
}

// nftCmd runs a single nft sub-command (e.g. "add", "table", …).
// "File exists" / "already exists" responses are treated as success so that
// Setup() and Apply() remain idempotent.
func nftCmd(args ...string) error {
	out, err := exec.Command("nft", args...).CombinedOutput()
	if err == nil {
		return nil
	}
	msg := strings.ToLower(string(bytes.TrimSpace(out)))
	if strings.Contains(msg, "file exists") || strings.Contains(msg, "already exists") {
		return nil // idempotent — object already there
	}
	return fmt.Errorf("nft %v: %s: %w", args, bytes.TrimSpace(out), err)
}

// nftScript feeds an nft script to stdin (nft -f -).
// Used for chain creation which requires a block definition.
func nftScript(script string) error {
	cmd := exec.Command("nft", "-f", "-")
	cmd.Stdin = strings.NewReader(script)
	out, err := cmd.CombinedOutput()
	if err == nil {
		return nil
	}
	msg := strings.ToLower(string(bytes.TrimSpace(out)))
	if strings.Contains(msg, "file exists") || strings.Contains(msg, "already exists") {
		return nil
	}
	return fmt.Errorf("nft script: %s: %w", bytes.TrimSpace(out), err)
}

// ── mockService ───────────────────────────────────────────────────────────────

type mockService struct{}

func (m *mockService) Setup() error                                        { return nil }
func (m *mockService) Apply(_ string, _ int64) error                       { return nil }
func (m *mockService) Remove(_ string) error                               { return nil }
func (m *mockService) Reset(_ string, _ int64) error                       { return nil }
func (m *mockService) GetUsage(_ string) (int64, bool, error)              { return 0, false, nil }
