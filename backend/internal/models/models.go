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
