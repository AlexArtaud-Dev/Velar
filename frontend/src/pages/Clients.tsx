import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { listClients, type Client } from '@/api/clients'
import { listInterfaces } from '@/api/interfaces'
import { useWebSocket } from '@/hooks/useWebSocket'
import { ClientCard } from '@/components/clients/ClientCard'
import { BulkBar } from '@/components/clients/BulkBar'
import { CreateClientDialog } from '@/components/clients/CreateClientDialog'
import { Button } from '@/components/ui/button'

/** Clients page — lists all clients (optionally filtered by interface). */
export default function Clients() {
  const { id: ifaceIdParam } = useParams<{ id: string }>()
  const ifaceId = ifaceIdParam ? Number(ifaceIdParam) : undefined
  const navigate = useNavigate()

  const qc = useQueryClient()
  const { data: clients = [], isLoading } = useQuery<Client[]>({
    queryKey: ['clients', ifaceId],
    queryFn: () => listClients(ifaceId),
    refetchInterval: 10_000,
  })
  const { data: interfaces = [] } = useQuery({
    queryKey: ['interfaces'],
    queryFn: listInterfaces,
  })
  const { stats } = useWebSocket()

  // Build a map from client_id → live peer stats coming from the WebSocket.
  const peerMap = new Map(
    stats?.interfaces.flatMap((i) => i.peers ?? []).map((p) => [p.client_id, p]) ?? [],
  )

  // ── Bulk selection ──────────────────────────────────────────────────────────
  const [selected, setSelected] = useState<Set<number>>(new Set())

  const toggleSelect = (id: number) =>
    setSelected((prev) => {
      const s = new Set(prev)
      s.has(id) ? s.delete(id) : s.add(id)
      return s
    })

  const selectAll = () => setSelected(new Set(clients.map((c) => c.id)))
  const clearSelection = () => setSelected(new Set())

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['clients'] })
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="p-6 animate-pulse space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-20 bg-muted rounded-lg" />
        ))}
      </div>
    )
  }

  const title = ifaceId
    ? interfaces.find((i) => i.id === ifaceId)?.name ?? `Interface ${ifaceId}`
    : 'All clients'

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          {ifaceId && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate('/interfaces')}
              className="shrink-0"
              title="Back to interfaces"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
          )}
          <div>
            <h1 className="text-2xl font-bold">Clients</h1>
            <p className="text-muted-foreground text-sm mt-1">{title}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <CreateClientDialog
            interfaces={interfaces}
            defaultInterfaceId={ifaceId}
            onCreated={invalidate}
          />
        </div>
      </div>

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

      {selected.size > 0 && (
        <BulkBar
          selected={selected}
          totalCount={clients.length}
          onSelectAll={selectAll}
          onClearSelection={clearSelection}
        />
      )}
    </div>
  )
}
