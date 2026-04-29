package config

import (
	"log/slog"
	"os"
	"strconv"
)

type Config struct {
	AppSecret  string
	AppPort    string
	AppEnv     string
	DBPath     string
	WGConfigDir string
	WGHost     string
	WGMock     bool
	AdguardURL  string
	AdguardUser string
	AdguardPass string
	CORSOrigin  string
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
