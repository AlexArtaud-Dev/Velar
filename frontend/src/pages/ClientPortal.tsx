import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getPortalClient, getSlavePortalClient, type PortalClient } from '@/api/portal'
import { formatBytes } from '@/lib/utils'
import {
  Wifi,
  WifiOff,
  Clock,
  Calendar,
  Gauge,
  ArrowDown,
  ArrowUp,
  Database,
  ShieldCheck,
  ShieldOff,
  ShieldAlert,
  AlertTriangle,
} from 'lucide-react'

// ── helpers ───────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const date = new Date(iso)
  // WireGuard reports epoch (1970) for peers that have never connected.
  // Go's zero time is year 0001. Treat anything before 2020 as "Never".
  if (date.getFullYear() < 2020) return 'Never'
  const diff = Date.now() - date.getTime()
  const s = Math.floor(diff / 1000)
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

function daysUntil(iso: string): number {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000)
}

// ── status config ─────────────────────────────────────────────────────────────

const STATUS_CONFIG = {
  connected: {
    label: 'Connected',
    dot: 'bg-emerald-500',
    pulse: true,
    badge: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
    Icon: Wifi,
  },
  active: {
    label: 'Active',
    dot: 'bg-blue-500',
    pulse: false,
    badge: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
    Icon: ShieldCheck,
  },
  suspended: {
    label: 'Suspended',
    dot: 'bg-red-500',
    pulse: false,
    badge: 'bg-red-500/15 text-red-400 border-red-500/30',
    Icon: ShieldOff,
  },
  disabled: {
    label: 'Disabled',
    dot: 'bg-slate-500',
    pulse: false,
    badge: 'bg-slate-500/15 text-slate-400 border-slate-500/30',
    Icon: ShieldOff,
  },
  expired: {
    label: 'Expired',
    dot: 'bg-amber-500',
    pulse: false,
    badge: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
    Icon: AlertTriangle,
  },
} as const

// ── sub-components ────────────────────────────────────────────────────────────

function InfoRow({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 py-3 border-b border-white/5 last:border-0">
      <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center shrink-0">
        <Icon className="h-4 w-4 text-slate-400" />
      </div>
      <span className="text-sm text-slate-400 w-32 shrink-0">{label}</span>
      <span className="text-sm text-slate-200 font-medium">{value}</span>
    </div>
  )
}

function QuotaSection({ client }: { client: PortalClient }) {
  if (client.data_quota_bytes === 0) return null

  // When suspended, the bar always fills to 100% regardless of what the
  // snapshot query returns (snapshots may not capture the final burst).
  const pct = client.quota_suspended
    ? 100
    : Math.min(100, Math.round((client.quota_used / client.data_quota_bytes) * 100))
  const barColor =
    client.quota_suspended || pct >= 100
      ? 'from-red-500 to-red-600'
      : pct >= 80
        ? 'from-amber-500 to-amber-600'
        : 'from-violet-500 to-indigo-500'

  const periodLabel =
    client.quota_period === 'monthly'
      ? 'Monthly'
      : client.quota_period === 'weekly'
        ? 'Weekly'
        : 'Total'

  return (
    <div className="rounded-xl bg-white/[0.03] border border-white/[0.07] p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Database className="h-4 w-4 text-slate-400" />
        <span className="text-sm font-semibold text-slate-300">Data Usage</span>
        <span className="ml-auto text-xs text-slate-500">{periodLabel}</span>
      </div>
      <div className="space-y-1.5">
        <div className="h-2.5 w-full rounded-full bg-white/5 overflow-hidden">
          <div
            className={`h-full rounded-full bg-gradient-to-r ${barColor} transition-all`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="flex justify-between text-xs text-slate-400">
          <span>{client.quota_suspended ? 'Quota exceeded' : `${formatBytes(client.quota_used)} used`}</span>
          <span className={pct >= 100 ? 'text-red-400 font-semibold' : ''}>
            {formatBytes(client.data_quota_bytes)} total ({pct}%)
          </span>
        </div>
      </div>
      {client.quota_suspended && (
        <div className="flex items-center gap-2 text-xs text-red-400 bg-red-500/10 rounded-lg px-3 py-2 border border-red-500/20">
          <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
          Access suspended — quota exceeded. Contact your administrator to restore.
        </div>
      )}
    </div>
  )
}

function BandwidthSection({ client }: { client: PortalClient }) {
  if (client.bandwidth_limit_down === 0 && client.bandwidth_limit_up === 0) return null
  return (
    <div className="rounded-xl bg-white/[0.03] border border-white/[0.07] p-4">
      <div className="flex items-center gap-2 mb-3">
        <Gauge className="h-4 w-4 text-slate-400" />
        <span className="text-sm font-semibold text-slate-300">Bandwidth Limits</span>
      </div>
      <div className="flex gap-4">
        {client.bandwidth_limit_down > 0 && (
          <div className="flex items-center gap-1.5 text-sm">
            <ArrowDown className="h-3.5 w-3.5 text-blue-400" />
            <span className="text-slate-200 font-medium">{client.bandwidth_limit_down} Mbps</span>
            <span className="text-slate-500 text-xs">download</span>
          </div>
        )}
        {client.bandwidth_limit_up > 0 && (
          <div className="flex items-center gap-1.5 text-sm">
            <ArrowUp className="h-3.5 w-3.5 text-violet-400" />
            <span className="text-slate-200 font-medium">{client.bandwidth_limit_up} Mbps</span>
            <span className="text-slate-500 text-xs">upload</span>
          </div>
        )}
      </div>
    </div>
  )
}

function ExpirySection({ client }: { client: PortalClient }) {
  if (!client.expires_at) return null
  const days = daysUntil(client.expires_at)
  const isExpired = days < 0

  return (
    <div
      className={`rounded-xl border p-4 flex items-center gap-3 ${
        isExpired
          ? 'bg-amber-500/10 border-amber-500/20'
          : days <= 7
            ? 'bg-amber-500/10 border-amber-500/20'
            : 'bg-white/[0.03] border-white/[0.07]'
      }`}
    >
      <Calendar className={`h-4 w-4 shrink-0 ${isExpired || days <= 7 ? 'text-amber-400' : 'text-slate-400'}`} />
      <div>
        <p className="text-sm text-slate-300">
          {isExpired ? 'Expired on' : 'Expires on'}{' '}
          <span className={`font-semibold ${isExpired || days <= 7 ? 'text-amber-400' : 'text-slate-200'}`}>
            {formatDate(client.expires_at)}
          </span>
        </p>
        <p className="text-xs text-slate-500 mt-0.5">
          {isExpired
            ? `${Math.abs(days)} day${Math.abs(days) !== 1 ? 's' : ''} ago`
            : days === 0
              ? 'Expires today'
              : `${days} day${days !== 1 ? 's' : ''} remaining`}
        </p>
      </div>
    </div>
  )
}

// ── main page ─────────────────────────────────────────────────────────────────

function PortalContent({ client }: { client: PortalClient }) {
  const status = STATUS_CONFIG[client.status] ?? STATUS_CONFIG.active

  return (
    <div className="w-full max-w-lg space-y-4">
      {/* Main card */}
      <div className="rounded-2xl bg-slate-800/60 border border-white/[0.08] backdrop-blur-xl overflow-hidden shadow-2xl shadow-black/40">
        {/* Card header — name + status */}
        <div className="px-6 pt-6 pb-5 border-b border-white/[0.06]">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-white leading-tight">{client.name}</h1>
              {client.owner_label && (
                <p className="text-sm text-slate-400 mt-0.5">{client.owner_label}</p>
              )}
            </div>
            <span
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border ${status.badge} shrink-0 mt-0.5`}
            >
              {/* Animated pulse dot for connected state */}
              <span className="relative flex h-2 w-2">
                <span
                  className={`${status.dot} absolute inline-flex h-full w-full rounded-full opacity-75 ${
                    status.pulse ? 'animate-ping' : ''
                  }`}
                />
                <span className={`${status.dot} relative inline-flex h-2 w-2 rounded-full`} />
              </span>
              {status.label}
            </span>
          </div>
          <div className="flex items-center gap-3 mt-3 text-sm text-slate-400">
            <code className="bg-white/5 px-2 py-0.5 rounded text-slate-300 font-mono text-xs">
              {client.assigned_ip}
            </code>
            <span className="text-slate-600">·</span>
            <span>{client.interface_name}</span>
          </div>
        </div>

        {/* Info rows */}
        <div className="px-6 py-2">
          {client.last_handshake && (
            <InfoRow
              icon={client.status === 'connected' ? Wifi : WifiOff}
              label="Last seen"
              value={timeAgo(client.last_handshake)}
            />
          )}
          <InfoRow
            icon={ArrowDown}
            label="Downloaded"
            value={formatBytes(client.bytes_rx)}
          />
          <InfoRow
            icon={ArrowUp}
            label="Uploaded"
            value={formatBytes(client.bytes_tx)}
          />
          <InfoRow
            icon={Clock}
            label="Member since"
            value={formatDate(client.created_at)}
          />
        </div>
      </div>

      {/* Quota card */}
      <QuotaSection client={client} />

      {/* Bandwidth card */}
      <BandwidthSection client={client} />

      {/* Expiry card */}
      <ExpirySection client={client} />

      {/* Footer */}
      <p className="text-center text-xs text-slate-600 pb-2">
        ⬡ Velar · VPN Management Platform
      </p>
    </div>
  )
}

// ── skeleton ──────────────────────────────────────────────────────────────────

function PortalSkeleton() {
  return (
    <div className="w-full max-w-lg animate-pulse space-y-4">
      <div className="rounded-2xl bg-slate-800/60 border border-white/[0.08] p-6 space-y-4">
        <div className="flex justify-between">
          <div className="space-y-2">
            <div className="h-7 w-40 bg-white/10 rounded-lg" />
            <div className="h-4 w-24 bg-white/5 rounded" />
          </div>
          <div className="h-7 w-24 bg-white/10 rounded-full" />
        </div>
        <div className="space-y-3 pt-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-10 bg-white/5 rounded-lg" />
          ))}
        </div>
      </div>
      <div className="h-24 bg-slate-800/60 border border-white/[0.08] rounded-xl" />
    </div>
  )
}

// ── route component ───────────────────────────────────────────────────────────

export default function ClientPortal() {
  const { token, instanceId } = useParams<{ token: string; instanceId?: string }>()
  const isSlave = !!instanceId

  const { data, isLoading, isError } = useQuery({
    queryKey: ['portal', instanceId, token],
    queryFn: () =>
      isSlave
        ? getSlavePortalClient(Number(instanceId), token!)
        : getPortalClient(token!),
    enabled: !!token,
    refetchInterval: 30_000,
    retry: false,
  })

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-start px-4 py-10 gap-6"
      style={{
        background: 'radial-gradient(ellipse at 50% 0%, rgba(99,102,241,0.15) 0%, transparent 60%), #0f172a',
      }}
    >
      {/* Header */}
      <div className="text-center space-y-1">
        <div className="text-2xl font-black text-white tracking-tight">⬡ Velar</div>
        <p className="text-sm text-slate-500">VPN Client Portal</p>
      </div>

      {isLoading && <PortalSkeleton />}

      {isError && (
        <div className="w-full max-w-lg rounded-2xl bg-slate-800/60 border border-red-500/20 p-8 text-center space-y-3">
          <ShieldOff className="h-10 w-10 text-red-400 mx-auto" />
          <p className="text-lg font-semibold text-slate-200">Portal not found</p>
          <p className="text-sm text-slate-400">
            This link is invalid or has been revoked. Contact your administrator.
          </p>
        </div>
      )}

      {data && <PortalContent client={data} />}
    </div>
  )
}
