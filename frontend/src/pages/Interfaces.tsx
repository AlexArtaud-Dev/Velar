import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, Power, PowerOff, Users, ChevronRight, Network } from 'lucide-react'
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
  listInterfaces, createInterface, deleteInterface, bringUp, bringDown,
  type CreateInterfacePayload,
} from '@/api/interfaces'

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

function CreateInterfaceDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<CreateInterfacePayload>({
    name: 'wg0',
    port: 51820,
    subnet: '10.0.0.0/24',
    dns_server: '1.1.1.1',
  })
  const [error, setError] = useState('')

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
          <Field label="Subnet (CIDR)" id="subnet" value={form.subnet ?? ''} onChange={set('subnet')} placeholder="10.0.0.0/24" />
          <Field label="DNS server" id="dns" value={form.dns_server ?? ''} onChange={set('dns_server')} placeholder="1.1.1.1" />
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

