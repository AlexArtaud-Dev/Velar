import { api } from './client'

export const getPublicIP = () =>
  api.get<{ ip: string }>('/settings/public-ip').then((r) => r.data)

export const getAdguardStatus = () =>
  api.get('/settings/adguard').then((r) => r.data)
