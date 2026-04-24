import { useQuery } from '@tanstack/react-query'
import { Network, Users, Activity, Globe } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { listInterfaces } from '@/api/interfaces'
import { listClients } from '@/api/clients'
import { getPublicIP } from '@/api/settings'
import { useWebSocket } from '@/hooks/useWebSocket'
import { formatBytes, timeAgo } from '@/lib/utils'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { useState, useEffect, useRef } from 'react'

interface BandwidthPoint {
  time: string
  rx: number
  tx: number
}

export default function Dashboard() {
  const { data: interfaces } = useQuery({ queryKey: ['interfaces'], queryFn: listInterfaces })
  const { data: clients } = useQuery({ queryKey: ['clients'], queryFn: () => listClients() })
  const { data: ipData } = useQuery({ queryKey: ['public-ip'], queryFn: getPublicIP, refetchInterval: 60_000 })
  const { stats } = useWebSocket()

  const [bandwidth, setBandwidth] = useState<BandwidthPoint[]>([])
  const prevStatsRef = useRef<{ rx: number; tx: number } | null>(null)

  useEffect(() => {
    if (!stats) return
    const totals = stats.interfaces.reduce(
      (acc, iface) => {
        iface.peers?.forEach((p) => {
          acc.rx += p.bytes_rx
          acc.tx += p.bytes_tx
        })
        return acc
      },
      { rx: 0, tx: 0 },
    )

    if (prevStatsRef.current) {
      const deltaRx = Math.max(0, totals.rx - prevStatsRef.current.rx)
      const deltaTx = Math.max(0, totals.tx - prevStatsRef.current.tx)
      setBandwidth((prev) => [
        ...prev.slice(-29),
        {
          time: new Date().toLocaleTimeString(),
          rx: Math.round(deltaRx / 5),
          tx: Math.round(deltaTx / 5),
        },
      ])
    }
    prevStatsRef.current = totals
  }, [stats])

  const totalPeers = stats?.interfaces.reduce((a, i) => a + (i.peers?.length ?? 0), 0) ?? 0
  const connectedPeers = stats?.interfaces.reduce(
    (a, i) => a + (i.peers?.filter((p) => p.connected).length ?? 0),
    0,
  ) ?? 0
  const upInterfaces = stats?.interfaces.filter((i) => i.up).length ?? 0

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground text-sm mt-1">Overview of your WireGuard server</p>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={<Network className="h-4 w-4" />}
          label="Interfaces"
          value={`${upInterfaces} / ${interfaces?.length ?? 0}`}
          sub="active"
        />
        <StatCard
          icon={<Users className="h-4 w-4" />}
          label="Clients"
          value={`${connectedPeers} / ${totalPeers}`}
          sub="connected"
        />
        <StatCard
          icon={<Activity className="h-4 w-4" />}
          label="Total RX"
          value={formatBytes(
            stats?.interfaces.flatMap((i) => i.peers ?? []).reduce((a, p) => a + p.bytes_rx, 0) ?? 0,
          )}
          sub="all time"
        />
        <StatCard
          icon={<Globe className="h-4 w-4" />}
          label="Public IP"
          value={ipData?.ip ?? '—'}
          sub="current"
        />
      </div>

      {/* Bandwidth chart */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Bandwidth (bytes/s)</CardTitle>
          <CardDescription>Live — updated every 5 seconds</CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={bandwidth}>
              <defs>
                <linearGradient id="rx" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="tx" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="time" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => formatBytes(v)} width={70} />
              <Tooltip formatter={(v: number) => formatBytes(v)} />
              <Area type="monotone" dataKey="rx" stroke="#3b82f6" fill="url(#rx)" name="RX" />
              <Area type="monotone" dataKey="tx" stroke="#10b981" fill="url(#tx)" name="TX" />
            </AreaChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Interface status */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Interface status</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {stats?.interfaces.map((iface) => (
            <div key={iface.id} className="flex items-center justify-between py-2 border-b border-border last:border-0">
              <div className="flex items-center gap-3">
                <Badge variant={iface.up ? 'success' : 'destructive'}>{iface.up ? 'UP' : 'DOWN'}</Badge>
                <span className="font-mono text-sm">{iface.name}</span>
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Users className="h-3 w-3" />
                <span>{iface.peers?.filter((p) => p.connected).length ?? 0} / {iface.peers?.length ?? 0}</span>
              </div>
            </div>
          ))}
          {!stats?.interfaces?.length && (
            <p className="text-sm text-muted-foreground">No interfaces found.</p>
          )}
        </CardContent>
      </Card>

      {/* Connected peers */}
      {stats?.interfaces.flatMap((i) => i.peers ?? []).some((p) => p.connected) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Connected peers</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {stats?.interfaces.flatMap((iface) =>
                (iface.peers ?? [])
                  .filter((p) => p.connected)
                  .map((p) => (
                    <div key={p.client_id} className="flex items-center justify-between text-sm py-1">
                      <div className="flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full bg-green-500 inline-block" />
                        <span className="font-medium">{p.name}</span>
                        <span className="text-muted-foreground font-mono text-xs">{iface.name}</span>
                      </div>
                      <div className="flex items-center gap-4 text-muted-foreground text-xs">
                        <span>↓ {formatBytes(p.bytes_rx)}</span>
                        <span>↑ {formatBytes(p.bytes_tx)}</span>
                        <span>{timeAgo(p.last_handshake)}</span>
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

function StatCard({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub: string }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between mb-2">
          <span className="text-muted-foreground text-xs uppercase tracking-wider">{label}</span>
          <span className="text-muted-foreground">{icon}</span>
        </div>
        <div className="text-2xl font-bold">{value}</div>
        <div className="text-xs text-muted-foreground mt-1">{sub}</div>
      </CardContent>
    </Card>
  )
}
