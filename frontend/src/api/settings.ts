import { api } from './client'

export const getPublicIP = () =>
  api.get<{ ip: string }>('/settings/public-ip').then((r) => r.data)

export const getAdguardStatus = () =>
  api.get('/settings/adguard').then((r) => r.data)

export interface NotificationStatus {
  enabled: boolean
  smtp_host: string
  smtp_from: string
  admin_email: string
}

export const getNotificationStatus = () =>
  api.get<NotificationStatus>('/settings/notifications').then((r) => r.data)

export interface SyncReport {
  interface: string
  peers_removed: number
  peers_added: number
  conf_synced: boolean
  errors?: string[]
}

export interface SyncResult {
  interfaces_synced: number
  peers_removed: number
  peers_added: number
  report: SyncReport[]
}

export const syncWireGuardState = () =>
  api.post<SyncResult>('/admin/sync').then((r) => r.data)

export interface RestoreReport {
  interfaces_created: number
  clients_created: number
  errors: string[]
}

export const exportBackup = (): Promise<Blob> =>
  api.get('/admin/backup', { responseType: 'blob' }).then((r) => r.data as Blob)

export const restoreBackup = (file: File, wipe: boolean): Promise<RestoreReport> => {
  const form = new FormData()
  form.append('backup', file)
  return api
    .post<RestoreReport>(`/admin/restore?wipe=${wipe}`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    .then((r) => r.data)
}

