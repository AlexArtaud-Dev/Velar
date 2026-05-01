package database

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"log/slog"
	"os"

	"github.com/AlexArtaud-Dev/velar/backend/internal/models"
	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

var DB *gorm.DB

func Init(dsn string) error {
	var err error
	DB, err = gorm.Open(sqlite.Open(dsn), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Silent),
	})
	if err != nil {
		return err
	}

	sqlDB, err := DB.DB()
	if err != nil {
		return err
	}
	sqlDB.SetMaxOpenConns(1)

	if err := DB.Exec("PRAGMA journal_mode=WAL").Error; err != nil {
		return err
	}
	if err := DB.Exec("PRAGMA foreign_keys=ON").Error; err != nil {
		return err
	}

	slog.Info("database connected", "dsn", dsn)
	return nil
}

// ValidateSQLite checks that the file at path is a valid SQLite3 database
// by reading the magic header bytes. Returns an error if invalid.
func ValidateSQLite(path string) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()

	header := make([]byte, 16)
	if _, err := f.Read(header); err != nil {
		return fmt.Errorf("cannot read file header: %w", err)
	}

	// SQLite3 files start with this magic string
	if string(header[:16]) != "SQLite format 3\x00" {
		return fmt.Errorf("not a valid SQLite3 database")
	}
	return nil
}

func AutoMigrate() error {
	// ── Pre-migration: ensure view_token column exists and has no blank values ──
	// AutoMigrate will add a uniqueIndex on view_token. SQLite cannot create a
	// unique index when multiple rows share the same value (empty string for
	// pre-v0.9 clients). We therefore:
	//  1. Add the column without the index if it is missing.
	//  2. Backfill any empty/NULL values with unique random tokens.
	// Then the full AutoMigrate (which adds the uniqueIndex) will succeed.
	if DB.Migrator().HasColumn(&models.Client{}, "view_token") {
		// Column exists — just backfill blanks.
		backfillViewTokens()
	} else {
		// Column doesn't exist yet — add it plain (no index) so we can populate it.
		if err := DB.Exec("ALTER TABLE clients ADD COLUMN view_token TEXT NOT NULL DEFAULT ''").Error; err != nil {
			// Ignore "duplicate column" errors from concurrent starts.
			slog.Warn("pre-migrate add view_token column", "err", err)
		}
		backfillViewTokens()
	}

	return DB.AutoMigrate(
		&models.Admin{},
		&models.RefreshToken{},
		&models.Interface{},
		&models.Client{},
		&models.DownloadToken{},
		&models.ConnectionEvent{},
		&models.PeerSnapshot{},
	)
}

// backfillViewTokens assigns a unique random token to every client row that
// has an empty or NULL view_token. Must be called before AutoMigrate adds the
// uniqueIndex, otherwise the constraint creation fails on duplicate empties.
func backfillViewTokens() {
	type row struct {
		ID uint
	}
	var rows []row
	DB.Raw("SELECT id FROM clients WHERE view_token = '' OR view_token IS NULL").Scan(&rows)
	for _, r := range rows {
		b := make([]byte, 32)
		_, _ = rand.Read(b)
		DB.Exec("UPDATE clients SET view_token = ? WHERE id = ?", hex.EncodeToString(b), r.ID)
	}
	if len(rows) > 0 {
		slog.Info("pre-migrate: backfilled view tokens", "count", len(rows))
	}
}
