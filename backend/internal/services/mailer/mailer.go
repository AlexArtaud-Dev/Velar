package mailer

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"log/slog"
	"net/smtp"
	"strings"

	"github.com/AlexArtaud-Dev/velar/backend/internal/config"
)

// SMTPEnabled returns true when SMTP is configured (host + from address set).
// Admin email is NOT required here — client notifications can work without it.
func SMTPEnabled() bool {
	c := config.C
	return c.SMTPHost != "" && c.SMTPFrom != ""
}

// Enabled returns true when full admin notifications are configured.
func Enabled() bool {
	return SMTPEnabled() && config.C.AdminEmail != ""
}

// Send delivers a plain-text email to the admin. Best-effort, non-blocking.
func Send(subject, body string) {
	if !Enabled() {
		return
	}
	go func() {
		if err := sendPlain(config.C.AdminEmail, subject, body); err != nil {
			slog.Warn("mailer: send to admin failed", "subject", subject, "err", err)
		}
	}()
}

// SendTo delivers a plain-text email to any recipient. Best-effort, non-blocking.
// Only requires SMTP_HOST and SMTP_FROM to be set (not ADMIN_EMAIL).
func SendTo(to, subject, body string) {
	if !SMTPEnabled() || to == "" {
		return
	}
	go func() {
		if err := sendPlain(to, subject, body); err != nil {
			slog.Warn("mailer: send failed", "to", to, "subject", subject, "err", err)
		}
	}()
}

// SendHTML delivers a beautiful HTML email to the admin. Best-effort, non-blocking.
func SendHTML(subject, htmlBody string) {
	if !Enabled() {
		return
	}
	go func() {
		if err := sendHTMLEmail(config.C.AdminEmail, subject, htmlBody); err != nil {
			slog.Warn("mailer: send HTML to admin failed", "subject", subject, "err", err)
		}
	}()
}

// SendHTMLTo delivers a beautiful HTML email to any recipient. Best-effort, non-blocking.
func SendHTMLTo(to, subject, htmlBody string) {
	if !SMTPEnabled() || to == "" {
		return
	}
	go func() {
		if err := sendHTMLEmail(to, subject, htmlBody); err != nil {
			slog.Warn("mailer: send HTML failed", "to", to, "subject", subject, "err", err)
		}
	}()
}

// ── internal ──────────────────────────────────────────────────────────────────

func auth() smtp.Auth {
	c := config.C
	if c.SMTPUser == "" {
		return nil
	}
	return smtp.PlainAuth("", c.SMTPUser, c.SMTPPass, c.SMTPHost)
}

func addr() string {
	return fmt.Sprintf("%s:%s", config.C.SMTPHost, config.C.SMTPPort)
}

func sendHTMLEmail(to, subject, htmlBody string) error {
	c := config.C
	boundary := "velar-alt-001"
	plain := "This email requires an HTML-compatible mail client. Please use an email app that supports HTML."

	var buf bytes.Buffer
	buf.WriteString("From: Velar <" + c.SMTPFrom + ">\r\n")
	buf.WriteString("To: " + to + "\r\n")
	buf.WriteString("Subject: [Velar] " + subject + "\r\n")
	buf.WriteString("MIME-Version: 1.0\r\n")
	buf.WriteString(fmt.Sprintf("Content-Type: multipart/alternative; boundary=\"%s\"\r\n", boundary))
	buf.WriteString("\r\n")

	// Plain-text fallback
	buf.WriteString(fmt.Sprintf("--%s\r\n", boundary))
	buf.WriteString("Content-Type: text/plain; charset=UTF-8\r\n\r\n")
	buf.WriteString(plain + "\r\n\r\n")

	// HTML part
	buf.WriteString(fmt.Sprintf("--%s\r\n", boundary))
	buf.WriteString("Content-Type: text/html; charset=UTF-8\r\n\r\n")
	buf.WriteString(htmlBody + "\r\n")

	buf.WriteString(fmt.Sprintf("--%s--\r\n", boundary))

	return smtp.SendMail(addr(), auth(), c.SMTPFrom, []string{to}, buf.Bytes())
}

func sendPlain(to, subject, body string) error {
	c := config.C
	msg := strings.Join([]string{
		"From: Velar <" + c.SMTPFrom + ">",
		"To: " + to,
		"Subject: [Velar] " + subject,
		"MIME-Version: 1.0",
		"Content-Type: text/plain; charset=UTF-8",
		"",
		body,
	}, "\r\n")
	return smtp.SendMail(addr(), auth(), c.SMTPFrom, []string{to}, []byte(msg))
}

func sendAttachment(to, subject, body, filename, content string) error {
	c := config.C
	boundary := "velar-boundary-001"
	encoded := base64.StdEncoding.EncodeToString([]byte(content))

	var buf bytes.Buffer
	buf.WriteString("From: Velar <" + c.SMTPFrom + ">\r\n")
	buf.WriteString("To: " + to + "\r\n")
	buf.WriteString("Subject: [Velar] " + subject + "\r\n")
	buf.WriteString("MIME-Version: 1.0\r\n")
	buf.WriteString(fmt.Sprintf("Content-Type: multipart/mixed; boundary=\"%s\"\r\n", boundary))
	buf.WriteString("\r\n")

	// Text part
	buf.WriteString(fmt.Sprintf("--%s\r\n", boundary))
	buf.WriteString("Content-Type: text/plain; charset=UTF-8\r\n\r\n")
	buf.WriteString(body + "\r\n")

	// Attachment part
	buf.WriteString(fmt.Sprintf("--%s\r\n", boundary))
	buf.WriteString(fmt.Sprintf("Content-Type: application/octet-stream; name=\"%s\"\r\n", filename))
	buf.WriteString("Content-Transfer-Encoding: base64\r\n")
	buf.WriteString(fmt.Sprintf("Content-Disposition: attachment; filename=\"%s\"\r\n\r\n", filename))

	// Split base64 into 76-char lines (RFC 2045)
	for i := 0; i < len(encoded); i += 76 {
		end := i + 76
		if end > len(encoded) {
			end = len(encoded)
		}
		buf.WriteString(encoded[i:end] + "\r\n")
	}

	buf.WriteString(fmt.Sprintf("--%s--\r\n", boundary))

	return smtp.SendMail(addr(), auth(), c.SMTPFrom, []string{to}, buf.Bytes())
}
