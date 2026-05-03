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
