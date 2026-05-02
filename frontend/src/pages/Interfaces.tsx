import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, Power, PowerOff, Users, ChevronRight, Network, Pencil, ShieldCheck, CheckCircle2, XCircle, Loader2, Wifi, Globe, Key } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import {
  listInterfaces, createInterface, updateInterface, deleteInterface, bringUp, bringDown, checkInterface,
  type CreateInterfacePayload, type UpdateInterfacePayload, type WGInterface,
} from '@/api/interfaces'
import { getAdguardStatus } from '@/api/settings'
import { useThemeStore } from '@/stores/theme'
import { cn } from '@/lib/utils'

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
  const { theme } = useThemeStore()
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

  const isCyber = theme === 'cyberpunk'
  const cardExtra = cn(
    theme === 'apple'     && 'apple-glass',
    theme === 'cyberpunk' && 'cyber-card',
  )

  if (isLoading) return <PageSkeleton />

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Interfaces</h1>
          <p className="text-muted-foreground text-sm mt-1">Manage WireGuard network interfaces</p>
        </div>
        <CreateInterfaceDialog onCreated={() => qc.invalidateQueries({ queryKey: ['interfaces'] })} />
      </div>

      <div className="grid gap-4">
        {ifaces.map((iface) => (
          <Card key={iface.id} className={cn('overflow-hidden', cardExtra)}>
            {/* Coloured status stripe */}
            <div className={cn(
              'h-1 w-full',
              iface.up
                ? isCyber ? 'bg-[hsl(180,100%,50%)]' : 'bg-green-500'
                : 'bg-destructive',
            )} />

            <CardHeader className="pb-3 pt-4">
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                {/* Left: name + meta */}
                <div className="space-y-2">
                  <div className="flex items-center gap-3">
                    <div className={cn(
                      'p-2 rounded-[var(--radius)]',
                      iface.up
                        ? isCyber ? 'bg-[rgba(0,255,255,0.1)]' : 'bg-green-500/10'
                        : 'bg-muted',
                    )}>
                      <Network className={cn(
                        'h-4 w-4',
                        iface.up
                          ? isCyber ? 'text-[hsl(180,100%,50%)]' : 'text-green-500'
                          : 'text-muted-foreground',
                      )} />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <CardTitle className="text-base font-mono">{iface.name}</CardTitle>
                        <Badge variant={iface.up ? 'success' : 'destructive'} className="text-[10px] px-1.5 py-0 h-4">
                          {iface.up ? 'UP' : 'DOWN'}
                        </Badge>
                        {iface.lan_access && (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 gap-1">
                            <Wifi className="h-2.5 w-2.5" /> LAN
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Meta grid */}
                  <div className="flex flex-wrap gap-x-4 gap-y-1 pl-12">
                    <MetaChip icon={<Globe className="h-3 w-3" />} label={iface.subnet} />
                    <MetaChip icon={<span className="text-[10px] font-bold">UDP</span>} label={`:${iface.port}`} />
                    <MetaChip icon={<span className="text-[10px] font-bold">DNS</span>} label={iface.dns_server} />
                    {iface.lan_access && iface.lan_subnet && (
                      <MetaChip icon={<Wifi className="h-3 w-3" />} label={iface.lan_subnet} />
                    )}
                  </div>
                </div>

                {/* Right: actions */}
                <div className="flex flex-wrap items-center gap-1.5 sm:shrink-0">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs gap-1.5"
                    onClick={() => navigate(`/interfaces/${iface.id}/clients`)}
                  >
                    <Users className="h-3 w-3" />
                    {iface.peer_count} clients
                    <ChevronRight className="h-3 w-3 opacity-50" />
                  </Button>
                  {iface.up ? (
                    <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => downMut.mutate(iface.id)} title="Bring down">
                      <PowerOff className="h-3.5 w-3.5" />
                    </Button>
                  ) : (
                    <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => upMut.mutate(iface.id)} title="Bring up">
                      <Power className="h-3.5 w-3.5 text-green-500" />
                    </Button>
                  )}
                  <CheckButton iface={iface} />
                  <EditInterfaceDialog iface={iface} onUpdated={() => {
                    qc.invalidateQueries({ queryKey: ['interfaces'] })
                    qc.invalidateQueries({ queryKey: ['clients'] })
                  }} />
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => { if (confirm(`Delete ${iface.name}?`)) deleteMut.mutate(iface.id) }}
                    title="Delete"
                  >
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </div>
              </div>
            </CardHeader>

            {/* Public key — collapsed in footer */}
            <CardContent className="pt-0 pb-3">
              <div className={cn(
                'flex items-center gap-2 px-3 py-2 rounded-[calc(var(--radius)-2px)] text-xs font-mono text-muted-foreground',
                isCyber ? 'bg-[rgba(0,255,255,0.04)] border border-[rgba(0,255,255,0.08)]' : 'bg-muted/40',
              )}>
                <Key className="h-3 w-3 shrink-0 opacity-60" />
                <span className="truncate">{iface.public_key}</span>
              </div>
            </CardContent>
          </Card>
        ))}
        {ifaces.length === 0 && (
          <div className="text-center py-16 text-muted-foreground">
            <Network className="h-12 w-12 mx-auto mb-3 opacity-20" />
            <p className="font-medium">No interfaces yet</p>
            <p className="text-sm mt-1 opacity-70">Create one to get started.</p>
          </div>
        )}
      </div>
    </div>
  )
}

function MetaChip({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <span className="flex items-center gap-1 text-xs text-muted-foreground">
      <span className="opacity-60">{icon}</span>
      <span className="font-mono">{label}</span>
    </span>
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
    lan_access: false,
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
          {/* LAN access */}
          <div
            className="flex items-center justify-between rounded-lg border border-border px-4 py-3 cursor-pointer select-none"
            onClick={() => setForm((f) => ({ ...f, lan_access: !f.lan_access }))}
          >
            <div>
              <p className="text-sm font-medium">Local network access</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Clients can reach LAN devices (e.g. 192.168.1.x) — split tunnel, auto-detected subnet
              </p>
            </div>
            <div className={`w-9 h-5 rounded-full transition-colors shrink-0 ml-4 ${form.lan_access ? 'bg-primary' : 'bg-muted'}`}>
              <div className={`w-4 h-4 rounded-full bg-white shadow m-0.5 transition-transform ${form.lan_access ? 'translate-x-4' : 'translate-x-0'}`} />
            </div>
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
      lan_access: iface.lan_access,
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
            {/* LAN access */}
            <div
              className="flex items-center justify-between rounded-lg border border-border px-4 py-3 cursor-pointer select-none"
              onClick={() => setForm((f) => ({ ...f, lan_access: !f.lan_access }))}
            >
              <div>
                <p className="text-sm font-medium">Local network access</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {iface.lan_access && iface.lan_subnet
                    ? `Currently routing ${iface.lan_subnet} — toggle to disable`
                    : 'Clients can reach LAN devices — split tunnel, subnet auto-detected'}
                </p>
              </div>
              <div className={`w-9 h-5 rounded-full transition-colors shrink-0 ml-4 ${form.lan_access ? 'bg-primary' : 'bg-muted'}`}>
                <div className={`w-4 h-4 rounded-full bg-white shadow m-0.5 transition-transform ${form.lan_access ? 'translate-x-4' : 'translate-x-0'}`} />
              </div>
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

