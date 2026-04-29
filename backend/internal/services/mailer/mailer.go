package mailer

import (
	"fmt"
	"log/slog"
	"net/smtp"
	"strings"

	"github.com/AlexArtaud-Dev/velar/backend/internal/config"
)

// Enabled returns true when SMTP is fully configured.
func Enabled() bool {
	c := config.C
	return c.SMTPHost != "" && c.SMTPFrom != "" && c.AdminEmail != ""
}

// Send delivers a plain-text email to the admin. It is best-effort and never
// blocks the caller — errors are logged but not returned.
func Send(subject, body string) {
	if !Enabled() {
		return
	}
	go func() {
		if err := send(config.C.AdminEmail, subject, body); err != nil {
			slog.Warn("mailer: send failed", "subject", subject, "err", err)
		}
	}()
}

// SendTo delivers a plain-text email to an arbitrary recipient.
func SendTo(to, subject, body string) {
	if !Enabled() {
		return
	}
	go func() {
		if err := send(to, subject, body); err != nil {
			slog.Warn("mailer: send failed", "to", to, "subject", subject, "err", err)
		}
	}()
}

func send(to, subject, body string) error {
	c := config.C
	addr := fmt.Sprintf("%s:%s", c.SMTPHost, c.SMTPPort)

	var auth smtp.Auth
	if c.SMTPUser != "" {
		auth = smtp.PlainAuth("", c.SMTPUser, c.SMTPPass, c.SMTPHost)
	}

	msg := strings.Join([]string{
		"From: Velar <" + c.SMTPFrom + ">",
		"To: " + to,
		"Subject: [Velar] " + subject,
		"MIME-Version: 1.0",
		"Content-Type: text/plain; charset=UTF-8",
		"",
		body,
	}, "\r\n")

	return smtp.SendMail(addr, auth, c.SMTPFrom, []string{to}, []byte(msg))
}
