package database

import (
	"log/slog"

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

func AutoMigrate() error {
	return DB.AutoMigrate(
		&models.Admin{},
		&models.RefreshToken{},
		&models.Interface{},
		&models.Client{},
		&models.DownloadToken{},
		&models.ConnectionEvent{},
	)
}
