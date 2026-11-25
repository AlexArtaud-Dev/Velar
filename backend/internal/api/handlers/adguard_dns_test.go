package handlers

import (
	"reflect"
	"testing"

	"github.com/AlexArtaud-Dev/velar/backend/internal/services/adguard"
)

func TestValidateDNSConfig(t *testing.T) {
	tests := []struct {
		name          string
		cfg           adguard.DNSConfig
		wantErr       bool
		wantUpstream  []string
		wantBootstrap []string
	}{
		{
			name:    "empty upstream",
			cfg:     adguard.DNSConfig{UpstreamDNS: []string{}},
			wantErr: true,
		},
		{
			name:    "only blank lines and comments",
			cfg:     adguard.DNSConfig{UpstreamDNS: []string{"", "   ", "# quad9 is down"}},
			wantErr: true,
		},
		{
			name: "bootstrap hostname rejected",
			cfg: adguard.DNSConfig{
				UpstreamDNS:  []string{"https://cloudflare-dns.com/dns-query"},
				BootstrapDNS: []string{"one.one.one.one"},
			},
			wantErr: true,
		},
		{
			name: "invalid mode",
			cfg: adguard.DNSConfig{
				UpstreamDNS:  []string{"1.1.1.1"},
				UpstreamMode: "round_robin",
			},
			wantErr: true,
		},
		{
			name: "ipv4, ipv6 and ip:port bootstrap",
			cfg: adguard.DNSConfig{
				UpstreamDNS:  []string{"tls://one.one.one.one"},
				BootstrapDNS: []string{"1.1.1.1", "2606:4700:4700::1111", "1.0.0.1:53", "[2606:4700:4700::1001]:53"},
				UpstreamMode: "parallel",
			},
			wantUpstream:  []string{"tls://one.one.one.one"},
			wantBootstrap: []string{"1.1.1.1", "2606:4700:4700::1111", "1.0.0.1:53", "[2606:4700:4700::1001]:53"},
		},
		{
			name: "trims, drops blanks and comments",
			cfg: adguard.DNSConfig{
				UpstreamDNS:  []string{"  https://dns.google/dns-query  ", "", "# comment", "tls://dns.google"},
				BootstrapDNS: []string{" 8.8.8.8 ", "#8.8.4.4", ""},
			},
			wantUpstream:  []string{"https://dns.google/dns-query", "tls://dns.google"},
			wantBootstrap: []string{"8.8.8.8"},
		},
		{
			name: "every valid mode accepted",
			cfg: adguard.DNSConfig{
				UpstreamDNS:  []string{"1.1.1.1"},
				UpstreamMode: "fastest_addr",
			},
			wantUpstream:  []string{"1.1.1.1"},
			wantBootstrap: []string{},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cfg := tt.cfg
			err := validateDNSConfig(&cfg)
			if (err != nil) != tt.wantErr {
				t.Fatalf("err = %v, wantErr %v", err, tt.wantErr)
			}
			if tt.wantErr {
				return
			}
			if !reflect.DeepEqual(cfg.UpstreamDNS, tt.wantUpstream) {
				t.Errorf("upstream = %v, want %v", cfg.UpstreamDNS, tt.wantUpstream)
			}
			if !reflect.DeepEqual(cfg.BootstrapDNS, tt.wantBootstrap) {
				t.Errorf("bootstrap = %v, want %v", cfg.BootstrapDNS, tt.wantBootstrap)
			}
		})
	}
}
