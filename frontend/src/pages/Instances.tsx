import { useState, useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Server, Plus, Trash2, RefreshCw,
  WifiOff, AlertTriangle, Check, Loader2,
  Network, Users, Activity, ChevronRight,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  listInstances, registerInstance, deleteInstance, pingInstance, proxyToInstance,
  type RemoteInstance,
} from '@/api/instances'
import { useThemeStore } from '@/stores/theme'
import { cn } from '@/lib/utils'

export default function Instances() {
  const { theme } = useThemeStore()
  const isCyber = theme === 'cyberpunk'
  const isApple = theme === 'apple'
  const [selected, setSelected] = useState<number | null>(null)

  const { data: instances = [] } = useQuery({
    queryKey: ['instances'],
    queryFn: listInstances,
  })

  const borderClass = isCyber ? 'border-[rgba(0,255,255,0.12)]' : 'border-border'

  return (
    <div className="flex" style={{ minHeight: 'calc(100vh - 57px)' }}>

      {/* ── Sidebar ── */}
      <aside className={cn(
        'w-56 shrink-0 border-r flex flex-col sticky top-0 overflow-y-auto',
        'max-h-[calc(100vh-57px)]',
        borderClass,
        isApple && 'apple-glass',
        isCyber && 'bg-[rgba(7,12,23,0.8)]',
      )}>
        <div className="px-3 pt-4 pb-1">
          <span className={cn(
            'text-[10px] font-semibold uppercase tracking-widest',
            isCyber ? 'text-[hsl(180,60%,45%)]' : 'text-muted-foreground',
          )}>
            Slave Instances
          </span>
        </div>

        {instances.length === 0 ? (
          <p className="px-4 py-3 text-xs text-muted-foreground">No instances yet.</p>
        ) : (
          <div className="px-2 pb-2 space-y-0.5">
            {instances.map((inst) => {
              const active = selected === inst.id
              return (
                <button
                  key={inst.id}
                  onClick={() => setSelected(inst.id)}
                  className={cn(
                    'w-full flex items-center gap-2 px-2.5 py-2 rounded-[var(--radius)] text-sm transition-colors text-left',
                    active
                      ? isCyber
                        ? 'bg-[rgba(0,255,255,0.1)] text-[hsl(180,80%,70%)]'
                        : 'bg-accent text-foreground'
                      : 'text-muted-foreground hover:text-foreground hover:bg-accent/50',
                  )}
                >
                  <Server className="h-3.5 w-3.5 shrink-0" />
                  <span className="flex-1 truncate text-xs font-medium">{inst.name}</span>
                  {active && <ChevronRight className="h-3 w-3 opacity-50 shrink-0" />}
                </button>
              )
            })}
          </div>
        )}

        <div className={cn('mx-3 my-2 border-t', borderClass)} />

        <button
          onClick={() => setSelected(null)}
          className={cn(
            'mx-2 mb-2 flex items-center gap-2 px-2.5 py-2 rounded-[var(--radius)] text-sm transition-colors text-left',
            selected === null
              ? isCyber ? 'bg-[rgba(0,255,255,0.1)] text-[hsl(180,80%,70%)]' : 'bg-accent text-foreground'
              : 'text-muted-foreground hover:text-foreground hover:bg-accent/50',
          )}
        >
          <Plus className="h-3.5 w-3.5 shrink-0" />
          <span className="text-xs font-medium">Add instance</span>
        </button>
      </aside>

      {/* ── Main content ── */}
      <main className="flex-1 overflow-y-auto p-6">
        {selected === null ? (
          <RegisterForm theme={theme} onRegistered={(id) => setSelected(id)} />
        ) : (() => {
          const inst = instances.find((i) => i.id === selected)
          if (!inst) return (
            <div className="flex items-center gap-2 text-sm text-muted-foreground p-6">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          )
          return (
            <InstancePanel
              key={selected}
              instanceId={selected}
              instance={inst}
              theme={theme}
              onDelete={() => setSelected(null)}
            />
          )
        })()}
      </main>
    </div>
  )
}

// ── Register form ─────────────────────────────────────────────────────────────

function RegisterForm({ theme, onRegistered }: { theme: string; onRegistered: (id: number) => void }) {
  const qc = useQueryClient()
  const isCyber = theme === 'cyberpunk'
  const isApple = theme === 'apple'

  const [name, setName]   = useState('')
  const [url, setUrl]     = useState('')
  const [token, setToken] = useState('')

  const mut = useMutation({
    mutationFn: () => registerInstance(name.trim(), url.trim(), token.trim()),
    onSuccess: (inst) => {
      qc.invalidateQueries({ queryKey: ['instances'] })
      onRegistered(inst.id)
    },
  })

  const cardClass = cn(isApple && 'apple-glass', isCyber && 'cyber-card')

  return (
    <div className="max-w-lg space-y-5">
      <div>
        <h1 className="text-xl font-bold">Connect a slave instance</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Run Velar with <code className="font-mono text-xs bg-muted px-1 rounded">VELAR_MODE=slave</code> on
          another server. The slave prints a <code className="font-mono text-xs bg-muted px-1 rounded">vs_</code> token
          on first boot — paste it here.
        </p>
      </div>

      <Card className={cardClass}>
        <CardContent className="pt-5 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="inst-name">Name</Label>
            <Input
              id="inst-name"
              placeholder="e.g. Home server, VPS Paris…"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="inst-url">URL</Label>
            <Input
              id="inst-url"
              placeholder="https://vpn.home.example.com"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
            <p className="text-[11px] text-muted-foreground">
              Must be reachable from this server. No trailing slash.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="inst-token">Slave token</Label>
            <Input
              id="inst-token"
              placeholder="vs_…"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              className="font-mono text-xs"
            />
          </div>

          {mut.isError && (
            <div className="flex items-center gap-2 text-sm text-destructive">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {(mut.error as Error)?.message ?? 'Registration failed'}
            </div>
          )}

          <Button
            disabled={!name.trim() || !url.trim() || !token.trim() || mut.isPending}
            onClick={() => mut.mutate()}
          >
            {mut.isPending
              ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Connecting…</>
              : <><Check className="h-4 w-4 mr-2" />Connect instance</>}
          </Button>
        </CardContent>
      </Card>

      <Card className={cn('border-dashed', cardClass)}>
        <CardContent className="pt-4">
          <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">Slave docker-compose</p>
          <pre className={cn(
            'text-[11px] p-3 rounded-[var(--radius)] overflow-x-auto leading-relaxed',
            isCyber ? 'bg-[rgba(0,255,255,0.04)] text-[hsl(180,60%,70%)]' : 'bg-muted text-foreground/80',
          )}>
{`services:
  api:
    build:
      context: ./backend
      dockerfile: Dockerfile
    restart: unless-stopped
    network_mode: host
    cap_add:
      - NET_ADMIN
      - SYS_MODULE
    volumes:
      - wireguard_configs:/etc/wireguard
      - sqlite_data:/data
    env_file:
      - .env.slave

volumes:
  wireguard_configs:
  sqlite_data:`}
          </pre>
        </CardContent>
      </Card>
    </div>
  )
}

// ── Instance panel ────────────────────────────────────────────────────────────

function InstancePanel({
  instanceId, instance, theme, onDelete,
}: {
  instanceId: number
  instance: RemoteInstance
  theme: string
  onDelete: () => void
}) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const isCyber = theme === 'cyberpunk'
  const isApple = theme === 'apple'
  const cardClass = cn(isApple && 'apple-glass', isCyber && 'cyber-card')

  const [lastChecked, setLastChecked] = useState<Date | null>(null)

  const { data: pingData, isLoading: pinging, refetch: reping } = useQuery({
    queryKey: ['instance-ping', instanceId],
    queryFn: () => pingInstance(instanceId),
    refetchInterval: 30_000,
  })

  useEffect(() => {
    if (pingData !== undefined) setLastChecked(new Date())
  }, [pingData])

  // Quick counts
  const { data: ifaceCount = 0 } = useQuery({
    queryKey: ['instance-iface-count', instanceId],
    queryFn: () =>
      proxyToInstance(instanceId, 'GET', '/api/v1/interfaces/overview').then((r) => {
        const d = JSON.parse(r.body)
        return Array.isArray(d) ? d.length : 0
      }),
    enabled: pingData?.reachable === true,
    refetchInterval: 60_000,
  })

  const { data: clientCount = 0 } = useQuery({
    queryKey: ['instance-client-count', instanceId],
    queryFn: () =>
      proxyToInstance(instanceId, 'GET', '/api/v1/clients').then((r) => {
        const d = JSON.parse(r.body)
        return Array.isArray(d) ? d.length : 0
      }),
    enabled: pingData?.reachable === true,
    refetchInterval: 60_000,
  })

  const deleteMut = useMutation({
    mutationFn: () => deleteInstance(instanceId),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['instances'] }); onDelete() },
  })

  const health    = pingData?.health
  const reachable = pingData?.reachable

  const statusColor =
    reachable === undefined   ? 'bg-muted-foreground/40' :
    !reachable                ? 'bg-red-500' :
    health?.status === 'ok'   ? (isCyber ? 'bg-[hsl(180,100%,50%)]' : 'bg-green-500') :
    health?.status === 'degraded' ? 'bg-amber-500' : 'bg-red-500'

  return (
    <div className="space-y-5 max-w-2xl">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <span className={cn('h-2.5 w-2.5 rounded-full shrink-0 mt-1', statusColor)} />
          <div>
            <h1 className="text-xl font-bold">{instance.name}</h1>
            <p className={cn('text-sm font-mono', isCyber ? 'text-[hsl(180,60%,55%)]' : 'text-muted-foreground')}>
              {instance.url}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => reping()} disabled={pinging}>
            <RefreshCw className={cn('h-3.5 w-3.5 mr-1.5', pinging && 'animate-spin')} />
            Refresh
          </Button>
          <Button
            variant="ghost" size="sm"
            className="text-destructive hover:text-destructive"
            onClick={() => { if (confirm(`Remove "${instance.name}"?`)) deleteMut.mutate() }}
          >
            <Trash2 className="h-3.5 w-3.5 mr-1.5" />
            Remove
          </Button>
        </div>
      </div>

      {/* Health card */}
      <Card className={cardClass}>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Activity className={cn('h-4 w-4', isCyber ? 'text-[hsl(180,100%,50%)]' : 'text-primary')} />
              <CardTitle className="text-sm">Health</CardTitle>
            </div>
            {lastChecked && (
              <span className="text-[11px] text-muted-foreground">
                Last checked {lastChecked.toLocaleTimeString()}
              </span>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {pinging ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Checking…
            </div>
          ) : !reachable ? (
            <div className="flex items-center gap-2 text-sm text-destructive">
              <WifiOff className="h-4 w-4" />
              Unreachable{pingData?.error ? ` — ${pingData.error}` : ''}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                <Stat label="Status"  value={health?.status ?? '—'}   ok={health?.status === 'ok'} isCyber={isCyber} />
                <Stat label="Version" value={health?.version ?? '—'}  isCyber={isCyber} />
                <Stat label="Uptime"  value={formatUptime(health?.uptime_seconds ?? 0)} isCyber={isCyber} />
                <Stat
                  label="AdGuard"
                  value={health?.checks.adguard.configured
                    ? (health.checks.adguard.status ?? 'n/a')
                    : 'not configured'}
                  ok={health?.checks.adguard.status === 'ok'}
                  isCyber={isCyber}
                />
              </div>

              {/* Quick stats + navigation */}
              <div className={cn('grid grid-cols-2 gap-3 pt-3 border-t', isCyber ? 'border-[rgba(0,255,255,0.12)]' : 'border-border')}>
                <button
                  onClick={() => navigate('/interfaces')}
                  className={cn(
                    'flex flex-col items-center gap-1 py-3 rounded-[var(--radius)] border transition-colors group',
                    isCyber
                      ? 'border-[rgba(0,255,255,0.12)] hover:border-[rgba(0,255,255,0.3)] hover:bg-[rgba(0,255,255,0.04)]'
                      : 'border-border hover:border-primary/50 hover:bg-accent/50',
                  )}
                >
                  <Network className={cn('h-5 w-5', isCyber ? 'text-[hsl(180,100%,50%)]' : 'text-primary')} />
                  <span className="text-xl font-bold">{ifaceCount}</span>
                  <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                    Interfaces <ChevronRight className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </span>
                </button>
                <button
                  onClick={() => navigate(`/clients?slave=${instanceId}`)}
                  className={cn(
                    'flex flex-col items-center gap-1 py-3 rounded-[var(--radius)] border transition-colors group',
                    isCyber
                      ? 'border-[rgba(0,255,255,0.12)] hover:border-[rgba(0,255,255,0.3)] hover:bg-[rgba(0,255,255,0.04)]'
                      : 'border-border hover:border-primary/50 hover:bg-accent/50',
                  )}
                >
                  <Users className={cn('h-5 w-5', isCyber ? 'text-[hsl(180,100%,50%)]' : 'text-primary')} />
                  <span className="text-xl font-bold">{clientCount}</span>
                  <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                    Clients <ChevronRight className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </span>
                </button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Stat({ label, value, ok, isCyber }: { label: string; value: string; ok?: boolean; isCyber: boolean }) {
  return (
    <div>
      <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">{label}</p>
      <p className={cn(
        'text-sm font-medium',
        ok === true ? (isCyber ? 'text-[hsl(180,80%,65%)]' : 'text-green-600 dark:text-green-400') :
        ok === false ? 'text-destructive' : '',
      )}>
        {value}
      </p>
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`
  return `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h`
}
