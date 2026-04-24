import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { Shield, Globe, Server, Key } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import { getPublicIP, getAdguardStatus } from '@/api/settings'
import { totpSetup, totpActivate } from '@/api/auth'
import { useAuthStore } from '@/stores/auth'

export default function Settings() {
  const { admin } = useAuthStore()
  const { data: ipData, refetch: refetchIP } = useQuery({ queryKey: ['public-ip'], queryFn: getPublicIP })
  const { data: adguard } = useQuery({ queryKey: ['adguard'], queryFn: getAdguardStatus, retry: false })

  return (
    <div className="p-6 space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-muted-foreground text-sm mt-1">System configuration and security</p>
      </div>

      {/* Public IP */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Globe className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">Public IP</CardTitle>
          </div>
          <CardDescription>Current server public IP (used as WireGuard endpoint)</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-between">
          <span className="font-mono text-lg">{ipData?.ip ?? '—'}</span>
          <Button variant="outline" size="sm" onClick={() => refetchIP()}>Refresh</Button>
        </CardContent>
      </Card>

      {/* AdGuard Home */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">AdGuard Home</CardTitle>
          </div>
          <CardDescription>DNS filtering status</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex items-center gap-3">
            <Badge variant={adguard?.running ? 'success' : 'destructive'}>
              {adguard?.running ? 'Running' : 'Unavailable'}
            </Badge>
            {adguard?.version && <span className="text-sm text-muted-foreground">v{adguard.version}</span>}
          </div>
          {adguard?.dns_addresses?.length > 0 && (
            <p className="text-xs text-muted-foreground font-mono">DNS: {adguard.dns_addresses.join(', ')}:{adguard.dns_port}</p>
          )}
        </CardContent>
      </Card>

      {/* TOTP */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Key className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">Two-factor authentication</CardTitle>
          </div>
          <CardDescription>TOTP via authenticator app (Google Authenticator, Aegis…)</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-between">
          <Badge variant={admin?.totp_enabled ? 'success' : 'secondary'}>
            {admin?.totp_enabled ? 'Enabled' : 'Disabled'}
          </Badge>
          {!admin?.totp_enabled && <SetupTOTPDialog />}
        </CardContent>
      </Card>

      {/* Backup */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Server className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">Database backup</CardTitle>
          </div>
          <CardDescription>Download a copy of the SQLite database</CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            variant="outline"
            onClick={() => { window.location.href = '/api/v1/admin/backup' }}
          >
            Download backup
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

function SetupTOTPDialog() {
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<'qr' | 'verify'>('qr')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const { setAuth, admin, accessToken } = useAuthStore()

  const setupQuery = useQuery({
    queryKey: ['totp-setup'],
    queryFn: totpSetup,
    enabled: open,
  })

  const activateMut = useMutation({
    mutationFn: () => totpActivate(code),
    onSuccess: () => {
      if (admin && accessToken) {
        setAuth(accessToken, { ...admin, totp_enabled: true })
      }
      setOpen(false)
    },
    onError: () => setError('Invalid code, try again.'),
  })

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">Set up 2FA</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Set up two-factor authentication</DialogTitle>
          <DialogDescription>
            {step === 'qr'
              ? 'Scan the QR code with your authenticator app, then click Next.'
              : 'Enter the 6-digit code from your authenticator app.'}
          </DialogDescription>
        </DialogHeader>

        {step === 'qr' ? (
          <div className="flex flex-col items-center gap-4 py-2">
            {setupQuery.isFetching ? (
              <div className="h-48 flex items-center justify-center text-muted-foreground">Loading…</div>
            ) : setupQuery.data?.qr_code ? (
              <>
                <img
                  src={`data:image/png;base64,${setupQuery.data.qr_code}`}
                  alt="TOTP QR"
                  className="rounded-lg"
                  width={200}
                />
                <p className="text-xs text-muted-foreground font-mono break-all text-center">
                  {setupQuery.data.secret}
                </p>
              </>
            ) : null}
          </div>
        ) : (
          <div className="space-y-3 py-2">
            <Label htmlFor="totp-verify">Verification code</Label>
            <Input
              id="totp-verify"
              autoFocus
              placeholder="000000"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          {step === 'qr' ? (
            <Button onClick={() => setStep('verify')}>Next →</Button>
          ) : (
            <Button onClick={() => activateMut.mutate()} disabled={activateMut.isPending || code.length < 6}>
              {activateMut.isPending ? 'Verifying…' : 'Activate'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
