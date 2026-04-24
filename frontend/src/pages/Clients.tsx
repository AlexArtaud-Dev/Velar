import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'
import { Plus, Trash2, QrCode, Download, Link2, ToggleLeft, ToggleRight, Clock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import {
  listClients, createClient, deleteClient, enableClient, disableClient,
  getClientQR, createDownloadLink, type CreateClientPayload,
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
                    <QRButton clientId={client.id} name={client.name} />
                    <DownloadLinkButton clientId={client.id} />
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
      <DialogContent className="max-w-xs text-center">
        <DialogHeader>
          <DialogTitle>QR — {name}</DialogTitle>
          <DialogDescription>Scan with the WireGuard app</DialogDescription>
        </DialogHeader>
        {isFetching ? (
          <div className="h-64 flex items-center justify-center text-muted-foreground">Loading…</div>
        ) : data?.qr_code ? (
          <img
            src={`data:image/png;base64,${data.qr_code}`}
            alt="QR code"
            className="mx-auto rounded-lg"
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function DownloadLinkButton({ clientId }: { clientId: number }) {
  const [copied, setCopied] = useState(false)
  const mut = useMutation({
    mutationFn: () => createDownloadLink(clientId),
    onSuccess: (data) => {
      const url = `${window.location.origin}${data.url}`
      navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    },
  })
  return (
    <Button variant="ghost" size="icon" title="Copy one-time download link" onClick={() => mut.mutate()}>
      {copied ? <Download className="h-4 w-4 text-green-500" /> : <Link2 className="h-4 w-4" />}
    </Button>
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
  const [form, setForm] = useState<CreateClientPayload>({
    interface_id: defaultInterfaceId ?? interfaces[0]?.id ?? 0,
    name: '',
    owner_label: '',
    allowed_ips: '0.0.0.0/0, ::/0',
  })
  const [error, setError] = useState('')

  const mutation = useMutation({
    mutationFn: createClient,
    onSuccess: () => { setOpen(false); onCreated() },
    onError: (e: unknown) => {
      setError((e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Error')
    },
  })

  function setField<K extends keyof CreateClientPayload>(key: K, value: CreateClientPayload[K]) {
    setForm((f) => ({ ...f, [key]: value }))
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
            <Input id="owner" value={form.owner_label ?? ''} onChange={(e) => setField('owner_label', e.target.value)} placeholder="alice" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="allowed">Allowed IPs</Label>
            <Input id="allowed" value={form.allowed_ips ?? ''} onChange={(e) => setField('allowed_ips', e.target.value)} placeholder="0.0.0.0/0, ::/0" />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={() => mutation.mutate(form)} disabled={mutation.isPending || !form.name || !form.interface_id}>
            {mutation.isPending ? 'Adding…' : 'Add client'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
