import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ClipboardList, ChevronLeft, ChevronRight, Search } from 'lucide-react'
import { listAuditLogs, type AuditLog } from '@/api/audit'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const LIMIT = 50

// ── Action badge colour ───────────────────────────────────────────────────────
function actionVariant(action: string): string {
  if (action.endsWith('.create'))   return 'bg-green-500/15 text-green-400 border-green-500/30'
  if (action.endsWith('.delete'))   return 'bg-red-500/15 text-red-400 border-red-500/30'
  if (action.endsWith('.enable'))   return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
  if (action.endsWith('.disable'))  return 'bg-amber-500/15 text-amber-400 border-amber-500/30'
  if (action.endsWith('.update'))   return 'bg-blue-500/15 text-blue-400 border-blue-500/30'
  if (action.startsWith('admin.'))  return 'bg-purple-500/15 text-purple-400 border-purple-500/30'
  return 'bg-muted text-muted-foreground border-border'
}

// Pretty-print an action string: "client.create" → "Create"
function actionLabel(action: string): string {
  const parts = action.split('.')
  const verb = parts[parts.length - 1]
  return verb.charAt(0).toUpperCase() + verb.slice(1)
}

// Target type badge
function targetBadge(type: string): string {
  switch (type) {
    case 'client':    return 'bg-sky-500/10 text-sky-400'
    case 'interface': return 'bg-violet-500/10 text-violet-400'
    case 'admin':     return 'bg-rose-500/10 text-rose-400'
    default:          return 'bg-muted text-muted-foreground'
  }
}

// Relative + absolute time
function fmtTime(iso: string): { rel: string; abs: string } {
  const d = new Date(iso)
  const diff = Date.now() - d.getTime()
  const sec = Math.floor(diff / 1000)
  const min = Math.floor(sec / 60)
  const hr  = Math.floor(min / 60)
  const day = Math.floor(hr / 24)
  let rel: string
  if (sec < 60)       rel = `${sec}s ago`
  else if (min < 60)  rel = `${min}m ago`
  else if (hr < 24)   rel = `${hr}h ago`
  else                rel = `${day}d ago`
  const abs = d.toLocaleString()
  return { rel, abs }
}

// ── Category filter tabs ──────────────────────────────────────────────────────
const CATEGORIES: { label: string; prefix: string }[] = [
  { label: 'All',        prefix: '' },
  { label: 'Clients',    prefix: 'client.' },
  { label: 'Interfaces', prefix: 'interface.' },
  { label: 'Admin',      prefix: 'admin.' },
]

/** Audit Log page */
export default function Audit() {
  const [page, setPage]         = useState(1)
  const [category, setCategory] = useState('')
  const [search, setSearch]     = useState('')

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['audit', page],
    queryFn: () => listAuditLogs({ page, limit: LIMIT }),
    placeholderData: (prev) => prev,
  })

  const items: AuditLog[] = data?.items ?? []
  const total = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / LIMIT))

  // Client-side category + text filter (applied to the current page slice)
  const filtered = items.filter((log) => {
    if (category && !log.action.startsWith(category)) return false
    if (search) {
      const q = search.toLowerCase()
      if (
        !log.action.toLowerCase().includes(q) &&
        !log.target_name.toLowerCase().includes(q) &&
        !log.target_type.toLowerCase().includes(q) &&
        !log.detail.toLowerCase().includes(q)
      ) return false
    }
    return true
  })

  function handleCategoryChange(prefix: string) {
    setCategory(prefix)
    setSearch('')
    setPage(1)
  }

  return (
    <div className="p-4 sm:p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <ClipboardList className="h-5 w-5 text-muted-foreground shrink-0" />
        <div>
          <h1 className="text-2xl font-bold">Audit Log</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Admin-initiated changes, newest first
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Category pills */}
        <div className="flex flex-wrap gap-1.5">
          {CATEGORIES.map((c) => (
            <button
              key={c.label}
              onClick={() => handleCategoryChange(c.prefix)}
              className={cn(
                'px-3 py-1.5 rounded-full text-xs font-medium border transition-colors',
                category === c.prefix
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-muted text-muted-foreground border-border hover:border-primary hover:text-foreground',
              )}
            >
              {c.label}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            placeholder="Search current page…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg bg-muted border border-border focus:outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground/60"
          />
        </div>
      </div>

      {/* Table */}
      <div className="rounded-lg border border-border overflow-hidden">
        {/* Table header */}
        <div className="hidden sm:grid grid-cols-[7rem_8rem_1fr_1fr_2fr] gap-3 px-4 py-2.5 bg-muted/50 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground border-b border-border">
          <span>Time</span>
          <span>Action</span>
          <span>Type</span>
          <span>Target</span>
          <span>Detail</span>
        </div>

        {isLoading ? (
          <div className="space-y-px">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-12 bg-muted/30 animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center text-muted-foreground text-sm">
            No audit entries found.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {filtered.map((log) => {
              const { rel, abs } = fmtTime(log.created_at)
              return (
                <div
                  key={log.id}
                  className="grid sm:grid-cols-[7rem_8rem_1fr_1fr_2fr] gap-x-3 gap-y-0.5 px-4 py-2.5 text-sm hover:bg-muted/30 transition-colors"
                >
                  {/* Time */}
                  <span
                    title={abs}
                    className="text-muted-foreground text-xs font-mono tabular-nums self-center shrink-0"
                  >
                    {rel}
                  </span>

                  {/* Action badge */}
                  <span className="self-center">
                    <span
                      className={cn(
                        'inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold border',
                        actionVariant(log.action),
                      )}
                    >
                      {actionLabel(log.action)}
                    </span>
                  </span>

                  {/* Target type */}
                  <span className="self-center">
                    <span
                      className={cn(
                        'inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium capitalize',
                        targetBadge(log.target_type),
                      )}
                    >
                      {log.target_type}
                    </span>
                  </span>

                  {/* Target name */}
                  <span className="self-center text-xs font-medium truncate" title={log.target_name}>
                    {log.target_name || <span className="text-muted-foreground/50">—</span>}
                  </span>

                  {/* Detail */}
                  <span
                    className="self-center text-xs text-muted-foreground truncate font-mono"
                    title={log.detail}
                  >
                    {log.detail || <span className="opacity-40">—</span>}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between gap-4">
        <span className="text-xs text-muted-foreground">
          {total} entr{total !== 1 ? 'ies' : 'y'} total
          {isFetching && !isLoading && (
            <span className="ml-2 opacity-60">Refreshing…</span>
          )}
        </span>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            className="h-8 w-8 p-0"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-xs text-muted-foreground tabular-nums">
            {page} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
            className="h-8 w-8 p-0"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}
