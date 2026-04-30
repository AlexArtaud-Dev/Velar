// Package bandwidth wraps Linux tc (traffic control) to enforce per-peer
// upload and download limits on WireGuard interfaces.
//
// Download (server → client) is shaped via an HTB qdisc + class + u32 filter
// on the WireGuard interface egress.
//
// Upload (client → server) is policed via an ingress qdisc + u32 filter with
// a police action (excess packets are dropped).
//
// Each client is identified by a handle derived from its VPN-assigned IP,
// which makes add/remove operations deterministic and idempotent.
package bandwidth

import (
	"fmt"
	"log/slog"
	"net"
	"os/exec"
	"strings"
)

// Apply enforces asymmetric bandwidth caps on a peer.
// downMbps caps egress (server→client / download); upMbps caps ingress (client→server / upload).
// A value of 0 means no limit for that direction.
// If both are 0, any existing rules are removed.
func Apply(ifaceName, assignedIP string, downMbps, upMbps int) error {
	if downMbps <= 0 && upMbps <= 0 {
		return Remove(ifaceName, assignedIP)
	}

	prio, class, err := handles(assignedIP)
	if err != nil {
		return err
	}

	// Remove any stale rules first (ignore errors — may not exist yet).
	_ = Remove(ifaceName, assignedIP)

	// ── Egress (download: server → client) ──────────────────────────────────

	if downMbps > 0 {
		rate := fmt.Sprintf("%dmbit", downMbps)
		burstKbit := downMbps * 1000 / 8
		if burstKbit < 32 {
			burstKbit = 32
		}
		burst := fmt.Sprintf("%dk", burstKbit)

		if err := ensureRootHTB(ifaceName); err != nil {
			return fmt.Errorf("bandwidth: ensure root HTB on %s: %w", ifaceName, err)
		}
		if err := runTC("tc", "class", "add", "dev", ifaceName,
			"parent", "1:", "classid", "1:"+class,
			"htb", "rate", rate, "burst", burst); err != nil {
			return fmt.Errorf("bandwidth: tc class add egress: %w", err)
		}
		if err := runTC("tc", "filter", "add", "dev", ifaceName,
			"parent", "1:", "prio", prio, "protocol", "ip",
			"u32", "match", "ip", "dst", assignedIP+"/32",
			"flowid", "1:"+class); err != nil {
			return fmt.Errorf("bandwidth: tc filter add egress: %w", err)
		}
	}

	// ── Ingress (upload: client → server) ───────────────────────────────────

	if upMbps > 0 {
		rate := fmt.Sprintf("%dmbit", upMbps)
		burstKbit := upMbps * 1000 / 8
		if burstKbit < 32 {
			burstKbit = 32
		}
		burst := fmt.Sprintf("%dk", burstKbit)

		if err := ensureIngress(ifaceName); err != nil {
			return fmt.Errorf("bandwidth: ensure ingress on %s: %w", ifaceName, err)
		}
		if err := runTC("tc", "filter", "add", "dev", ifaceName,
			"parent", "ffff:", "prio", prio, "protocol", "ip",
			"u32", "match", "ip", "src", assignedIP+"/32",
			"police", "rate", rate, "burst", burst,
			"drop", "flowid", ":1"); err != nil {
			return fmt.Errorf("bandwidth: tc filter add ingress: %w", err)
		}
	}

	slog.Info("bandwidth limit applied", "iface", ifaceName, "ip", assignedIP, "down_mbps", downMbps, "up_mbps", upMbps)
	return nil
}

// Remove deletes all tc rules associated with the given peer IP.
// Safe to call even if no rules exist.
func Remove(ifaceName, assignedIP string) error {
	prio, class, err := handles(assignedIP)
	if err != nil {
		return err
	}
	// Ignore errors — rules may not exist.
	runTC("tc", "filter", "del", "dev", ifaceName, "parent", "1:", "prio", prio, "protocol", "ip")   //nolint:errcheck
	runTC("tc", "class", "del", "dev", ifaceName, "classid", "1:"+class)                              //nolint:errcheck
	runTC("tc", "filter", "del", "dev", ifaceName, "parent", "ffff:", "prio", prio, "protocol", "ip") //nolint:errcheck
	return nil
}

// RemoveAll tears down all tc qdiscs on an interface.
// Call this when an interface is deleted or brought down.
func RemoveAll(ifaceName string) {
	runTC("tc", "qdisc", "del", "dev", ifaceName, "root")                       //nolint:errcheck
	runTC("tc", "qdisc", "del", "dev", ifaceName, "handle", "ffff:", "ingress") //nolint:errcheck
}

// ── internal ──────────────────────────────────────────────────────────────────

// ensureRootHTB creates the root HTB qdisc + a default unlimited class on the
// WireGuard interface if they don't already exist.
func ensureRootHTB(ifaceName string) error {
	out, _ := exec.Command("tc", "qdisc", "show", "dev", ifaceName).Output()
	if strings.Contains(string(out), "htb") {
		return nil // already set up
	}
	if err := runTC("tc", "qdisc", "add", "dev", ifaceName, "root", "handle", "1:", "htb", "default", "9999"); err != nil {
		return err
	}
	// Default class — effectively unlimited (10 Gbit) for peers without a limit.
	return runTC("tc", "class", "add", "dev", ifaceName,
		"parent", "1:", "classid", "1:9999", "htb", "rate", "10gbit")
}

// ensureIngress creates the ingress qdisc on the WireGuard interface if it
// doesn't already exist.
func ensureIngress(ifaceName string) error {
	out, _ := exec.Command("tc", "qdisc", "show", "dev", ifaceName).Output()
	if strings.Contains(string(out), "ingress") {
		return nil
	}
	return runTC("tc", "qdisc", "add", "dev", ifaceName, "handle", "ffff:", "ingress")
}

// handles returns the tc priority and class handle for a given IP.
// Both values are derived from the last two octets of the IPv4 address,
// giving a unique-per-/16-subnet integer in the range 2–65534.
func handles(ip string) (prio, class string, err error) {
	parsed := net.ParseIP(ip).To4()
	if parsed == nil {
		return "", "", fmt.Errorf("bandwidth: invalid IPv4 %q", ip)
	}
	n := int(parsed[2])*256 + int(parsed[3])
	s := fmt.Sprintf("%d", n)
	return s, s, nil
}

func runTC(args ...string) error {
	out, err := exec.Command(args[0], args[1:]...).CombinedOutput()
	if err != nil {
		return fmt.Errorf("%v: %s: %w", args, strings.TrimSpace(string(out)), err)
	}
	return nil
}
