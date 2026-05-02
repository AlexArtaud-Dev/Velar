import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Trash2, ToggleLeft, ToggleRight, Clock, Gauge, ArrowDown, ArrowUp, Link, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { enableClient, disableClient, deleteClient, type Client } from '@/api/clients'
import { type PeerStatOut } from '@/hooks/useWebSocket'
import { formatBytes, timeAgo } from '@/lib/utils'
import { cn } from '@/lib/utils'
import { useThemeStore } from '@/stores/theme'
import { ClientActionsMenu } from './ClientActionsMenu'
import { QuotaBar } from './QuotaBar'

interface ClientCardProps {
  client: Client
  peer?: PeerStatOut
  isSelected: boolean
  onToggleSelect: () => void
  onUpdated: () => void
  anySelected: boolean
}

export function ClientCard({
  client,
  peer,
  isSelected,
  onToggleSelect,
  onUpdated,
  anySelected,
}: ClientCardProps) {
  const qc = useQueryClient()
  const { theme } = useThemeStore()
  const [copied, setCopied] = useState(false)

  const isCyber   = theme === 'cyberpunk'
  const isApple   = theme === 'apple'
  const isOnline  = !!peer?.connected

  function copyPortalLink() {
    if (!client.view_token) return
    const url = `${window.location.origin}/portal/${client.view_token}`
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['clients'] })
    onUpdated()
  }

  const enableMut  = useMutation({ mutationFn: enableClient,  onSuccess: invalidate })
  const disableMut = useMutation({ mutationFn: disableClient, onSuccess: invalidate })
  const deleteMut  = useMutation({ mutationFn: deleteClient,  onSuccess: invalidate })

  const quotaSet        = client.data_quota_bytes > 0
  const hasBandwidthLimit = client.bandwidth_limit_down > 0 || client.bandwidth_limit_up > 0

  // Initials avatar
  const initials = client.name
    .split(/\s+/)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .slice(0, 2)
    .join('')

  return (
    <Card
      className={cn(
        'group/card transition-all duration-200',
        isSelected && 'ring-2 ring-primary bg-primary/5',
        isApple  && 'apple-glass hover:shadow-md',
        isCyber  && cn(
          'cyber-card',
          isOnline && 'border-[rgba(0,255,255,0.3)]',
        ),
        !isApple && !isCyber && 'hover:shadow-md',
      )}
    >
      <CardHeader className="pb-2">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">

          {/* Left: selector dot + avatar + name */}
          <div className="flex items-center gap-2.5">
            {/* Dot / checkbox hybrid */}
            <button
              onClick={onToggleSelect}
              className="relative h-4 w-4 shrink-0 flex items-center justify-center"
              aria-label="Select client"
            >
              <span className={cn(
                'absolute inset-0 flex items-center justify-center transition-opacity',
                isSelected || anySelected ? 'opacity-0' : 'opacity-100 group-hover/card:opacity-0',
              )}>
                <span className={cn(
                  'h-2.5 w-2.5 rounded-full transition-colors',
                  isOnline
                    ? isCyber
                      ? 'bg-[hsl(180,100%,50%)] shadow-[0_0_6px_rgba(0,255,255,0.6)]'
                      : 'bg-green-500'
                    : 'bg-muted-foreground/25',
                )} />
              </span>
              <span className={cn(
                'absolute inset-0 flex items-center justify-center transition-opacity',
                isSelected || anySelected ? 'opacity-100' : 'opacity-0 group-hover/card:opacity-100',
              )}>
                <span className={cn(
                  'h-4 w-4 rounded border-2 flex items-center justify-center transition-colors',
                  isSelected ? 'bg-primary border-primary' : 'border-muted-foreground/40 bg-background',
                )}>
                  {isSelected && (
                    <svg className="h-2.5 w-2.5 text-primary-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </span>
              </span>
            </button>

            {/* Initials avatar */}
            <div className={cn(
              'h-8 w-8 rounded-[calc(var(--radius)-2px)] flex items-center justify-center text-xs font-bold shrink-0 select-none',
              isOnline
                ? isCyber
                  ? 'bg-[rgba(0,255,255,0.12)] text-[hsl(180,100%,60%)] border border-[rgba(0,255,255,0.2)]'
                  : 'bg-green-500/10 text-green-700 dark:text-green-400'
                : isApple
                  ? 'bg-[rgba(0,122,255,0.08)] text-[hsl(211,100%,45%)]'
                  : 'bg-muted text-muted-foreground',
            )}>
              {initials || '?'}
            </div>

            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <CardTitle className="text-sm leading-none">{client.name}</CardTitle>
                {client.owner_label && (
                  <span className="text-xs text-muted-foreground">{client.owner_label}</span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-1.5 mt-1">
                {!client.enabled && <Badge variant="secondary" className="h-4 text-[10px] px-1.5">Disabled</Badge>}
                {client.quota_suspended && <Badge variant="destructive" className="h-4 text-[10px] px-1.5">Suspended</Badge>}
                {client.expires_at && (
                  <Badge variant="warning" className="h-4 text-[10px] px-1.5 gap-1">
                    <Clock className="h-2.5 w-2.5" />
                    {new Date(client.expires_at) > new Date()
                      ? `Expires ${new Date(client.expires_at).toLocaleDateString()}`
                      : 'Expired'}
                  </Badge>
                )}
              </div>
            </div>
          </div>

          {/* Right: action buttons */}
          <div className="flex items-center gap-1 ml-auto sm:ml-0">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              title="Copy portal link"
              onClick={copyPortalLink}
            >
              {copied
                ? <Check className="h-3.5 w-3.5 text-green-500" />
                : <Link className="h-3.5 w-3.5 text-muted-foreground" />}
            </Button>
            <ClientActionsMenu client={client} onUpdated={invalidate} />
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              title={client.enabled ? 'Disable' : 'Enable'}
              onClick={() => client.enabled ? disableMut.mutate(client.id) : enableMut.mutate(client.id)}
            >
              {client.enabled
                ? <ToggleRight className={cn('h-4 w-4', isCyber ? 'text-[hsl(180,100%,50%)]' : 'text-green-500')} />
                : <ToggleLeft  className="h-4 w-4 text-muted-foreground" />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              title="Delete"
              onClick={() => { if (confirm(`Delete ${client.name}?`)) deleteMut.mutate(client.id) }}
            >
              <Trash2 className="h-3.5 w-3.5 text-destructive" />
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-1">
        {/* Meta row */}
        <div className={cn(
          'flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground px-1 pb-2',
          isCyber && 'font-mono',
        )}>
          <span className={cn(
            'font-mono px-1.5 py-0.5 rounded text-xs',
            isCyber ? 'bg-[rgba(0,255,255,0.08)] text-[hsl(180,80%,65%)]' : 'bg-muted text-foreground/80',
          )}>
            {client.assigned_ip}
          </span>
          <span className="flex items-center gap-0.5">
            <ArrowDown className={cn('h-3 w-3', isCyber ? 'text-[hsl(180,100%,50%)]' : 'text-blue-500')} />
            {formatBytes(peer?.bytes_rx ?? client.bytes_rx)}
          </span>
          <span className="flex items-center gap-0.5">
            <ArrowUp className={cn('h-3 w-3', isCyber ? 'text-[hsl(300,100%,55%)]' : 'text-emerald-500')} />
            {formatBytes(peer?.bytes_tx ?? client.bytes_tx)}
          </span>
          <span>{peer?.last_handshake ? timeAgo(peer.last_handshake) : '—'}</span>
          {hasBandwidthLimit && (
            <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
              <Gauge className="h-3 w-3" />
              {client.bandwidth_limit_down > 0 && (
                <span className="flex items-center gap-0.5">
                  <ArrowDown className="h-2.5 w-2.5" />{client.bandwidth_limit_down}
                </span>
              )}
              {client.bandwidth_limit_down > 0 && client.bandwidth_limit_up > 0 && <span>/</span>}
              {client.bandwidth_limit_up > 0 && (
                <span className="flex items-center gap-0.5">
                  <ArrowUp className="h-2.5 w-2.5" />{client.bandwidth_limit_up}
                </span>
              )}
              <span>Mbps</span>
            </span>
          )}
          {client.email && (
            <span className="font-mono truncate max-w-[14rem]">{client.email}</span>
          )}
        </div>

        {quotaSet && <QuotaBar client={client} />}
      </CardContent>
    </Card>
  )
}
