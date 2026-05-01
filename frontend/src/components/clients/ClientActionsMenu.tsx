import { useState } from 'react'
import {
  FileText, QrCode, Link2, Mail, History, DatabaseZap, Gauge, Pencil, MoreHorizontal, ExternalLink,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  ConfigButton,
  SendConfigButton,
  QRButton,
  DownloadLinkButton,
  EditClientDialog,
  ClientHistoryDialog,
  QuotaDialog,
  BandwidthDialog,
} from './ClientDialogs'
import { type Client } from '@/api/clients'
import { formatBytes } from '@/lib/utils'

interface ClientActionsMenuProps {
  /** The client this menu belongs to. */
  client: Client
  /** Called after any mutation that modifies the client (edit, quota, bandwidth). */
  onUpdated: () => void
}

/**
 * ClientActionsMenu renders the ⋯ dropdown for a client card.
 * Each dialog is controlled independently via local open state so that dialogs
 * survive the dropdown unmounting when it closes.
 */
export function ClientActionsMenu({ client, onUpdated }: ClientActionsMenuProps) {
  const [configOpen, setConfigOpen] = useState(false)
  const [sendOpen, setSendOpen] = useState(false)
  const [qrOpen, setQrOpen] = useState(false)
  const [linkOpen, setLinkOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [quotaOpen, setQuotaOpen] = useState(false)
  const [bwOpen, setBwOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)

  const hasBandwidthLimit =
    client.bandwidth_limit_down > 0 || client.bandwidth_limit_up > 0

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
            <DatabaseZap
              className={`h-3.5 w-3.5 ${client.data_quota_bytes > 0 ? 'text-purple-500' : ''}`}
            />
            Data quota{' '}
            {client.data_quota_bytes > 0 && (
              <span className="ml-auto text-xs text-muted-foreground">
                {formatBytes(client.data_quota_bytes)}
              </span>
            )}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setBwOpen(true)}>
            <Gauge
              className={`h-3.5 w-3.5 ${hasBandwidthLimit ? 'text-amber-500' : ''}`}
            />
            Bandwidth{' '}
            {hasBandwidthLimit && (
              <span className="ml-auto text-xs text-muted-foreground">
                {client.bandwidth_limit_down > 0 ? `↓${client.bandwidth_limit_down}` : ''}
                {client.bandwidth_limit_down > 0 && client.bandwidth_limit_up > 0 ? '/' : ''}
                {client.bandwidth_limit_up > 0 ? `↑${client.bandwidth_limit_up}` : ''} Mbps
              </span>
            )}
          </DropdownMenuItem>

          <DropdownMenuSeparator />
          {client.view_token && (
            <DropdownMenuItem
              onClick={() => window.open(`${window.location.origin}/portal/${client.view_token}`, '_blank')}
            >
              <ExternalLink className="h-3.5 w-3.5" /> Open portal
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={() => setEditOpen(true)}>
            <Pencil className="h-3.5 w-3.5" /> Edit
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Dialogs — rendered outside the dropdown so they survive its unmount */}
      <ConfigButton
        clientId={client.id}
        name={client.name}
        open={configOpen}
        onOpenChange={setConfigOpen}
      />
      <SendConfigButton
        clientId={client.id}
        email={client.email}
        open={sendOpen}
        onOpenChange={setSendOpen}
      />
      <QRButton
        clientId={client.id}
        name={client.name}
        open={qrOpen}
        onOpenChange={setQrOpen}
      />
      <DownloadLinkButton
        clientId={client.id}
        open={linkOpen}
        onOpenChange={setLinkOpen}
      />
      <ClientHistoryDialog
        client={client}
        open={historyOpen}
        onOpenChange={setHistoryOpen}
      />
      <QuotaDialog
        client={client}
        open={quotaOpen}
        onOpenChange={setQuotaOpen}
        onUpdated={onUpdated}
      />
      <BandwidthDialog
        client={client}
        open={bwOpen}
        onOpenChange={setBwOpen}
        onUpdated={onUpdated}
      />
      <EditClientDialog
        client={client}
        open={editOpen}
        onOpenChange={setEditOpen}
        onUpdated={onUpdated}
      />
    </>
  )
}
