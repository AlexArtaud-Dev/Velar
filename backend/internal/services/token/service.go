package token

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"time"

	"github.com/AlexArtaud-Dev/velar/backend/internal/database"
	"github.com/AlexArtaud-Dev/velar/backend/internal/models"
)

const DefaultTTL = time.Hour

func Generate(clientID uint) (rawToken string, model *models.DownloadToken, err error) {
	b := make([]byte, 32)
	if _, err = rand.Read(b); err != nil {
		return "", nil, err
	}
	rawToken = hex.EncodeToString(b)
	hash := sha256Hash(rawToken)

	model = &models.DownloadToken{
		ClientID:  clientID,
		TokenHash: hash,
		ExpiresAt: time.Now().Add(DefaultTTL),
	}
	if err = database.DB.Create(model).Error; err != nil {
		return "", nil, err
	}
	return rawToken, model, nil
}

func Consume(rawToken string) (*models.Client, error) {
	hash := sha256Hash(rawToken)

	var dt models.DownloadToken
	if err := database.DB.
		Preload("Client").
		Where("token_hash = ? AND used = false AND expires_at > ?", hash, time.Now()).
		First(&dt).Error; err != nil {
		return nil, errors.New("token not found or expired")
	}

	if err := database.DB.Model(&dt).Update("used", true).Error; err != nil {
		return nil, err
	}
	return &dt.Client, nil
}

func HashRefreshToken(raw string) string {
	return sha256Hash(raw)
}

func sha256Hash(s string) string {
	h := sha256.Sum256([]byte(s))
	return hex.EncodeToString(h[:])
}
