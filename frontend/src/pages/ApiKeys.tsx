import { useState, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Key, Plus, Trash2, Copy, Check, AlertTriangle, Clock,
  ChevronRight, Play, Loader2, TriangleAlert,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { listTokens, createToken, deleteToken, type PAT, type CreatedPAT } from '@/api/tokens'
import { useThemeStore } from '@/stores/theme'
import { cn } from '@/lib/utils'

// ── API endpoint definitions ──────────────────────────────────────────────────

type HttpMethod = 'GET' | 'POST' | 'DELETE'

interface QueryParam {
  name: string
  type: 'string' | 'integer'
  required: boolean
  default?: string
  description: string
  options?: string[]
}

interface HeaderParam {
  name: string
  required: boolean
  default: string
  description: string
  options?: string[]
}

interface EndpointDef {
  id: string
  method: HttpMethod
  path: string
  name: string
  category: string
  description: string
  auth: string
  queryParams: QueryParam[]
  headers: HeaderParam[]
}

const ENDPOINTS: EndpointDef[] = [
  {
    id: 'metrics',
    method: 'GET',
    path: '/api/v1/metrics',
    name: 'Metrics',
    category: 'Monitoring',
    description:
      'Returns server and peer metrics. Cached for 60 seconds server-side. ' +
      'Use the Accept header to choose between Prometheus text format (default, for Grafana / Prometheus scraper) ' +
      'or JSON (for dashboards and scripts).',
    auth: 'JWT or PAT',
    queryParams: [],
    headers: [
      {
        name: 'Accept',
        required: false,
        default: 'text/plain',
        description: 'Response format.',
        options: ['text/plain', 'application/json'],
      },
    ],
  },
  {
    id: 'audit',
    method: 'GET',
    path: '/api/v1/audit',
    name: 'Audit Logs',
    category: 'Monitoring',
    description:
      'Returns a paginated list of admin mutation events (client create/delete, ' +
      'enable/disable, quota reset, interface create/delete). Entries are pruned after 90 days.',
    auth: 'JWT or PAT',
    queryParams: [
      {
        name: 'page',
        type: 'integer',
        required: false,
        default: '1',
        description: 'Page number (1-based).',
      },
      {
        name: 'limit',
        type: 'integer',
        required: false,
        default: '50',
        description: 'Items per page. Maximum 200.',
      },
      {
        name: 'action',
        type: 'string',
        required: false,
        default: '',
        description: 'Filter by action type.',
        options: [
          '',
          'client.create',
          'client.delete',
          'client.enable',
          'client.disable',
          'client.quota_reset',
          'interface.create',
          'interface.delete',
        ],
      },
    ],
    headers: [],
  },
]

const METHOD_COLORS: Record<HttpMethod, string> = {
  GET:    'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20',
  POST:   'bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20',
  DELETE: 'bg-red-500/10 text-red-500 border-red-500/20',
}

// ── Main page ─────────────────────────────────────────────────────────────────

type View = 'tokens' | `endpoint:${string}`

export default function ApiKeys() {
  const { theme } = useThemeStore()
  const isCyber = theme === 'cyberpunk'
  const isApple = theme === 'apple'
  const [view, setView] = useState<View>('tokens')

  const { data: tokens = [] } = useQuery({ queryKey: ['tokens'], queryFn: listTokens })

  const borderClass = isCyber ? 'border-[rgba(0,255,255,0.12)]' : 'border-border'

  return (
    <div className="flex" style={{ minHeight: 'calc(100vh - 57px)' }}>

      {/* ── Left sidebar ── */}
      <aside className={cn(
        'w-52 shrink-0 border-r flex flex-col sticky top-0 overflow-y-auto',
        'max-h-[calc(100vh-57px)]',
        borderClass,
        isApple && 'apple-glass',
        isCyber && 'bg-[rgba(7,12,23,0.8)]',
      )}>

        {/* Token section */}
        <div className="px-3 pt-4 pb-1">
          <span className={cn(
            'text-[10px] font-semibold uppercase tracking-widest',
            isCyber ? 'text-[hsl(180,60%,45%)]' : 'text-muted-foreground',
          )}>
            API Keys
          </span>
        </div>

        <button
          onClick={() => setView('tokens')}
          className={cn(
            'mx-2 mb-1 flex items-center gap-2 px-2.5 py-2 rounded-[var(--radius)] text-sm font-medium transition-colors text-left',
            view === 'tokens'
              ? isCyber
                ? 'bg-[rgba(0,255,255,0.1)] text-[hsl(180,80%,70%)]'
                : 'bg-accent text-foreground'
              : 'text-muted-foreground hover:text-foreground hover:bg-accent/50',
          )}
        >
          <Key className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">Manage tokens</span>
        </button>

        {/* Token list (compact) */}
        {tokens.length > 0 && (
          <div className="px-3 pb-2 space-y-0.5">
            {tokens.map((t) => (
              <div key={t.id} className="flex items-center gap-1.5 text-xs text-muted-foreground py-0.5 pl-1">
                <span className={cn(
                  'h-1.5 w-1.5 rounded-full shrink-0',
                  t.expires_at && new Date(t.expires_at) < new Date()
                    ? 'bg-red-400'
                    : isCyber ? 'bg-[hsl(180,100%,50%)]' : 'bg-green-500',
                )} />
                <span className="truncate">{t.name}</span>
              </div>
            ))}
          </div>
        )}

        <div className={cn('mx-3 my-3 border-t', borderClass)} />

        {/* Reference section */}
        <div className="px-3 pb-1">
          <span className={cn(
            'text-[10px] font-semibold uppercase tracking-widest',
            isCyber ? 'text-[hsl(180,60%,45%)]' : 'text-muted-foreground',
          )}>
            API Reference
          </span>
        </div>

        {Object.entries(
          ENDPOINTS.reduce<Record<string, EndpointDef[]>>((acc, e) => {
            ;(acc[e.category] ??= []).push(e)
            return acc
          }, {}),
        ).map(([cat, eps]) => (
          <div key={cat} className="mb-2">
            <div className={cn('px-4 py-0.5 text-[10px]', isCyber ? 'text-[hsl(180,40%,40%)]' : 'text-muted-foreground/60')}>
              {cat}
            </div>
            {eps.map((ep) => {
              const active = view === `endpoint:${ep.id}`
              return (
                <button
                  key={ep.id}
                  onClick={() => setView(`endpoint:${ep.id}`)}
                  className={cn(
                    'mx-2 mb-0.5 w-[calc(100%-16px)] flex items-center gap-2 px-2.5 py-1.5 rounded-[var(--radius)] text-xs transition-colors text-left',
                    active
                      ? isCyber
                        ? 'bg-[rgba(0,255,255,0.1)] text-[hsl(180,80%,70%)]'
                        : 'bg-accent text-foreground'
                      : 'text-muted-foreground hover:text-foreground hover:bg-accent/50',
                  )}
                >
                  <span className={cn(
                    'shrink-0 font-mono text-[9px] font-bold px-1 py-0.5 rounded border',
                    METHOD_COLORS[ep.method],
                  )}>
                    {ep.method}
                  </span>
                  <span className="truncate">{ep.name}</span>
                  {active && <ChevronRight className="h-3 w-3 ml-auto shrink-0 opacity-60" />}
                </button>
              )
            })}
          </div>
        ))}

        <div className="flex-1" />
      </aside>

      {/* ── Main content ── */}
      <main className="flex-1 overflow-y-auto">
        {view === 'tokens' && <TokenManager tokens={tokens} theme={theme} />}
        {ENDPOINTS.map((ep) =>
          view === `endpoint:${ep.id}`
            ? <EndpointDocs key={ep.id} endpoint={ep} tokens={tokens} theme={theme} />
            : null,
        )}
      </main>
    </div>
  )
}

// ── Token manager ─────────────────────────────────────────────────────────────

function TokenManager({ tokens, theme }: { tokens: PAT[]; theme: string }) {
  const qc = useQueryClient()
  const isCyber = theme === 'cyberpunk'
  const isApple = theme === 'apple'

  const [showForm, setShowForm] = useState(false)
  const [name, setName]         = useState('')
  const [expiresAt, setExpiresAt] = useState('')
  const [newToken, setNewToken]   = useState<CreatedPAT | null>(null)
  const [copied, setCopied]       = useState(false)

  const createMut = useMutation({
    mutationFn: () => createToken(name.trim(), expiresAt || null),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['tokens'] })
      setNewToken(data)
      setName('')
      setExpiresAt('')
      setShowForm(false)
    },
  })
  const deleteMut = useMutation({
    mutationFn: deleteToken,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tokens'] }),
  })

  function copy(token: string) {
    navigator.clipboard.writeText(token).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const cardClass = cn(isApple && 'apple-glass', isCyber && 'cyber-card')

  return (
    <div className="p-6 space-y-5 max-w-2xl">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold">API Keys</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Personal access tokens for programmatic API access
          </p>
        </div>
        <Button size="sm" onClick={() => { setShowForm(true); setNewToken(null) }}>
          <Plus className="h-4 w-4 mr-1.5" />New token
        </Button>
      </div>

      {/* Reveal banner */}
      {newToken && (
        <Card className={cn('border-green-500/30 bg-green-500/5', isCyber && 'border-[rgba(0,255,255,0.3)] bg-[rgba(0,255,255,0.04)]')}>
          <CardContent className="pt-4 space-y-3">
            <div className="flex items-start gap-2 text-sm">
              <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
              <span className="text-muted-foreground">
                Copy this token — it <strong className="text-foreground">won't be shown again</strong>.
              </span>
            </div>
            <div className={cn(
              'flex items-center gap-2 p-2.5 rounded-[var(--radius)] font-mono text-xs break-all',
              isCyber ? 'bg-[rgba(0,255,255,0.06)] text-[hsl(180,80%,70%)]' : 'bg-muted',
            )}>
              <span className="flex-1 select-all">{newToken.token}</span>
              <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => copy(newToken.token)}>
                {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Create form */}
      {showForm && (
        <Card className={cardClass}>
          <CardHeader>
            <CardTitle className="text-base">New token</CardTitle>
            <CardDescription>Give it a name so you remember where it's used.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="tok-name">Name</Label>
              <Input id="tok-name" placeholder="e.g. Grafana, Home server script…"
                value={name} onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && name.trim() && createMut.mutate()} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tok-exp">Expiry <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Input id="tok-exp" type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
            </div>
            <div className="flex gap-2">
              <Button size="sm" disabled={!name.trim() || createMut.isPending} onClick={() => createMut.mutate()}>
                {createMut.isPending ? 'Generating…' : 'Generate'}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => { setShowForm(false); setName(''); setExpiresAt('') }}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Token list */}
      <Card className={cardClass}>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Key className={cn('h-4 w-4', isCyber ? 'text-[hsl(180,100%,50%)]' : 'text-muted-foreground')} />
            <CardTitle className="text-base">Active tokens</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          {tokens.length === 0 ? (
            <p className="text-sm text-muted-foreground">No tokens yet.</p>
          ) : (
            <div className="space-y-2">
              {tokens.map((pat) => {
                const expired = pat.expires_at != null && new Date(pat.expires_at) < new Date()
                return (
                  <div key={pat.id} className={cn(
                    'flex items-center justify-between gap-3 px-3 py-2.5 rounded-[var(--radius)] border border-border',
                    expired ? 'opacity-50' : isCyber ? 'bg-[rgba(0,255,255,0.03)]' : 'bg-muted/30',
                  )}>
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Key className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium truncate">{pat.name}</span>
                          {expired && <Badge variant="destructive" className="h-4 text-[10px] px-1.5">Expired</Badge>}
                        </div>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-0.5 text-xs text-muted-foreground">
                          <span className={cn('font-mono', isCyber && 'text-[hsl(180,60%,55%)]')}>{pat.token_prefix}…</span>
                          <span>Created {new Date(pat.created_at).toLocaleDateString()}</span>
                          {pat.expires_at && (
                            <span className="flex items-center gap-0.5">
                              <Clock className="h-3 w-3" />
                              {expired ? 'Expired' : 'Expires'} {new Date(pat.expires_at).toLocaleDateString()}
                            </span>
                          )}
                          <span className="italic">{pat.last_used_at ? `Last used ${new Date(pat.last_used_at).toLocaleDateString()}` : 'Never used'}</span>
                        </div>
                      </div>
                    </div>
                    <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0"
                      onClick={() => { if (confirm(`Revoke "${pat.name}"?`)) deleteMut.mutate(pat.id) }}>
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// ── Endpoint documentation + tester ──────────────────────────────────────────

interface TesterResponse {
  status: number
  statusText: string
  contentType: string
  body: string
  duration: number
}

function EndpointDocs({ endpoint, tokens, theme }: { endpoint: EndpointDef; tokens: PAT[]; theme: string }) {
  const isCyber = theme === 'cyberpunk'
  const isApple = theme === 'apple'

  // Tester state
  const [tokenInput, setTokenInput]   = useState('')
  const [queryVals, setQueryVals]     = useState<Record<string, string>>({})
  const [headerVals, setHeaderVals]   = useState<Record<string, string>>({})
  const [response, setResponse]       = useState<TesterResponse | null>(null)
  const [loading, setLoading]         = useState(false)
  const [testerError, setTesterError] = useState('')
  const responseRef = useRef<HTMLDivElement>(null)

  function setQP(name: string, val: string) { setQueryVals((p) => ({ ...p, [name]: val })) }
  function setHP(name: string, val: string) { setHeaderVals((p) => ({ ...p, [name]: val })) }

  async function execute() {
    const tok = tokenInput.trim()
    if (!tok) { setTesterError('Enter a token to authenticate the request.'); return }
    setTesterError('')
    setLoading(true)
    setResponse(null)
    try {
      const url = new URL(endpoint.path, window.location.origin)
      endpoint.queryParams.forEach((p) => {
        const v = queryVals[p.name] ?? ''
        if (v) url.searchParams.set(p.name, v)
      })
      const headers: Record<string, string> = { Authorization: `Bearer ${tok}` }
      endpoint.headers.forEach((h) => {
        const v = headerVals[h.name] ?? h.default
        if (v) headers[h.name] = v
      })
      const t0 = performance.now()
      const res = await fetch(url.toString(), { headers })
      const duration = Math.round(performance.now() - t0)
      const ct = res.headers.get('content-type') ?? ''
      let body: string
      if (ct.includes('json')) {
        const json = await res.json()
        body = JSON.stringify(json, null, 2)
      } else {
        body = await res.text()
      }
      setResponse({ status: res.status, statusText: res.statusText, contentType: ct, body, duration })
      setTimeout(() => responseRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50)
    } catch (err) {
      setTesterError(err instanceof Error ? err.message : 'Request failed')
    } finally {
      setLoading(false)
    }
  }

  const cardClass = cn(isApple && 'apple-glass', isCyber && 'cyber-card')
  const isOk = response && response.status >= 200 && response.status < 300

  // Build example curl
  const curlHeaders = endpoint.headers
    .map((h) => ` \\\n  -H "${h.name}: ${headerVals[h.name] ?? h.default}"`)
    .join('')
  const curlParams = endpoint.queryParams
    .filter((p) => queryVals[p.name])
    .map((p) => `${p.name}=${encodeURIComponent(queryVals[p.name])}`)
    .join('&')
  const curlUrl = `${window.location.origin}${endpoint.path}${curlParams ? '?' + curlParams : ''}`
  const curlCmd = `curl -H "Authorization: Bearer <token>"${curlHeaders} \\\n  "${curlUrl}"`

  return (
    <div className="p-6 space-y-5 max-w-3xl">
      {/* Endpoint header */}
      <div>
        <div className="flex items-center gap-3 mb-1">
          <span className={cn(
            'font-mono text-xs font-bold px-2 py-1 rounded border',
            METHOD_COLORS[endpoint.method],
          )}>
            {endpoint.method}
          </span>
          <code className={cn(
            'text-sm font-mono',
            isCyber ? 'text-[hsl(180,80%,70%)]' : 'text-foreground',
          )}>
            {endpoint.path}
          </code>
          <Badge variant="secondary" className="text-[10px] h-5">{endpoint.auth}</Badge>
        </div>
        <h2 className="text-xl font-bold">{endpoint.name}</h2>
        <p className="text-muted-foreground text-sm mt-1 leading-relaxed">{endpoint.description}</p>
      </div>

      {/* Parameters */}
      {(endpoint.queryParams.length > 0 || endpoint.headers.length > 0) && (
        <Card className={cardClass}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Parameters</CardTitle>
          </CardHeader>
          <CardContent className="space-y-0 p-0">
            {endpoint.queryParams.length > 0 && (
              <ParamTable title="Query parameters" params={endpoint.queryParams.map(p => ({
                name: p.name, in: 'query', type: p.type,
                required: p.required, default: p.default, description: p.description,
              }))} isCyber={isCyber} />
            )}
            {endpoint.headers.length > 0 && (
              <ParamTable title="Headers" params={endpoint.headers.map(h => ({
                name: h.name, in: 'header', type: 'string',
                required: h.required, default: h.default, description: h.description,
                options: h.options,
              }))} isCyber={isCyber} />
            )}
          </CardContent>
        </Card>
      )}

      {/* Interactive tester */}
      <Card className={cardClass}>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Play className={cn('h-4 w-4', isCyber ? 'text-[hsl(180,100%,50%)]' : 'text-primary')} />
            <CardTitle className="text-sm">Try it out</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Token input */}
          <div className="space-y-1.5">
            <Label className="text-xs">Bearer token</Label>
            <div className="flex gap-2">
              <Input
                placeholder="vp_… or paste a JWT"
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
                className={cn('font-mono text-xs', isCyber && 'bg-[rgba(0,255,255,0.04)] border-[rgba(0,255,255,0.2)]')}
              />
              {tokens.length > 0 && (
                <select
                  className={cn(
                    'text-xs rounded-md px-2 border border-border bg-background text-muted-foreground shrink-0',
                    'focus:outline-none focus:ring-1 focus:ring-ring cursor-pointer',
                  )}
                  value=""
                  onChange={(e) => {
                    const t = tokens.find((t) => String(t.id) === e.target.value)
                    if (t) setTokenInput('')  // token value not stored client-side; user must paste
                  }}
                  title="Your saved tokens (paste the full token value above)"
                >
                  <option value="">Saved tokens</option>
                  {tokens.map((t) => (
                    <option key={t.id} value={String(t.id)}>{t.name} ({t.token_prefix}…)</option>
                  ))}
                </select>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Saved tokens shown for reference — paste the full token value above (shown once at creation).
            </p>
          </div>

          {/* Query params inputs */}
          {endpoint.queryParams.length > 0 && (
            <div className="space-y-2">
              <Label className="text-xs">Query parameters</Label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {endpoint.queryParams.map((p) => (
                  <div key={p.name} className="space-y-1">
                    <label className="text-[11px] text-muted-foreground font-mono">
                      {p.name}{p.required && <span className="text-destructive ml-0.5">*</span>}
                    </label>
                    {p.options ? (
                      <select
                        className={cn(
                          'w-full text-xs rounded-md px-2 py-1.5 border border-border bg-background',
                          'focus:outline-none focus:ring-1 focus:ring-ring',
                        )}
                        value={queryVals[p.name] ?? ''}
                        onChange={(e) => setQP(p.name, e.target.value)}
                      >
                        {p.options.map((o) => <option key={o} value={o}>{o || '(all)'}</option>)}
                      </select>
                    ) : (
                      <Input
                        placeholder={p.default ?? ''}
                        value={queryVals[p.name] ?? ''}
                        onChange={(e) => setQP(p.name, e.target.value)}
                        className="h-8 text-xs"
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Header inputs */}
          {endpoint.headers.length > 0 && (
            <div className="space-y-2">
              <Label className="text-xs">Headers</Label>
              <div className="space-y-2">
                {endpoint.headers.map((h) => (
                  <div key={h.name} className="flex items-center gap-2">
                    <code className="text-xs text-muted-foreground w-24 shrink-0 font-mono">{h.name}</code>
                    {h.options ? (
                      <select
                        className={cn(
                          'flex-1 text-xs rounded-md px-2 py-1.5 border border-border bg-background',
                          'focus:outline-none focus:ring-1 focus:ring-ring',
                        )}
                        value={headerVals[h.name] ?? h.default}
                        onChange={(e) => setHP(h.name, e.target.value)}
                      >
                        {h.options.map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                    ) : (
                      <Input
                        placeholder={h.default}
                        value={headerVals[h.name] ?? ''}
                        onChange={(e) => setHP(h.name, e.target.value)}
                        className="h-8 text-xs flex-1"
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {testerError && (
            <div className="flex items-center gap-2 text-sm text-destructive">
              <TriangleAlert className="h-4 w-4 shrink-0" />
              {testerError}
            </div>
          )}

          <Button size="sm" onClick={execute} disabled={loading}>
            {loading
              ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Sending…</>
              : <><Play className="h-3.5 w-3.5 mr-1.5" />Execute</>}
          </Button>

          {/* Response */}
          {response && (
            <div ref={responseRef} className="space-y-2 pt-1">
              <div className="flex items-center gap-3 text-xs">
                <span className={cn(
                  'font-bold',
                  isOk ? 'text-green-500' : 'text-destructive',
                )}>
                  {response.status} {response.statusText}
                </span>
                <span className="text-muted-foreground">{response.duration} ms</span>
                <span className="text-muted-foreground font-mono truncate">{response.contentType}</span>
              </div>
              <pre className={cn(
                'text-[11px] p-3 rounded-[var(--radius)] overflow-auto max-h-72 whitespace-pre leading-relaxed',
                isCyber
                  ? 'bg-[rgba(0,255,255,0.04)] text-[hsl(180,60%,70%)]'
                  : 'bg-muted text-foreground/80',
              )}>
                {response.body}
              </pre>
            </div>
          )}
        </CardContent>
      </Card>

      {/* cURL example */}
      <Card className={cardClass}>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">cURL example</CardTitle>
        </CardHeader>
        <CardContent>
          <pre className={cn(
            'text-[11px] p-3 rounded-[var(--radius)] overflow-x-auto whitespace-pre leading-relaxed',
            isCyber
              ? 'bg-[rgba(0,255,255,0.04)] text-[hsl(180,60%,70%)]'
              : 'bg-muted text-foreground/80',
          )}>
            {curlCmd}
          </pre>
        </CardContent>
      </Card>
    </div>
  )
}

// ── Parameter table ───────────────────────────────────────────────────────────

function ParamTable({
  title, params, isCyber,
}: {
  title: string
  params: { name: string; in: string; type: string; required: boolean; default?: string; description: string; options?: string[] }[]
  isCyber: boolean
}) {
  return (
    <div>
      <div className={cn(
        'px-4 py-2 text-[11px] font-semibold border-b border-border',
        isCyber ? 'text-[hsl(180,60%,55%)] border-[rgba(0,255,255,0.1)]' : 'text-muted-foreground',
      )}>
        {title}
      </div>
      <div className="divide-y divide-border">
        {params.map((p) => (
          <div key={p.name} className="px-4 py-3 grid grid-cols-[8rem_1fr] gap-4 text-sm">
            <div className="space-y-1">
              <code className={cn('text-xs font-mono font-semibold', isCyber && 'text-[hsl(180,80%,65%)]')}>
                {p.name}
              </code>
              <div className="flex flex-wrap gap-1">
                <span className="text-[10px] text-muted-foreground bg-muted px-1 rounded">{p.type}</span>
                {p.required
                  ? <span className="text-[10px] text-destructive bg-destructive/10 px-1 rounded">required</span>
                  : <span className="text-[10px] text-muted-foreground bg-muted px-1 rounded">optional</span>}
              </div>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground leading-relaxed">{p.description}</p>
              {p.default !== undefined && p.default !== '' && (
                <p className="text-[11px] text-muted-foreground">
                  Default: <code className="font-mono">{p.default}</code>
                </p>
              )}
              {p.options && p.options.filter(Boolean).length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {p.options.filter(Boolean).map((o) => (
                    <code key={o} className={cn(
                      'text-[10px] px-1.5 py-0.5 rounded border font-mono',
                      isCyber
                        ? 'border-[rgba(0,255,255,0.2)] text-[hsl(180,60%,60%)]'
                        : 'border-border text-muted-foreground',
                    )}>
                      {o}
                    </code>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
