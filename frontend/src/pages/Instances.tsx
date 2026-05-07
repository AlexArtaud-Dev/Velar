import { useState, useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Server, Plus, Trash2, RefreshCw,
  WifiOff, AlertTriangle, Check, Loader2,
  Network, Users, Activity, ChevronRight,
  Pencil, Shield, ToggleLeft, ToggleRight,
  ExternalLink,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  listInstances, registerInstance, updateInstance, updateAdguardCredentials,
  toggleAdguardSync, triggerAdguardSync,
  deleteInstance, pingInstance, proxyToInstance,
  type RemoteInstance,
} from '@/api/instances'
import { useThemeStore } from '@/stores/theme'
import { cn } from '@/lib/utils'

export default function Instances() {
  const { theme } = useThemeStore()
  const isCyber = theme === 'cyberpunk'
  const isApple = theme === 'apple'
  const [selected, setSelected] = useState<number | null>(null)
  const [showAdd, setShowAdd] = useState(false)

  const { data: instances = [] } = useQuery({
    queryKey: ['instances'],
    queryFn: listInstances,
  })

  const borderClass = isCyber ? 'border-[rgba(0,255,255,0.12)]' : 'border-border'

  const handleSelectInstance = (id: number) => {
    setSelected(id)
    setShowAdd(false)
  }

  const handleShowAdd = () => {
    setSelected(null)
    setShowAdd(true)
  }

  const handleRegistered = (id: number) => {
    setSelected(id)
    setShowAdd(false)
  }

  const showOverview = selected === null && !showAdd && instances.length > 0
  const showRegister = showAdd || instances.length === 0

  return (
    <div className="flex h-full">

      {/* ── Sidebar ── */}
      <aside className={cn(
        'w-56 shrink-0 border-r flex flex-col overflow-y-auto',
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
                  onClick={() => handleSelectInstance(inst.id)}
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
          onClick={handleShowAdd}
          className={cn(
            'mx-2 mb-2 flex items-center gap-2 px-2.5 py-2 rounded-[var(--radius)] text-sm transition-colors text-left',
            showAdd
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
        {showOverview ? (
          <InstancesOverview
            instances={instances}
            theme={theme}
            onSelect={handleSelectInstance}
            onAdd={handleShowAdd}
          />
        ) : showRegister ? (
          <RegisterForm theme={theme} onRegistered={handleRegistered} />
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
              instanceId={selected!}
              instance={inst}
              theme={theme}
              onDelete={() => { setSelected(null); setShowAdd(false) }}
            />
          )
        })()}
      </main>
    </div>
  )
}

// ── Instances overview ────────────────────────────────────────────────────────

function InstancesOverview({
  instances, theme, onSelect, onAdd,
}: {
  instances: RemoteInstance[]
  theme: string
  onSelect: (id: number) => void
  onAdd: () => void
}) {
  const isCyber = theme === 'cyberpunk'
  const isApple = theme === 'apple'
  const borderClass = isCyber ? 'border-[rgba(0,255,255,0.12)]' : 'border-border'

  return (
    <div className="space-y-5 max-w-3xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Slave Instances</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {instances.length} instance{instances.length !== 1 ? 's' : ''} registered
          </p>
        </div>
        <Button size="sm" onClick={onAdd}>
          <Plus className="h-3.5 w-3.5 mr-1.5" />
          Add instance
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {instances.map((inst) => (
          <button
            key={inst.id}
            onClick={() => onSelect(inst.id)}
            className={cn(
              'group text-left rounded-[var(--radius)] border p-4 transition-colors',
              isApple && 'apple-glass',
              isCyber
                ? 'border-[rgba(0,255,255,0.12)] hover:border-[rgba(0,255,255,0.3)] hover:bg-[rgba(0,255,255,0.04)] bg-[rgba(7,12,23,0.6)]'
                : 'border-border hover:border-primary/50 hover:bg-accent/50 bg-card',
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className={cn(
                  'h-8 w-8 rounded-[var(--radius)] flex items-center justify-center shrink-0',
                  isCyber ? 'bg-[rgba(0,255,255,0.08)]' : 'bg-muted',
                )}>
                  <Server className={cn('h-4 w-4', isCyber ? 'text-[hsl(180,80%,60%)]' : 'text-primary')} />
                </div>
                <div className="min-w-0">
                  <p className="font-semibold text-sm truncate">{inst.name}</p>
                  <p className={cn(
                    'text-[11px] font-mono truncate mt-0.5',
                    isCyber ? 'text-[hsl(180,55%,50%)]' : 'text-muted-foreground',
                  )}>
                    {inst.url}
                  </p>
                </div>
              </div>
              <ExternalLink className={cn(
                'h-3.5 w-3.5 shrink-0 mt-0.5 opacity-0 group-hover:opacity-50 transition-opacity',
                isCyber ? 'text-[hsl(180,80%,60%)]' : 'text-muted-foreground',
              )} />
            </div>

            {inst.adguard_enabled && (
              <div className={cn('mt-3 pt-3 border-t flex items-center gap-2', borderClass)}>
                <Shield className={cn('h-3 w-3', isCyber ? 'text-[hsl(180,80%,60%)]' : 'text-primary')} />
                <span className="text-[11px] text-muted-foreground">AdGuard configured</span>
                {inst.adguard_sync_enabled && (
                  <span className={cn(
                    'ml-auto text-[10px] font-medium px-1.5 py-0.5 rounded-full',
                    isCyber
                      ? 'bg-[rgba(0,255,255,0.1)] text-[hsl(180,80%,65%)]'
                      : 'bg-green-500/10 text-green-600 dark:text-green-400',
                  )}>
                    Auto-sync on
                  </span>
                )}
              </div>
            )}
          </button>
        ))}
      </div>
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
  const borderClass = isCyber ? 'border-[rgba(0,255,255,0.12)]' : 'border-border'

  const [lastChecked, setLastChecked] = useState<Date | null>(null)
  const [editOpen, setEditOpen]       = useState(false)
  const [agOpen, setAgOpen]           = useState(false)

  // Edit fields
  const [editName, setEditName]   = useState(instance.name)
  const [editUrl, setEditUrl]     = useState(instance.url)
  const [editToken, setEditToken] = useState('')

  // AdGuard fields
  const [agUrl, setAgUrl]   = useState(instance.adguard_url ?? '')
  const [agUser, setAgUser] = useState('')
  const [agPass, setAgPass] = useState('')

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

  const editMut = useMutation({
    mutationFn: () => updateInstance(instanceId, editName.trim(), editUrl.trim(), editToken.trim() || undefined),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['instances'] })
      setEditOpen(false)
      setEditToken('')
    },
  })

  const agMut = useMutation({
    mutationFn: () => updateAdguardCredentials(instanceId, agUrl.trim(), agUser.trim(), agPass.trim()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['instances'] })
      setAgOpen(false)
      setAgUser('')
      setAgPass('')
    },
  })

  const syncToggleMut = useMutation({
    mutationFn: (enabled: boolean) => toggleAdguardSync(instanceId, enabled),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['instances'] }),
  })

  const syncNowMut = useMutation({
    mutationFn: () => triggerAdguardSync(instanceId),
  })

  const health    = pingData?.health
  const reachable = pingData?.reachable

  const statusColor =
    reachable === undefined       ? 'bg-muted-foreground/40' :
    !reachable                    ? 'bg-red-500' :
    health?.status === 'ok'       ? (isCyber ? 'bg-[hsl(180,100%,50%)]' : 'bg-green-500') :
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
          <Button variant="outline" size="sm" onClick={() => { setEditOpen((o) => !o); setAgOpen(false) }}>
            <Pencil className="h-3.5 w-3.5 mr-1.5" />
            Edit
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

      {/* Edit form */}
      {editOpen && (
        <Card className={cardClass}>
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <Pencil className={cn('h-4 w-4', isCyber ? 'text-[hsl(180,100%,50%)]' : 'text-primary')} />
              <CardTitle className="text-sm">Edit instance</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="edit-name">Name</Label>
              <Input id="edit-name" value={editName} onChange={(e) => setEditName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-url">URL</Label>
              <Input id="edit-url" value={editUrl} onChange={(e) => setEditUrl(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-token">
                Slave token
                <span className="ml-2 text-[11px] text-muted-foreground font-normal">leave blank to keep current</span>
              </Label>
              <Input
                id="edit-token"
                placeholder="vs_… (optional)"
                value={editToken}
                onChange={(e) => setEditToken(e.target.value)}
                className="font-mono text-xs"
              />
            </div>
            {editMut.isError && (
              <p className="text-sm text-destructive flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                {(editMut.error as Error)?.message ?? 'Update failed'}
              </p>
            )}
            <div className="flex gap-2 pt-1">
              <Button
                size="sm"
                disabled={!editName.trim() || !editUrl.trim() || editMut.isPending}
                onClick={() => editMut.mutate()}
              >
                {editMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                <span className="ml-1.5">Save</span>
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditOpen(false)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

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
              <div className={cn('grid grid-cols-2 gap-3 pt-3 border-t', borderClass)}>
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

      {/* AdGuard credentials card */}
      <Card className={cardClass}>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Shield className={cn('h-4 w-4', isCyber ? 'text-[hsl(180,100%,50%)]' : 'text-primary')} />
              <CardTitle className="text-sm">AdGuard Home</CardTitle>
            </div>
            <div className="flex items-center gap-2">
              {instance.adguard_enabled && (
                <span className="text-[11px] text-green-500 font-medium">Configured</span>
              )}
              <Button
                size="sm" variant="outline"
                onClick={() => { setAgOpen((o) => !o); setEditOpen(false) }}
              >
                <Pencil className="h-3.5 w-3.5 mr-1.5" />
                {instance.adguard_enabled ? 'Update' : 'Configure'}
              </Button>
            </div>
          </div>
        </CardHeader>
        {(instance.adguard_enabled || agOpen) && (
          <CardContent className="space-y-3">
            {!agOpen && instance.adguard_enabled && (
              <div className="text-xs text-muted-foreground space-y-0.5">
                <p><span className="font-medium text-foreground">URL:</span> {instance.adguard_url}</p>
                <p className="opacity-60">Credentials stored encrypted.</p>
              </div>
            )}

            {/* Sync controls — visible when configured and form is closed */}
            {!agOpen && instance.adguard_enabled && (
              <div className={cn('flex items-center justify-between pt-2 border-t', borderClass)}>
                <div>
                  <p className="text-xs font-medium">Sync with master</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Push master config to this instance every 5 min
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {syncNowMut.isSuccess && (
                    <span className="text-[11px] text-green-500">Synced</span>
                  )}
                  {syncNowMut.isError && (() => {
                    const msg =
                      (syncNowMut.error as any)?.response?.data?.error ??
                      (syncNowMut.error as Error)?.message ??
                      'Unknown error'
                    return (
                      <span className="text-[11px] text-destructive max-w-xs text-right">
                        {msg}
                      </span>
                    )
                  })()}
                  <Button
                    size="sm" variant="outline"
                    disabled={syncNowMut.isPending}
                    onClick={() => syncNowMut.mutate()}
                    className="h-7 text-xs px-2.5"
                  >
                    {syncNowMut.isPending
                      ? <Loader2 className="h-3 w-3 animate-spin" />
                      : <RefreshCw className="h-3 w-3" />}
                    <span className="ml-1.5">Sync now</span>
                  </Button>
                  <button
                    onClick={() => syncToggleMut.mutate(!instance.adguard_sync_enabled)}
                    disabled={syncToggleMut.isPending}
                    className="shrink-0"
                    title={instance.adguard_sync_enabled ? 'Disable auto-sync' : 'Enable auto-sync'}
                  >
                    {syncToggleMut.isPending
                      ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                      : instance.adguard_sync_enabled
                        ? <ToggleRight className={cn('h-6 w-6', isCyber ? 'text-[hsl(180,100%,50%)]' : 'text-green-500')} />
                        : <ToggleLeft className="h-6 w-6 text-muted-foreground" />}
                  </button>
                </div>
              </div>
            )}

            {agOpen && (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="ag-url">AdGuard URL</Label>
                  <Input
                    id="ag-url"
                    placeholder="http://localhost:3001"
                    value={agUrl}
                    onChange={(e) => setAgUrl(e.target.value)}
                    className="font-mono text-xs"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Internal URL of AdGuard on the slave (e.g. <code className="bg-muted px-1 rounded">http://localhost:3001</code>)
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ag-user">Username</Label>
                  <Input id="ag-user" value={agUser} onChange={(e) => setAgUser(e.target.value)} autoComplete="off" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ag-pass">Password</Label>
                  <Input id="ag-pass" type="password" value={agPass} onChange={(e) => setAgPass(e.target.value)} autoComplete="new-password" />
                </div>
                {agMut.isError && (
                  <p className="text-sm text-destructive flex items-center gap-1.5">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                    {(agMut.error as Error)?.message ?? 'Save failed'}
                  </p>
                )}
                <div className="flex gap-2 pt-1">
                  <Button
                    size="sm"
                    disabled={!agUrl.trim() || !agUser.trim() || !agPass.trim() || agMut.isPending}
                    onClick={() => agMut.mutate()}
                  >
                    {agMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                    <span className="ml-1.5">Save credentials</span>
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setAgOpen(false)}>Cancel</Button>
                </div>
              </div>
            )}
          </CardContent>
        )}
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
