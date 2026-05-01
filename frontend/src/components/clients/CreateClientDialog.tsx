import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader,
  DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import { createClient, type CreateClientPayload } from '@/api/clients'

interface CreateClientDialogProps {
  /** Available interfaces shown in the interface selector. */
  interfaces: { id: number; name: string }[]
  /** Pre-selects an interface when opened from an interface-scoped clients view. */
  defaultInterfaceId?: number
  /** Called after a client is successfully created. */
  onCreated: () => void
}

/**
 * CreateClientDialog opens as a dialog triggered by the "Add client" button.
 * It collects name, interface, optional email, allowed IPs, and expiry, then
 * calls the create endpoint. The server generates the keypair and assigns an IP.
 */
export function CreateClientDialog({
  interfaces,
  defaultInterfaceId,
  onCreated,
}: CreateClientDialogProps) {
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
      setError(
        (e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Error',
      )
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
      // datetime-local gives "YYYY-MM-DDTHH:MM" — append seconds + Z so Date parses as UTC.
      expires_at: form.expires_at
        ? new Date(form.expires_at + ':00Z').toISOString()
        : undefined,
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
            <Input
              id="client-name"
              value={form.name}
              onChange={(e) => setField('name', e.target.value)}
              placeholder="Alice's laptop"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="owner">Owner label</Label>
            <Input
              id="owner"
              value={form.owner_label}
              onChange={(e) => setField('owner_label', e.target.value)}
              placeholder="alice"
            />
          </div>
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
          <div className="space-y-1.5">
            <Label htmlFor="allowed">Allowed IPs</Label>
            <Input
              id="allowed"
              value={form.allowed_ips}
              onChange={(e) => setField('allowed_ips', e.target.value)}
              placeholder="0.0.0.0/0, ::/0"
            />
          </div>
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
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            onClick={submit}
            disabled={mutation.isPending || !form.name || !form.interface_id}
          >
            {mutation.isPending ? 'Adding…' : 'Add client'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
