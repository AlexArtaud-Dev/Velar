import { api } from './client'

export interface TrafficTotals {
  rx: number
  tx: number
}

export interface RecentEvent {
  id: number
  client_id: number
  client_name: string
  interface_name: string
  event_type: 'connected' | 'disconnected'
  source_ip: string
  timestamp: string
}

export interface DashboardStats {
  traffic_24h: TrafficTotals
  traffic_7d: TrafficTotals
  recent_events: RecentEvent[]
}

export interface SnapshotPoint {
  timestamp: string
  bytes_rx: number
  bytes_tx: number
}

export const getDashboardStats = () =>
  api.get<DashboardStats>('/dashboard').then((r) => r.data)

export const getDashboardSnapshots = (range: '24h' | '7d' = '24h') =>
  api.get<SnapshotPoint[]>('/dashboard/snapshots', { params: { range } }).then((r) => r.data)
