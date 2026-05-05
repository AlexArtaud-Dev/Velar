import { useState, useEffect } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Plus, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader,
  DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import { createClient, type CreateClientPayload } from '@/api/clients'
import { listInstances, proxyToInstance } from '@/api/instances'

interface CreateClientDialogProps {
  /** Local interfaces (pre-loaded by parent). */
  interfaces: { id: number; name: string }[]
  /** Pre-selects a local interface when opened from a scoped view. */
  defaultInterfaceId?: number
  /** Called after a client is successfully created on any instance. */
  onCreated: () => void
}

/**
 * CreateClientDialog — unified "Add client" dialog.
 * When slave instances exist, a selector at the top lets the user choose
 * whether the client is created locally or on a specific slave.
 * For slaves the interface list is fetched dynamically via proxyToInstance.
 */
export function CreateClientDialog({ interfaces, defaultInterfaceId, onCreated }: CreateClientDialogProps) {
  const [open, setOpen] = useState(false)
  const [instanceId, setInstanceId] = useState<number | null>(null) // null = local
  const [form, setForm] = useState({
    interface_id: defaultInterfaceId ?? interfaces[0]?.id ?? 0,
    name: '',
    owner_label: '',
    email: '',
    allowed_ips: '0.0.0.0/0, ::/0',
    expires_at: '',
  })
  const [error, setError] = useState('')

  const { data: instances = [] } = useQuery({ queryKey: ['instances'], queryFn: listInstances })

  const { data: slaveIfaces = [], isLoading: loadingSlaveIfaces } = useQuery({
    queryKey: ['slave-ifaces-create', instanceId],
    queryFn: () =>
      proxyToInstance(instanceId!, 'GET', '/api/v1/interfaces').then((r) => {
        const d = JSON.parse(r.body)
        return (Array.isArray(d) ? d : []) as { id: number; name: string }[]
      }),
    enabled: instanceId !== null && open,
  })

  const currentIfaces = instanceId === null ? interfaces : slaveIfaces

  // When switching to local, restore local default
  useEffect(() => {
    if (instanceId === null) {
      setForm((f) => ({ ...f, interface_id: defaultInterfaceId ?? interfaces[0]?.id ?? 0 }))
    }
  }, [instanceId]) // eslint-disable-line react-hooks/exhaustive-deps

  // When slave ifaces arrive, pick the first one
  useEffect(() => {
    if (slaveIfaces.length > 0 && instanceId !== null) {
      setForm((f) => ({ ...f, interface_id: slaveIfaces[0].id }))
    }
  }, [slaveIfaces]) // eslint-disable-line react-hooks/exhaustive-deps

  const mutation = useMutation({
    mutationFn: async () => {
      const payload: CreateClientPayload = {
        interface_id: form.interface_id,
        name: form.name.trim(),
        owner_label: form.owner_label || undefined,
        email: form.email || undefined,
        allowed_ips: form.allowed_ips || undefined,
        expires_at: form.expires_at
          ? new Date(form.expires_at + ':00Z').toISOString()
          : undefined,
      }
      if (instanceId !== null) {
        await proxyToInstance(instanceId, 'POST', '/api/v1/clients', payload)
      } else {
        await createClient(payload)
      }
    },
    onSuccess: () => { setOpen(false); onCreated() },
    onError: (e: unknown) => {
      setError(
        (e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Error',
      )
    },
  })

  function setField<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function handleOpenChange(v: boolean) {
    if (v) {
      setInstanceId(null)
      setForm({
        interface_id: defaultInterfaceId ?? interfaces[0]?.id ?? 0,
        name: '', owner_label: '', email: '',
        allowed_ips: '0.0.0.0/0, ::/0', expires_at: '',
      })
      setError('')
    }
    setOpen(v)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
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

          {/* Instance selector — only shown when slaves exist */}
          {instances.length > 0 && (
            <div className="space-y-1.5">
              <Label>Instance</Label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={instanceId ?? ''}
                onChange={(e) => setInstanceId(e.target.value === '' ? null : Number(e.target.value))}
              >
                <option value="">Local</option>
                {instances.map((inst) => (
                  <option key={inst.id} value={inst.id}>{inst.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Interface selector */}
          <div className="space-y-1.5">
            <Label htmlFor="iface-select">Interface</Label>
            {loadingSlaveIfaces ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground h-10 px-3">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading interfaces…
              </div>
            ) : (
              <select
                id="iface-select"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={form.interface_id}
                onChange={(e) => setField('interface_id', Number(e.target.value))}
              >
                {currentIfaces.map((i) => (
                  <option key={i.id} value={i.id}>{i.name}</option>
                ))}
              </select>
            )}
          </div>

          {/* Name */}
          <div className="space-y-1.5">
            <Label htmlFor="client-name">Name</Label>
            <Input
              id="client-name"
              value={form.name}
              onChange={(e) => setField('name', e.target.value)}
              placeholder="Alice's laptop"
            />
          </div>

          {/* Owner label */}
          <div className="space-y-1.5">
            <Label htmlFor="owner">Owner label</Label>
            <Input
              id="owner"
              value={form.owner_label}
              onChange={(e) => setField('owner_label', e.target.value)}
              placeholder="alice"
            />
          </div>

          {/* Email */}
          <div className="space-y-1.5">
            <Label htmlFor="email">
              Client email{' '}
              <span className="text-muted-foreground text-xs">
                (optional — receives one-time download link)
              </span>
            </Label>
            <Input
              id="email"
              type="email"
              value={form.email}
              onChange={(e) => setField('email', e.target.value)}
              placeholder="alice@example.com"
            />
          </div>

          {/* Allowed IPs */}
          <div className="space-y-1.5">
            <Label htmlFor="allowed">Allowed IPs</Label>
            <Input
              id="allowed"
              value={form.allowed_ips}
              onChange={(e) => setField('allowed_ips', e.target.value)}
              placeholder="0.0.0.0/0, ::/0"
            />
          </div>

          {/* Expiry */}
          <div className="space-y-1.5">
            <Label htmlFor="create-expiry">
              Expiry{' '}
              <span className="text-muted-foreground text-xs">
                (UTC — leave empty for no expiry)
              </span>
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
          <Button variant="outline" onClick={() => handleOpenChange(false)}>Cancel</Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !form.name.trim() || !form.interface_id}
          >
            {mutation.isPending
              ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Adding…</>
              : 'Add client'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
