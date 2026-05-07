import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Server, Network, Search, X } from 'lucide-react'
import { listClients, type Client } from '@/api/clients'
import { listInterfaces } from '@/api/interfaces'
import { listInstances, proxyToInstance, type RemoteInstance } from '@/api/instances'
import { useWebSocket, type StatsPayload } from '@/hooks/useWebSocket'
import { ClientCard } from '@/components/clients/ClientCard'
import { BulkBar } from '@/components/clients/BulkBar'
import { CreateClientDialog } from '@/components/clients/CreateClientDialog'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type Source = 'all' | 'local' | number

/** Clients page — all clients view, local, or per-slave. */
export default function Clients() {
  const { id: ifaceIdParam } = useParams<{ id: string }>()
  const ifaceId = ifaceIdParam ? Number(ifaceIdParam) : undefined
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const initialSlave = searchParams.get('slave') ? Number(searchParams.get('slave')) : null
  const [source, setSource] = useState<Source>(initialSlave ?? 'local')
  const initialIfaceFilter = searchParams.get('iface') ? Number(searchParams.get('iface')) : undefined
  const [slaveIfaceFilter, setSlaveIfaceFilter] = useState<number | undefined>(initialIfaceFilter)

  const qc = useQueryClient()
  const { data: interfaces = [] } = useQuery({ queryKey: ['interfaces'], queryFn: listInterfaces })
  const { data: instances = [] } = useQuery({ queryKey: ['instances'], queryFn: listInstances })
  const { data: clients = [], isLoading } = useQuery<Client[]>({
    queryKey: ['clients', ifaceId],
    queryFn: () => listClients(ifaceId),
    refetchInterval: 10_000,
    enabled: source === 'local',
  })
  const { stats } = useWebSocket()

  const peerMap = new Map(
    stats?.interfaces.flatMap((i) => i.peers ?? []).map((p) => [p.client_id, p]) ?? [],
  )

  // Search + status filter (client-side)
  const [search, setSearch]             = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'connected' | 'disabled' | 'expired' | 'suspended'>('all')

  const now = new Date()
  const filteredClients = clients.filter((c) => {
    if (statusFilter === 'connected'  && !peerMap.get(c.id)?.connected) return false
    if (statusFilter === 'disabled'   && (c.enabled || c.quota_suspended)) return false
    if (statusFilter === 'expired'    && !(c.expires_at && new Date(c.expires_at) < now)) return false
    if (statusFilter === 'suspended'  && !c.quota_suspended) return false
    if (search) {
      const q = search.toLowerCase()
      if (
        !c.name.toLowerCase().includes(q) &&
        !c.assigned_ip.toLowerCase().includes(q) &&
        !(c.owner_label ?? '').toLowerCase().includes(q) &&
        !(c.email ?? '').toLowerCase().includes(q)
      ) return false
    }
    return true
  })

  const [selected, setSelected] = useState<Set<number>>(new Set())
  const toggleSelect   = (id: number) => setSelected((prev) => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s })
  const selectAll      = () => setSelected(new Set(filteredClients.map((c) => c.id)))
  const clearSelection = () => setSelected(new Set())

  function invalidateLocal() { qc.invalidateQueries({ queryKey: ['clients'] }) }

  function handleSourceChange(s: Source) {
    setSource(s)
    setSlaveIfaceFilter(undefined)
    setSelected(new Set())
  }

  const selectedInstance = typeof source === 'number' ? instances.find((i) => i.id === source) : undefined

  const showSourceBar = instances.length > 0

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
              {source === 'all'
                ? 'All instances'
                : source === 'local'
                  ? ifaceId ? interfaces.find((i) => i.id === ifaceId)?.name ?? `Interface ${ifaceId}` : 'Local'
                  : selectedInstance?.name ?? 'Slave clients'}
            </p>
          </div>
        </div>
        {/* "Add client" is always visible — the dialog has its own instance selector */}
        <CreateClientDialog
          interfaces={interfaces}
          defaultInterfaceId={ifaceId}
          onCreated={() => {
            qc.invalidateQueries({ queryKey: ['clients'] })
            qc.invalidateQueries({ queryKey: ['slave-clients'] })
          }}
        />
      </div>

      {/* Source bar */}
      {showSourceBar && (
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            onClick={() => handleSourceChange('all')}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors',
              source === 'all'
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-muted text-muted-foreground border-border hover:border-primary hover:text-foreground',
            )}
          >
            All
          </button>
          <button
            onClick={() => handleSourceChange('local')}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors',
              source === 'local'
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
                source === inst.id
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
      {source === 'all' ? (
        <AllClientsView instances={instances} />
      ) : typeof source === 'number' && selectedInstance ? (
        <SlaveClientsList
          instance={selectedInstance}
          ifaceFilter={slaveIfaceFilter}
          onIfaceFilterChange={setSlaveIfaceFilter}
        />
      ) : (
        <>
          {/* Search & status filter */}
          {!isLoading && (
            <ClientFilterBar
              search={search}
              onSearchChange={(v) => { setSearch(v); clearSelection() }}
              statusFilter={statusFilter}
              onStatusFilterChange={(v) => { setStatusFilter(v); clearSelection() }}
            />
          )}

          {isLoading ? (
            <div className="p-6 animate-pulse space-y-3">
              {[1, 2, 3].map((i) => <div key={i} className="h-20 bg-muted rounded-lg" />)}
            </div>
          ) : (
            <div className="space-y-3">
              {filteredClients.map((client) => (
                <ClientCard
                  key={client.id}
                  client={client}
                  peer={peerMap.get(client.id)}
                  isSelected={selected.has(client.id)}
                  anySelected={selected.size > 0}
                  onToggleSelect={() => toggleSelect(client.id)}
                  onUpdated={invalidateLocal}
                />
              ))}
              {clients.length === 0 && (
                <div className="text-center py-12 text-muted-foreground">
                  <p>No clients yet.</p>
                </div>
              )}
              {clients.length > 0 && filteredClients.length === 0 && (
                <div className="text-center py-12 text-muted-foreground">
                  <p>No clients match your filters.</p>
                </div>
              )}
            </div>
          )}
          {selected.size > 0 && (
            <BulkBar
              selected={selected}
              totalCount={filteredClients.length}
              onSelectAll={selectAll}
              onClearSelection={clearSelection}
            />
          )}
        </>
      )}
    </div>
  )
}

// ── Client filter bar ─────────────────────────────────────────────────────────

type StatusFilter = 'all' | 'connected' | 'disabled' | 'expired' | 'suspended'

const STATUS_FILTERS: { label: string; value: StatusFilter }[] = [
  { label: 'All',       value: 'all' },
  { label: 'Connected', value: 'connected' },
  { label: 'Disabled',  value: 'disabled' },
  { label: 'Expired',   value: 'expired' },
  { label: 'Suspended', value: 'suspended' },
]

function ClientFilterBar({
  search, onSearchChange,
  statusFilter, onStatusFilterChange,
}: {
  search: string
  onSearchChange: (v: string) => void
  statusFilter: StatusFilter
  onStatusFilterChange: (v: StatusFilter) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Text search */}
      <div className="relative flex-1 min-w-44">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
        <input
          type="text"
          placeholder="Search by name, IP, owner…"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="w-full pl-8 pr-7 py-1.5 text-xs rounded-lg bg-muted border border-border focus:outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground/60"
        />
        {search && (
          <button
            onClick={() => onSearchChange('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      {/* Status pills */}
      <div className="flex flex-wrap gap-1">
        {STATUS_FILTERS.map(({ label, value }) => (
          <button
            key={value}
            onClick={() => onStatusFilterChange(value)}
            className={cn(
              'px-2.5 py-1 rounded-full text-xs font-medium border transition-colors',
              statusFilter === value
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-muted text-muted-foreground border-border hover:border-primary hover:text-foreground',
            )}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  )
}

// ── All-instances view ────────────────────────────────────────────────────────

function AllClientsView({ instances }: { instances: RemoteInstance[] }) {
  return (
    <div className="space-y-8">
      <LocalClientsSection />
      {instances.map((inst) => (
        <SlaveClientsSection key={inst.id} instance={inst} />
      ))}
    </div>
  )
}

function LocalClientsSection() {
  const qc = useQueryClient()
  const { data: clients = [], isLoading } = useQuery<Client[]>({
    queryKey: ['clients'],
    queryFn: () => listClients(undefined),
    refetchInterval: 10_000,
  })
  const { stats } = useWebSocket()
  const peerMap = new Map(
    stats?.interfaces.flatMap((i) => i.peers ?? []).map((p) => [p.client_id, p]) ?? [],
  )
  function invalidate() { qc.invalidateQueries({ queryKey: ['clients'] }) }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 pb-2 border-b border-border">
        <Network className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Local</span>
        {!isLoading && <span className="text-xs text-muted-foreground/60">({clients.length})</span>}
      </div>
      {isLoading ? (
        <div className="space-y-3">{[1, 2, 3].map((i) => <div key={i} className="h-20 bg-muted rounded-lg animate-pulse" />)}</div>
      ) : clients.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground text-sm">No local clients.</div>
      ) : (
        clients.map((c) => (
          <ClientCard
            key={c.id}
            client={c}
            peer={peerMap.get(c.id)}
            isSelected={false}
            anySelected={false}
            onToggleSelect={() => {}}
            onUpdated={invalidate}
          />
        ))
      )}
    </div>
  )
}

function SlaveClientsSection({ instance }: { instance: RemoteInstance }) {
  const qc = useQueryClient()
  const { data: clients = [], isLoading } = useQuery({
    queryKey: ['slave-clients', instance.id, undefined],
    queryFn: () =>
      proxyToInstance(instance.id, 'GET', '/api/v1/clients').then((r) => {
        const d = JSON.parse(r.body)
        return (Array.isArray(d) ? d : []) as Client[]
      }),
    refetchInterval: 10_000,
  })
  // Live peer stats for RX/TX and connected status (same as WS but polled)
  const { data: slaveStats } = useQuery({
    queryKey: ['slave-stats', instance.id],
    queryFn: () =>
      proxyToInstance(instance.id, 'GET', '/api/v1/stats').then((r) => JSON.parse(r.body) as StatsPayload),
    refetchInterval: 5_000,
  })
  const peerMap = new Map(
    (slaveStats?.interfaces ?? []).flatMap((i) => i.peers ?? []).map((p) => [p.client_id, p]),
  )
  function invalidate() { qc.invalidateQueries({ queryKey: ['slave-clients', instance.id] }) }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 pb-2 border-b border-border">
        <Server className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">{instance.name}</span>
        <span className="text-xs text-muted-foreground/60 font-mono">{instance.url}</span>
        {!isLoading && <span className="text-xs text-muted-foreground/60">({clients.length})</span>}
      </div>
      {isLoading ? (
        <div className="space-y-3">{[1, 2].map((i) => <div key={i} className="h-20 bg-muted rounded-lg animate-pulse" />)}</div>
      ) : clients.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground text-sm">No clients on {instance.name}.</div>
      ) : (
        clients.map((c) => (
          <ClientCard
            key={c.id}
            client={c}
            peer={peerMap.get(c.id)}
            isSelected={false}
            anySelected={false}
            onToggleSelect={() => {}}
            onUpdated={invalidate}
            instanceId={instance.id}
            instanceUrl={instance.url}
          />
        ))
      )}
    </div>
  )
}

// ── Slave clients list (single slave source) ──────────────────────────────────

interface SlaveIface {
  id: number
  name: string
  peer_count: number
}

function SlaveClientsList({
  instance, ifaceFilter, onIfaceFilterChange,
}: {
  instance: RemoteInstance
  ifaceFilter: number | undefined
  onIfaceFilterChange: (id: number | undefined) => void
}) {
  const qc = useQueryClient()

  const { data: slaveIfaces = [] } = useQuery({
    queryKey: ['slave-interfaces', instance.id],
    queryFn: () =>
      proxyToInstance(instance.id, 'GET', '/api/v1/interfaces').then((r) => {
        const d = JSON.parse(r.body)
        return (Array.isArray(d) ? d : []) as SlaveIface[]
      }),
  })

  const url = ifaceFilter ? `/api/v1/clients?interface_id=${ifaceFilter}` : '/api/v1/clients'
  const { data: clients = [], isLoading } = useQuery({
    queryKey: ['slave-clients', instance.id, ifaceFilter],
    queryFn: () =>
      proxyToInstance(instance.id, 'GET', url).then((r) => {
        const d = JSON.parse(r.body)
        return (Array.isArray(d) ? d : []) as Client[]
      }),
    refetchInterval: 10_000,
  })

  // Live peer stats (same 5 s cadence as local WebSocket)
  const { data: slaveStats } = useQuery({
    queryKey: ['slave-stats', instance.id],
    queryFn: () =>
      proxyToInstance(instance.id, 'GET', '/api/v1/stats').then((r) => JSON.parse(r.body) as StatsPayload),
    refetchInterval: 5_000,
  })
  const peerMap = new Map(
    (slaveStats?.interfaces ?? []).flatMap((i) => i.peers ?? []).map((p) => [p.client_id, p]),
  )

  const [selected, setSelected] = useState<Set<number>>(new Set())
  const toggleSelect   = (id: number) => setSelected((prev) => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s })
  const selectAll      = () => setSelected(new Set(clients.map((c) => c.id)))
  const clearSelection = () => setSelected(new Set())

  function invalidate() { qc.invalidateQueries({ queryKey: ['slave-clients', instance.id] }) }

  return (
    <div className="space-y-4">
      {/* Interface filter tabs */}
      {slaveIfaces.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => onIfaceFilterChange(undefined)}
            className={cn('px-3 py-1.5 rounded-full text-xs font-medium border transition-colors',
              ifaceFilter === undefined ? 'bg-primary text-primary-foreground border-primary' : 'bg-muted text-muted-foreground border-border hover:border-primary')}
          >
            All
          </button>
          {slaveIfaces.map((iface) => (
            <button
              key={iface.id}
              onClick={() => onIfaceFilterChange(iface.id)}
              className={cn('px-3 py-1.5 rounded-full text-xs font-medium border transition-colors font-mono',
                ifaceFilter === iface.id ? 'bg-primary text-primary-foreground border-primary' : 'bg-muted text-muted-foreground border-border hover:border-primary')}
            >
              {iface.name}
            </button>
          ))}
        </div>
      )}

      {/* Count */}
      <p className="text-sm text-muted-foreground">{clients.length} client{clients.length !== 1 ? 's' : ''}</p>

      {/* Client cards — full feature parity via instanceId prop */}
      {isLoading ? (
        <div className="space-y-3">{[1, 2, 3].map((i) => <div key={i} className="h-20 bg-muted rounded-lg animate-pulse" />)}</div>
      ) : clients.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground"><p>No clients on this slave.</p></div>
      ) : (
        <div className="space-y-3">
          {clients.map((cl) => (
            <ClientCard
              key={cl.id}
              client={cl}
              peer={peerMap.get(cl.id)}
              isSelected={selected.has(cl.id)}
              anySelected={selected.size > 0}
              onToggleSelect={() => toggleSelect(cl.id)}
              onUpdated={invalidate}
              instanceId={instance.id}
              instanceUrl={instance.url}
            />
          ))}
        </div>
      )}

      {selected.size > 0 && (
        <BulkBar
          selected={selected}
          totalCount={clients.length}
          onSelectAll={selectAll}
          onClearSelection={clearSelection}
          instanceId={instance.id}
        />
      )}
    </div>
  )
}
