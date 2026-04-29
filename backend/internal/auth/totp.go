package auth

import (
	"encoding/base64"
	"bytes"

	"github.com/pquerna/otp/totp"
	"github.com/skip2/go-qrcode"
)

type TOTPSetup struct {
	Secret   string `json:"secret"`
	QRCode   string `json:"qr_code"` // base64 PNG
	OTPAuthURL string `json:"otp_auth_url"`
}

func GenerateTOTP(username, issuer string) (*TOTPSetup, error) {
	key, err := totp.Generate(totp.GenerateOpts{
		Issuer:      issuer,
		AccountName: username,
	})
	if err != nil {
		return nil, err
	}

	var buf bytes.Buffer
	png, err := qrcode.Encode(key.URL(), qrcode.Medium, 256)
	if err != nil {
		return nil, err
	}
	buf.Write(png)

	return &TOTPSetup{
		Secret:     key.Secret(),
		QRCode:     base64.StdEncoding.EncodeToString(buf.Bytes()),
		OTPAuthURL: key.URL(),
	}, nil
}

func ValidateTOTP(secret, code string) bool {
	return totp.Validate(code, secret)
}
