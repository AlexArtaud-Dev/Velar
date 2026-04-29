import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, Power, PowerOff, Users, ChevronRight, Network, Pencil, ShieldCheck, CheckCircle2, XCircle, Loader2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import {
  listInterfaces, createInterface, updateInterface, deleteInterface, bringUp, bringDown, checkInterface,
  type CreateInterfacePayload, type UpdateInterfacePayload, type WGInterface,
} from '@/api/interfaces'
import { getAdguardStatus } from '@/api/settings'

const DNS_PRESETS = [
  { label: 'Cloudflare', value: '1.1.1.1' },
  { label: 'Google', value: '8.8.8.8' },
  { label: 'Quad9', value: '9.9.9.9' },
]

function serverIPFromSubnet(subnet: string): string {
  try {
    const base = subnet.split('/')[0]
    const parts = base.split('.')
    parts[3] = String(Number(parts[3]) + 1)
    return parts.join('.')
  } catch { return '' }
}

export default function Interfaces() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { data: ifaces = [], isLoading } = useQuery({ queryKey: ['interfaces'], queryFn: listInterfaces, refetchInterval: 5000 })

  const deleteMut = useMutation({
    mutationFn: deleteInterface,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['interfaces'] }),
  })
  const upMut = useMutation({
    mutationFn: bringUp,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['interfaces'] }),
  })
  const downMut = useMutation({
    mutationFn: bringDown,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['interfaces'] }),
  })

  if (isLoading) return <PageSkeleton />

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Interfaces</h1>
          <p className="text-muted-foreground text-sm mt-1">Manage WireGuard network interfaces</p>
        </div>
        <CreateInterfaceDialog onCreated={() => qc.invalidateQueries({ queryKey: ['interfaces'] })} />
      </div>

      <div className="grid gap-4">
        {ifaces.map((iface) => (
          <Card key={iface.id}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Badge variant={iface.up ? 'success' : 'destructive'}>{iface.up ? 'UP' : 'DOWN'}</Badge>
                  <CardTitle className="text-lg font-mono">{iface.name}</CardTitle>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => navigate(`/interfaces/${iface.id}/clients`)}
                  >
                    <Users className="h-3 w-3 mr-1" />
                    {iface.peer_count} clients
                    <ChevronRight className="h-3 w-3 ml-1" />
                  </Button>
                  {iface.up ? (
                    <Button variant="outline" size="icon" onClick={() => downMut.mutate(iface.id)} title="Bring down">
                      <PowerOff className="h-4 w-4" />
                    </Button>
                  ) : (
                    <Button variant="outline" size="icon" onClick={() => upMut.mutate(iface.id)} title="Bring up">
                      <Power className="h-4 w-4" />
                    </Button>
                  )}
                  <CheckButton iface={iface} />
                  <EditInterfaceDialog iface={iface} onUpdated={() => qc.invalidateQueries({ queryKey: ['interfaces'] })} />
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => { if (confirm(`Delete ${iface.name}?`)) deleteMut.mutate(iface.id) }}
                    title="Delete"
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>
              <CardDescription className="font-mono text-xs">{iface.subnet} • :{iface.port} • DNS {iface.dns_server}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-xs text-muted-foreground font-mono break-all">
                <span className="font-semibold">PubKey:</span> {iface.public_key}
              </div>
            </CardContent>
          </Card>
        ))}
        {ifaces.length === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            <Network className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p>No interfaces yet. Create one to get started.</p>
          </div>
        )}
      </div>
    </div>
  )
}

function CheckButton({ iface }: { iface: WGInterface }) {
  const [open, setOpen] = useState(false)
  const { data, isFetching, refetch } = useQuery({
    queryKey: ['iface-check', iface.id],
    queryFn: () => checkInterface(iface.id),
    enabled: open,
    staleTime: 0,
  })

  function StatusRow({ label, ok, detail }: { label: string; ok: boolean; detail?: string }) {
    return (
      <div className="flex items-center gap-3">
        {ok
          ? <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
          : <XCircle className="h-4 w-4 text-destructive shrink-0" />}
        <span className="text-sm flex-1">{label}</span>
        {detail && <span className="text-xs text-muted-foreground font-mono">{detail}</span>}
      </div>
    )
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="icon" title="Check connectivity">
          <ShieldCheck className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Connectivity check — {iface.name}</DialogTitle>
          <DialogDescription>Verifies the interface is up and the port is bound.</DialogDescription>
        </DialogHeader>
        {isFetching ? (
          <div className="flex items-center justify-center gap-2 py-6 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Checking…
          </div>
        ) : data ? (
          <div className="space-y-3 py-2">
            <StatusRow label="Interface is UP" ok={data.interface_up} detail={data.interface} />
            <StatusRow label="UDP port bound" ok={data.port_bound} detail={`:${data.port}`} />
            <p className="text-xs text-muted-foreground pt-1">
              To verify external reachability, ensure port <span className="font-mono">{data.port}/UDP</span> is forwarded on your router to this server.
            </p>
          </div>
        ) : null}
        <div className="flex justify-end">
          <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching}>
            {isFetching ? 'Checking…' : 'Re-check'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function CreateInterfaceDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<CreateInterfacePayload>({
    name: 'wg0',
    port: 51820,
    subnet: '10.0.0.0/24',
    dns_server: '1.1.1.1',
  })
  const [error, setError] = useState('')

  const { data: adguard } = useQuery({
    queryKey: ['adguard-status'],
    queryFn: getAdguardStatus,
    enabled: open,
    retry: false,
  })

  const adguardIP = serverIPFromSubnet(form.subnet ?? '10.0.0.0/24')
  const adguardAvailable = adguard?.running === true

  const mutation = useMutation({
    mutationFn: createInterface,
    onSuccess: () => { setOpen(false); onCreated() },
    onError: (e: unknown) => {
      setError((e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Error')
    },
  })

  function set(key: keyof CreateInterfacePayload) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({ ...f, [key]: key === 'port' ? Number(e.target.value) : e.target.value }))
  }

  const allPresets = [
    ...(adguardAvailable ? [{ label: `AdGuard (${adguardIP})`, value: adguardIP }] : []),
    ...DNS_PRESETS,
  ]

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="h-4 w-4 mr-2" />
          New interface
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create WireGuard interface</DialogTitle>
          <DialogDescription>A new keypair will be generated automatically.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <Field label="Name" id="name" value={form.name} onChange={set('name')} placeholder="wg0" />
          <Field label="Listen port" id="port" type="number" value={String(form.port)} onChange={set('port')} placeholder="51820" />
          <div className="space-y-1.5">
              <Label htmlFor="subnet">Subnet (CIDR)</Label>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {SUBNET_PRESETS.map((s) => (
                  <button key={s} type="button"
                    onClick={() => setForm((f) => ({ ...f, subnet: s }))}
                    className={`px-2.5 py-1 rounded-md text-xs border transition-colors ${form.subnet === s ? 'bg-primary text-primary-foreground border-primary' : 'bg-muted text-muted-foreground border-border hover:border-primary'}`}
                  >{s}</button>
                ))}
              </div>
              <Input id="subnet" value={form.subnet ?? ''} onChange={set('subnet')} placeholder="10.0.0.0/24" />
            </div>
          <div className="space-y-1.5">
            <Label>DNS server</Label>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {allPresets.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, dns_server: p.value }))}
                  className={`px-2.5 py-1 rounded-md text-xs border transition-colors ${
                    form.dns_server === p.value
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-muted text-muted-foreground border-border hover:border-primary'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <Input
              id="dns"
              value={form.dns_server ?? ''}
              onChange={set('dns_server')}
              placeholder="Custom DNS (e.g. 1.1.1.1)"
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={() => mutation.mutate(form)} disabled={mutation.isPending}>
            {mutation.isPending ? 'Creating…' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const SUBNET_PRESETS = [
  '10.0.0.0/24',
  '10.0.1.0/24',
  '10.8.0.0/24',
  '172.16.0.0/24',
  '192.168.10.0/24',
]

function EditInterfaceDialog({ iface, onUpdated }: { iface: WGInterface; onUpdated: () => void }) {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<UpdateInterfacePayload>({})
  const [error, setError] = useState('')
  const { data: ifaces = [] } = useQuery({ queryKey: ['interfaces'], queryFn: listInterfaces })

  function openDialog() {
    setForm({
      dns_server: iface.dns_server,
      port: iface.port,
      subnet: iface.subnet,
      post_up: iface.post_up,
      post_down: iface.post_down,
    })
    setError('')
    setOpen(true)
  }

  const portConflict = form.port !== iface.port &&
    ifaces.some((i) => i.id !== iface.id && i.port === form.port)

  const mutation = useMutation({
    mutationFn: () => updateInterface(iface.id, form),
    onSuccess: () => { setOpen(false); onUpdated() },
    onError: (e: unknown) => {
      setError((e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Error')
    },
  })

  const allPresets = [
    ...(form.subnet ? [{ label: `AdGuard (${serverIPFromSubnet(form.subnet)})`, value: serverIPFromSubnet(form.subnet) }] : []),
    ...DNS_PRESETS,
  ]

  return (
    <>
      <Button variant="outline" size="icon" title="Edit" onClick={openDialog}>
        <Pencil className="h-4 w-4" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit {iface.name}</DialogTitle>
            <DialogDescription>Changes to port, subnet or PostUp will restart the interface.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Listen port</Label>
              <Input
                type="number"
                value={form.port ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, port: Number(e.target.value) }))}
              />
              {portConflict && <p className="text-xs text-destructive">Port already used by another interface</p>}
            </div>
            <div className="space-y-1.5">
              <Label>Subnet (CIDR)</Label>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {SUBNET_PRESETS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setForm((f) => {
                      const newDns = f.dns_server === serverIPFromSubnet(iface.subnet)
                        ? serverIPFromSubnet(s)
                        : f.dns_server
                      return { ...f, subnet: s, dns_server: newDns }
                    })}
                    className={`px-2.5 py-1 rounded-md text-xs border transition-colors ${
                      form.subnet === s
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-muted text-muted-foreground border-border hover:border-primary'
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
              <Input
                value={form.subnet ?? ''}
                onChange={(e) => {
                  const newSubnet = e.target.value
                  setForm((f) => {
                    const newDns = f.dns_server === serverIPFromSubnet(iface.subnet)
                      ? serverIPFromSubnet(newSubnet)
                      : f.dns_server
                    return { ...f, subnet: newSubnet, dns_server: newDns }
                  })
                }}
                placeholder="10.0.0.0/24"
              />
            </div>
            <div className="space-y-1.5">
              <Label>DNS server</Label>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {allPresets.map((p) => (
                  <button
                    key={p.value}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, dns_server: p.value }))}
                    className={`px-2.5 py-1 rounded-md text-xs border transition-colors ${
                      form.dns_server === p.value
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-muted text-muted-foreground border-border hover:border-primary'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <Input
                value={form.dns_server ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, dns_server: e.target.value }))}
                placeholder="1.1.1.1"
              />
            </div>
            <div className="space-y-1.5">
              <Label>PostUp</Label>
              <Input value={form.post_up ?? ''} onChange={(e) => setForm((f) => ({ ...f, post_up: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>PostDown</Label>
              <Input value={form.post_down ?? ''} onChange={(e) => setForm((f) => ({ ...f, post_down: e.target.value }))} />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => mutation.mutate()} disabled={mutation.isPending || portConflict}>
              {mutation.isPending ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function Field({ label, id, ...props }: { label: string; id: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} {...props} />
    </div>
  )
}

function PageSkeleton() {
  return (
    <div className="p-6 space-y-4 animate-pulse">
      {[1, 2].map((i) => (
        <div key={i} className="h-32 rounded-lg bg-muted" />
      ))}
    </div>
  )
}

