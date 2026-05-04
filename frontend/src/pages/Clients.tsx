import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Server, Plus, Trash2, ToggleLeft, ToggleRight, Check, Loader2, ArrowDown, ArrowUp, X } from 'lucide-react'
import { listClients, type Client } from '@/api/clients'
import { listInterfaces } from '@/api/interfaces'
import { listInstances, proxyToInstance, type RemoteInstance } from '@/api/instances'
import { useWebSocket } from '@/hooks/useWebSocket'
import { ClientCard } from '@/components/clients/ClientCard'
import { BulkBar } from '@/components/clients/BulkBar'
import { CreateClientDialog } from '@/components/clients/CreateClientDialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { formatBytes, timeAgo, cn } from '@/lib/utils'
import { useThemeStore } from '@/stores/theme'

/** Clients page — local clients + slave source bar. */
export default function Clients() {
  const { id: ifaceIdParam } = useParams<{ id: string }>()
  const ifaceId = ifaceIdParam ? Number(ifaceIdParam) : undefined
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { theme } = useThemeStore()

  // Source selection: null = local, number = slave instance id
  const initialSlave = searchParams.get('slave') ? Number(searchParams.get('slave')) : null
  const [slaveId, setSlaveId] = useState<number | null>(initialSlave)
  const initialIfaceFilter = searchParams.get('iface') ? Number(searchParams.get('iface')) : undefined
  const [slaveIfaceFilter, setSlaveIfaceFilter] = useState<number | undefined>(initialIfaceFilter)

  const qc = useQueryClient()
  const { data: interfaces = [] } = useQuery({ queryKey: ['interfaces'], queryFn: listInterfaces })
  const { data: instances = [] } = useQuery({ queryKey: ['instances'], queryFn: listInstances })
  const { data: clients = [], isLoading } = useQuery<Client[]>({
    queryKey: ['clients', ifaceId],
    queryFn: () => listClients(ifaceId),
    refetchInterval: 10_000,
    enabled: slaveId === null,
  })
  const { stats } = useWebSocket()

  const peerMap = new Map(
    stats?.interfaces.flatMap((i) => i.peers ?? []).map((p) => [p.client_id, p]) ?? [],
  )

  const [selected, setSelected] = useState<Set<number>>(new Set())
  const toggleSelect = (id: number) => setSelected((prev) => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s })
  const selectAll    = () => setSelected(new Set(clients.map((c) => c.id)))
  const clearSelection = () => setSelected(new Set())

  function invalidate() { qc.invalidateQueries({ queryKey: ['clients'] }) }

  function handleSourceChange(id: number | null) {
    setSlaveId(id)
    setSlaveIfaceFilter(undefined)
    setSelected(new Set())
  }

  const selectedInstance = instances.find((i) => i.id === slaveId)

  return (
    <div className="p-4 sm:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          {ifaceId && (
            <Button variant="ghost" size="icon" onClick={() => navigate('/interfaces')} className="shrink-0" title="Back to interfaces">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          )}
          <div>
            <h1 className="text-2xl font-bold">Clients</h1>
            <p className="text-muted-foreground text-sm mt-1">
              {slaveId === null
                ? ifaceId ? interfaces.find((i) => i.id === ifaceId)?.name ?? `Interface ${ifaceId}` : 'All clients'
                : selectedInstance?.name ?? 'Slave clients'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {slaveId === null && (
            <CreateClientDialog interfaces={interfaces} defaultInterfaceId={ifaceId} onCreated={invalidate} />
          )}
        </div>
      </div>

      {/* Source bar — only shown when slaves exist */}
      {instances.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            onClick={() => handleSourceChange(null)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors',
              slaveId === null
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-muted text-muted-foreground border-border hover:border-primary hover:text-foreground',
            )}
          >
            Local
          </button>
          {instances.map((inst) => (
            <button
              key={inst.id}
              onClick={() => handleSourceChange(inst.id)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors',
                slaveId === inst.id
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-muted text-muted-foreground border-border hover:border-primary hover:text-foreground',
              )}
            >
              <Server className="h-3 w-3" />
              {inst.name}
            </button>
          ))}
        </div>
      )}

      {/* Content */}
      {slaveId !== null && selectedInstance ? (
        <SlaveClientsList
          instance={selectedInstance}
          ifaceFilter={slaveIfaceFilter}
          onIfaceFilterChange={setSlaveIfaceFilter}
          theme={theme}
        />
      ) : (
        <>
          {isLoading ? (
            <div className="p-6 animate-pulse space-y-3">
              {[1, 2, 3].map((i) => <div key={i} className="h-20 bg-muted rounded-lg" />)}
            </div>
          ) : (
            <div className="space-y-3">
              {clients.map((client) => (
                <ClientCard
                  key={client.id}
                  client={client}
                  peer={peerMap.get(client.id)}
                  isSelected={selected.has(client.id)}
                  anySelected={selected.size > 0}
                  onToggleSelect={() => toggleSelect(client.id)}
                  onUpdated={invalidate}
                />
              ))}
              {clients.length === 0 && (
                <div className="text-center py-12 text-muted-foreground">
                  <p>No clients yet.</p>
                </div>
              )}
            </div>
          )}
          {selected.size > 0 && (
            <BulkBar selected={selected} totalCount={clients.length} onSelectAll={selectAll} onClearSelection={clearSelection} />
          )}
        </>
      )}
    </div>
  )
}

// ── Slave clients list ────────────────────────────────────────────────────────

interface SlaveClient {
  id: number
  interface_id: number
  name: string
  assigned_ip: string
  enabled: boolean
  bytes_rx: number
  bytes_tx: number
  last_handshake: string | null
  public_key: string
}

interface SlaveIface {
  id: number
  name: string
  peer_count: number
}

function SlaveClientsList({
  instance, ifaceFilter, onIfaceFilterChange, theme,
}: {
  instance: RemoteInstance
  ifaceFilter: number | undefined
  onIfaceFilterChange: (id: number | undefined) => void
  theme: string
}) {
  const isCyber = theme === 'cyberpunk'

  const { data: slaveIfaces = [] } = useQuery({
    queryKey: ['slave-interfaces', instance.id],
    queryFn: () => proxyToInstance(instance.id, 'GET', '/api/v1/interfaces').then((r) => {
      const d = JSON.parse(r.body); return (Array.isArray(d) ? d : []) as SlaveIface[]
    }),
  })

  const url = ifaceFilter ? `/api/v1/clients?interface_id=${ifaceFilter}` : '/api/v1/clients'
  const { data: clients = [], isLoading, refetch } = useQuery({
    queryKey: ['slave-clients', instance.id, ifaceFilter],
    queryFn: () => proxyToInstance(instance.id, 'GET', url).then((r) => {
      const d = JSON.parse(r.body); return (Array.isArray(d) ? d : []) as SlaveClient[]
    }),
    refetchInterval: 10_000,
  })

  const enableMut  = useMutation({ mutationFn: (id: number) => proxyToInstance(instance.id, 'POST',   `/api/v1/clients/${id}/enable`),  onSuccess: () => refetch() })
  const disableMut = useMutation({ mutationFn: (id: number) => proxyToInstance(instance.id, 'POST',   `/api/v1/clients/${id}/disable`), onSuccess: () => refetch() })
  const deleteMut  = useMutation({ mutationFn: (id: number) => proxyToInstance(instance.id, 'DELETE', `/api/v1/clients/${id}`),         onSuccess: () => refetch() })

  // Create client form
  const [showCreate, setShowCreate] = useState(false)
  const [newName, setNewName] = useState('')
  const [newIfaceId, setNewIfaceId] = useState<number | undefined>(ifaceFilter ?? slaveIfaces[0]?.id)
  const createMut = useMutation({
    mutationFn: () => proxyToInstance(instance.id, 'POST', '/api/v1/clients', {
      name: newName.trim(), interface_id: newIfaceId,
    }),
    onSuccess: () => { setShowCreate(false); setNewName(''); refetch() },
  })

  // keep newIfaceId in sync when ifaces load
  const resolvedIfaceId = newIfaceId ?? slaveIfaces[0]?.id

  return (
    <div className="space-y-4">
      {/* Interface filter tabs */}
      {slaveIfaces.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          <button onClick={() => onIfaceFilterChange(undefined)}
            className={cn('px-3 py-1.5 rounded-full text-xs font-medium border transition-colors',
              ifaceFilter === undefined ? 'bg-primary text-primary-foreground border-primary' : 'bg-muted text-muted-foreground border-border hover:border-primary')}>
            All
          </button>
          {slaveIfaces.map((iface) => (
            <button key={iface.id} onClick={() => onIfaceFilterChange(iface.id)}
              className={cn('px-3 py-1.5 rounded-full text-xs font-medium border transition-colors font-mono',
                ifaceFilter === iface.id ? 'bg-primary text-primary-foreground border-primary' : 'bg-muted text-muted-foreground border-border hover:border-primary')}>
              {iface.name}
            </button>
          ))}
        </div>
      )}

      {/* Action bar */}
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{clients.length} client{clients.length !== 1 ? 's' : ''}</span>
        <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setShowCreate((v) => !v)}>
          <Plus className="h-3 w-3 mr-1" /> New client
        </Button>
      </div>

      {/* Inline create form */}
      {showCreate && (
        <div className={cn('rounded-[var(--radius)] border border-border p-4 space-y-3', isCyber ? 'bg-[rgba(0,255,255,0.03)]' : 'bg-muted/20')}>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">New client on {instance.name}</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Name</Label>
              <Input className="h-8 text-sm" placeholder="e.g. Phone, Laptop…" value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && newName.trim() && resolvedIfaceId && createMut.mutate()} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Interface</Label>
              <select
                className="h-8 w-full rounded-[var(--radius)] border border-border bg-background px-2 text-sm"
                value={resolvedIfaceId ?? ''}
                onChange={(e) => setNewIfaceId(Number(e.target.value))}
              >
                {slaveIfaces.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
              </select>
            </div>
          </div>
          {createMut.isError && <p className="text-xs text-destructive">{(createMut.error as Error)?.message ?? 'Failed'}</p>}
          <div className="flex gap-2">
            <Button size="sm" className="h-8" disabled={!newName.trim() || !resolvedIfaceId || createMut.isPending} onClick={() => createMut.mutate()}>
              {createMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Check className="h-3.5 w-3.5 mr-1.5" />} Create
            </Button>
            <Button size="sm" variant="outline" className="h-8" onClick={() => setShowCreate(false)}>
              <X className="h-3.5 w-3.5 mr-1.5" /> Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Client cards */}
      {isLoading ? (
        <div className="space-y-3">{[1, 2, 3].map((i) => <div key={i} className="h-20 bg-muted rounded-lg animate-pulse" />)}</div>
      ) : clients.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground"><p>No clients on this slave.</p></div>
      ) : (
        <div className="space-y-3">
          {clients.map((cl) => (
            <SlaveClientCard
              key={cl.id}
              client={cl}
              theme={theme}
              onEnable={() => enableMut.mutate(cl.id)}
              onDisable={() => disableMut.mutate(cl.id)}
              onDelete={() => { if (confirm(`Delete ${cl.name}?`)) deleteMut.mutate(cl.id) }}
              busy={enableMut.isPending || disableMut.isPending || deleteMut.isPending}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Slave client card ─────────────────────────────────────────────────────────

function SlaveClientCard({
  client, theme, onEnable, onDisable, onDelete, busy,
}: {
  client: SlaveClient
  theme: string
  onEnable: () => void
  onDisable: () => void
  onDelete: () => void
  busy: boolean
}) {
  const isCyber = theme === 'cyberpunk'
  const isApple = theme === 'apple'

  return (
    <Card className={cn(
      'transition-all duration-200',
      !client.enabled && 'opacity-60',
      isApple && 'apple-glass',
      isCyber && 'cyber-card',
      !isApple && !isCyber && 'hover:shadow-md',
    )}>
      <CardHeader className="pb-2">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <span className={cn(
              'h-2.5 w-2.5 rounded-full shrink-0',
              client.enabled
                ? isCyber ? 'bg-[hsl(180,100%,50%)] shadow-[0_0_6px_rgba(0,255,255,0.6)]' : 'bg-green-500'
                : 'bg-muted-foreground/25',
            )} />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <CardTitle className="text-sm leading-none">{client.name}</CardTitle>
                {!client.enabled && <Badge variant="secondary" className="h-4 text-[10px] px-1.5">Disabled</Badge>}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1 ml-auto sm:ml-0">
            <Button variant="ghost" size="icon" className="h-7 w-7" title={client.enabled ? 'Disable' : 'Enable'} disabled={busy}
              onClick={client.enabled ? onDisable : onEnable}>
              {client.enabled
                ? <ToggleRight className={cn('h-4 w-4', isCyber ? 'text-[hsl(180,100%,50%)]' : 'text-green-500')} />
                : <ToggleLeft className="h-4 w-4 text-muted-foreground" />}
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" title="Delete" disabled={busy} onClick={onDelete}>
              <Trash2 className="h-3.5 w-3.5 text-destructive" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-1">
        <div className={cn('flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground px-1 pb-2', isCyber && 'font-mono')}>
          <span className={cn('font-mono px-1.5 py-0.5 rounded text-xs',
            isCyber ? 'bg-[rgba(0,255,255,0.08)] text-[hsl(180,80%,65%)]' : 'bg-muted text-foreground/80')}>
            {client.assigned_ip}
          </span>
          <span className="flex items-center gap-0.5">
            <ArrowDown className={cn('h-3 w-3', isCyber ? 'text-[hsl(180,100%,50%)]' : 'text-blue-500')} />
            {formatBytes(client.bytes_rx)}
          </span>
          <span className="flex items-center gap-0.5">
            <ArrowUp className={cn('h-3 w-3', isCyber ? 'text-[hsl(300,100%,55%)]' : 'text-emerald-500')} />
            {formatBytes(client.bytes_tx)}
          </span>
          {client.last_handshake && <span>{timeAgo(new Date(client.last_handshake).getTime() / 1000)}</span>}
        </div>
      </CardContent>
    </Card>
  )
}
