import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Key, Plus, Trash2, Copy, Check, AlertTriangle, Clock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { listTokens, createToken, deleteToken, type PAT, type CreatedPAT } from '@/api/tokens'
import { useThemeStore } from '@/stores/theme'
import { cn } from '@/lib/utils'

export default function ApiKeys() {
  const { theme } = useThemeStore()
  const qc = useQueryClient()
  const isCyber = theme === 'cyberpunk'
  const isApple = theme === 'apple'

  const { data: tokens = [], isLoading } = useQuery({
    queryKey: ['tokens'],
    queryFn: listTokens,
  })

  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [expiresAt, setExpiresAt] = useState('')
  const [newToken, setNewToken] = useState<CreatedPAT | null>(null)
  const [copied, setCopied] = useState(false)

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

  function copyToken(token: string) {
    navigator.clipboard.writeText(token).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  function isExpired(pat: PAT) {
    return pat.expires_at != null && new Date(pat.expires_at) < new Date()
  }

  const cardClass = cn(
    isApple && 'apple-glass',
    isCyber && 'cyber-card',
  )

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-3xl mx-auto">

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className={cn('text-2xl font-bold', isApple && 'tracking-tight text-[hsl(225,25%,10%)]')}>
            API Keys
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Personal access tokens for programmatic API access
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => { setShowForm(true); setNewToken(null) }}
          className={cn(isCyber && 'border border-[rgba(0,255,255,0.3)] bg-[rgba(0,255,255,0.08)] text-[hsl(180,100%,60%)] hover:bg-[rgba(0,255,255,0.15)]')}
        >
          <Plus className="h-4 w-4 mr-1.5" />
          New token
        </Button>
      </div>

      {/* New-token revealed banner */}
      {newToken && (
        <Card className={cn('border-green-500/30 bg-green-500/5', isCyber && 'border-[rgba(0,255,255,0.3)] bg-[rgba(0,255,255,0.05)]')}>
          <CardContent className="pt-4 space-y-3">
            <div className="flex items-start gap-2 text-sm">
              <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
              <span className="text-muted-foreground">
                Copy this token now — it <strong className="text-foreground">won't be shown again</strong>.
              </span>
            </div>
            <div className={cn(
              'flex items-center gap-2 p-2.5 rounded-[var(--radius)] font-mono text-sm break-all',
              isCyber ? 'bg-[rgba(0,255,255,0.06)] text-[hsl(180,80%,70%)]' : 'bg-muted',
            )}>
              <span className="flex-1 select-all">{newToken.token}</span>
              <Button
                variant="ghost" size="icon" className="h-7 w-7 shrink-0"
                onClick={() => copyToken(newToken.token)}
              >
                {copied
                  ? <Check className="h-3.5 w-3.5 text-green-500" />
                  : <Copy className="h-3.5 w-3.5" />}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Create form */}
      {showForm && (
        <Card className={cardClass}>
          <CardHeader>
            <CardTitle className="text-base">New API token</CardTitle>
            <CardDescription>Give the token a descriptive name so you remember where it's used.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="token-name">Name</Label>
              <Input
                id="token-name"
                placeholder="e.g. Grafana scraper, Home automation…"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && name.trim() && createMut.mutate()}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="token-expiry">Expiry <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Input
                id="token-expiry"
                type="datetime-local"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
              />
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={!name.trim() || createMut.isPending}
                onClick={() => createMut.mutate()}
              >
                {createMut.isPending ? 'Generating…' : 'Generate token'}
              </Button>
              <Button
                size="sm" variant="ghost"
                onClick={() => { setShowForm(false); setName(''); setExpiresAt('') }}
              >
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
          {isLoading ? (
            <p className="text-sm text-muted-foreground py-2">Loading…</p>
          ) : tokens.length === 0 ? (
            <p className="text-sm text-muted-foreground py-2">No tokens yet. Create one above.</p>
          ) : (
            <div className="space-y-2">
              {tokens.map((pat) => (
                <div
                  key={pat.id}
                  className={cn(
                    'flex items-center justify-between gap-3 px-3 py-2.5 rounded-[var(--radius)] border border-border transition-colors',
                    isExpired(pat) ? 'opacity-50' : isCyber ? 'bg-[rgba(0,255,255,0.03)]' : 'bg-muted/30',
                  )}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Key className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium truncate">{pat.name}</span>
                        {isExpired(pat) && (
                          <Badge variant="destructive" className="h-4 text-[10px] px-1.5">Expired</Badge>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-0.5 text-xs text-muted-foreground">
                        <span className={cn('font-mono', isCyber && 'text-[hsl(180,60%,55%)]')}>
                          {pat.token_prefix}…
                        </span>
                        <span>Created {new Date(pat.created_at).toLocaleDateString()}</span>
                        {pat.expires_at && (
                          <span className="flex items-center gap-0.5">
                            <Clock className="h-3 w-3" />
                            {isExpired(pat) ? 'Expired' : 'Expires'} {new Date(pat.expires_at).toLocaleDateString()}
                          </span>
                        )}
                        {pat.last_used_at && (
                          <span>Last used {new Date(pat.last_used_at).toLocaleDateString()}</span>
                        )}
                        {!pat.last_used_at && (
                          <span className="italic">Never used</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <Button
                    variant="ghost" size="icon" className="h-7 w-7 shrink-0"
                    title="Revoke token"
                    onClick={() => {
                      if (confirm(`Revoke "${pat.name}"? This cannot be undone.`))
                        deleteMut.mutate(pat.id)
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Usage hint */}
      <Card className={cn('border-dashed', cardClass)}>
        <CardContent className="pt-4">
          <p className="text-xs text-muted-foreground leading-relaxed space-y-1">
            <span className="block font-medium text-foreground mb-1">Usage</span>
            Use the token as a Bearer header in your API calls:
          </p>
          <pre className={cn(
            'mt-2 text-xs p-2.5 rounded-[var(--radius)] overflow-x-auto',
            isCyber ? 'bg-[rgba(0,255,255,0.06)] text-[hsl(180,80%,65%)]' : 'bg-muted text-foreground/80',
          )}>
{`curl -H "Authorization: Bearer vp_<your-token>" \\
  https://your-domain/api/v1/metrics`}
          </pre>
        </CardContent>
      </Card>

    </div>
  )
}
