import { useQuery } from '@tanstack/react-query'
import { DatabaseZap } from 'lucide-react'
import { getClientQuotaUsage, type Client } from '@/api/clients'
import { formatBytes } from '@/lib/utils'

interface QuotaBarProps {
  /** Client whose quota progress to display. Must have data_quota_bytes > 0. */
  client: Client
}

/**
 * QuotaBar renders an inline data-usage progress bar inside a client card.
 * It fetches usage from the dedicated quota-usage endpoint, which mirrors the
 * quota job's DB query exactly — giving an accurate count for the full current
 * period regardless of snapshot retention limits.
 */
export function QuotaBar({ client }: QuotaBarProps) {
  const { data } = useQuery({
    queryKey: ['client-quota-usage', client.id],
    queryFn: () => getClientQuotaUsage(client.id),
    refetchInterval: 60_000,
    staleTime: 30_000,
  })

  const used = data?.used ?? 0
  const quota = client.data_quota_bytes
  const period = data?.period ?? client.quota_period ?? 'monthly'
  const pct = quota > 0 ? Math.min(100, Math.round((used / quota) * 100)) : 0
  const color = pct >= 100 ? 'bg-red-500' : pct >= 80 ? 'bg-amber-500' : 'bg-blue-500'

  return (
    <div className="mt-2.5 space-y-1">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <DatabaseZap className="h-3 w-3" />
          Quota ({period})
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
