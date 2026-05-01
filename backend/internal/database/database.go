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
	// ── Pre-migration: backfill view_token before the uniqueIndex is created ──
	//
	// AutoMigrate adds a uniqueIndex on view_token. SQLite refuses to create a
	// unique index when multiple rows share the same value, which is the case for
	// all pre-v0.9 clients whose view_token is the empty string default.
	//
	// Strategy (safe for both fresh and existing databases):
	//  1. If the clients table exists, try to add the column without an index
	//     (ALTER TABLE is a no-op / returns an error if the column already exists;
	//     we intentionally ignore that error).
	//  2. Backfill every row that still has an empty or NULL token.
	//  3. Run full AutoMigrate — uniqueIndex creation now succeeds.
	if DB.Migrator().HasTable("clients") {
		// Ignore error — column may already exist from a previous (failed) migrate.
		_ = DB.Exec("ALTER TABLE clients ADD COLUMN view_token TEXT NOT NULL DEFAULT ''").Error
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
// has an empty or NULL view_token. Called before AutoMigrate creates the
// uniqueIndex so the constraint is never violated.
func backfillViewTokens() {
	type clientRow struct{ ID uint }
	var rows []clientRow
	// Raw query so we never panic if the column was just added and GORM's
	// schema cache is stale.
	if err := DB.Raw("SELECT id FROM clients WHERE view_token = '' OR view_token IS NULL").
		Scan(&rows).Error; err != nil {
		slog.Warn("backfillViewTokens: query failed", "err", err)
		return
	}
	for _, r := range rows {
		b := make([]byte, 32)
		if _, err := rand.Read(b); err != nil {
			continue
		}
		DB.Exec("UPDATE clients SET view_token = ? WHERE id = ?", hex.EncodeToString(b), r.ID)
	}
	if len(rows) > 0 {
		slog.Info("backfilled view tokens", "count", len(rows))
	}
}
