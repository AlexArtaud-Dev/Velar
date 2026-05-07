import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Shield, Server, ChevronDown, RefreshCw, Plus, Trash2, AlertTriangle,
  Loader2, Check, ToggleLeft, ToggleRight,
} from 'lucide-react'
import { listInstances } from '@/api/instances'
import {
  getStatus, getStats, getFilteringStatus, setFilteringEnabled,
  addFilter, removeFilter, refreshFilters,
  getUserRules, setUserRules,
  getRewrites, addRewrite, deleteRewrite,
  setProtection,
  getSafeBrowsingStatus, setSafeBrowsing,
  getParentalStatus, setParental,
  getSafeSearchStatus, setSafeSearch,
  type AdguardSource, type SafeSearchSettings,
} from '@/api/adguard'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { useThemeStore } from '@/stores/theme'

type Tab = 'overview' | 'protection' | 'blocklists' | 'rules' | 'rewrites'

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview',   label: 'Overview'    },
  { id: 'protection', label: 'Protection'  },
  { id: 'blocklists', label: 'Blocklists'  },
  { id: 'rules',      label: 'Custom Rules'},
  { id: 'rewrites',   label: 'DNS Rewrites'},
]

export default function Adguard() {
  const { theme } = useThemeStore()
  const isCyber = theme === 'cyberpunk'
  const isApple = theme === 'apple'

  const [source, setSource] = useState<AdguardSource>(null)
  const [tab, setTab] = useState<Tab>('overview')

  const { data: instances = [] } = useQuery({
    queryKey: ['instances'],
    queryFn: listInstances,
  })

  const enabledSlaves = instances.filter((i) => i.adguard_enabled)
  const selectedInstance = source !== null ? instances.find((i) => i.id === source) : null
  const isSynced = selectedInstance?.adguard_sync_enabled === true
  const sourceName =
    source === null
      ? 'Master'
      : selectedInstance?.name ?? `Instance #${source}`

  const cardClass = cn(isApple && 'apple-glass', isCyber && 'cyber-card')
  const borderClass = isCyber ? 'border-[rgba(0,255,255,0.12)]' : 'border-border'

  return (
    <div className="p-4 sm:p-6 space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Shield className="h-5 w-5 text-muted-foreground shrink-0" />
          <div>
            <h1 className="text-2xl font-bold">AdGuard Home</h1>
            <p className="text-muted-foreground text-sm mt-0.5">DNS-level ad blocking and filtering</p>
          </div>
        </div>

        {/* Instance selector */}
        <div className="relative">
          <div className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center">
            {source === null
              ? <Shield className="h-3.5 w-3.5 text-muted-foreground" />
              : <Server className="h-3.5 w-3.5 text-muted-foreground" />}
          </div>
          <select
            value={source === null ? '__master__' : String(source)}
            onChange={(e) => setSource(e.target.value === '__master__' ? null : Number(e.target.value))}
            className={cn(
              'h-9 pl-7 pr-8 text-sm rounded-lg border bg-background text-foreground',
              'focus:outline-none focus:ring-2 focus:ring-primary/50 appearance-none cursor-pointer transition-colors',
              'hover:border-primary/50',
              isCyber ? 'border-[rgba(0,255,255,0.2)] hover:border-[rgba(0,255,255,0.5)] focus:ring-[rgba(0,255,255,0.3)]' : 'border-border',
            )}
          >
            <option value="__master__">Master</option>
            {enabledSlaves.length > 0 && (
              <optgroup label="Slaves">
                {enabledSlaves.map((i) => (
                  <option key={i.id} value={i.id}>{i.name}</option>
                ))}
              </optgroup>
            )}
          </select>
          <div className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center">
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className={cn('flex gap-1 border-b', borderClass)}>
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px',
              tab === t.id
                ? isCyber
                  ? 'border-[hsl(180,100%,50%)] text-[hsl(180,60%,85%)]'
                  : 'border-primary text-foreground'
                : cn('border-transparent text-muted-foreground hover:text-foreground', isCyber && 'hover:text-[hsl(180,60%,80%)]'),
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Sync banner */}
      {isSynced && (
        <div className={cn(
          'flex items-center gap-2.5 px-4 py-2.5 rounded-lg border text-sm',
          isCyber
            ? 'bg-[rgba(0,255,255,0.06)] border-[rgba(0,255,255,0.2)] text-[hsl(180,60%,70%)]'
            : 'bg-muted border-border text-muted-foreground',
        )}>
          <Shield className="h-4 w-4 shrink-0" />
          <span>
            <span className="font-semibold text-foreground">{sourceName}</span> is synced with master — settings are managed automatically and read-only here.
          </span>
        </div>
      )}

      {/* Tab content */}
      <div className={cn(isSynced && 'opacity-50 pointer-events-none select-none')}>
        {tab === 'overview'   && <OverviewTab    source={source} sourceName={sourceName} cardClass={cardClass} isCyber={isCyber} />}
        {tab === 'protection' && <ProtectionTab  source={source} cardClass={cardClass} isCyber={isCyber} borderClass={borderClass} />}
        {tab === 'blocklists' && <BlocklistsTab  source={source} cardClass={cardClass} isCyber={isCyber} borderClass={borderClass} />}
        {tab === 'rules'      && <RulesTab       source={source} cardClass={cardClass} isCyber={isCyber} />}
        {tab === 'rewrites'   && <RewritesTab    source={source} cardClass={cardClass} borderClass={borderClass} />}
      </div>
    </div>
  )
}

// ── Overview ──────────────────────────────────────────────────────────────────

function OverviewTab({ source, sourceName, cardClass, isCyber }: {
  source: AdguardSource; sourceName: string; cardClass: string; isCyber: boolean
}) {
  const qc = useQueryClient()
  const qk = ['adguard-status', source]
  const sqk = ['adguard-stats', source]

  const { data: status, isLoading: loadingStatus, refetch: refetchStatus } = useQuery({
    queryKey: qk,
    queryFn: () => getStatus(source),
    retry: 1,
  })
  const { data: stats, isLoading: loadingStats } = useQuery({
    queryKey: sqk,
    queryFn: () => getStats(source),
    retry: 1,
  })

  const protectionMut = useMutation({
    mutationFn: (enabled: boolean) => setProtection(source, enabled),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk }),
  })

  const blockedPct = stats && stats.num_dns_queries > 0
    ? ((stats.num_blocked_filtering / stats.num_dns_queries) * 100).toFixed(1)
    : '0.0'

  return (
    <div className="space-y-4">
      {/* Status card */}
      <Card className={cardClass}>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Shield className={cn('h-4 w-4', isCyber ? 'text-[hsl(180,100%,50%)]' : 'text-primary')} />
              Status — {sourceName}
            </CardTitle>
            <div className="flex items-center gap-2">
              {status && (
                <button
                  onClick={() => protectionMut.mutate(!status.protection_enabled)}
                  disabled={protectionMut.isPending}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border transition-colors',
                    status.protection_enabled
                      ? 'bg-green-500/10 border-green-500/30 text-green-600 dark:text-green-400 hover:bg-green-500/20'
                      : 'bg-red-500/10 border-red-500/30 text-red-500 hover:bg-red-500/20',
                  )}
                >
                  {protectionMut.isPending
                    ? <Loader2 className="h-3 w-3 animate-spin" />
                    : status.protection_enabled
                      ? <ToggleRight className="h-3.5 w-3.5" />
                      : <ToggleLeft className="h-3.5 w-3.5" />}
                  {status.protection_enabled ? 'Protection on' : 'Protection off'}
                </button>
              )}
              <Button variant="outline" size="sm" onClick={() => refetchStatus()} disabled={loadingStatus}>
                <RefreshCw className={cn('h-3.5 w-3.5 mr-1.5', loadingStatus && 'animate-spin')} />
                Refresh
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loadingStatus ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Fetching status…
            </div>
          ) : !status ? (
            <p className="text-sm text-destructive flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" /> Could not reach AdGuard
            </p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <StatCell label="Running"    value={status.running ? 'Yes' : 'No'} ok={status.running} isCyber={isCyber} />
              <StatCell label="Version"    value={status.version} isCyber={isCyber} />
              <StatCell label="DNS Port"   value={String(status.dns_port)} isCyber={isCyber} />
              <StatCell label="Query Log"  value={status.querylog_enabled ? 'Enabled' : 'Disabled'} isCyber={isCyber} />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Stats card */}
      <Card className={cardClass}>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">24h Statistics</CardTitle>
        </CardHeader>
        <CardContent>
          {loadingStats ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Fetching stats…
            </div>
          ) : !stats ? (
            <p className="text-sm text-destructive flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" /> Could not fetch stats
            </p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <StatCell label="DNS Queries"   value={stats.num_dns_queries.toLocaleString()} isCyber={isCyber} />
              <StatCell label="Blocked"       value={`${stats.num_blocked_filtering.toLocaleString()} (${blockedPct}%)`} ok={stats.num_blocked_filtering > 0} isCyber={isCyber} />
              <StatCell label="Safe Browsing" value={stats.num_replaced_safebrowsing.toLocaleString()} isCyber={isCyber} />
              <StatCell label="Avg Response"  value={`${(stats.avg_processing_time * 1000).toFixed(1)} ms`} isCyber={isCyber} />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// ── Protection ────────────────────────────────────────────────────────────────

const SAFE_SEARCH_ENGINES: { key: keyof SafeSearchSettings; label: string }[] = [
  { key: 'bing',       label: 'Bing'       },
  { key: 'duckduckgo', label: 'DuckDuckGo' },
  { key: 'ecosia',     label: 'Ecosia'     },
  { key: 'google',     label: 'Google'     },
  { key: 'pixabay',    label: 'Pixabay'    },
  { key: 'yandex',     label: 'Yandex'     },
  { key: 'youtube',    label: 'YouTube'    },
]

function ProtectionTab({ source, cardClass, isCyber, borderClass }: {
  source: AdguardSource; cardClass: string; isCyber: boolean; borderClass: string
}) {
  const qc = useQueryClient()

  const sbQk  = ['adguard-safebrowsing', source]
  const parQk = ['adguard-parental', source]
  const ssQk  = ['adguard-safesearch', source]

  const { data: sbData }  = useQuery({ queryKey: sbQk,  queryFn: () => getSafeBrowsingStatus(source), retry: 1 })
  const { data: parData } = useQuery({ queryKey: parQk, queryFn: () => getParentalStatus(source),     retry: 1 })
  const { data: ssData }  = useQuery({ queryKey: ssQk,  queryFn: () => getSafeSearchStatus(source),   retry: 1 })

  const sbMut = useMutation({
    mutationFn: (enabled: boolean) => setSafeBrowsing(source, enabled),
    onSuccess: () => qc.invalidateQueries({ queryKey: sbQk }),
  })
  const parMut = useMutation({
    mutationFn: (enabled: boolean) => setParental(source, enabled),
    onSuccess: () => qc.invalidateQueries({ queryKey: parQk }),
  })
  const ssMut = useMutation({
    mutationFn: (s: SafeSearchSettings) => setSafeSearch(source, s),
    onSuccess: () => qc.invalidateQueries({ queryKey: ssQk }),
  })

  function toggleEngine(key: keyof SafeSearchSettings) {
    if (!ssData) return
    const updated = { ...ssData, [key]: !ssData[key] }
    ssMut.mutate(updated)
  }

  return (
    <div className="space-y-4">
      {/* Safe browsing */}
      <Card className={cardClass}>
        <CardContent className="pt-4">
          <ProtectionRow
            title="Safe Browsing"
            description="Block domains known to host malware or phishing content using AdGuard's privacy-respecting lookup service."
            enabled={sbData?.enabled ?? false}
            loading={sbMut.isPending}
            onToggle={(v) => sbMut.mutate(v)}
            isCyber={isCyber}
          />
        </CardContent>
      </Card>

      {/* Parental control */}
      <Card className={cardClass}>
        <CardContent className="pt-4">
          <ProtectionRow
            title="Parental Control"
            description="Block adult content domains using AdGuard's parental control service."
            enabled={parData?.enabled ?? false}
            loading={parMut.isPending}
            onToggle={(v) => parMut.mutate(v)}
            isCyber={isCyber}
          />
        </CardContent>
      </Card>

      {/* Safe search */}
      <Card className={cardClass}>
        <CardContent className="pt-4 space-y-4">
          <ProtectionRow
            title="Safe Search"
            description="Force safe search mode on supported search engines."
            enabled={ssData?.enabled ?? false}
            loading={ssMut.isPending}
            onToggle={(v) => ssData && ssMut.mutate({ ...ssData, enabled: v })}
            isCyber={isCyber}
          />
          {ssData?.enabled && (
            <div className={cn('grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t', borderClass)}>
              {SAFE_SEARCH_ENGINES.map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => toggleEngine(key)}
                  disabled={ssMut.isPending}
                  className={cn(
                    'flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors',
                    ssData[key]
                      ? isCyber
                        ? 'bg-[rgba(0,255,255,0.1)] border-[rgba(0,255,255,0.3)] text-[hsl(180,80%,70%)]'
                        : 'bg-primary/10 border-primary/30 text-primary'
                      : 'bg-muted border-border text-muted-foreground hover:border-primary/30',
                  )}
                >
                  <span className={cn(
                    'h-1.5 w-1.5 rounded-full shrink-0',
                    ssData[key] ? (isCyber ? 'bg-[hsl(180,100%,50%)]' : 'bg-primary') : 'bg-muted-foreground/40',
                  )} />
                  {label}
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function ProtectionRow({ title, description, enabled, loading, onToggle, isCyber }: {
  title: string; description: string; enabled: boolean
  loading: boolean; onToggle: (v: boolean) => void; isCyber: boolean
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex-1">
        <p className="text-sm font-semibold">{title}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
      </div>
      <button
        onClick={() => onToggle(!enabled)}
        disabled={loading}
        className="shrink-0 mt-0.5"
      >
        {loading
          ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          : enabled
            ? <ToggleRight className={cn('h-6 w-6', isCyber ? 'text-[hsl(180,100%,50%)]' : 'text-green-500')} />
            : <ToggleLeft className="h-6 w-6 text-muted-foreground" />}
      </button>
    </div>
  )
}

// ── Blocklists ────────────────────────────────────────────────────────────────

function BlocklistsTab({ source, cardClass, isCyber, borderClass }: {
  source: AdguardSource; cardClass: string; isCyber: boolean; borderClass: string
}) {
  const qc = useQueryClient()
  const qk = ['adguard-filtering', source]

  const { data, isLoading } = useQuery({
    queryKey: qk,
    queryFn: () => getFilteringStatus(source),
    retry: 1,
  })

  const [addUrl, setAddUrl]   = useState('')
  const [addName, setAddName] = useState('')

  const toggleMut = useMutation({
    mutationFn: (enabled: boolean) => setFilteringEnabled(source, enabled),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk }),
  })

  const addMut = useMutation({
    mutationFn: () => addFilter(source, addUrl.trim(), addName.trim()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk })
      setAddUrl(''); setAddName('')
    },
  })

  const removeMut = useMutation({
    mutationFn: (url: string) => removeFilter(source, url),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk }),
  })

  const refreshMut = useMutation({
    mutationFn: () => refreshFilters(source),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk }),
  })

  return (
    <div className="space-y-4">
      <Card className={cardClass}>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-3">
              <CardTitle className="text-sm">Blocklists</CardTitle>
              {data && (
                <button
                  onClick={() => toggleMut.mutate(!data.enabled)}
                  disabled={toggleMut.isPending}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  {data.enabled
                    ? <ToggleRight className={cn('h-4 w-4', isCyber ? 'text-[hsl(180,100%,50%)]' : 'text-green-500')} />
                    : <ToggleLeft className="h-4 w-4" />}
                  {data.enabled ? 'Filtering on' : 'Filtering off'}
                </button>
              )}
            </div>
            <Button variant="outline" size="sm" onClick={() => refreshMut.mutate()} disabled={refreshMut.isPending}>
              <RefreshCw className={cn('h-3.5 w-3.5 mr-1.5', refreshMut.isPending && 'animate-spin')} />
              Refresh lists
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Add form */}
          <div className="flex gap-2 flex-wrap">
            <Input
              placeholder="List name"
              value={addName}
              onChange={(e) => setAddName(e.target.value)}
              className="flex-1 min-w-32 h-8 text-xs"
            />
            <Input
              placeholder="https://filters.example.com/list.txt"
              value={addUrl}
              onChange={(e) => setAddUrl(e.target.value)}
              className="flex-[2] min-w-48 h-8 text-xs font-mono"
            />
            <Button
              size="sm" className="h-8"
              disabled={!addUrl.trim() || !addName.trim() || addMut.isPending}
              onClick={() => addMut.mutate()}
            >
              {addMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              <span className="ml-1.5">Add</span>
            </Button>
          </div>
          {addMut.isError && (
            <p className="text-xs text-destructive">{(addMut.error as Error)?.message}</p>
          )}

          {/* List */}
          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : !data?.filters?.length ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No blocklists configured.</p>
          ) : (
            <div className={cn('divide-y rounded-lg border overflow-hidden', borderClass)}>
              {data.filters.map((f) => (
                <div key={f.id} className="flex items-center gap-3 px-3 py-2.5 hover:bg-muted/30 transition-colors">
                  <span className={cn(
                    'h-1.5 w-1.5 rounded-full shrink-0',
                    f.enabled ? (isCyber ? 'bg-[hsl(180,100%,50%)]' : 'bg-green-500') : 'bg-muted-foreground/40',
                  )} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{f.name}</p>
                    <p className="text-[11px] text-muted-foreground font-mono truncate">{f.url}</p>
                  </div>
                  <span className="text-[11px] text-muted-foreground shrink-0 tabular-nums">
                    {f.rules_count.toLocaleString()} rules
                  </span>
                  <button
                    onClick={() => removeMut.mutate(f.url)}
                    disabled={removeMut.isPending}
                    className="text-muted-foreground hover:text-destructive transition-colors shrink-0"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// ── Custom Rules ──────────────────────────────────────────────────────────────

function RulesTab({ source, cardClass, isCyber }: {
  source: AdguardSource; cardClass: string; isCyber: boolean
}) {
  const qc = useQueryClient()
  const qk = ['adguard-rules', source]

  const { data, isLoading } = useQuery({
    queryKey: qk,
    queryFn: () => getUserRules(source),
    retry: 1,
  })

  const [draft, setDraft] = useState<string | null>(null)
  const editing = draft !== null
  const rules = data?.rules ?? []

  const saveMut = useMutation({
    mutationFn: () => setUserRules(source, (draft ?? '').split('\n').filter(Boolean)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk })
      setDraft(null)
    },
  })

  return (
    <Card className={cardClass}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">Custom Filtering Rules</CardTitle>
          {!editing ? (
            <Button size="sm" variant="outline" onClick={() => setDraft(rules.join('\n'))}>
              Edit
            </Button>
          ) : (
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={saveMut.isPending}
                onClick={() => saveMut.mutate()}
              >
                {saveMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                <span className="ml-1.5">Save</span>
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>Cancel</Button>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : editing ? (
          <div className="space-y-2">
            <p className="text-[11px] text-muted-foreground">
              One rule per line. AdGuard syntax: <code className="bg-muted px-1 rounded">||example.com^</code> to block, <code className="bg-muted px-1 rounded">@@||example.com^</code> to allow.
            </p>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={14}
              className={cn(
                'w-full rounded-lg border text-xs font-mono p-3 resize-y bg-muted/50 focus:outline-none focus:ring-1 focus:ring-primary',
                isCyber ? 'border-[rgba(0,255,255,0.2)]' : 'border-border',
              )}
              placeholder="# Enter rules here..."
            />
            {saveMut.isError && (
              <p className="text-xs text-destructive">{(saveMut.error as Error)?.message}</p>
            )}
          </div>
        ) : rules.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">No custom rules defined.</p>
        ) : (
          <pre className={cn(
            'text-xs font-mono p-3 rounded-lg border overflow-x-auto leading-relaxed',
            isCyber ? 'bg-[rgba(0,255,255,0.04)] border-[rgba(0,255,255,0.12)] text-[hsl(180,60%,75%)]' : 'bg-muted border-border',
          )}>
            {rules.join('\n')}
          </pre>
        )}
      </CardContent>
    </Card>
  )
}

// ── DNS Rewrites ──────────────────────────────────────────────────────────────

function RewritesTab({ source, cardClass, borderClass }: {
  source: AdguardSource; cardClass: string; borderClass: string
}) {
  const qc = useQueryClient()
  const qk = ['adguard-rewrites', source]

  const { data, isLoading } = useQuery({
    queryKey: qk,
    queryFn: () => getRewrites(source),
    retry: 1,
  })

  const [domain, setDomain] = useState('')
  const [answer, setAnswer] = useState('')

  const addMut = useMutation({
    mutationFn: () => addRewrite(source, domain.trim(), answer.trim()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk })
      setDomain(''); setAnswer('')
    },
  })

  const deleteMut = useMutation({
    mutationFn: ({ d, a }: { d: string; a: string }) => deleteRewrite(source, d, a),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk }),
  })

  const rewrites = data?.rewrites ?? []

  return (
    <Card className={cardClass}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">DNS Rewrites</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Add form */}
        <div className="flex gap-2 flex-wrap">
          <div className="flex-1 min-w-36 space-y-1">
            <Label className="text-[11px]">Domain</Label>
            <Input
              placeholder="home.local"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              className="h-8 text-xs font-mono"
            />
          </div>
          <div className="flex-1 min-w-36 space-y-1">
            <Label className="text-[11px]">Answer (IP or domain)</Label>
            <Input
              placeholder="192.168.1.1"
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              className="h-8 text-xs font-mono"
            />
          </div>
          <div className="flex items-end">
            <Button
              size="sm" className="h-8"
              disabled={!domain.trim() || !answer.trim() || addMut.isPending}
              onClick={() => addMut.mutate()}
            >
              {addMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              <span className="ml-1.5">Add</span>
            </Button>
          </div>
        </div>
        {addMut.isError && (
          <p className="text-xs text-destructive">{(addMut.error as Error)?.message}</p>
        )}

        {/* Table */}
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : rewrites.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">No DNS rewrites configured.</p>
        ) : (
          <div className={cn('rounded-lg border overflow-hidden', borderClass)}>
            <div className="hidden sm:grid grid-cols-[1fr_1fr_2rem] gap-3 px-3 py-2 bg-muted/50 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground border-b">
              <span>Domain</span>
              <span>Answer</span>
              <span />
            </div>
            <div className="divide-y divide-border">
              {rewrites.map((r) => (
                <div key={`${r.domain}-${r.answer}`} className="grid sm:grid-cols-[1fr_1fr_2rem] gap-3 px-3 py-2.5 hover:bg-muted/30 transition-colors items-center">
                  <span className="text-sm font-mono truncate">{r.domain}</span>
                  <span className="text-sm font-mono text-muted-foreground truncate">{r.answer}</span>
                  <button
                    onClick={() => deleteMut.mutate({ d: r.domain, a: r.answer })}
                    disabled={deleteMut.isPending}
                    className="text-muted-foreground hover:text-destructive transition-colors justify-self-end"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function StatCell({ label, value, ok, isCyber }: {
  label: string; value: string; ok?: boolean; isCyber: boolean
}) {
  return (
    <div>
      <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">{label}</p>
      <p className={cn(
        'text-sm font-medium',
        ok === true  ? (isCyber ? 'text-[hsl(180,80%,65%)]' : 'text-green-600 dark:text-green-400') :
        ok === false ? 'text-destructive' : '',
      )}>
        {value}
      </p>
    </div>
  )
}
