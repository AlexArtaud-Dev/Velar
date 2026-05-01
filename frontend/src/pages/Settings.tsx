import { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Shield, Globe, Key, Lock, Bell, RefreshCw, CheckCircle2, AlertCircle, Download, Upload, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import { getPublicIP, getAdguardStatus, getNotificationStatus, syncWireGuardState, exportBackup, restoreBackup, type SyncResult, type RestoreReport } from '@/api/settings'
import { totpSetup, totpActivate, totpDisable, changePassword } from '@/api/auth'
import { useAuthStore } from '@/stores/auth'

export default function Settings() {
  const { admin } = useAuthStore()
  const { data: ipData, refetch: refetchIP } = useQuery({ queryKey: ['public-ip'], queryFn: getPublicIP })
  const { data: adguard } = useQuery({ queryKey: ['adguard'], queryFn: getAdguardStatus, retry: false })
  const { data: notif } = useQuery({ queryKey: ['notifications'], queryFn: getNotificationStatus, retry: false })

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-2xl">
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
          {(adguard?.dns_addresses?.length ?? 0) > 0 && (
            <p className="text-xs text-muted-foreground font-mono">DNS: {adguard.dns_addresses.join(', ')}:{adguard.dns_port}</p>
          )}
        </CardContent>
      </Card>

      {/* Change password */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Lock className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">Password</CardTitle>
          </div>
          <CardDescription>Change your admin password</CardDescription>
        </CardHeader>
        <CardContent>
          <ChangePasswordForm />
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
          {admin?.totp_enabled ? <DisableTOTPDialog /> : <SetupTOTPDialog />}
        </CardContent>
      </Card>

      {/* Notifications */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Bell className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">Email notifications</CardTitle>
          </div>
          <CardDescription>
            Admin alerts for new clients and expiring peers. Configure via <code className="text-xs">SMTP_HOST</code>, <code className="text-xs">SMTP_FROM</code> and <code className="text-xs">ADMIN_EMAIL</code> in your <code className="text-xs">.env</code>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex items-center gap-3">
            <Badge variant={notif?.enabled ? 'success' : 'secondary'}>
              {notif?.enabled ? 'Configured' : 'Not configured'}
            </Badge>
          </div>
          {notif?.enabled && (
            <p className="text-xs text-muted-foreground font-mono">
              {notif.smtp_from} → {notif.admin_email} via {notif.smtp_host}
            </p>
          )}
        </CardContent>
      </Card>

      {/* WireGuard state sync */}
      <SyncCard />

      {/* Backup / Restore */}
      <BackupCard />

    </div>
  )
}

function BackupCard() {
  const queryClient = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [wipe, setWipe] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [restoreResult, setRestoreResult] = useState<RestoreReport | null>(null)

  const exportMut = useMutation({
    mutationFn: exportBackup,
    onSuccess: (blob) => {
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `velar-backup-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
    },
  })

  const restoreMut = useMutation({
    mutationFn: ({ file, doWipe }: { file: File; doWipe: boolean }) => restoreBackup(file, doWipe),
    onSuccess: (data) => {
      setRestoreResult(data)
      setConfirmOpen(false)
      setPendingFile(null)
      setWipe(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
      queryClient.invalidateQueries()
    },
  })

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setPendingFile(file)
    setRestoreResult(null)
    setConfirmOpen(true)
  }

  function handleConfirmRestore() {
    if (!pendingFile) return
    restoreMut.mutate({ file: pendingFile, doWipe: wipe })
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Download className="h-4 w-4 text-muted-foreground" />
          <CardTitle className="text-base">Backup &amp; Restore</CardTitle>
        </div>
        <CardDescription>
          Export all interfaces and clients as an encrypted JSON file. Restore on any Velar instance
          with the same <code className="text-xs">APP_SECRET</code>.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Export */}
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={() => exportMut.mutate()}
            disabled={exportMut.isPending}
          >
            <Download className="h-4 w-4" />
            {exportMut.isPending ? 'Exporting…' : 'Export backup'}
          </Button>
          {exportMut.isSuccess && (
            <span className="text-xs text-green-500 flex items-center gap-1">
              <CheckCircle2 className="h-3.5 w-3.5" /> Downloaded
            </span>
          )}
          {exportMut.isError && (
            <span className="text-xs text-destructive">Export failed</span>
          )}
        </div>

        <div className="border-t border-border pt-4 space-y-3">
          <p className="text-sm font-medium">Restore from backup</p>

          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={handleFileChange}
          />

          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="h-4 w-4" />
            Choose backup file…
          </Button>

          {/* Confirm restore dialog */}
          <Dialog open={confirmOpen} onOpenChange={(v) => { setConfirmOpen(v); if (!v) { setPendingFile(null); if (fileInputRef.current) fileInputRef.current.value = '' } }}>
            <DialogContent className="max-w-sm">
              <DialogHeader>
                <DialogTitle>Restore backup</DialogTitle>
                <DialogDescription>
                  {pendingFile && (
                    <span>File: <span className="font-mono text-foreground">{pendingFile.name}</span></span>
                  )}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4 py-1">
                <div className="flex items-start gap-3 rounded-md border border-border bg-muted/40 px-3 py-2.5">
                  <input
                    id="wipe-check"
                    type="checkbox"
                    checked={wipe}
                    onChange={(e) => setWipe(e.target.checked)}
                    className="mt-0.5 h-4 w-4 cursor-pointer accent-destructive"
                  />
                  <label htmlFor="wipe-check" className="text-sm cursor-pointer space-y-0.5">
                    <div className="flex items-center gap-1.5 font-medium text-destructive">
                      <Trash2 className="h-3.5 w-3.5" />
                      Wipe existing data before restore
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Deletes all current interfaces and clients (except admin account) before importing.
                    </p>
                  </label>
                </div>

                {restoreMut.isError && (
                  <p className="text-sm text-destructive">
                    Restore failed:{' '}
                    {(restoreMut.error as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Unknown error'}
                  </p>
                )}
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setConfirmOpen(false)}>Cancel</Button>
                <Button
                  onClick={handleConfirmRestore}
                  disabled={restoreMut.isPending}
                  variant={wipe ? 'destructive' : 'default'}
                >
                  {restoreMut.isPending ? 'Restoring…' : wipe ? 'Wipe & Restore' : 'Restore'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Restore result */}
          {restoreResult && (
            <div className="rounded-md border border-border bg-muted/40 px-3 py-2.5 text-xs space-y-1.5">
              <div className="flex items-center gap-2 font-medium">
                {restoreResult.errors.length === 0
                  ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                  : <AlertCircle className="h-3.5 w-3.5 text-yellow-500" />}
                Restore complete
              </div>
              <p className="text-muted-foreground">
                {restoreResult.interfaces_created} interface{restoreResult.interfaces_created !== 1 ? 's' : ''} ·{' '}
                {restoreResult.clients_created} client{restoreResult.clients_created !== 1 ? 's' : ''} imported
              </p>
              {restoreResult.errors.length > 0 && (
                <div className="space-y-0.5">
                  {restoreResult.errors.map((e, i) => (
                    <p key={i} className="text-destructive">{e}</p>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function SyncCard() {
  const [result, setResult] = useState<SyncResult | null>(null)

  const mut = useMutation({
    mutationFn: syncWireGuardState,
    onSuccess: (data) => setResult(data),
  })

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <RefreshCw className="h-4 w-4 text-muted-foreground" />
          <CardTitle className="text-base">WireGuard state sync</CardTitle>
        </div>
        <CardDescription>
          Reconciles the running WireGuard state against the database. Removes stale peers,
          re-adds missing ones, rewrites all conf files and reapplies bandwidth limits.
          Use this after a server reboot, manual wg changes, or an application upgrade.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button
          variant="outline"
          size="sm"
          onClick={() => { setResult(null); mut.mutate() }}
          disabled={mut.isPending}
          className="gap-2"
        >
          <RefreshCw className={`h-4 w-4 ${mut.isPending ? 'animate-spin' : ''}`} />
          {mut.isPending ? 'Syncing…' : 'Run sync'}
        </Button>

        {result && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-3 text-sm">
              <span className="text-muted-foreground">
                {result.interfaces_synced} interface{result.interfaces_synced !== 1 ? 's' : ''} synced
              </span>
              {result.peers_removed > 0 && (
                <Badge variant="warning" className="gap-1">
                  −{result.peers_removed} stale peer{result.peers_removed !== 1 ? 's' : ''} removed
                </Badge>
              )}
              {result.peers_added > 0 && (
                <Badge variant="success" className="gap-1">
                  +{result.peers_added} peer{result.peers_added !== 1 ? 's' : ''} re-added
                </Badge>
              )}
              {result.peers_removed === 0 && result.peers_added === 0 && (
                <Badge variant="secondary">Already in sync</Badge>
              )}
            </div>

            <div className="space-y-2">
              {result.report.map((r) => (
                <div key={r.interface} className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs space-y-1">
                  <div className="flex items-center gap-2 font-medium">
                    {(r.errors?.length ?? 0) > 0
                      ? <AlertCircle className="h-3.5 w-3.5 text-destructive" />
                      : <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />}
                    <span className="font-mono">{r.interface}</span>
                    {r.conf_synced && <span className="text-muted-foreground">conf synced</span>}
                  </div>
                  {(r.peers_removed > 0 || r.peers_added > 0) && (
                    <p className="text-muted-foreground">
                      {r.peers_removed > 0 && `−${r.peers_removed} removed`}
                      {r.peers_removed > 0 && r.peers_added > 0 && ' · '}
                      {r.peers_added > 0 && `+${r.peers_added} added`}
                    </p>
                  )}
                  {r.errors?.map((e, i) => (
                    <p key={i} className="text-destructive">{e}</p>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function ChangePasswordForm() {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const { admin, setAuth, accessToken } = useAuthStore()

  const mutation = useMutation({
    mutationFn: () => changePassword(current, next),
    onSuccess: () => {
      if (admin && accessToken) setAuth(accessToken, { ...admin, must_change_password: false })
      setCurrent(''); setNext(''); setConfirm(''); setSuccess(true)
      setTimeout(() => setSuccess(false), 3000)
    },
    onError: (e: unknown) => {
      setError((e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Error')
    },
  })

  function submit() {
    setError('')
    if (next.length < 8) { setError('Password must be at least 8 characters'); return }
    if (next !== confirm) { setError('Passwords do not match'); return }
    mutation.mutate()
  }

  return (
    <div className="space-y-3 max-w-sm">
      <div className="space-y-1.5">
        <Label htmlFor="s-current">Current password</Label>
        <Input id="s-current" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="s-new">New password</Label>
        <Input id="s-new" type="password" value={next} onChange={(e) => setNext(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="s-confirm">Confirm</Label>
        <Input id="s-confirm" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {success && <p className="text-sm text-green-500">Password updated successfully</p>}
      <Button size="sm" onClick={submit} disabled={mutation.isPending}>
        {mutation.isPending ? 'Saving…' : 'Update password'}
      </Button>
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

function DisableTOTPDialog() {
  const [open, setOpen] = useState(false)
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const { setAuth, admin, accessToken } = useAuthStore()

  const mut = useMutation({
    mutationFn: () => totpDisable(code),
    onSuccess: () => {
      if (admin && accessToken) setAuth(accessToken, { ...admin, totp_enabled: false })
      setOpen(false)
      setCode('')
    },
    onError: () => setError('Invalid code, try again.'),
  })

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); setCode(''); setError('') }}>
      <DialogTrigger asChild>
        <Button size="sm" variant="destructive">Disable 2FA</Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Disable two-factor authentication</DialogTitle>
          <DialogDescription>Enter your current authenticator code to confirm.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <Label htmlFor="totp-disable">Verification code</Label>
          <Input
            id="totp-disable"
            autoFocus
            placeholder="000000"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && code.length === 6 && mut.mutate()}
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            variant="destructive"
            onClick={() => mut.mutate()}
            disabled={mut.isPending || code.length < 6}
          >
            {mut.isPending ? 'Disabling…' : 'Disable 2FA'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

