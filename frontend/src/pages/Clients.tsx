import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'
import { Plus, Trash2, QrCode, Link2, ToggleLeft, ToggleRight, Clock, FileText, Copy, Check, Pencil, Mail, X, Gauge, ArrowDown, ArrowUp, History, Wifi, WifiOff, DatabaseZap, MoreHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  listClients, createClient, updateClient, deleteClient, enableClient, disableClient,
  getClientQR, getClientConfigText, createDownloadLink, sendConfigEmail,
  getClientSnapshots, getClientEvents,
  bulkEnableClients, bulkDisableClients, bulkDeleteClients,
  type CreateClientPayload, type Client,
} from '@/api/clients'
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts'
import { listInterfaces } from '@/api/interfaces'
import { useWebSocket } from '@/hooks/useWebSocket'
import { formatBytes, timeAgo } from '@/lib/utils'

export default function Clients() {
  const { id: ifaceIdParam } = useParams<{ id: string }>()
  const ifaceId = ifaceIdParam ? Number(ifaceIdParam) : undefined

  const qc = useQueryClient()
  const { data: clients = [], isLoading } = useQuery({
    queryKey: ['clients', ifaceId],
    queryFn: () => listClients(ifaceId),
    refetchInterval: 10_000,
  })
  const { data: interfaces = [] } = useQuery({ queryKey: ['interfaces'], queryFn: listInterfaces })
  const { stats } = useWebSocket()

  const peerMap = new Map(
    stats?.interfaces.flatMap((i) => i.peers ?? []).map((p) => [p.client_id, p]) ?? [],
  )

  const deleteMut = useMutation({ mutationFn: deleteClient, onSuccess: () => qc.invalidateQueries({ queryKey: ['clients'] }) })
  const enableMut = useMutation({ mutationFn: enableClient, onSuccess: () => qc.invalidateQueries({ queryKey: ['clients'] }) })
  const disableMut = useMutation({ mutationFn: disableClient, onSuccess: () => qc.invalidateQueries({ queryKey: ['clients'] }) })

  // Bulk selection state
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const toggleSelect = (id: number) =>
    setSelected((prev) => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s })
  const selectAll = () => setSelected(new Set(clients.map((c) => c.id)))
  const clearSelection = () => setSelected(new Set())

  const bulkEnableMut = useMutation({
    mutationFn: () => bulkEnableClients([...selected]),
    onSuccess: () => { clearSelection(); qc.invalidateQueries({ queryKey: ['clients'] }) },
  })
  const bulkDisableMut = useMutation({
    mutationFn: () => bulkDisableClients([...selected]),
    onSuccess: () => { clearSelection(); qc.invalidateQueries({ queryKey: ['clients'] }) },
  })
  const bulkDeleteMut = useMutation({
    mutationFn: () => bulkDeleteClients([...selected]),
    onSuccess: () => { clearSelection(); qc.invalidateQueries({ queryKey: ['clients'] }) },
  })

  if (isLoading) return <div className="p-6 animate-pulse space-y-3">{[1,2,3].map(i => <div key={i} className="h-20 bg-muted rounded-lg" />)}</div>

  const title = ifaceId ? interfaces.find((i) => i.id === ifaceId)?.name ?? `Interface ${ifaceId}` : 'All clients'

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Clients</h1>
          <p className="text-muted-foreground text-sm mt-1">{title}</p>
        </div>
        <div className="flex items-center gap-2">
          {clients.length > 0 && (
            <Button variant="outline" size="sm" onClick={selected.size === clients.length ? clearSelection : selectAll}>
              {selected.size === clients.length ? 'Deselect all' : 'Select all'}
            </Button>
          )}
          <CreateClientDialog
            interfaces={interfaces}
            defaultInterfaceId={ifaceId}
            onCreated={() => qc.invalidateQueries({ queryKey: ['clients'] })}
          />
        </div>
      </div>

      <div className="space-y-3">
        {clients.map((client) => {
          const peer = peerMap.get(client.id)
          const isSelected = selected.has(client.id)
          const quotaSet = client.data_quota_bytes > 0
          return (
            <Card
              key={client.id}
              className={isSelected ? 'ring-2 ring-primary' : ''}
            >
              <CardHeader className="pb-2">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    {/* Checkbox */}
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSelect(client.id)}
                      className="h-4 w-4 rounded border-border accent-primary shrink-0 cursor-pointer"
                    />
                    <span
                      className={`h-2.5 w-2.5 rounded-full shrink-0 ${peer?.connected ? 'bg-green-500' : 'bg-muted-foreground/30'}`}
                    />
                    <CardTitle className="text-base">{client.name}</CardTitle>
                    {client.owner_label && (
                      <span className="text-xs text-muted-foreground">{client.owner_label}</span>
                    )}
                    {!client.enabled && <Badge variant="secondary">Disabled</Badge>}
                    {client.expires_at && (
                      <Badge variant="warning" className="gap-1">
                        <Clock className="h-3 w-3" />
                        {new Date(client.expires_at) > new Date()
                          ? `Expires ${new Date(client.expires_at).toLocaleDateString()}`
                          : 'Expired'}
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <ClientActionsMenu
                      client={client}
                      onUpdated={() => qc.invalidateQueries({ queryKey: ['clients'] })}
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      title={client.enabled ? 'Disable' : 'Enable'}
                      onClick={() => client.enabled ? disableMut.mutate(client.id) : enableMut.mutate(client.id)}
                    >
                      {client.enabled
                        ? <ToggleRight className="h-4 w-4 text-green-500" />
                        : <ToggleLeft className="h-4 w-4 text-muted-foreground" />}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Delete"
                      onClick={() => { if (confirm(`Delete ${client.name}?`)) deleteMut.mutate(client.id) }}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                  <span className="font-mono">{client.assigned_ip}</span>
                  <span>↓ {formatBytes(peer?.bytes_rx ?? client.bytes_rx)}</span>
                  <span>↑ {formatBytes(peer?.bytes_tx ?? client.bytes_tx)}</span>
                  <span>Last seen: {peer?.last_handshake ? timeAgo(peer.last_handshake) : '—'}</span>
                  {(client.bandwidth_limit_down > 0 || client.bandwidth_limit_up > 0) && (
                    <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
                      <Gauge className="h-3 w-3" />
                      {client.bandwidth_limit_down > 0 && (
                        <span className="flex items-center gap-0.5"><ArrowDown className="h-2.5 w-2.5" />{client.bandwidth_limit_down}</span>
                      )}
                      {client.bandwidth_limit_down > 0 && client.bandwidth_limit_up > 0 && <span>/</span>}
                      {client.bandwidth_limit_up > 0 && (
                        <span className="flex items-center gap-0.5"><ArrowUp className="h-2.5 w-2.5" />{client.bandwidth_limit_up}</span>
                      )}
                      <span>Mbps</span>
                    </span>
                  )}
                  {client.email && <span className="font-mono">{client.email}</span>}
                </div>
                {/* Quota progress bar */}
                {quotaSet && (
                  <QuotaBar client={client} />
                )}
              </CardContent>
            </Card>
          )
        })}
        {clients.length === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            <p>No clients yet.</p>
          </div>
        )}
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="fixed bottom-4 max-lg:bottom-18 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 bg-popover border border-border rounded-xl shadow-xl px-4 py-2.5">
          <span className="text-sm font-medium mr-2">{selected.size} selected</span>
          <Button
            size="sm"
            variant="outline"
            disabled={bulkEnableMut.isPending}
            onClick={() => bulkEnableMut.mutate()}
            className="gap-1.5"
          >
            <ToggleRight className="h-3.5 w-3.5 text-green-500" />
            Enable
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={bulkDisableMut.isPending}
            onClick={() => bulkDisableMut.mutate()}
            className="gap-1.5"
          >
            <ToggleLeft className="h-3.5 w-3.5 text-muted-foreground" />
            Disable
          </Button>
          <Button
            size="sm"
            variant="destructive"
            disabled={bulkDeleteMut.isPending}
            onClick={() => {
              if (confirm(`Delete ${selected.size} client(s)? This cannot be undone.`))
                bulkDeleteMut.mutate()
            }}
            className="gap-1.5"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </Button>
          <Button size="sm" variant="ghost" onClick={clearSelection}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}
    </div>
  )
}

// ── Client actions dropdown menu ──────────────────────────────────────────────

function ClientActionsMenu({ client, onUpdated }: { client: Client; onUpdated: () => void }) {
  // Each dialog is controlled independently via open state lifted here
  const [configOpen, setConfigOpen] = useState(false)
  const [sendOpen, setSendOpen] = useState(false)
  const [qrOpen, setQrOpen] = useState(false)
  const [linkOpen, setLinkOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [quotaOpen, setQuotaOpen] = useState(false)
  const [bwOpen, setBwOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" title="Actions">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>Config</DropdownMenuLabel>
          <DropdownMenuItem onClick={() => setConfigOpen(true)}>
            <FileText className="h-3.5 w-3.5" /> View config
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setQrOpen(true)}>
            <QrCode className="h-3.5 w-3.5" /> QR code
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setLinkOpen(true)}>
            <Link2 className="h-3.5 w-3.5" /> Download link
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => setSendOpen(true)}
            disabled={!client.email}
            className={!client.email ? 'opacity-40' : ''}
          >
            <Mail className="h-3.5 w-3.5" /> Send by email
          </DropdownMenuItem>

          <DropdownMenuSeparator />
          <DropdownMenuLabel>Analytics & Limits</DropdownMenuLabel>
          <DropdownMenuItem onClick={() => setHistoryOpen(true)}>
            <History className="h-3.5 w-3.5" /> History
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setQuotaOpen(true)}>
            <DatabaseZap className={`h-3.5 w-3.5 ${client.data_quota_bytes > 0 ? 'text-purple-500' : ''}`} />
            Data quota {client.data_quota_bytes > 0 && <span className="ml-auto text-xs text-muted-foreground">{formatBytes(client.data_quota_bytes)}</span>}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setBwOpen(true)}>
            <Gauge className={`h-3.5 w-3.5 ${(client.bandwidth_limit_down > 0 || client.bandwidth_limit_up > 0) ? 'text-amber-500' : ''}`} />
            Bandwidth {(client.bandwidth_limit_down > 0 || client.bandwidth_limit_up > 0) && (
              <span className="ml-auto text-xs text-muted-foreground">
                {client.bandwidth_limit_down > 0 ? `↓${client.bandwidth_limit_down}` : ''}
                {client.bandwidth_limit_down > 0 && client.bandwidth_limit_up > 0 ? '/' : ''}
                {client.bandwidth_limit_up > 0 ? `↑${client.bandwidth_limit_up}` : ''} Mbps
              </span>
            )}
          </DropdownMenuItem>

          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setEditOpen(true)}>
            <Pencil className="h-3.5 w-3.5" /> Edit
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Dialogs — rendered outside the dropdown so they survive its unmount */}
      <ConfigButton clientId={client.id} name={client.name} open={configOpen} onOpenChange={setConfigOpen} />
      <SendConfigButton clientId={client.id} email={client.email} open={sendOpen} onOpenChange={setSendOpen} />
      <QRButton clientId={client.id} name={client.name} open={qrOpen} onOpenChange={setQrOpen} />
      <DownloadLinkButton clientId={client.id} open={linkOpen} onOpenChange={setLinkOpen} />
      <ClientHistoryDialog client={client} open={historyOpen} onOpenChange={setHistoryOpen} />
      <QuotaDialog client={client} open={quotaOpen} onOpenChange={setQuotaOpen} onUpdated={onUpdated} />
      <BandwidthDialog client={client} open={bwOpen} onOpenChange={setBwOpen} onUpdated={onUpdated} />
      <EditClientDialog client={client} open={editOpen} onOpenChange={setEditOpen} onUpdated={onUpdated} />
    </>
  )
}

/** Works on both HTTP and HTTPS by falling back to execCommand */
function copyToClipboard(text: string) {
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

function ConfigButton({ clientId, name, open, onOpenChange }: { clientId: number; name: string; open: boolean; onOpenChange: (v: boolean) => void }) {
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
          <div className="h-32 flex items-center justify-center text-muted-foreground">Loading…</div>
        ) : (
          <pre className="bg-muted rounded-md p-4 text-xs font-mono whitespace-pre overflow-x-auto max-h-80">
            {data}
          </pre>
        )}
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={handleCopy} disabled={!data}>
            {copied ? <><Check className="h-3 w-3 mr-1" />Copied!</> : <><Copy className="h-3 w-3 mr-1" />Copy</>}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function SendConfigButton({ clientId, email, open, onOpenChange }: { clientId: number; email?: string; open: boolean; onOpenChange: (v: boolean) => void }) {
  const mut = useMutation({
    mutationFn: () => sendConfigEmail(clientId),
    onSuccess: () => { onOpenChange(false) },
  })

  // Use dialog as confirmation step
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Send config by email</DialogTitle>
          <DialogDescription>
            A one-time download link will be sent to <span className="font-mono text-foreground">{email}</span>.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending}>
            {mut.isPending ? 'Sending…' : mut.isSuccess ? <><Check className="h-3.5 w-3.5 mr-1" /> Sent!</> : 'Send'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function QRButton({ clientId, name, open, onOpenChange }: { clientId: number; name: string; open: boolean; onOpenChange: (v: boolean) => void }) {
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
          <div className="h-64 flex items-center justify-center text-muted-foreground">Loading…</div>
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

function DownloadLinkButton({ clientId, open, onOpenChange }: { clientId: number; open: boolean; onOpenChange: (v: boolean) => void }) {
  const [url, setUrl] = useState<string | null>(null)
  const mut = useMutation({
    mutationFn: () => createDownloadLink(clientId),
    onSuccess: (data) => setUrl(`${window.location.origin}${data.url}`),
  })

  function handleOpen(v: boolean) {
    onOpenChange(v)
    if (v && !url) mut.mutate()
    if (!v) setUrl(null)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>One-time download link</DialogTitle>
          <DialogDescription>Valid for 1 hour, single use. Share this link to allow config download without login.</DialogDescription>
        </DialogHeader>
        {mut.isPending || !url ? (
          <div className="h-16 flex items-center justify-center text-muted-foreground text-sm">Generating…</div>
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

function EditClientDialog({ client, open, onOpenChange, onUpdated }: { client: Client; open: boolean; onOpenChange: (v: boolean) => void; onUpdated: () => void }) {
  const [form, setForm] = useState({ name: '', owner_label: '', email: '', allowed_ips: '', expires_at: '' })
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
    mutationFn: () => updateClient(client.id, {
      name: form.name || undefined,
      owner_label: form.owner_label || undefined,
      email: form.email,
      allowed_ips: form.allowed_ips || undefined,
      // If expires_at is empty, send clear_expires_at: true so the backend
      // explicitly nullifies the column (plain null is indistinguishable from
      // "field omitted" on a *time.Time pointer in Go).
      ...(form.expires_at
        ? { expires_at: new Date(form.expires_at + ':00Z').toISOString() }
        : { clear_expires_at: true }),
    }),
    onSuccess: () => { onOpenChange(false); onUpdated() },
    onError: (e: unknown) => {
      setError((e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Error')
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
            <Input id="edit-name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-owner">Owner label</Label>
            <Input id="edit-owner" value={form.owner_label} onChange={(e) => setForm((f) => ({ ...f, owner_label: e.target.value }))} placeholder="alice" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-email">Client email <span className="text-muted-foreground text-xs">(receives notifications)</span></Label>
            <Input id="edit-email" type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} placeholder="alice@example.com" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-ips">Allowed IPs</Label>
            <Input id="edit-ips" value={form.allowed_ips} onChange={(e) => setForm((f) => ({ ...f, allowed_ips: e.target.value }))} placeholder="0.0.0.0/0, ::/0" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-expiry">Expiry <span className="text-muted-foreground text-xs">(UTC — leave empty for no expiry)</span></Label>
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
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending || !form.name}>
            {mutation.isPending ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ClientHistoryDialog({ client, open, onOpenChange }: { client: Client; open: boolean; onOpenChange: (v: boolean) => void }) {
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
    <>
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
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => formatBytes(v as number)} width={72} />
                  <Tooltip formatter={(v) => formatBytes(v as number)} />
                  <Area type="monotone" dataKey="rx" stroke="#3b82f6" fill={`url(#crx-${client.id})`} name="↓ Download" />
                  <Area type="monotone" dataKey="tx" stroke="#10b981" fill={`url(#ctx-${client.id})`} name="↑ Upload" />
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
                  <div key={e.id} className="flex items-center gap-2.5 text-xs py-1 border-b border-border last:border-0">
                    {e.event_type === 'connected'
                      ? <Wifi className="h-3.5 w-3.5 text-green-500 shrink-0" />
                      : <WifiOff className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                    <span className={e.event_type === 'connected' ? 'text-green-600 dark:text-green-400 font-medium' : 'text-muted-foreground'}>
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
    </>
  )
}

function formatSnapshotTime(iso: string, range: '1h' | '24h' | '7d'): string {
  const d = new Date(iso)
  if (range === '7d') {
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit' })
  }
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

// ── Quota bar (inline in client card) ────────────────────────────────────────

function QuotaBar({ client }: { client: Client }) {
  const { data: snapshots = [] } = useQuery({
    queryKey: ['client-snapshots-quota', client.id],
    queryFn: () => {
      const period = client.quota_period ?? 'monthly'
      const range = period === 'total' ? '7d' : period === 'weekly' ? '7d' : '24h'
      return import('@/api/clients').then((m) => m.getClientSnapshots(client.id, range))
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  })

  // For monthly/weekly, filter client-side to the current period start
  const periodStart = (() => {
    const now = new Date()
    if (client.quota_period === 'weekly') {
      const day = now.getDay() === 0 ? 6 : now.getDay() - 1 // Mon=0
      const d = new Date(now); d.setDate(d.getDate() - day); d.setHours(0, 0, 0, 0)
      return d
    }
    if (client.quota_period === 'total') return new Date(0)
    // monthly
    return new Date(now.getFullYear(), now.getMonth(), 1)
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
        <span>{formatBytes(used)} / {formatBytes(quota)} ({pct}%)</span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

// ── Quota dialog ──────────────────────────────────────────────────────────────

function QuotaDialog({ client, open, onOpenChange, onUpdated }: { client: Client; open: boolean; onOpenChange: (v: boolean) => void; onUpdated: () => void }) {
  const [quotaGb, setQuotaGb] = useState(0)
  const [period, setPeriod] = useState<'monthly' | 'weekly' | 'total'>('monthly')
  const [error, setError] = useState('')

  useEffect(() => {
    if (open) {
      setQuotaGb(client.data_quota_bytes > 0 ? Math.round(client.data_quota_bytes / 1e9 * 100) / 100 : 0)
      setPeriod(client.quota_period ?? 'monthly')
      setError('')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const mutation = useMutation({
    mutationFn: () => updateClient(client.id, {
      data_quota_bytes: Math.round(quotaGb * 1e9),
      quota_period: period,
    }),
    onSuccess: () => { onOpenChange(false); onUpdated() },
    onError: (e: unknown) => {
      setError((e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Error')
    },
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

function BandwidthDialog({ client, open, onOpenChange, onUpdated }: { client: Client; open: boolean; onOpenChange: (v: boolean) => void; onUpdated: () => void }) {
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
    mutationFn: () => updateClient(client.id, {
      bandwidth_limit_down: down,
      bandwidth_limit_up: up,
    }),
    onSuccess: () => { onOpenChange(false); onUpdated() },
    onError: (e: unknown) => {
      setError((e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Error')
    },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Bandwidth — {client.name}</DialogTitle>
            <DialogDescription>
              Set per-direction caps via Linux tc. 0 = unlimited.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="bw-down" className="flex items-center gap-1.5">
                <ArrowDown className="h-3.5 w-3.5 text-blue-500" />
                Download limit <span className="text-muted-foreground text-xs">(server → client, Mbps)</span>
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
                Upload limit <span className="text-muted-foreground text-xs">(client → server, Mbps)</span>
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

function CreateClientDialog({
  interfaces,
  defaultInterfaceId,
  onCreated,
}: {
  interfaces: { id: number; name: string }[]
  defaultInterfaceId?: number
  onCreated: () => void
}) {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({
    interface_id: defaultInterfaceId ?? interfaces[0]?.id ?? 0,
    name: '',
    owner_label: '',
    email: '',
    allowed_ips: '0.0.0.0/0, ::/0',
    expires_at: '',
  })
  const [error, setError] = useState('')

  const mutation = useMutation({
    mutationFn: (payload: CreateClientPayload) => createClient(payload),
    onSuccess: () => { setOpen(false); onCreated() },
    onError: (e: unknown) => {
      setError((e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Error')
    },
  })

  function setField<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function submit() {
    const payload: CreateClientPayload = {
      interface_id: form.interface_id,
      name: form.name,
      owner_label: form.owner_label || undefined,
      email: form.email || undefined,
      allowed_ips: form.allowed_ips || undefined,
      // datetime-local gives "YYYY-MM-DDTHH:MM" — append seconds + Z so Date parses as UTC
      expires_at: form.expires_at ? new Date(form.expires_at + ':00Z').toISOString() : undefined,
    }
    mutation.mutate(payload)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="h-4 w-4 mr-2" /> Add client
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add WireGuard client</DialogTitle>
          <DialogDescription>Keypair and IP are generated automatically.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="iface-select">Interface</Label>
            <select
              id="iface-select"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={form.interface_id}
              onChange={(e) => setField('interface_id', Number(e.target.value))}
            >
              {interfaces.map((i) => (
                <option key={i.id} value={i.id}>{i.name}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="client-name">Name</Label>
            <Input id="client-name" value={form.name} onChange={(e) => setField('name', e.target.value)} placeholder="Alice's laptop" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="owner">Owner label</Label>
            <Input id="owner" value={form.owner_label} onChange={(e) => setField('owner_label', e.target.value)} placeholder="alice" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="email">
              Client email <span className="text-muted-foreground text-xs">(optional — receives one-time download link)</span>
            </Label>
            <Input id="email" type="email" value={form.email} onChange={(e) => setField('email', e.target.value)} placeholder="alice@example.com" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="allowed">Allowed IPs</Label>
            <Input id="allowed" value={form.allowed_ips} onChange={(e) => setField('allowed_ips', e.target.value)} placeholder="0.0.0.0/0, ::/0" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="create-expiry">
              Expiry <span className="text-muted-foreground text-xs">(UTC — leave empty for no expiry)</span>
            </Label>
            <Input
              id="create-expiry"
              type="datetime-local"
              value={form.expires_at}
              onChange={(e) => setField('expires_at', e.target.value)}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={submit} disabled={mutation.isPending || !form.name || !form.interface_id}>
            {mutation.isPending ? 'Adding…' : 'Add client'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
