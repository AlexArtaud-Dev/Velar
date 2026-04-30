import { useQuery } from '@tanstack/react-query'
import { Network, Users, Activity, Globe, ArrowDown, ArrowUp, Wifi, WifiOff } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { listInterfaces } from '@/api/interfaces'
import { getPublicIP } from '@/api/settings'
import { getDashboardStats, getDashboardSnapshots, type SnapshotPoint } from '@/api/dashboard'
import { useWebSocket } from '@/hooks/useWebSocket'
import { formatBytes, timeAgo } from '@/lib/utils'
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
  const { data: interfaces } = useQuery({ queryKey: ['interfaces'], queryFn: listInterfaces })
  const { data: ipData } = useQuery({ queryKey: ['public-ip'], queryFn: getPublicIP, refetchInterval: 60_000 })
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

  // Live bandwidth delta chart (from WebSocket)
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
  const totalPeers = ifaces.reduce((a, i) => a + (i.peers?.length ?? 0), 0)
  const connectedPeers = ifaces.reduce((a, i) => a + (i.peers?.filter((p) => p.connected).length ?? 0), 0)
  const upInterfaces = ifaces.filter((i) => i.up).length

  // Format history chart points
  const historyChartData = historyData.map((p: SnapshotPoint) => ({
    time: formatChartTime(p.timestamp, historyRange),
    rx: p.bytes_rx,
    tx: p.bytes_tx,
  }))

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground text-sm mt-1">Overview of your WireGuard server</p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <StatCard
          icon={<Network className="h-4 w-4" />}
          label="Interfaces"
          value={`${upInterfaces} / ${interfaces?.length ?? 0}`}
          sub="active"
          accent={upInterfaces > 0 ? 'green' : 'red'}
        />
        <StatCard
          icon={<Users className="h-4 w-4" />}
          label="Clients"
          value={`${connectedPeers} / ${totalPeers}`}
          sub="connected"
          accent={connectedPeers > 0 ? 'green' : 'default'}
        />
        <StatCard
          icon={<ArrowDown className="h-4 w-4" />}
          label="Downloaded today"
          value={formatBytes(dashStats?.traffic_24h.rx ?? 0)}
          sub="last 24 hours"
          accent="blue"
        />
        <StatCard
          icon={<ArrowUp className="h-4 w-4" />}
          label="Uploaded today"
          value={formatBytes(dashStats?.traffic_24h.tx ?? 0)}
          sub="last 24 hours"
          accent="emerald"
        />
      </div>

      {/* Live bandwidth */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Live bandwidth</CardTitle>
          <CardDescription>Bytes/s — updated every 5 seconds via WebSocket</CardDescription>
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
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="ltx" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="time" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => formatBytes(v as number)} width={72} />
                <Tooltip formatter={(v) => formatBytes(v as number)} />
                <Area type="monotone" dataKey="rx" stroke="#3b82f6" fill="url(#lrx)" name="↓ RX" />
                <Area type="monotone" dataKey="tx" stroke="#10b981" fill="url(#ltx)" name="↑ TX" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Historical bandwidth */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Traffic history</CardTitle>
              <CardDescription>Stored data, updated every minute</CardDescription>
            </div>
            <div className="flex gap-1">
              {(['24h', '7d'] as const).map((r) => (
                <button
                  key={r}
                  onClick={() => setHistoryRange(r)}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                    historyRange === r
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
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
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="htx" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="time" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => formatBytes(v as number)} width={72} />
                <Tooltip
                  formatter={(v) => formatBytes(v as number)}
                  labelFormatter={(l) => `${l}`}
                />
                <Area type="monotone" dataKey="rx" stroke="#3b82f6" fill="url(#hrx)" name="↓ Download" />
                <Area type="monotone" dataKey="tx" stroke="#10b981" fill="url(#htx)" name="↑ Upload" />
              </AreaChart>
            </ResponsiveContainer>
          )}
          {dashStats && (
            <div className="flex gap-6 mt-3 text-xs text-muted-foreground border-t border-border pt-3">
              <span>
                <span className="text-foreground font-medium">7d ↓</span>{' '}
                {formatBytes(dashStats.traffic_7d.rx)}
              </span>
              <span>
                <span className="text-foreground font-medium">7d ↑</span>{' '}
                {formatBytes(dashStats.traffic_7d.tx)}
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Interface status */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Interfaces</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {ifaces.map((iface) => (
              <div key={iface.id} className="flex items-center justify-between py-1.5 border-b border-border last:border-0">
                <div className="flex items-center gap-2.5">
                  <Badge variant={iface.up ? 'success' : 'destructive'} className="text-xs px-1.5 py-0">
                    {iface.up ? 'UP' : 'DOWN'}
                  </Badge>
                  <span className="font-mono text-sm">{iface.name}</span>
                </div>
                <span className="text-xs text-muted-foreground">
                  {iface.peers?.filter((p) => p.connected).length ?? 0} / {iface.peers?.length ?? 0} connected
                </span>
              </div>
            ))}
            {!ifaces.length && <p className="text-sm text-muted-foreground">No interfaces.</p>}
          </CardContent>
        </Card>

        {/* Recent connection events */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent connections</CardTitle>
            <CardDescription>Connect / disconnect events across all clients</CardDescription>
          </CardHeader>
          <CardContent>
            {(dashStats?.recent_events.length ?? 0) === 0 ? (
              <p className="text-sm text-muted-foreground">No events yet.</p>
            ) : (
              <div className="space-y-2 max-h-56 overflow-y-auto">
                {dashStats?.recent_events.map((e) => (
                  <div key={e.id} className="flex items-center gap-2.5 text-xs py-1 border-b border-border last:border-0">
                    {e.event_type === 'connected'
                      ? <Wifi className="h-3.5 w-3.5 text-green-500 shrink-0" />
                      : <WifiOff className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                    <span className="font-medium truncate flex-1">{e.client_name}</span>
                    {e.interface_name && (
                      <span className="font-mono text-muted-foreground shrink-0">{e.interface_name}</span>
                    )}
                    {e.source_ip && (
                      <span className="font-mono text-muted-foreground shrink-0 hidden sm:inline">{e.source_ip}</span>
                    )}
                    <span className="text-muted-foreground shrink-0">{timeAgo(e.timestamp)}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Connected peers */}
      {ifaces.flatMap((i) => i.peers ?? []).some((p) => p.connected) && (
        <Card>
          <CardHeader><CardTitle className="text-base">Connected peers</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2">
              {ifaces.flatMap((iface) =>
                (iface.peers ?? []).filter((p) => p.connected).map((p) => (
                  <div key={p.client_id} className="flex items-center justify-between text-sm py-1">
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-green-500 inline-block shrink-0" />
                      <span className="font-medium">{p.name}</span>
                      <span className="text-muted-foreground font-mono text-xs">{iface.name}</span>
                    </div>
                    <div className="flex items-center gap-3 text-muted-foreground text-xs">
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

function StatCard({
  icon, label, value, sub, accent = 'default',
}: {
  icon: React.ReactNode
  label: string
  value: string
  sub: string
  accent?: 'default' | 'green' | 'red' | 'blue' | 'emerald'
}) {
  const accentColor = {
    default: 'text-muted-foreground',
    green: 'text-green-500',
    red: 'text-red-500',
    blue: 'text-blue-500',
    emerald: 'text-emerald-500',
  }[accent]

  return (
    <Card>
      <CardContent className="pt-5 pb-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-muted-foreground text-xs uppercase tracking-wider">{label}</span>
          <span className={accentColor}>{icon}</span>
        </div>
        <div className="text-xl sm:text-2xl font-bold truncate">{value}</div>
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
