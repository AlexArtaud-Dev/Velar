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

