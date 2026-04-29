import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'
import { Plus, Trash2, QrCode, Link2, ToggleLeft, ToggleRight, Clock, FileText, Copy, Check, Pencil, Mail } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import {
  listClients, createClient, updateClient, deleteClient, enableClient, disableClient,
  getClientQR, getClientConfigText, createDownloadLink, sendConfigEmail,
  type CreateClientPayload, type Client,
} from '@/api/clients'
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

  if (isLoading) return <div className="p-6 animate-pulse space-y-3">{[1,2,3].map(i => <div key={i} className="h-20 bg-muted rounded-lg" />)}</div>

  const title = ifaceId ? interfaces.find((i) => i.id === ifaceId)?.name ?? `Interface ${ifaceId}` : 'All clients'

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Clients</h1>
          <p className="text-muted-foreground text-sm mt-1">{title}</p>
        </div>
        <CreateClientDialog
          interfaces={interfaces}
          defaultInterfaceId={ifaceId}
          onCreated={() => qc.invalidateQueries({ queryKey: ['clients'] })}
        />
      </div>

      <div className="space-y-3">
        {clients.map((client) => {
          const peer = peerMap.get(client.id)
          return (
            <Card key={client.id}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span
                      className={`h-2.5 w-2.5 rounded-full ${peer?.connected ? 'bg-green-500' : 'bg-muted-foreground/30'}`}
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
                    <ConfigButton clientId={client.id} name={client.name} />
                    <SendConfigButton clientId={client.id} email={client.email} />
                    <QRButton clientId={client.id} name={client.name} />
                    <DownloadLinkButton clientId={client.id} />
                    <EditClientDialog client={client} onUpdated={() => qc.invalidateQueries({ queryKey: ['clients'] })} />
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
                  {client.email && <span className="font-mono">{client.email}</span>}
                </div>
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
    </div>
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

function ConfigButton({ clientId, name }: { clientId: number; name: string }) {
  const [open, setOpen] = useState(false)
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
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" title="View config">
          <FileText className="h-4 w-4" />
        </Button>
      </DialogTrigger>
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

function SendConfigButton({ clientId, email }: { clientId: number; email?: string }) {
  const [sent, setSent] = useState(false)

  const mut = useMutation({
    mutationFn: () => sendConfigEmail(clientId),
    onSuccess: () => {
      setSent(true)
      setTimeout(() => setSent(false), 3000)
    },
  })

  const hasEmail = !!email

  return (
    <Button
      variant="ghost"
      size="icon"
      title={hasEmail ? `Send config to ${email}` : 'No email set on this client'}
      disabled={!hasEmail || mut.isPending}
      onClick={() => mut.mutate()}
      className={sent ? 'text-green-500' : ''}
    >
      {sent
        ? <Check className="h-4 w-4 text-green-500" />
        : mut.isPending
          ? <Mail className="h-4 w-4 animate-pulse" />
          : <Mail className={`h-4 w-4 ${!hasEmail ? 'opacity-30' : ''}`} />}
    </Button>
  )
}

function QRButton({ clientId, name }: { clientId: number; name: string }) {
  const [open, setOpen] = useState(false)
  const { data, isFetching } = useQuery({
    queryKey: ['client-qr', clientId],
    queryFn: () => getClientQR(clientId),
    enabled: open,
  })
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" title="QR code">
          <QrCode className="h-4 w-4" />
        </Button>
      </DialogTrigger>
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

function DownloadLinkButton({ clientId }: { clientId: number }) {
  const [url, setUrl] = useState<string | null>(null)
  const mut = useMutation({
    mutationFn: () => createDownloadLink(clientId),
    onSuccess: (data) => setUrl(`${window.location.origin}${data.url}`),
  })
  return (
    <>
      <Button variant="ghost" size="icon" title="One-time download link" onClick={() => mut.mutate()}>
        <Link2 className="h-4 w-4" />
      </Button>
      <Dialog open={!!url} onOpenChange={() => setUrl(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>One-time download link</DialogTitle>
            <DialogDescription>Valid for 1 hour, single use. Share this link to allow config download without login.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex gap-2">
              <input
                readOnly
                value={url ?? ''}
                className="flex-1 rounded-md border border-input bg-muted px-3 py-2 text-xs font-mono"
              />
              <Button size="sm" onClick={() => { copyToClipboard(url ?? ''); setUrl(null) }}>
                Copy
              </Button>
            </div>
            <a
              href={url ?? '#'}
              target="_blank"
              rel="noopener noreferrer"
              className="block text-xs text-primary underline break-all"
              onClick={() => setTimeout(() => setUrl(null), 500)}
            >
              Click to download directly →
            </a>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

function EditClientDialog({ client, onUpdated }: { client: Client; onUpdated: () => void }) {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ name: '', owner_label: '', email: '', allowed_ips: '', expires_at: '' })
  const [error, setError] = useState('')

  function openDialog() {
    setForm({
      name: client.name,
      owner_label: client.owner_label ?? '',
      email: client.email ?? '',
      allowed_ips: client.allowed_ips ?? '0.0.0.0/0, ::/0',
      // slice to "YYYY-MM-DDTHH:MM" so datetime-local renders correctly as UTC
      expires_at: client.expires_at ? client.expires_at.slice(0, 16) : '',
    })
    setError('')
    setOpen(true)
  }

  const mutation = useMutation({
    mutationFn: () => updateClient(client.id, {
      name: form.name || undefined,
      owner_label: form.owner_label || undefined,
      email: form.email,
      allowed_ips: form.allowed_ips || undefined,
      // append ":00Z" so Date parses the datetime-local value as UTC
      expires_at: form.expires_at ? new Date(form.expires_at + ':00Z').toISOString() : null,
    }),
    onSuccess: () => { setOpen(false); onUpdated() },
    onError: (e: unknown) => {
      setError((e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Error')
    },
  })

  return (
    <>
      <Button variant="ghost" size="icon" title="Edit" onClick={openDialog}>
        <Pencil className="h-4 w-4" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
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
              <Input id="edit-expiry" type="datetime-local" value={form.expires_at} onChange={(e) => setForm((f) => ({ ...f, expires_at: e.target.value }))} />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => mutation.mutate()} disabled={mutation.isPending || !form.name}>
              {mutation.isPending ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
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
