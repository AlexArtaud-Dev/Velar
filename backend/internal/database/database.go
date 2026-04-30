package database

import (
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
