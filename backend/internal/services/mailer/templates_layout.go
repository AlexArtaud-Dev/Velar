// Package mailer provides HTML email template helpers for Velar.
// Templates are split by audience:
//   - templates_layout.go  — shared layout primitives (this file)
//   - templates_client.go  — client-facing messages
//   - templates_admin.go   — admin-facing messages
package mailer

import "fmt"

// ── Layout primitives ─────────────────────────────────────────────────────────

// baseHTML wraps body content in the branded Velar email shell.
// subtitle appears below the logo in the header.
func baseHTML(subtitle, bodyContent string) string {
	return fmt.Sprintf(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Velar</title>
</head>
<body style="margin:0;padding:0;background:#0f172a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<table width="100%%" cellpadding="0" cellspacing="0" border="0" style="background:#0f172a;padding:40px 16px;">
<tr><td align="center">
<table cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%%;background:#1e293b;border-radius:16px;overflow:hidden;border:1px solid #334155;">

  <!-- Header -->
  <tr>
    <td style="background:linear-gradient(135deg,#6366f1 0%%,#8b5cf6 100%%);padding:36px 40px;text-align:center;">
      <div style="font-size:28px;font-weight:800;color:#ffffff;letter-spacing:-0.5px;">&#x2B22; Velar</div>
      <div style="color:rgba(255,255,255,0.75);font-size:14px;margin-top:8px;font-weight:400;">%s</div>
    </td>
  </tr>

  <!-- Body -->
  <tr>
    <td style="padding:36px 40px;">
      %s
    </td>
  </tr>

  <!-- Footer -->
  <tr>
    <td style="padding:20px 40px;border-top:1px solid #334155;text-align:center;color:#475569;font-size:12px;line-height:1.7;">
      Velar &mdash; VPN Management Platform<br>
      <span style="color:#334155;">This is an automated notification. Do not reply to this email.</span>
    </td>
  </tr>

</table>
</td></tr>
</table>
</body>
</html>`, subtitle, bodyContent)
}

// infoRow renders a two-column table row: a label (left) and a value (right).
func infoRow(label, value string) string {
	return fmt.Sprintf(`<tr>
  <td style="padding:10px 16px;border-bottom:1px solid #1e293b;color:#64748b;font-size:13px;white-space:nowrap;vertical-align:top;">%s</td>
  <td style="padding:10px 16px;border-bottom:1px solid #1e293b;color:#e2e8f0;font-size:13px;font-family:'Courier New',Courier,monospace;word-break:break-all;">%s</td>
</tr>`, label, value)
}

// infoTable wraps a set of infoRow calls in a styled table container.
func infoTable(rows string) string {
	return fmt.Sprintf(`<table cellpadding="0" cellspacing="0" border="0" width="100%%" style="background:#0f172a;border-radius:10px;border:1px solid #334155;margin:20px 0;overflow:hidden;">
  <tbody>%s</tbody>
</table>`, rows)
}

// ctaButton renders a large call-to-action button linking to url.
func ctaButton(label, url string) string {
	return fmt.Sprintf(`<div style="text-align:center;margin:28px 0 12px;">
  <a href="%s" style="display:inline-block;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#ffffff;text-decoration:none;padding:14px 36px;border-radius:10px;font-weight:700;font-size:15px;letter-spacing:0.2px;">%s</a>
</div>`, url, label)
}

// badge renders an inline pill badge with custom text, foreground, and background colours.
func badge(label, color, bg string) string {
	return fmt.Sprintf(`<span style="display:inline-block;padding:4px 12px;border-radius:20px;font-size:12px;font-weight:700;color:%s;background:%s;letter-spacing:0.3px;">%s</span>`,
		color, bg, label)
}

// h2 renders a section heading.
func h2(text string) string {
	return fmt.Sprintf(`<h2 style="margin:0 0 12px;color:#f1f5f9;font-size:20px;font-weight:700;line-height:1.3;">%s</h2>`, text)
}

// para renders a body paragraph.
func para(text string) string {
	return fmt.Sprintf(`<p style="margin:0 0 16px;color:#94a3b8;font-size:14px;line-height:1.75;">%s</p>`, text)
}

// highlight renders a left-border callout block for important notes.
func highlight(text string) string {
	return fmt.Sprintf(`<p style="margin:0 0 16px;background:#0f172a;border-left:3px solid #6366f1;padding:12px 16px;border-radius:0 8px 8px 0;color:#e2e8f0;font-size:14px;line-height:1.75;">%s</p>`, text)
}

// note renders small-print text centred below the main body.
func note(text string) string {
	return fmt.Sprintf(`<p style="margin:16px 0 0;color:#475569;font-size:12px;line-height:1.6;text-align:center;">%s</p>`, text)
}

// divider renders a full-width horizontal rule.
func divider() string {
	return `<div style="height:1px;background:#334155;margin:24px 0;"></div>`
}

// portalSection renders a subtle "view your status" link for client emails.
// When portalURL is empty the section is omitted entirely.
func portalSection(portalURL string) string {
	if portalURL == "" {
		return ""
	}
	return fmt.Sprintf(`<p style="margin:20px 0 0;text-align:center;">
  <a href="%s" style="color:#6366f1;font-size:13px;text-decoration:none;">&#x1F4CA;&nbsp; View your VPN status anytime &rarr;</a>
</p>`, portalURL)
}

// stepsList renders a numbered list of instruction strings.
func stepsList(steps []string) string {
	rows := ""
	for i, s := range steps {
		rows += fmt.Sprintf(`<tr>
  <td style="padding:8px 12px 8px 0;vertical-align:top;width:36px;">
    <div style="background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;font-weight:800;font-size:12px;width:26px;height:26px;border-radius:50%%;text-align:center;line-height:26px;">%d</div>
  </td>
  <td style="padding:8px 0;color:#cbd5e1;font-size:14px;line-height:1.65;vertical-align:top;">%s</td>
</tr>`, i+1, s)
	}
	return fmt.Sprintf(`<table cellpadding="0" cellspacing="0" border="0" width="100%%" style="margin:16px 0 20px;">
<tbody>%s</tbody>
</table>`, rows)
}
