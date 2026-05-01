import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Trash2, ToggleLeft, ToggleRight, Clock, Gauge, ArrowDown, ArrowUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { enableClient, disableClient, deleteClient, type Client } from '@/api/clients'
import { type PeerStatOut } from '@/hooks/useWebSocket'
import { formatBytes, timeAgo } from '@/lib/utils'
import { ClientActionsMenu } from './ClientActionsMenu'
import { QuotaBar } from './QuotaBar'

interface ClientCardProps {
  /** Client data from the API. */
  client: Client
  /** Live peer stats from the WebSocket feed, if available. */
  peer?: PeerStatOut
  /** Whether this card is currently selected for bulk operations. */
  isSelected: boolean
  /** Toggles the selection state of this card. */
  onToggleSelect: () => void
  /** Called after any mutation that modifies the client list. */
  onUpdated: () => void
  /** Whether any card in the list is selected (controls dot vs checkbox visibility). */
  anySelected: boolean
}

/**
 * ClientCard renders a single client row with status indicators, live stats,
 * a dot/checkbox hybrid selector, and the actions dropdown.
 */
export function ClientCard({
  client,
  peer,
  isSelected,
  onToggleSelect,
  onUpdated,
  anySelected,
}: ClientCardProps) {
  const qc = useQueryClient()

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['clients'] })
    onUpdated()
  }

  const enableMut = useMutation({ mutationFn: enableClient, onSuccess: invalidate })
  const disableMut = useMutation({ mutationFn: disableClient, onSuccess: invalidate })
  const deleteMut = useMutation({ mutationFn: deleteClient, onSuccess: invalidate })

  const quotaSet = client.data_quota_bytes > 0
  const hasBandwidthLimit =
    client.bandwidth_limit_down > 0 || client.bandwidth_limit_up > 0

  return (
    <Card
      className={`group/card transition-colors ${
        isSelected ? 'ring-2 ring-primary bg-primary/5' : ''
      }`}
    >
      <CardHeader className="pb-2">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {/* Dot / checkbox hybrid — hover reveals checkbox, dot shows when idle */}
            <button
              onClick={onToggleSelect}
              className="relative h-4 w-4 shrink-0 flex items-center justify-center"
              aria-label="Select client"
            >
              {/* Status dot — hidden on hover or when any card is selected */}
              <span
                className={`absolute inset-0 flex items-center justify-center transition-opacity
                  ${isSelected || anySelected
                    ? 'opacity-0'
                    : 'opacity-100 group-hover/card:opacity-0'}`}
              >
                <span
                  className={`h-2.5 w-2.5 rounded-full ${
                    peer?.connected ? 'bg-green-500' : 'bg-muted-foreground/30'
                  }`}
                />
              </span>
              {/* Checkbox — visible on hover or when any card is selected */}
              <span
                className={`absolute inset-0 flex items-center justify-center transition-opacity
                  ${isSelected || anySelected
                    ? 'opacity-100'
                    : 'opacity-0 group-hover/card:opacity-100'}`}
              >
                <span
                  className={`h-4 w-4 rounded border-2 flex items-center justify-center transition-colors
                    ${isSelected
                      ? 'bg-primary border-primary'
                      : 'border-muted-foreground/40 bg-background'}`}
                >
                  {isSelected && (
                    <svg
                      className="h-2.5 w-2.5 text-primary-foreground"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={3}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                  )}
                </span>
              </span>
            </button>

            <CardTitle className="text-base">{client.name}</CardTitle>
            {client.owner_label && (
              <span className="text-xs text-muted-foreground">{client.owner_label}</span>
            )}
            {!client.enabled && <Badge variant="secondary">Disabled</Badge>}
            {client.expires_at && (
              <Badge variant="warning" className="gap-1">
                <Clock className="h-3 w-3" />
                {new Date(client.expires_at) > new Date()
                  ? `Expires ${new Date(client.expires_at).toLocaleDateString()}`
                  : 'Expired'}
              </Badge>
            )}
          </div>

          <div className="flex items-center gap-1">
            <ClientActionsMenu client={client} onUpdated={invalidate} />
            <Button
              variant="ghost"
              size="icon"
              title={client.enabled ? 'Disable' : 'Enable'}
              onClick={() =>
                client.enabled
                  ? disableMut.mutate(client.id)
                  : enableMut.mutate(client.id)
              }
            >
              {client.enabled
                ? <ToggleRight className="h-4 w-4 text-green-500" />
                : <ToggleLeft className="h-4 w-4 text-muted-foreground" />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              title="Delete"
              onClick={() => {
                if (confirm(`Delete ${client.name}?`)) deleteMut.mutate(client.id)
              }}
            >
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent>
        <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
          <span className="font-mono">{client.assigned_ip}</span>
          <span>↓ {formatBytes(peer?.bytes_rx ?? client.bytes_rx)}</span>
          <span>↑ {formatBytes(peer?.bytes_tx ?? client.bytes_tx)}</span>
          <span>Last seen: {peer?.last_handshake ? timeAgo(peer.last_handshake) : '—'}</span>
          {hasBandwidthLimit && (
            <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
              <Gauge className="h-3 w-3" />
              {client.bandwidth_limit_down > 0 && (
                <span className="flex items-center gap-0.5">
                  <ArrowDown className="h-2.5 w-2.5" />
                  {client.bandwidth_limit_down}
                </span>
              )}
              {client.bandwidth_limit_down > 0 && client.bandwidth_limit_up > 0 && (
                <span>/</span>
              )}
              {client.bandwidth_limit_up > 0 && (
                <span className="flex items-center gap-0.5">
                  <ArrowUp className="h-2.5 w-2.5" />
                  {client.bandwidth_limit_up}
                </span>
              )}
              <span>Mbps</span>
            </span>
          )}
          {client.email && <span className="font-mono">{client.email}</span>}
        </div>

        {quotaSet && <QuotaBar client={client} />}
      </CardContent>
    </Card>
  )
}
