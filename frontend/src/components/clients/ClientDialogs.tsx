/**
 * ClientDialogs — all dialog components for the Clients page.
 *
 * Exported:
 *   ConfigButton         — view raw WireGuard config text
 *   SendConfigButton     — confirm + send config email
 *   QRButton             — show QR code
 *   DownloadLinkButton   — generate and display a one-time download URL
 *   EditClientDialog     — edit name / email / IPs / expiry
 *   ClientHistoryDialog  — bandwidth chart + connection events
 *   QuotaDialog          — set data quota and reset usage
 *   BandwidthDialog      — set per-direction tc bandwidth caps
 */

import { useState, useEffect } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import {
  Check, Copy, ArrowDown, ArrowUp, Wifi, WifiOff, X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts'
import {
  getClientConfigText, getClientQR, createDownloadLink, sendConfigEmail,
  updateClient, resetClientQuota, getClientSnapshots, getClientEvents,
  type Client,
} from '@/api/clients'
import { formatBytes } from '@/lib/utils'

// ── Clipboard helper ──────────────────────────────────────────────────────────

/** copyToClipboard works on both HTTP and HTTPS by falling back to execCommand. */
export function copyToClipboard(text: string) {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text)
  } else {
    const el = document.createElement('textarea')
    el.value = text
    el.style.position = 'fixed'
    el.style.opacity = '0'
    document.body.appendChild(el)
    el.select()
    document.execCommand('copy')
    document.body.removeChild(el)
  }
}

// ── Time formatter used by ClientHistoryDialog ────────────────────────────────

function formatSnapshotTime(iso: string, range: '1h' | '24h' | '7d'): string {
  const d = new Date(iso)
  if (range === '7d') {
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit' })
  }
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

// ── ConfigButton ──────────────────────────────────────────────────────────────

interface ConfigButtonProps {
  clientId: number
  name: string
  open: boolean
  onOpenChange: (v: boolean) => void
}

/** ConfigButton shows the raw WireGuard config text in a dialog. */
export function ConfigButton({ clientId, name, open, onOpenChange }: ConfigButtonProps) {
  const [copied, setCopied] = useState(false)
  const { data, isFetching } = useQuery({
    queryKey: ['client-config-text', clientId],
    queryFn: () => getClientConfigText(clientId),
    enabled: open,
  })

  function handleCopy() {
    if (!data) return
    copyToClipboard(data)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Config — {name}</DialogTitle>
          <DialogDescription>WireGuard client configuration</DialogDescription>
        </DialogHeader>
        {isFetching ? (
          <div className="h-32 flex items-center justify-center text-muted-foreground">
            Loading…
          </div>
        ) : (
          <pre className="bg-muted rounded-md p-4 text-xs font-mono whitespace-pre overflow-x-auto max-h-80">
            {data}
          </pre>
        )}
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={handleCopy} disabled={!data}>
            {copied
              ? <><Check className="h-3 w-3 mr-1" />Copied!</>
              : <><Copy className="h-3 w-3 mr-1" />Copy</>}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── SendConfigButton ──────────────────────────────────────────────────────────

interface SendConfigButtonProps {
  clientId: number
  email?: string
  open: boolean
  onOpenChange: (v: boolean) => void
}

/** SendConfigButton confirms and sends a one-time config download email. */
export function SendConfigButton({ clientId, email, open, onOpenChange }: SendConfigButtonProps) {
  const mut = useMutation({
    mutationFn: () => sendConfigEmail(clientId),
    onSuccess: () => { onOpenChange(false) },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Send config by email</DialogTitle>
          <DialogDescription>
            A one-time download link will be sent to{' '}
            <span className="font-mono text-foreground">{email}</span>.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending}>
            {mut.isPending
              ? 'Sending…'
              : mut.isSuccess
                ? <><Check className="h-3.5 w-3.5 mr-1" /> Sent!</>
                : 'Send'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── QRButton ──────────────────────────────────────────────────────────────────

interface QRButtonProps {
  clientId: number
  name: string
  open: boolean
  onOpenChange: (v: boolean) => void
}

/** QRButton fetches and displays the WireGuard QR code for mobile import. */
export function QRButton({ clientId, name, open, onOpenChange }: QRButtonProps) {
  const { data, isFetching } = useQuery({
    queryKey: ['client-qr', clientId],
    queryFn: () => getClientQR(clientId),
    enabled: open,
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg text-center">
        <DialogHeader>
          <DialogTitle>QR — {name}</DialogTitle>
          <DialogDescription>Scan with the WireGuard app</DialogDescription>
        </DialogHeader>
        {isFetching ? (
          <div className="h-64 flex items-center justify-center text-muted-foreground">
            Loading…
          </div>
        ) : data?.qr_code ? (
          <div className="bg-white p-4 rounded-lg inline-block mx-auto">
            <img
              src={`data:image/png;base64,${data.qr_code}`}
              alt="QR code"
              className="block w-full"
            />
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

// ── DownloadLinkButton ────────────────────────────────────────────────────────

interface DownloadLinkButtonProps {
  clientId: number
  open: boolean
  onOpenChange: (v: boolean) => void
}

/** DownloadLinkButton generates a one-time config download URL and displays it. */
export function DownloadLinkButton({ clientId, open, onOpenChange }: DownloadLinkButtonProps) {
  const [url, setUrl] = useState<string | null>(null)
  const mut = useMutation({
    mutationFn: () => createDownloadLink(clientId),
    onSuccess: (data) => setUrl(`${window.location.origin}${data.url}`),
  })

  useEffect(() => {
    if (open) {
      setUrl(null)
      mut.mutate()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>One-time download link</DialogTitle>
          <DialogDescription>
            Valid for 1 hour, single use. Share this link to allow config download without login.
          </DialogDescription>
        </DialogHeader>
        {mut.isPending || !url ? (
          <div className="h-16 flex items-center justify-center text-muted-foreground text-sm">
            Generating…
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex gap-2">
              <input
                readOnly
                value={url}
                className="flex-1 rounded-md border border-input bg-muted px-3 py-2 text-xs font-mono"
              />
              <Button size="sm" onClick={() => { copyToClipboard(url); onOpenChange(false) }}>
                Copy
              </Button>
            </div>
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="block text-xs text-primary underline break-all"
              onClick={() => setTimeout(() => onOpenChange(false), 500)}
            >
              Click to download directly →
            </a>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ── EditClientDialog ──────────────────────────────────────────────────────────

interface EditClientDialogProps {
  client: Client
  open: boolean
  onOpenChange: (v: boolean) => void
  onUpdated: () => void
}

/** EditClientDialog allows editing a client's name, email, allowed IPs, and expiry. */
export function EditClientDialog({ client, open, onOpenChange, onUpdated }: EditClientDialogProps) {
  const [form, setForm] = useState({
    name: '',
    owner_label: '',
    email: '',
    allowed_ips: '',
    expires_at: '',
  })
  const [error, setError] = useState('')

  useEffect(() => {
    if (open) {
      setForm({
        name: client.name,
        owner_label: client.owner_label ?? '',
        email: client.email ?? '',
        allowed_ips: client.allowed_ips ?? '0.0.0.0/0, ::/0',
        expires_at: client.expires_at ? client.expires_at.slice(0, 16) : '',
      })
      setError('')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const mutation = useMutation({
    mutationFn: () =>
      updateClient(client.id, {
        name: form.name || undefined,
        owner_label: form.owner_label || undefined,
        email: form.email,
        allowed_ips: form.allowed_ips || undefined,
        // If expires_at is empty, send clear_expires_at: true so the backend explicitly
        // nullifies the column (plain null is indistinguishable from "field omitted" on
        // a *time.Time pointer in Go).
        ...(form.expires_at
          ? { expires_at: new Date(form.expires_at + ':00Z').toISOString() }
          : { clear_expires_at: true }),
      }),
    onSuccess: () => { onOpenChange(false); onUpdated() },
    onError: (e: unknown) => {
      setError(
        (e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Error',
      )
    },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit client — {client.name}</DialogTitle>
          <DialogDescription>Update name, label, allowed IPs or expiry.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="edit-name">Name</Label>
            <Input
              id="edit-name"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-owner">Owner label</Label>
            <Input
              id="edit-owner"
              value={form.owner_label}
              onChange={(e) => setForm((f) => ({ ...f, owner_label: e.target.value }))}
              placeholder="alice"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-email">
              Client email{' '}
              <span className="text-muted-foreground text-xs">(receives notifications)</span>
            </Label>
            <Input
              id="edit-email"
              type="email"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              placeholder="alice@example.com"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-ips">Allowed IPs</Label>
            <Input
              id="edit-ips"
              value={form.allowed_ips}
              onChange={(e) => setForm((f) => ({ ...f, allowed_ips: e.target.value }))}
              placeholder="0.0.0.0/0, ::/0"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-expiry">
              Expiry{' '}
              <span className="text-muted-foreground text-xs">
                (UTC — leave empty for no expiry)
              </span>
            </Label>
            <div className="flex gap-2">
              <Input
                id="edit-expiry"
                type="datetime-local"
                value={form.expires_at}
                onChange={(e) => setForm((f) => ({ ...f, expires_at: e.target.value }))}
                className="flex-1"
              />
              {form.expires_at && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  title="Remove expiry"
                  onClick={() => setForm((f) => ({ ...f, expires_at: '' }))}
                >
                  <X className="h-4 w-4 text-muted-foreground" />
                </Button>
              )}
            </div>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !form.name}
          >
            {mutation.isPending ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── ClientHistoryDialog ───────────────────────────────────────────────────────

interface ClientHistoryDialogProps {
  client: Client
  open: boolean
  onOpenChange: (v: boolean) => void
}

/** ClientHistoryDialog shows a bandwidth chart and connection event log. */
export function ClientHistoryDialog({ client, open, onOpenChange }: ClientHistoryDialogProps) {
  const [range, setRange] = useState<'1h' | '24h' | '7d'>('24h')

  const { data: snapshots = [], isFetching: loadingSnaps } = useQuery({
    queryKey: ['client-snapshots', client.id, range],
    queryFn: () => getClientSnapshots(client.id, range),
    enabled: open,
    refetchInterval: open ? 60_000 : false,
  })

  const { data: events = [], isFetching: loadingEvents } = useQuery({
    queryKey: ['client-events', client.id],
    queryFn: () => getClientEvents(client.id),
    enabled: open,
    refetchInterval: open ? 30_000 : false,
  })

  const chartData = snapshots.map((p) => ({
    time: formatSnapshotTime(p.timestamp, range),
    rx: p.bytes_rx,
    tx: p.bytes_tx,
  }))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>History — {client.name}</DialogTitle>
          <DialogDescription>Bandwidth usage and connection events</DialogDescription>
        </DialogHeader>

        {/* Bandwidth chart */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Bandwidth</span>
            <div className="flex gap-1">
              {(['1h', '24h', '7d'] as const).map((r) => (
                <button
                  key={r}
                  onClick={() => setRange(r)}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                    range === r
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>

          {loadingSnaps && snapshots.length === 0 ? (
            <div className="h-[140px] flex items-center justify-center text-sm text-muted-foreground">
              Loading…
            </div>
          ) : chartData.length === 0 ? (
            <div className="h-[140px] flex items-center justify-center text-sm text-muted-foreground">
              No data for this period.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={140}>
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id={`crx-${client.id}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id={`ctx-${client.id}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="time" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                <YAxis
                  tick={{ fontSize: 10 }}
                  tickFormatter={(v) => formatBytes(v as number)}
                  width={72}
                />
                <Tooltip formatter={(v) => formatBytes(v as number)} />
                <Area
                  type="monotone"
                  dataKey="rx"
                  stroke="#3b82f6"
                  fill={`url(#crx-${client.id})`}
                  name="↓ Download"
                />
                <Area
                  type="monotone"
                  dataKey="tx"
                  stroke="#10b981"
                  fill={`url(#ctx-${client.id})`}
                  name="↑ Upload"
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Connection events */}
        <div className="space-y-2">
          <span className="text-sm font-medium">Connection events</span>
          {loadingEvents && events.length === 0 ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : events.length === 0 ? (
            <p className="text-sm text-muted-foreground">No events recorded yet.</p>
          ) : (
            <div className="max-h-44 overflow-y-auto space-y-1 rounded-md border border-border p-2">
              {events.map((e) => (
                <div
                  key={e.id}
                  className="flex items-center gap-2.5 text-xs py-1 border-b border-border last:border-0"
                >
                  {e.event_type === 'connected'
                    ? <Wifi className="h-3.5 w-3.5 text-green-500 shrink-0" />
                    : <WifiOff className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                  <span
                    className={
                      e.event_type === 'connected'
                        ? 'text-green-600 dark:text-green-400 font-medium'
                        : 'text-muted-foreground'
                    }
                  >
                    {e.event_type === 'connected' ? 'Connected' : 'Disconnected'}
                  </span>
                  {e.source_ip && (
                    <span className="font-mono text-muted-foreground">{e.source_ip}</span>
                  )}
                  <span className="ml-auto text-muted-foreground shrink-0">
                    {new Date(e.timestamp).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── QuotaDialog ───────────────────────────────────────────────────────────────

interface QuotaDialogProps {
  client: Client
  open: boolean
  onOpenChange: (v: boolean) => void
  onUpdated: () => void
}

/** QuotaDialog sets the per-client data quota and lets the admin force-reset usage. */
export function QuotaDialog({ client, open, onOpenChange, onUpdated }: QuotaDialogProps) {
  const [quotaGb, setQuotaGb] = useState(0)
  const [period, setPeriod] = useState<'monthly' | 'weekly' | 'total'>('monthly')
  const [error, setError] = useState('')

  useEffect(() => {
    if (open) {
      setQuotaGb(
        client.data_quota_bytes > 0
          ? Math.round((client.data_quota_bytes / 1e9) * 100) / 100
          : 0,
      )
      setPeriod(client.quota_period ?? 'monthly')
      setError('')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const mutation = useMutation({
    mutationFn: () =>
      updateClient(client.id, {
        data_quota_bytes: Math.round(quotaGb * 1e9),
        quota_period: period,
      }),
    onSuccess: () => { onOpenChange(false); onUpdated() },
    onError: (e: unknown) => {
      setError(
        (e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Error',
      )
    },
  })

  const resetMut = useMutation({
    mutationFn: () => resetClientQuota(client.id),
    onSuccess: () => onUpdated(),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Data quota — {client.name}</DialogTitle>
          <DialogDescription>
            Automatically suspend access when the limit is reached. 0 = unlimited.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="quota-gb">Data limit (GB)</Label>
            <Input
              id="quota-gb"
              type="number"
              min={0}
              step={0.01}
              value={quotaGb}
              onChange={(e) => setQuotaGb(Math.max(0, Number(e.target.value)))}
              placeholder="0"
            />
            <p className="text-xs text-muted-foreground">0 = no quota</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="quota-period">Reset period</Label>
            <select
              id="quota-period"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={period}
              onChange={(e) => setPeriod(e.target.value as typeof period)}
            >
              <option value="monthly">Monthly (resets 1st of month)</option>
              <option value="weekly">Weekly (resets Monday)</option>
              <option value="total">Total (never resets)</option>
            </select>
          </div>
          {client.data_quota_bytes > 0 && (
            <div className="rounded-md border border-border p-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">Force reset usage</p>
                <p className="text-xs text-muted-foreground">
                  Resets counter now, re-enables client if suspended
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={resetMut.isPending}
                onClick={() => resetMut.mutate()}
              >
                {resetMut.isSuccess
                  ? <><Check className="h-3.5 w-3.5 mr-1" />Done</>
                  : resetMut.isPending
                    ? 'Resetting…'
                    : 'Reset'}
              </Button>
            </div>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
            {mutation.isPending ? 'Applying…' : 'Apply'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── BandwidthDialog ───────────────────────────────────────────────────────────

interface BandwidthDialogProps {
  client: Client
  open: boolean
  onOpenChange: (v: boolean) => void
  onUpdated: () => void
}

/** BandwidthDialog sets per-direction tc bandwidth caps (Mbps). */
export function BandwidthDialog({ client, open, onOpenChange, onUpdated }: BandwidthDialogProps) {
  const [down, setDown] = useState(0)
  const [up, setUp] = useState(0)
  const [error, setError] = useState('')

  useEffect(() => {
    if (open) {
      setDown(client.bandwidth_limit_down ?? 0)
      setUp(client.bandwidth_limit_up ?? 0)
      setError('')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const mutation = useMutation({
    mutationFn: () =>
      updateClient(client.id, {
        bandwidth_limit_down: down,
        bandwidth_limit_up: up,
      }),
    onSuccess: () => { onOpenChange(false); onUpdated() },
    onError: (e: unknown) => {
      setError(
        (e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Error',
      )
    },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Bandwidth — {client.name}</DialogTitle>
          <DialogDescription>Set per-direction caps via Linux tc. 0 = unlimited.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="bw-down" className="flex items-center gap-1.5">
              <ArrowDown className="h-3.5 w-3.5 text-blue-500" />
              Download limit{' '}
              <span className="text-muted-foreground text-xs">(server → client, Mbps)</span>
            </Label>
            <Input
              id="bw-down"
              type="number"
              min={0}
              value={down}
              onChange={(e) => setDown(Math.max(0, Number(e.target.value)))}
              placeholder="0"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bw-up" className="flex items-center gap-1.5">
              <ArrowUp className="h-3.5 w-3.5 text-green-500" />
              Upload limit{' '}
              <span className="text-muted-foreground text-xs">(client → server, Mbps)</span>
            </Label>
            <Input
              id="bw-up"
              type="number"
              min={0}
              value={up}
              onChange={(e) => setUp(Math.max(0, Number(e.target.value)))}
              placeholder="0"
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
            {mutation.isPending ? 'Applying…' : 'Apply'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
