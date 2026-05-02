import { useQuery } from '@tanstack/react-query'
import { Network, Users, ArrowDown, ArrowUp, Wifi, WifiOff, TrendingUp, Activity } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { listInterfaces } from '@/api/interfaces'
import { getPublicIP } from '@/api/settings'
import { getDashboardStats, getDashboardSnapshots, type SnapshotPoint } from '@/api/dashboard'
import { useWebSocket } from '@/hooks/useWebSocket'
import { useThemeStore } from '@/stores/theme'
import { formatBytes, timeAgo } from '@/lib/utils'
import { cn } from '@/lib/utils'
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts'
import { useState, useEffect, useRef } from 'react'
import React from 'react'

interface LiveBandwidthPoint {
  time: string
  rx: number
  tx: number
}

export default function Dashboard() {
  const { theme } = useThemeStore()
  const { data: interfaces } = useQuery({ queryKey: ['interfaces'], queryFn: listInterfaces })
  useQuery({ queryKey: ['public-ip'], queryFn: getPublicIP, refetchInterval: 60_000 })
  const { data: dashStats } = useQuery({
    queryKey: ['dashboard-stats'],
    queryFn: getDashboardStats,
    refetchInterval: 30_000,
  })
  const [historyRange, setHistoryRange] = useState<'24h' | '7d'>('24h')
  const { data: historyData = [] } = useQuery({
    queryKey: ['dashboard-snapshots', historyRange],
    queryFn: () => getDashboardSnapshots(historyRange),
    refetchInterval: 60_000,
  })

  const { stats } = useWebSocket()

  const [liveBandwidth, setLiveBandwidth] = useState<LiveBandwidthPoint[]>([])
  const prevStatsRef = useRef<{ rx: number; tx: number } | null>(null)

  useEffect(() => {
    if (!stats) return
    const totals = stats.interfaces.reduce(
      (acc, iface) => {
        iface.peers?.forEach((p) => { acc.rx += p.bytes_rx; acc.tx += p.bytes_tx })
        return acc
      },
      { rx: 0, tx: 0 },
    )
    if (prevStatsRef.current) {
      const deltaRx = Math.max(0, totals.rx - prevStatsRef.current.rx)
      const deltaTx = Math.max(0, totals.tx - prevStatsRef.current.tx)
      setLiveBandwidth((prev) => [
        ...prev.slice(-29),
        { time: new Date().toLocaleTimeString(), rx: Math.round(deltaRx / 5), tx: Math.round(deltaTx / 5) },
      ])
    }
    prevStatsRef.current = totals
  }, [stats])

  const ifaces = stats?.interfaces ?? []
  const totalPeers    = ifaces.reduce((a, i) => a + (i.peers?.length ?? 0), 0)
  const connectedPeers = ifaces.reduce((a, i) => a + (i.peers?.filter((p) => p.connected).length ?? 0), 0)
  const upInterfaces  = ifaces.filter((i) => i.up).length

  const historyChartData = historyData.map((p: SnapshotPoint) => ({
    time: formatChartTime(p.timestamp, historyRange),
    rx: p.bytes_rx,
    tx: p.bytes_tx,
  }))

  // Theme-aware chart colors
  const isCyber = theme === 'cyberpunk'
  const rxColor = isCyber ? '#00f5ff' : '#3b82f6'
  const txColor = isCyber ? '#ff00c8' : '#10b981'

  const cardClass = cn(
    theme === 'apple'     && 'apple-glass',
    theme === 'cyberpunk' && 'cyber-card',
  )

  return (
    <div className="p-4 sm:p-6 space-y-6">

      {/* Page header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className={cn(
            'text-2xl font-bold',
            theme === 'apple' && 'text-[hsl(225,25%,10%)] tracking-tight',
          )}>
            Dashboard
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Overview of your WireGuard server
          </p>
        </div>
        {/* Live pill */}
        <div className={cn(
          'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border mt-0.5',
          connectedPeers > 0
            ? isCyber
              ? 'bg-[rgba(0,255,255,0.08)] border-[rgba(0,255,255,0.3)] text-[hsl(180,100%,60%)]'
              : 'bg-green-500/10 border-green-500/20 text-green-600 dark:text-green-400'
            : 'bg-muted border-border text-muted-foreground',
        )}>
          <span className={cn(
            'h-1.5 w-1.5 rounded-full',
            connectedPeers > 0
              ? isCyber ? 'bg-[hsl(180,100%,50%)] animate-pulse' : 'bg-green-500 animate-pulse'
              : 'bg-muted-foreground',
          )} />
          {connectedPeers > 0 ? `${connectedPeers} online` : 'No peers'}
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <StatCard
          icon={<Network className="h-5 w-5" />}
          label="Interfaces"
          value={`${upInterfaces} / ${interfaces?.length ?? 0}`}
          sub="active"
          accent="green"
          theme={theme}
        />
        <StatCard
          icon={<Users className="h-5 w-5" />}
          label="Clients"
          value={`${connectedPeers} / ${totalPeers}`}
          sub="connected"
          accent={connectedPeers > 0 ? 'blue' : 'default'}
          theme={theme}
        />
        <StatCard
          icon={<ArrowDown className="h-5 w-5" />}
          label="Downloaded"
          value={formatBytes(dashStats?.traffic_24h.rx ?? 0)}
          sub="last 24 h"
          accent="blue"
          theme={theme}
        />
        <StatCard
          icon={<ArrowUp className="h-5 w-5" />}
          label="Uploaded"
          value={formatBytes(dashStats?.traffic_24h.tx ?? 0)}
          sub="last 24 h"
          accent="emerald"
          theme={theme}
        />
      </div>

      {/* Live bandwidth */}
      <Card className={cardClass}>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Activity className={cn('h-4 w-4', isCyber ? 'text-[hsl(180,100%,50%)]' : 'text-blue-500')} />
            <CardTitle className="text-base">Live bandwidth</CardTitle>
          </div>
          <CardDescription>Bytes/s — updated every 5 s via WebSocket</CardDescription>
        </CardHeader>
        <CardContent>
          {liveBandwidth.length === 0 ? (
            <div className="h-[160px] flex items-center justify-center text-sm text-muted-foreground">
              Waiting for data…
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={160}>
              <AreaChart data={liveBandwidth}>
                <defs>
                  <linearGradient id="lrx" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor={rxColor} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={rxColor} stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="ltx" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor={txColor} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={txColor} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="time" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => formatBytes(v as number)} width={72} />
                <Tooltip formatter={(v) => formatBytes(v as number)} />
                <Area type="monotone" dataKey="rx" stroke={rxColor} fill="url(#lrx)" name="↓ RX" strokeWidth={isCyber ? 1.5 : 2} />
                <Area type="monotone" dataKey="tx" stroke={txColor} fill="url(#ltx)" name="↑ TX" strokeWidth={isCyber ? 1.5 : 2} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Historical bandwidth */}
      <Card className={cardClass}>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <TrendingUp className={cn('h-4 w-4', isCyber ? 'text-[hsl(180,100%,50%)]' : 'text-violet-500')} />
              <div>
                <CardTitle className="text-base">Traffic history</CardTitle>
                <CardDescription>Stored snapshots, updated every minute</CardDescription>
              </div>
            </div>
            <div className={cn(
              'flex gap-1 p-0.5 rounded-lg',
              theme === 'apple' ? 'bg-[rgba(0,0,0,0.06)]' : 'bg-muted',
            )}>
              {(['24h', '7d'] as const).map((r) => (
                <button
                  key={r}
                  onClick={() => setHistoryRange(r)}
                  className={cn(
                    'px-2.5 py-1 rounded-md text-xs font-medium transition-all',
                    historyRange === r
                      ? isCyber
                        ? 'bg-[rgba(0,255,255,0.15)] text-[hsl(180,100%,60%)] border border-[rgba(0,255,255,0.3)]'
                        : 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {historyChartData.length === 0 ? (
            <div className="h-[160px] flex items-center justify-center text-sm text-muted-foreground">
              No historical data yet — check back after a few minutes.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={160}>
              <AreaChart data={historyChartData}>
                <defs>
                  <linearGradient id="hrx" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor={rxColor} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={rxColor} stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="htx" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor={txColor} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={txColor} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="time" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => formatBytes(v as number)} width={72} />
                <Tooltip formatter={(v) => formatBytes(v as number)} labelFormatter={(l) => `${l}`} />
                <Area type="monotone" dataKey="rx" stroke={rxColor} fill="url(#hrx)" name="↓ Download" strokeWidth={isCyber ? 1.5 : 2} />
                <Area type="monotone" dataKey="tx" stroke={txColor} fill="url(#htx)" name="↑ Upload"   strokeWidth={isCyber ? 1.5 : 2} />
              </AreaChart>
            </ResponsiveContainer>
          )}
          {dashStats && (
            <div className="flex gap-6 mt-3 text-xs text-muted-foreground border-t border-border pt-3">
              <span><span className="text-foreground font-medium">7d ↓</span>{' '}{formatBytes(dashStats.traffic_7d.rx)}</span>
              <span><span className="text-foreground font-medium">7d ↑</span>{' '}{formatBytes(dashStats.traffic_7d.tx)}</span>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Interface status */}
        <Card className={cardClass}>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Network className={cn('h-4 w-4', isCyber ? 'text-[hsl(180,100%,50%)]' : 'text-violet-500')} />
              <CardTitle className="text-base">Interfaces</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {ifaces.map((iface) => (
              <div key={iface.id} className={cn(
                'flex items-center justify-between px-3 py-2.5 rounded-[var(--radius)] border border-border transition-colors',
                iface.up
                  ? isCyber
                    ? 'bg-[rgba(0,255,255,0.04)] border-[rgba(0,255,255,0.15)]'
                    : 'bg-green-500/5 border-green-500/20'
                  : 'bg-muted/40',
              )}>
                <div className="flex items-center gap-2.5">
                  <span className={cn(
                    'h-2 w-2 rounded-full shrink-0',
                    iface.up
                      ? isCyber ? 'bg-[hsl(180,100%,50%)] animate-pulse' : 'bg-green-500 animate-pulse'
                      : 'bg-muted-foreground/30',
                  )} />
                  <span className="font-mono text-sm font-medium">{iface.name}</span>
                  <Badge variant={iface.up ? 'success' : 'destructive'} className="text-[10px] px-1.5 py-0 h-4">
                    {iface.up ? 'UP' : 'DOWN'}
                  </Badge>
                </div>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {iface.peers?.filter((p) => p.connected).length ?? 0}
                  <span className="text-muted-foreground/50 mx-0.5">/</span>
                  {iface.peers?.length ?? 0}
                </span>
              </div>
            ))}
            {!ifaces.length && (
              <p className="text-sm text-muted-foreground py-2">No interfaces.</p>
            )}
          </CardContent>
        </Card>

        {/* Recent connection events */}
        <Card className={cardClass}>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Wifi className={cn('h-4 w-4', isCyber ? 'text-[hsl(180,100%,50%)]' : 'text-blue-500')} />
              <div>
                <CardTitle className="text-base">Recent connections</CardTitle>
                <CardDescription>Connect / disconnect events</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {(dashStats?.recent_events.length ?? 0) === 0 ? (
              <p className="text-sm text-muted-foreground">No events yet.</p>
            ) : (
              <div className="space-y-1 max-h-56 overflow-y-auto">
                {dashStats?.recent_events.map((e) => (
                  <div key={e.id} className={cn(
                    'flex items-center gap-2.5 text-xs px-2 py-1.5 rounded-[calc(var(--radius)-2px)] transition-colors',
                    e.event_type === 'connected'
                      ? isCyber ? 'bg-[rgba(0,255,255,0.04)]' : 'bg-green-500/5'
                      : 'bg-muted/30',
                  )}>
                    {e.event_type === 'connected'
                      ? <Wifi  className={cn('h-3.5 w-3.5 shrink-0', isCyber ? 'text-[hsl(180,100%,50%)]' : 'text-green-500')} />
                      : <WifiOff className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                    <span className="font-medium truncate flex-1">{e.client_name}</span>
                    {e.interface_name && (
                      <span className="font-mono text-muted-foreground shrink-0">{e.interface_name}</span>
                    )}
                    <span className="text-muted-foreground shrink-0">{timeAgo(new Date(e.timestamp).getTime() / 1000)}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Connected peers */}
      {ifaces.flatMap((i) => i.peers ?? []).some((p) => p.connected) && (
        <Card className={cardClass}>
          <CardHeader>
            <div className="flex items-center gap-2">
              <span className={cn(
                'h-2 w-2 rounded-full animate-pulse',
                isCyber ? 'bg-[hsl(180,100%,50%)]' : 'bg-green-500',
              )} />
              <CardTitle className="text-base">Connected peers</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-1">
              {ifaces.flatMap((iface) =>
                (iface.peers ?? []).filter((p) => p.connected).map((p) => (
                  <div key={p.client_id} className={cn(
                    'flex items-center justify-between text-sm px-3 py-2 rounded-[calc(var(--radius)-2px)]',
                    isCyber ? 'bg-[rgba(0,255,255,0.04)] border border-[rgba(0,255,255,0.08)]' : 'bg-muted/40',
                  )}>
                    <div className="flex items-center gap-2.5">
                      <span className={cn(
                        'h-2 w-2 rounded-full shrink-0',
                        isCyber ? 'bg-[hsl(180,100%,50%)]' : 'bg-green-500',
                      )} />
                      <span className="font-medium">{p.name}</span>
                      <span className="text-muted-foreground font-mono text-xs">{iface.name}</span>
                    </div>
                    <div className="flex items-center gap-3 text-muted-foreground text-xs tabular-nums">
                      <span>↓ {formatBytes(p.bytes_rx)}</span>
                      <span>↑ {formatBytes(p.bytes_tx)}</span>
                      <span className="hidden sm:inline">{timeAgo(p.last_handshake)}</span>
                    </div>
                  </div>
                )),
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

// ── StatCard ──────────────────────────────────────────────────────────────────

type Accent = 'default' | 'green' | 'red' | 'blue' | 'emerald' | 'violet'

const ACCENT_MAP: Record<Accent, { icon: string; bg: string; cyber: string }> = {
  default:  { icon: 'text-muted-foreground',   bg: 'bg-muted/60',                    cyber: 'text-[hsl(180,30%,55%)]' },
  green:    { icon: 'text-green-500',           bg: 'bg-green-500/10',                cyber: 'text-[hsl(180,100%,50%)]' },
  red:      { icon: 'text-red-500',             bg: 'bg-red-500/10',                  cyber: 'text-red-400' },
  blue:     { icon: 'text-blue-500',            bg: 'bg-blue-500/10',                 cyber: 'text-[hsl(180,100%,60%)]' },
  emerald:  { icon: 'text-emerald-500',         bg: 'bg-emerald-500/10',              cyber: 'text-[hsl(300,100%,60%)]' },
  violet:   { icon: 'text-violet-500',          bg: 'bg-violet-500/10',               cyber: 'text-violet-400' },
}

function StatCard({
  icon, label, value, sub, accent = 'default', theme,
}: {
  icon: React.ReactNode
  label: string
  value: string
  sub: string
  accent?: Accent
  theme: string
}) {
  const isCyber = theme === 'cyberpunk'
  const a = ACCENT_MAP[accent]

  return (
    <Card className={cn(
      'overflow-hidden transition-all duration-200 hover:scale-[1.01]',
      theme === 'apple'     && 'apple-glass',
      theme === 'cyberpunk' && 'cyber-card',
    )}>
      <CardContent className="pt-5 pb-4">
        <div className="flex items-start justify-between mb-3">
          <span className="text-muted-foreground text-xs font-medium uppercase tracking-wider">{label}</span>
          <div className={cn(
            'p-2 rounded-[calc(var(--radius)-2px)]',
            isCyber ? 'bg-[rgba(0,255,255,0.08)]' : a.bg,
          )}>
            <span className={isCyber ? a.cyber : a.icon}>
              {icon}
            </span>
          </div>
        </div>
        <div className={cn(
          'text-2xl font-bold tabular-nums truncate',
          isCyber && 'text-[hsl(180,60%,88%)]',
        )}>
          {value}
        </div>
        <div className="text-xs text-muted-foreground mt-1">{sub}</div>
      </CardContent>
    </Card>
  )
}

function formatChartTime(iso: string, range: '24h' | '7d'): string {
  const d = new Date(iso)
  if (range === '7d') {
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  }
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}
