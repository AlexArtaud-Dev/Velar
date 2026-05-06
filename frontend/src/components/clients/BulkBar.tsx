import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ToggleRight, ToggleLeft, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { bulkEnableClients, bulkDisableClients, bulkDeleteClients } from '@/api/clients'
import { proxyToInstance } from '@/api/instances'

interface BulkBarProps {
  /** IDs currently selected by the user. */
  selected: Set<number>
  /** Total number of clients in the list (used for "select all" label). */
  totalCount: number
  onSelectAll: () => void
  onClearSelection: () => void
  /** When set, all bulk calls are proxied through this slave instance. */
  instanceId?: number
}

/**
 * BulkBar is a floating action bar that appears when one or more clients are
 * selected. It provides bulk enable / disable / delete operations.
 * Supports both local and slave instances via the optional instanceId prop.
 */
export function BulkBar({ selected, totalCount, onSelectAll, onClearSelection, instanceId }: BulkBarProps) {
  const qc = useQueryClient()

  function onSuccess() {
    onClearSelection()
    if (instanceId) {
      qc.invalidateQueries({ queryKey: ['slave-clients', instanceId] })
    } else {
      qc.invalidateQueries({ queryKey: ['clients'] })
    }
  }

  const bulkEnableMut = useMutation({
    mutationFn: async () => {
      if (instanceId) {
        await proxyToInstance(instanceId, 'POST', '/api/v1/clients/bulk/enable', { ids: [...selected] })
      } else {
        await bulkEnableClients([...selected])
      }
    },
    onSuccess,
  })
  const bulkDisableMut = useMutation({
    mutationFn: async () => {
      if (instanceId) {
        await proxyToInstance(instanceId, 'POST', '/api/v1/clients/bulk/disable', { ids: [...selected] })
      } else {
        await bulkDisableClients([...selected])
      }
    },
    onSuccess,
  })
  const bulkDeleteMut = useMutation({
    mutationFn: async () => {
      if (instanceId) {
        await proxyToInstance(instanceId, 'POST', '/api/v1/clients/bulk/delete', { ids: [...selected] })
      } else {
        await bulkDeleteClients([...selected])
      }
    },
    onSuccess,
  })

  return (
    <div className="fixed bottom-4 max-lg:bottom-18 left-1/2 -translate-x-1/2 z-50 flex items-center gap-1.5 bg-card border border-border rounded-xl shadow-2xl px-3 py-2">
      <span className="text-xs font-medium text-muted-foreground px-1 mr-1">
        {selected.size} / {totalCount}
      </span>
      <div className="h-4 w-px bg-border mx-0.5" />
      <Button
        size="sm"
        variant="ghost"
        className="text-xs h-7 px-2.5"
        onClick={selected.size === totalCount ? onClearSelection : onSelectAll}
      >
        {selected.size === totalCount ? 'Deselect all' : 'Select all'}
      </Button>
      <div className="h-4 w-px bg-border mx-0.5" />
      <Button
        size="sm"
        variant="ghost"
        disabled={bulkEnableMut.isPending}
        onClick={() => bulkEnableMut.mutate()}
        className="gap-1.5 h-7 px-2.5 text-xs text-green-500 hover:text-green-400"
      >
        <ToggleRight className="h-3.5 w-3.5" /> Enable
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={bulkDisableMut.isPending}
        onClick={() => bulkDisableMut.mutate()}
        className="gap-1.5 h-7 px-2.5 text-xs"
      >
        <ToggleLeft className="h-3.5 w-3.5" /> Disable
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={bulkDeleteMut.isPending}
        onClick={() => {
          if (confirm(`Delete ${selected.size} client(s)?`)) bulkDeleteMut.mutate()
        }}
        className="gap-1.5 h-7 px-2.5 text-xs text-destructive hover:text-destructive"
      >
        <Trash2 className="h-3.5 w-3.5" /> Delete
      </Button>
      <div className="h-4 w-px bg-border mx-0.5" />
      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onClearSelection}>
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  )
}
