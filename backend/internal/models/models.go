package models

import "time"

type Admin struct {
	ID                 uint      `gorm:"primaryKey" json:"id"`
	Username           string    `gorm:"uniqueIndex;not null" json:"username"`
	PasswordHash       string    `gorm:"not null" json:"-"`
	TOTPSecret         string    `gorm:"default:''" json:"-"`
	TOTPEnabled        bool      `gorm:"default:false" json:"totp_enabled"`
	MustChangePassword bool      `gorm:"default:false" json:"must_change_password"`
	CreatedAt          time.Time `json:"created_at"`
}

type RefreshToken struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	AdminID   uint      `gorm:"not null;index" json:"admin_id"`
	TokenHash string    `gorm:"uniqueIndex;not null" json:"-"`
	ExpiresAt time.Time `gorm:"not null" json:"expires_at"`
	Revoked   bool      `gorm:"default:false" json:"revoked"`
	CreatedAt time.Time `json:"created_at"`
	Admin     Admin     `gorm:"foreignKey:AdminID" json:"-"`
}

type Interface struct {
	ID            uint      `gorm:"primaryKey" json:"id"`
	Name          string    `gorm:"uniqueIndex;not null" json:"name"`
	Port          int       `gorm:"not null" json:"port"`
	Subnet        string    `gorm:"not null" json:"subnet"`
	PrivateKey    string    `gorm:"not null" json:"-"`
	PublicKey     string    `gorm:"not null" json:"public_key"`
	DNSServer     string    `gorm:"default:'1.1.1.1'" json:"dns_server"`
	ListenAddress string    `gorm:"default:'0.0.0.0'" json:"listen_address"`
	PostUp        string    `json:"post_up"`
	PostDown      string    `json:"post_down"`
	LanAccess     bool      `gorm:"default:false" json:"lan_access"`
	LanSubnet     string    `gorm:"default:''" json:"lan_subnet"`
	Enabled       bool      `gorm:"default:true" json:"enabled"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
	Clients       []Client  `gorm:"foreignKey:InterfaceID" json:"clients,omitempty"`
}

type Client struct {
	ID            uint       `gorm:"primaryKey" json:"id"`
	InterfaceID   uint       `gorm:"not null;index" json:"interface_id"`
	Name          string     `gorm:"not null" json:"name"`
	OwnerLabel    string     `json:"owner_label"`
	Email         string     `gorm:"default:''" json:"email"`
	PublicKey     string     `gorm:"uniqueIndex;not null" json:"public_key"`
	PrivateKey    string     `gorm:"not null" json:"-"`
	PresharedKey  string     `gorm:"not null" json:"-"`
	AllowedIPs      string     `gorm:"not null" json:"allowed_ips"`
	AssignedIP      string     `gorm:"not null" json:"assigned_ip"`
	BandwidthLimitDown int     `gorm:"default:0" json:"bandwidth_limit_down"` // Mbps, 0 = unlimited
	BandwidthLimitUp   int     `gorm:"default:0" json:"bandwidth_limit_up"`   // Mbps, 0 = unlimited
	DataQuotaBytes  int64      `gorm:"default:0" json:"data_quota_bytes"`     // bytes, 0 = unlimited
	QuotaPeriod     string     `gorm:"default:'monthly'" json:"quota_period"` // monthly | weekly | total
	QuotaWarnedAt   *time.Time `json:"quota_warned_at"`
	QuotaResetAt    *time.Time `json:"quota_reset_at"`    // manual reset shifts effective period start
	QuotaSuspended  bool       `gorm:"default:false" json:"quota_suspended"` // true when disabled automatically by the quota job
	ViewToken       string     `gorm:"uniqueIndex;default:''" json:"view_token"` // read-only client portal token
	Enabled         bool       `gorm:"default:true" json:"enabled"`
	ExpiresAt     *time.Time `json:"expires_at"`
	LastHandshake *time.Time `json:"last_handshake"`
	BytesRx       int64      `gorm:"default:0" json:"bytes_rx"`
	BytesTx       int64      `gorm:"default:0" json:"bytes_tx"`
	CreatedAt     time.Time  `json:"created_at"`
	UpdatedAt     time.Time  `json:"updated_at"`
	Interface     Interface  `gorm:"foreignKey:InterfaceID" json:"-"`
}

type DownloadToken struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	ClientID  uint      `gorm:"not null;index" json:"client_id"`
	TokenHash string    `gorm:"uniqueIndex;not null" json:"-"`
	ExpiresAt time.Time `gorm:"not null" json:"expires_at"`
	Used      bool      `gorm:"default:false" json:"used"`
	CreatedAt time.Time `json:"created_at"`
	Client    Client    `gorm:"foreignKey:ClientID" json:"-"`
}

type ConnectionEvent struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	ClientID  uint      `gorm:"not null;index" json:"client_id"`
	EventType string    `gorm:"not null" json:"event_type"` // "connected" | "disconnected"
	SourceIP  string    `json:"source_ip"`
	Timestamp time.Time `gorm:"not null" json:"timestamp"`
	Client    Client    `gorm:"foreignKey:ClientID" json:"-"`
}

// PersonalAccessToken allows API access without a short-lived JWT.
// The raw token (format: vp_<64 hex chars>) is shown exactly once at creation.
// Only the SHA-256 hash is persisted; the prefix (first 8 chars) is stored for
// display purposes so the user can identify which token is which.
type PersonalAccessToken struct {
	ID             uint       `gorm:"primaryKey" json:"id"`
	AdminID        uint       `gorm:"not null;index" json:"admin_id"`
	Name           string     `gorm:"not null" json:"name"`
	TokenPrefix    string     `gorm:"not null" json:"token_prefix"`    // first 8 chars, display only
	TokenHash      string     `gorm:"uniqueIndex;not null" json:"-"`   // SHA-256 of raw token (auth lookup)
	TokenEncrypted string     `gorm:"not null;default:''" json:"-"`    // AES-256-GCM encrypted raw token (proxy use)
	ExpiresAt      *time.Time `json:"expires_at"`
	LastUsedAt     *time.Time `json:"last_used_at"`
	CreatedAt      time.Time  `json:"created_at"`
}

// SlaveToken authenticates a master instance on this node when running in slave mode.
// Generated once on first boot; only the SHA-256 hash is stored.
type SlaveToken struct {
	ID        uint      `gorm:"primaryKey"`
	TokenHash string    `gorm:"uniqueIndex;not null"`
	CreatedAt time.Time
}

// RemoteInstance represents a registered slave node on the master instance.
// The full vs_ token is AES-encrypted at rest; only the prefix is shown in the UI.
// AdGuard credentials are stored encrypted; AdguardEnabled signals whether AdGuard
// is configured on this slave and ready to proxy.
type RemoteInstance struct {
	ID                   uint       `gorm:"primaryKey" json:"id"`
	Name                 string     `gorm:"not null" json:"name"`
	URL                  string     `gorm:"not null" json:"url"`
	TokenEncrypted       string     `gorm:"not null;default:''" json:"-"`
	TokenPrefix          string     `gorm:"not null" json:"token_prefix"`
	LastSeenAt           *time.Time `json:"last_seen_at"`
	// AdGuard credentials for this slave (optional; empty = no AdGuard configured)
	AdguardURL           string     `gorm:"default:''" json:"adguard_url"`
	AdguardUserEncrypted string     `gorm:"default:''" json:"-"`
	AdguardPassEncrypted string     `gorm:"default:''" json:"-"`
	AdguardEnabled       bool       `gorm:"default:false" json:"adguard_enabled"`
	AdguardSyncEnabled   bool       `gorm:"default:false" json:"adguard_sync_enabled"`
	CreatedAt            time.Time  `json:"created_at"`
}

// AuditLog records admin-initiated mutations for lightweight change tracking.
// Rows older than 90 days are pruned automatically.
type AuditLog struct {
	ID         uint      `gorm:"primaryKey" json:"id"`
	AdminID    uint      `gorm:"not null;index" json:"admin_id"`
	Action     string    `gorm:"not null" json:"action"`       // e.g. "client.create", "client.delete"
	TargetType string    `gorm:"not null" json:"target_type"` // "client" | "interface" | "admin"
	TargetID   uint      `json:"target_id"`
	TargetName string    `json:"target_name"`
	Detail     string    `json:"detail"` // optional JSON / short description
	CreatedAt  time.Time `json:"created_at"`
}

// PeerSnapshot stores per-client bandwidth deltas sampled every minute.
// BytesRx/BytesTx are deltas (not cumulative) — bytes transferred since the
// previous snapshot. Rows older than 7 days are purged automatically.
type PeerSnapshot struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	ClientID  uint      `gorm:"not null;index" json:"client_id"`
	Timestamp time.Time `gorm:"not null;index" json:"timestamp"`
	BytesRx   int64     `gorm:"default:0" json:"bytes_rx"` // delta since last snapshot
	BytesTx   int64     `gorm:"default:0" json:"bytes_tx"` // delta since last snapshot
	Client    Client    `gorm:"foreignKey:ClientID" json:"-"`
}
