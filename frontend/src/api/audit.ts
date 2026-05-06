import { api } from './client'

export interface AuditLog {
  id: number
  admin_id: number
  action: string
  target_type: string
  target_id: number
  target_name: string
  detail: string
  created_at: string
}

export interface AuditLogResponse {
  total: number
  page: number
  limit: number
  items: AuditLog[]
}

export const listAuditLogs = (params?: { page?: number; limit?: number; action?: string }) =>
  api.get<AuditLogResponse>('/audit', { params }).then((r) => r.data)
