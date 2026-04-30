import { api } from './client'

export interface Client {
  id: number
  interface_id: number
  name: string
  owner_label: string
  email: string
  public_key: string
  allowed_ips: string
  assigned_ip: string
  bandwidth_limit: number // Mbps, 0 = unlimited
  enabled: boolean
  expires_at: string | null
  last_handshake: string | null
  bytes_rx: number
  bytes_tx: number
  created_at: string
  updated_at: string
}

export interface CreateClientPayload {
  interface_id: number
  name: string
  owner_label?: string
  email?: string
  allowed_ips?: string
  expires_at?: string
  bandwidth_limit?: number // Mbps, 0 = unlimited
}

export const listClients = (interfaceId?: number) =>
  api
    .get<Client[]>('/clients', { params: interfaceId ? { interface_id: interfaceId } : {} })
    .then((r) => r.data)

export const getClient = (id: number) =>
  api.get<Client>(`/clients/${id}`).then((r) => r.data)

export const createClient = (payload: CreateClientPayload) =>
  api.post<Client>('/clients', payload).then((r) => r.data)

export interface UpdateClientPayload {
  name?: string
  owner_label?: string
  email?: string
  allowed_ips?: string
  expires_at?: string
  clear_expires_at?: boolean
  bandwidth_limit?: number // Mbps, 0 = unlimited
}

export const updateClient = (id: number, payload: UpdateClientPayload) =>
  api.put<Client>(`/clients/${id}`, payload).then((r) => r.data)

export const deleteClient = (id: number) => api.delete(`/clients/${id}`)

export const enableClient = (id: number) =>
  api.post(`/clients/${id}/enable`)

export const disableClient = (id: number) =>
  api.post(`/clients/${id}/disable`)

export const getClientConfig = (id: number) =>
  api.get(`/clients/${id}/config`, { responseType: 'blob' }).then((r) => r.data)

export const getClientConfigText = (id: number) =>
  api.get<string>(`/clients/${id}/config`, { responseType: 'text' }).then((r) => r.data)

export const getClientQR = (id: number) =>
  api.get<{ qr_code: string }>(`/clients/${id}/qr`).then((r) => r.data)

export const createDownloadLink = (id: number) =>
  api.post<{ token: string; url: string }>(`/clients/${id}/download-link`).then((r) => r.data)

export const sendConfigEmail = (id: number) =>
  api.post<{ message: string }>(`/clients/${id}/send-config`).then((r) => r.data)
