import { api } from './client'

export interface RemoteInstance {
  id: number
  name: string
  url: string
  token_prefix: string
  last_seen_at: string | null
  created_at: string
}

export interface InstanceHealth {
  reachable: boolean
  error?: string
  health?: {
    status: string
    version: string
    environment: string
    uptime_seconds: number
    checks: {
      database: { status: string }
      adguard: { configured: boolean; status?: string; running?: boolean; version?: string; dns_port?: number }
      wireguard: { mock: boolean }
    }
  }
}

export interface InstanceProxyResult {
  status: number
  status_text: string
  content_type: string
  body: string
  duration_ms: number
}

export function listInstances(): Promise<RemoteInstance[]> {
  return api.get('/instances').then((r) => r.data)
}

export function registerInstance(name: string, url: string, token: string): Promise<RemoteInstance> {
  return api.post('/instances', { name, url, token }).then((r) => r.data)
}

export function deleteInstance(id: number): Promise<void> {
  return api.delete(`/instances/${id}`).then(() => undefined)
}

export function pingInstance(id: number): Promise<InstanceHealth> {
  return api.get(`/instances/${id}/ping`).then((r) => r.data)
}

export function proxyToInstance(
  id: number,
  method: string,
  path: string,
  body?: unknown,
): Promise<InstanceProxyResult> {
  return api
    .post(`/instances/${id}/proxy`, { method, path, body: body ?? null })
    .then((r) => r.data)
}

/** Ask the master to send a config email for a client hosted on a slave.
 *  The master fetches client data + creates a download token on the slave,
 *  then sends the email via its own SMTP. */
export function sendSlaveClientConfig(instanceId: number, clientId: number): Promise<{ message: string }> {
  return api
    .post(`/instances/${instanceId}/clients/${clientId}/send-config`)
    .then((r) => r.data)
}
