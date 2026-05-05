import axios from 'axios'

// Standalone axios instance with no auth interceptors — the portal is public.
const publicApi = axios.create({ baseURL: '/api/v1' })

export interface PortalClient {
  name: string
  owner_label: string
  /** connected | active | suspended | disabled | expired */
  status: 'connected' | 'active' | 'suspended' | 'disabled' | 'expired'
  assigned_ip: string
  interface_name: string
  last_handshake: string | null
  bytes_rx: number
  bytes_tx: number
  bandwidth_limit_down: number // Mbps, 0 = unlimited
  bandwidth_limit_up: number   // Mbps, 0 = unlimited
  data_quota_bytes: number     // bytes, 0 = unlimited
  quota_used: number
  quota_period: string
  quota_suspended: boolean
  expires_at: string | null
  created_at: string
}

export const getPortalClient = (token: string) =>
  publicApi
    .get<PortalClient>(`/public/client/${token}`)
    .then((r) => r.data)

export const getSlavePortalClient = (instanceId: number, token: string) =>
  publicApi
    .get<PortalClient>(`/public/client/s/${instanceId}/${token}`)
    .then((r) => r.data)
