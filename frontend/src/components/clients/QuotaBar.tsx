import { useQuery } from '@tanstack/react-query'
import { DatabaseZap } from 'lucide-react'
import { getClientSnapshots, type Client } from '@/api/clients'
import { formatBytes } from '@/lib/utils'

interface QuotaBarProps {
  /** Client whose quota progress to display. Must have data_quota_bytes > 0. */
  client: Client
}

/** QuotaBar renders an inline data-usage progress bar inside a client card. */
export function QuotaBar({ client }: QuotaBarProps) {
  const { data: snapshots = [] } = useQuery({
    queryKey: ['client-snapshots-quota', client.id],
    queryFn: () => {
      const period = client.quota_period ?? 'monthly'
      const range = period === 'weekly' || period === 'total' ? '7d' : '24h'
      return getClientSnapshots(client.id, range)
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  })

  // Compute effective period start — natural start or manual reset, whichever is later.
  const periodStart = (() => {
    const now = new Date()
    let natural: Date
    if (client.quota_period === 'weekly') {
      const day = now.getDay() === 0 ? 6 : now.getDay() - 1
      const d = new Date(now)
      d.setDate(d.getDate() - day)
      d.setHours(0, 0, 0, 0)
      natural = d
    } else if (client.quota_period === 'total') {
      natural = new Date(0)
    } else {
      natural = new Date(now.getFullYear(), now.getMonth(), 1)
    }
    if (client.quota_reset_at) {
      const reset = new Date(client.quota_reset_at)
      return reset > natural ? reset : natural
    }
    return natural
  })()

  const used = snapshots
    .filter((s) => new Date(s.timestamp) >= periodStart)
    .reduce((acc, s) => acc + s.bytes_rx + s.bytes_tx, 0)

  const quota = client.data_quota_bytes
  const pct = Math.min(100, Math.round((used / quota) * 100))
  const color = pct >= 100 ? 'bg-red-500' : pct >= 80 ? 'bg-amber-500' : 'bg-blue-500'

  return (
    <div className="mt-2.5 space-y-1">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <DatabaseZap className="h-3 w-3" />
          Quota ({client.quota_period})
        </span>
        <span>
          {formatBytes(used)} / {formatBytes(quota)} ({pct}%)
        </span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}
