import { useQuery, useQueries } from '@tanstack/react-query'
import { Network, Users, ArrowDown, ArrowUp, Wifi, WifiOff, TrendingUp, Activity, Server, Shield } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { listInterfaces } from '@/api/interfaces'
import { getPublicIP } from '@/api/settings'
import { getDashboardStats, getDashboardSnapshots, type DashboardStats, type SnapshotPoint } from '@/api/dashboard'
import { listInstances, proxyToInstance, type RemoteInstance } from '@/api/instances'
import { getStats as getAgStats, getStatus as getAgStatus, type AdguardStats, type AdguardStatus } from '@/api/adguard'
import { useWebSocket, type StatsPayload } from '@/hooks/useWebSocket'
import { useThemeStore } from '@/stores/theme'
import { formatBytes, formatBytesShort, timeAgo } from '@/lib/utils'
import { cn } from '@/lib/utils'
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts'
import { useState, useEffect, useRef } from 'react'
import React from 'react'

interface SlaveIfaceOverview {
  id: number
  name: string
  port: number
  subnet: string
  enabled: boolean
  interface_up: boolean
  port_bound: boolean
  client_count: number
}

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
  const { data: instances = [] } = useQuery({ queryKey: ['instances'], queryFn: listInstances })

  // Per-slave interface overview (for static info + fallback counts)
  const slaveOverviewResults = useQueries({
    queries: instances.map((inst) => ({
      queryKey: ['slave-overview', inst.id] as const,
      queryFn: () =>
        proxyToInstance(inst.id, 'GET', '/api/v1/interfaces/overview').then((r) => {
          const d = JSON.parse(r.body)
          return (Array.isArray(d) ? d : []) as SlaveIfaceOverview[]
        }),
      refetchInterval: 30_000,
    })),
  })
  const slaveOverviews: { instance: RemoteInstance; ifaces: SlaveIfaceOverview[]; isLoading: boolean }[] =
    instances.map((inst, i) => ({
      instance: inst,
      ifaces: slaveOverviewResults[i]?.data ?? [],
      isLoading: slaveOverviewResults[i]?.isLoading ?? true,
    }))

  // Per-slave live stats — same payload as WebSocket, polled every 5 s
  const slaveStatsResults = useQueries({
    queries: instances.map((inst) => ({
      queryKey: ['slave-stats', inst.id] as const,
      queryFn: () =>
        proxyToInstance(inst.id, 'GET', '/api/v1/stats').then((r) => JSON.parse(r.body) as StatsPayload),
      refetchInterval: 5_000,
    })),
  })
  const slaveStatsList: { instance: RemoteInstance; data: StatsPayload | undefined }[] =
    instances.map((inst, i) => ({ instance: inst, data: slaveStatsResults[i]?.data }))

  // Per-slave dashboard data — for recent events
  const slaveDashResults = useQueries({
    queries: instances.map((inst) => ({
      queryKey: ['slave-dashboard', inst.id] as const,
      queryFn: () =>
        proxyToInstance(inst.id, 'GET', '/api/v1/dashboard').then((r) => JSON.parse(r.body) as DashboardStats),
      refetchInterval: 30_000,
    })),
  })

  const slaveIfaceUp    = slaveOverviews.reduce((sum, s) => sum + s.ifaces.filter((f) => f.interface_up).length, 0)
  const slaveIfaceTotal = slaveOverviews.reduce((sum, s) => sum + s.ifaces.length, 0)
  // Fallback client count from overview (used before stats endpoint loads)
  const slaveClientTotalOverview = slaveOverviews.reduce(
    (sum, s) => sum + s.ifaces.reduce((a, f) => a + Number(f.client_count), 0),
    0,
  )

  // Slave traffic totals from dashboard data
  const slaveRx24h = slaveDashResults.reduce((sum, r) => sum + (r.data?.traffic_24h.rx ?? 0), 0)
  const slaveTx24h = slaveDashResults.reduce((sum, r) => sum + (r.data?.traffic_24h.tx ?? 0), 0)
  const slaveRx7d  = slaveDashResults.reduce((sum, r) => sum + (r.data?.traffic_7d.rx ?? 0), 0)
  const slaveTx7d  = slaveDashResults.reduce((sum, r) => sum + (r.data?.traffic_7d.tx ?? 0), 0)

  // AdGuard aggregate — master + adguard-enabled slaves
  const agSlaves = instances.filter((i) => i.adguard_enabled)
  const { data: masterAgStats } = useQuery({
    queryKey: ['adguard-stats', null],
    queryFn: () => getAgStats(null),
    retry: false,
    refetchInterval: 30_000,
  })
  const { data: masterAgStatus } = useQuery({
    queryKey: ['adguard-status', null],
    queryFn: () => getAgStatus(null),
    retry: false,
    refetchInterval: 30_000,
  })
  const slaveAgStatsResults = useQueries({
    queries: agSlaves.map((inst) => ({
      queryKey: ['adguard-stats', inst.id] as const,
      queryFn: () => getAgStats(inst.id),
      retry: false,
      refetchInterval: 30_000,
    })),
  })
  const slaveAgStatusResults = useQueries({
    queries: agSlaves.map((inst) => ({
      queryKey: ['adguard-status', inst.id] as const,
      queryFn: () => getAgStatus(inst.id),
      retry: false,
      refetchInterval: 30_000,
    })),
  })

  const agNodes: { name: string; stats: AdguardStats | undefined; status: AdguardStatus | undefined }[] = [
    { name: 'Master', stats: masterAgStats, status: masterAgStatus },
    ...agSlaves.map((inst, i) => ({
      name: inst.name,
      stats: slaveAgStatsResults[i]?.data,
      status: slaveAgStatusResults[i]?.data,
    })),
  ].filter((n) => n.stats !== undefined || n.status !== undefined)

  const agTotalQueries = agNodes.reduce((s, n) => s + (n.stats?.num_dns_queries ?? 0), 0)
  const agTotalBlocked = agNodes.reduce((s, n) => s + (n.stats?.num_blocked_filtering ?? 0), 0)

  const slaveConnectedPeers = slaveStatsList.reduce(
    (sum, s) =>
      sum + (s.data?.interfaces ?? []).reduce((a, i) => a + (i.peers ?? []).filter((p) => p.connected).length, 0),
    0,
  )
  const slaveTotalPeers = slaveStatsList.reduce(
    (sum, s) => sum + (s.data?.interfaces ?? []).reduce((a, i) => a + (i.peers ?? []).length, 0),
    0,
  )

  // Merge recent events (local + slave), newest first, cap at 20
  const allRecentEvents = [
    ...(dashStats?.recent_events ?? []).map((e) => ({ ...e, origin: 'Local' as string })),
    ...slaveDashResults.flatMap((r, i) =>
      (r.data?.recent_events ?? []).map((e) => ({ ...e, origin: instances[i]?.name ?? 'Slave' })),
    ),
  ]
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 20)

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

    // Local WS totals
    const localTotals = stats.interfaces.reduce(
      (acc, iface) => {
        iface.peers?.forEach((p) => { acc.rx += p.bytes_rx; acc.tx += p.bytes_tx })
        return acc
      },
      { rx: 0, tx: 0 },
    )

    // Sample latest slave totals at each local WS tick
    const slaveTotals = { rx: 0, tx: 0 }
    slaveStatsResults.forEach((r) => {
      r.data?.interfaces?.forEach((i) => {
        ;(i.peers ?? []).forEach((p) => { slaveTotals.rx += p.bytes_rx; slaveTotals.tx += p.bytes_tx })
      })
    })

    const totals = { rx: localTotals.rx + slaveTotals.rx, tx: localTotals.tx + slaveTotals.tx }

    if (prevStatsRef.current) {
      const deltaRx = Math.max(0, totals.rx - prevStatsRef.current.rx)
      const deltaTx = Math.max(0, totals.tx - prevStatsRef.current.tx)
      setLiveBandwidth((prev) => [
        ...prev.slice(-29),
        { time: new Date().toLocaleTimeString(), rx: Math.round(deltaRx / 5), tx: Math.round(deltaTx / 5) },
      ])
    }
    prevStatsRef.current = totals
  // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const isCyber = theme === 'cyberpunk'
  const rxColor = isCyber ? '#00f5ff' : '#3b82f6'
  const txColor = isCyber ? '#ff00c8' : '#10b981'

  const cardClass = cn(
    theme === 'apple'     && 'apple-glass',
    theme === 'cyberpunk' && 'cyber-card',
  )

  const anyConnected = connectedPeers > 0 || slaveConnectedPeers > 0

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
          anyConnected
            ? isCyber
              ? 'bg-[rgba(0,255,255,0.08)] border-[rgba(0,255,255,0.3)] text-[hsl(180,100%,60%)]'
              : 'bg-green-500/10 border-green-500/20 text-green-600 dark:text-green-400'
            : 'bg-muted border-border text-muted-foreground',
        )}>
          <span className={cn(
            'h-1.5 w-1.5 rounded-full',
            anyConnected
              ? isCyber ? 'bg-[hsl(180,100%,50%)] animate-pulse' : 'bg-green-500 animate-pulse'
              : 'bg-muted-foreground',
          )} />
          {anyConnected
            ? `${connectedPeers + slaveConnectedPeers} online`
            : 'No peers'}
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <StatCard
          icon={<Network className="h-5 w-5" />}
          label="Interfaces"
          value={`${upInterfaces + slaveIfaceUp} / ${(interfaces?.length ?? 0) + slaveIfaceTotal}`}
          sub={instances.length > 0 ? `${instances.length + 1} instances` : 'active'}
          accent="green"
          theme={theme}
        />
        <StatCard
          icon={<Users className="h-5 w-5" />}
          label="Clients"
          value={`${connectedPeers + slaveConnectedPeers} / ${totalPeers + (slaveTotalPeers || slaveClientTotalOverview)}`}
          sub={instances.length > 0 ? 'online / total (all)' : 'connected'}
          accent={(connectedPeers + slaveConnectedPeers) > 0 ? 'blue' : 'default'}
          theme={theme}
        />
        <StatCard
          icon={<ArrowDown className="h-5 w-5" />}
          label="Downloaded"
          value={formatBytes((dashStats?.traffic_24h.rx ?? 0) + slaveRx24h)}
          sub={instances.length > 0 ? 'last 24 h (all)' : 'last 24 h'}
          accent="blue"
          theme={theme}
        />
        <StatCard
          icon={<ArrowUp className="h-5 w-5" />}
          label="Uploaded"
          value={formatBytes((dashStats?.traffic_24h.tx ?? 0) + slaveTx24h)}
          sub={instances.length > 0 ? 'last 24 h (all)' : 'last 24 h'}
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
          <CardDescription>
            Bytes/s — updated every 5 s via WebSocket{instances.length > 0 ? ' + slave polling' : ''}
          </CardDescription>
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
                <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => formatBytesShort(v as number)} width={64} />
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
                <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => formatBytesShort(v as number)} width={64} />
                <Tooltip formatter={(v) => formatBytes(v as number)} labelFormatter={(l) => `${l}`} />
                <Area type="monotone" dataKey="rx" stroke={rxColor} fill="url(#hrx)" name="↓ Download" strokeWidth={isCyber ? 1.5 : 2} />
                <Area type="monotone" dataKey="tx" stroke={txColor} fill="url(#htx)" name="↑ Upload"   strokeWidth={isCyber ? 1.5 : 2} />
              </AreaChart>
            </ResponsiveContainer>
          )}
          {dashStats && (
            <div className="flex gap-6 mt-3 text-xs text-muted-foreground border-t border-border pt-3">
              <span><span className="text-foreground font-medium">7d ↓</span>{' '}{formatBytes((dashStats.traffic_7d.rx) + slaveRx7d)}</span>
              <span><span className="text-foreground font-medium">7d ↑</span>{' '}{formatBytes((dashStats.traffic_7d.tx) + slaveTx7d)}</span>
              {instances.length > 0 && <span className="text-muted-foreground/50">all instances</span>}
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
            {/* Local interfaces (from WebSocket) */}
            {instances.length > 0 && (
              <div className="flex items-center gap-1.5 pb-1 mb-1">
                <Network className="h-3 w-3 text-muted-foreground/60" />
                <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70">Local</span>
              </div>
            )}
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
            {!ifaces.length && !slaveOverviews.length && (
              <p className="text-sm text-muted-foreground py-2">No interfaces.</p>
            )}

            {/* Slave instance sections */}
            {slaveOverviews.map(({ instance, ifaces: sIfaces, isLoading: sLoading }) => {
              const sStats = slaveStatsList.find((s) => s.instance.id === instance.id)?.data
              return (
                <div key={instance.id} className="pt-4">
                  <div className="flex items-center gap-1.5 pb-2 border-t border-border/50 pt-3">
                    <Server className="h-3 w-3 text-muted-foreground/60" />
                    <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70">{instance.name}</span>
                    <span className="text-[10px] text-muted-foreground/40 font-mono truncate">{instance.url}</span>
                  </div>
                  {sLoading ? (
                    <div className="h-9 bg-muted/40 rounded animate-pulse" />
                  ) : sIfaces.length === 0 ? (
                    <p className="text-xs text-muted-foreground/60 py-1 px-2">No interfaces</p>
                  ) : (
                    <div className="space-y-1.5">
                      {sIfaces.map((sf) => {
                        const sfStats = sStats?.interfaces?.find((si) => si.name === sf.name)
                        const connected = sfStats?.peers?.filter((p) => p.connected).length ?? 0
                        const total = sfStats?.peers?.length ?? sf.client_count
                        return (
                          <div key={sf.id} className={cn(
                            'flex items-center justify-between px-3 py-2 rounded-[var(--radius)] border border-border transition-colors',
                            sf.interface_up
                              ? isCyber
                                ? 'bg-[rgba(0,255,255,0.04)] border-[rgba(0,255,255,0.15)]'
                                : 'bg-green-500/5 border-green-500/20'
                              : 'bg-muted/40',
                          )}>
                            <div className="flex items-center gap-2.5">
                              <span className={cn(
                                'h-2 w-2 rounded-full shrink-0',
                                sf.interface_up
                                  ? isCyber ? 'bg-[hsl(180,100%,50%)] animate-pulse' : 'bg-green-500 animate-pulse'
                                  : 'bg-muted-foreground/30',
                              )} />
                              <span className="font-mono text-sm font-medium">{sf.name}</span>
                              <Badge variant={sf.interface_up ? 'success' : 'destructive'} className="text-[10px] px-1.5 py-0 h-4">
                                {sf.interface_up ? 'UP' : 'DOWN'}
                              </Badge>
                            </div>
                            <span className="text-xs text-muted-foreground tabular-nums">
                              {connected}
                              <span className="text-muted-foreground/50 mx-0.5">/</span>
                              {total}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </CardContent>
        </Card>

        {/* Recent connection events */}
        <Card className={cardClass}>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Wifi className={cn('h-4 w-4', isCyber ? 'text-[hsl(180,100%,50%)]' : 'text-blue-500')} />
              <div>
                <CardTitle className="text-base">Recent connections</CardTitle>
                <CardDescription>
                  Connect / disconnect events{instances.length > 0 ? ' — all instances' : ''}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {allRecentEvents.length === 0 ? (
              <p className="text-sm text-muted-foreground">No events yet.</p>
            ) : (
              <div className="space-y-1 max-h-56 overflow-y-auto">
                {allRecentEvents.map((e) => (
                  <div key={`${e.origin}-${e.id}`} className={cn(
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
                    {instances.length > 0 && (
                      <span className={cn(
                        'text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0',
                        e.origin === 'Local'
                          ? 'bg-muted text-muted-foreground'
                          : 'bg-blue-500/10 text-blue-500',
                      )}>{e.origin}</span>
                    )}
                    <span className="text-muted-foreground shrink-0">{timeAgo(new Date(e.timestamp).getTime() / 1000)}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* AdGuard aggregate */}
      {agNodes.length > 0 && (
        <Card className={cardClass}>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Shield className={cn('h-4 w-4', isCyber ? 'text-[hsl(180,100%,50%)]' : 'text-blue-500')} />
                <div>
                  <CardTitle className="text-base">AdGuard Home</CardTitle>
                  <CardDescription>
                    DNS stats — last 24 h{agNodes.length > 1 ? ` · ${agNodes.length} instances` : ''}
                  </CardDescription>
                </div>
              </div>
              <div className="flex items-center gap-4 text-right">
                <div>
                  <p className="text-xs text-muted-foreground">Total queries</p>
                  <p className="text-lg font-bold tabular-nums">{agTotalQueries.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Blocked</p>
                  <p className={cn(
                    'text-lg font-bold tabular-nums',
                    agTotalBlocked > 0 ? (isCyber ? 'text-[hsl(180,100%,60%)]' : 'text-blue-500') : '',
                  )}>
                    {agTotalBlocked.toLocaleString()}
                    {agTotalQueries > 0 && (
                      <span className="text-xs font-normal text-muted-foreground ml-1">
                        ({Math.round(agTotalBlocked / agTotalQueries * 100)}%)
                      </span>
                    )}
                  </p>
                </div>
              </div>
            </div>
          </CardHeader>
          {agNodes.length > 1 && (
            <CardContent>
              <div className="space-y-1">
                {agNodes.map((node) => {
                  const pct = node.stats && node.stats.num_dns_queries > 0
                    ? Math.round(node.stats.num_blocked_filtering / node.stats.num_dns_queries * 100)
                    : 0
                  const isUp = node.status?.running ?? false
                  return (
                    <div key={node.name} className={cn(
                      'flex items-center gap-3 px-3 py-2.5 rounded-[var(--radius)] border text-sm',
                      isCyber ? 'border-[rgba(0,255,255,0.1)] bg-[rgba(0,255,255,0.02)]' : 'border-border bg-muted/20',
                    )}>
                      <span className={cn(
                        'h-2 w-2 rounded-full shrink-0',
                        isUp
                          ? isCyber ? 'bg-[hsl(180,100%,50%)]' : 'bg-green-500'
                          : 'bg-muted-foreground/30',
                      )} />
                      <span className="font-medium flex-1 truncate">{node.name}</span>
                      {node.stats ? (
                        <>
                          <span className="text-xs text-muted-foreground tabular-nums">
                            {node.stats.num_dns_queries.toLocaleString()} queries
                          </span>
                          <span className={cn(
                            'text-xs font-medium tabular-nums min-w-[4rem] text-right',
                            node.stats.num_blocked_filtering > 0
                              ? isCyber ? 'text-[hsl(180,80%,65%)]' : 'text-blue-500'
                              : 'text-muted-foreground',
                          )}>
                            {node.stats.num_blocked_filtering.toLocaleString()} blocked
                          </span>
                          <span className="text-[11px] text-muted-foreground w-10 text-right tabular-nums">
                            {pct}%
                          </span>
                          <span className="text-[11px] text-muted-foreground hidden sm:inline tabular-nums">
                            {(node.stats.avg_processing_time * 1000).toFixed(1)} ms
                          </span>
                        </>
                      ) : (
                        <span className="text-xs text-muted-foreground">No data</span>
                      )}
                    </div>
                  )
                })}
              </div>
            </CardContent>
          )}
        </Card>
      )}

      {/* Connected peers — local + slave */}
      {anyConnected && (
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
              {/* Local peers — show section label only when slaves are present */}
              {connectedPeers > 0 && instances.length > 0 && (
                <div className="flex items-center gap-1.5 pb-1 mb-0.5">
                  <Network className="h-3 w-3 text-muted-foreground/60" />
                  <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70">Local</span>
                </div>
              )}
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

              {/* Slave peers */}
              {slaveStatsList.map(({ instance, data: sd }) => {
                const connectedPeersForSlave = (sd?.interfaces ?? []).flatMap(
                  (i) => (i.peers ?? []).filter((p) => p.connected).map((p) => ({ ...p, ifaceName: i.name })),
                )
                if (connectedPeersForSlave.length === 0) return null
                return (
                  <div key={instance.id}>
                    <div className="flex items-center gap-1.5 pt-2 pb-1 border-t border-border/40 mt-1">
                      <Server className="h-3 w-3 text-muted-foreground/60" />
                      <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70">{instance.name}</span>
                    </div>
                    {connectedPeersForSlave.map((p) => (
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
                          <span className="text-muted-foreground font-mono text-xs">{p.ifaceName}</span>
                        </div>
                        <div className="flex items-center gap-3 text-muted-foreground text-xs tabular-nums">
                          <span>↓ {formatBytes(p.bytes_rx)}</span>
                          <span>↑ {formatBytes(p.bytes_tx)}</span>
                          <span className="hidden sm:inline">{timeAgo(p.last_handshake)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )
              })}
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
