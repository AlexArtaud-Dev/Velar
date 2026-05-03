package config

// AppVersion is the current Velar release. Bump this on each release.
const AppVersion = "1.0.0"

import (
	"log/slog"
	"os"
	"strconv"
)

type Config struct {
	AppSecret   string
	AppPort     string
	AppEnv      string
	DBPath      string
	WGConfigDir string
	WGHost      string
	WGMock      bool
	AdguardURL  string
	AdguardUser string
	AdguardPass string
	CORSOrigin  string
	// SMTP / notifications
	SMTPHost    string
	SMTPPort    string
	SMTPUser    string
	SMTPPass    string
	SMTPFrom    string
	AdminEmail  string
	// Public URL of the Velar dashboard (e.g. https://velar.example.com)
	// Used to build one-time download links in notification emails.
	AppURL string
}

var C Config

func Load() {
	C = Config{
		AppSecret:   requireEnv("APP_SECRET"),
		AppPort:     getEnv("APP_PORT", "8080"),
		AppEnv:      getEnv("APP_ENV", "production"),
		DBPath:      getEnv("DB_PATH", "/data/velar.db"),
		WGConfigDir: getEnv("WG_CONFIG_DIR", "/etc/wireguard"),
		WGHost:      getEnv("WG_HOST", "0.0.0.0"),
		WGMock:      parseBool(getEnv("WG_MOCK", "false")),
		AdguardURL:  getEnv("ADGUARD_URL", "http://localhost:3001"),
		AdguardUser: getEnv("ADGUARD_USER", "admin"),
		AdguardPass: getEnv("ADGUARD_PASSWORD", ""),
		CORSOrigin:  getEnv("CORS_ORIGIN", "http://localhost:5173"),
		SMTPHost:    getEnv("SMTP_HOST", ""),
		SMTPPort:    getEnv("SMTP_PORT", "587"),
		SMTPUser:    getEnv("SMTP_USER", ""),
		SMTPPass:    getEnv("SMTP_PASSWORD", ""),
		SMTPFrom:    getEnv("SMTP_FROM", ""),
		AdminEmail:  getEnv("ADMIN_EMAIL", ""),
		AppURL:      getEnv("APP_URL", ""),
	}

	if len(C.AppSecret) < 32 {
		slog.Warn("APP_SECRET is shorter than 32 characters — this weakens encryption")
	}
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func requireEnv(key string) string {
	v := os.Getenv(key)
	if v == "" {
		slog.Error("required env var not set", "key", key)
		os.Exit(1)
	}
	return v
}

func parseBool(s string) bool {
	b, _ := strconv.ParseBool(s)
	return b
}
