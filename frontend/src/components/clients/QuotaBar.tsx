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
 *
 * Display logic:
 * - If client.quota_suspended is true the bar immediately shows "Exceeded"
 *   (full red, no API round-trip needed) — the client list already carries
 *   this flag and refreshes every 10 s, so the bar updates the moment the
 *   quota job suspends the peer.
 * - Otherwise it fetches the accurate period usage from /quota-usage (every
 *   15 s) to show a live byte counter and progress percentage.
 */
export function QuotaBar({ client }: QuotaBarProps) {
  const { data } = useQuery({
    queryKey: ['client-quota-usage', client.id],
    queryFn: () => getClientQuotaUsage(client.id),
    // Skip the fetch entirely when we already know from the client record that
    // the quota has been exceeded — the flag is the source of truth here.
    enabled: !client.quota_suspended,
    refetchInterval: 15_000,
    staleTime: 0,
  })

  const quota = client.data_quota_bytes
  const period = data?.period ?? client.quota_period ?? 'monthly'

  // When suspended: derive display values from the client record itself so the
  // bar goes red immediately without waiting for the next API poll.
  const exceeded = client.quota_suspended
  const used = exceeded ? (data?.used ?? quota) : (data?.used ?? 0)
  const pct = exceeded ? 100 : quota > 0 ? Math.min(100, Math.round((used / quota) * 100)) : 0
  const color = exceeded || pct >= 100 ? 'bg-red-500' : pct >= 80 ? 'bg-amber-500' : 'bg-blue-500'

  return (
    <div className="mt-2.5 space-y-1">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <DatabaseZap className={`h-3 w-3 ${exceeded ? 'text-red-500' : ''}`} />
          Quota ({period})
          {exceeded && (
            <span className="ml-1 text-red-500 font-medium">— Exceeded</span>
          )}
        </span>
        <span className={exceeded ? 'text-red-500 font-medium' : ''}>
          {formatBytes(used)} / {formatBytes(quota)} ({pct}%)
        </span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}
