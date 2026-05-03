import { api } from './client'

export interface PAT {
  id: number
  name: string
  token_prefix: string
  expires_at: string | null
  last_used_at: string | null
  created_at: string
}

export interface CreatedPAT extends PAT {
  token: string // only returned on creation
}

export function listTokens(): Promise<PAT[]> {
  return api.get('/tokens').then((r) => r.data)
}

export function createToken(name: string, expiresAt?: string | null): Promise<CreatedPAT> {
  return api.post('/tokens', { name, expires_at: expiresAt ?? null }).then((r) => r.data)
}

export function deleteToken(id: number): Promise<void> {
  return api.delete(`/tokens/${id}`).then(() => undefined)
}

export interface ProxyResult {
  status: number
  status_text: string
  content_type: string
  body: string
  duration_ms: number
}

export function devProxy(
  tokenId: number,
  path: string,
  queryParams: Record<string, string>,
  headers: Record<string, string>,
): Promise<ProxyResult> {
  return api.post('/dev/proxy', {
    token_id: tokenId,
    path,
    query_params: queryParams,
    headers,
  }).then((r) => r.data)
}
