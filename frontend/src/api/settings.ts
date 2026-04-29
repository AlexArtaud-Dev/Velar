import { api } from './client'

export const getPublicIP = () =>
  api.get<{ ip: string }>('/settings/public-ip').then((r) => r.data)

export const getAdguardStatus = () =>
  api.get('/settings/adguard').then((r) => r.data)

export const downloadBackup = async () => {
  const res = await api.get('/admin/backup', { responseType: 'blob' })
  const url = URL.createObjectURL(new Blob([res.data]))
  const a = document.createElement('a')
  a.href = url
  a.download = `velar_backup_${new Date().toISOString().slice(0, 10)}.db`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export interface NotificationStatus {
  enabled: boolean
  smtp_host: string
  smtp_from: string
  admin_email: string
}

export const getNotificationStatus = () =>
  api.get<NotificationStatus>('/settings/notifications').then((r) => r.data)

export const restoreBackup = (file: File) => {
  const form = new FormData()
  form.append('file', file)
  return api.post('/admin/restore', form, { headers: { 'Content-Type': 'multipart/form-data' } })
}
