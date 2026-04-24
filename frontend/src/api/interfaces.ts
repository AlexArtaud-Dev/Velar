import { api } from './client'

export interface WGInterface {
  id: number
  name: string
  port: number
  subnet: string
  public_key: string
  dns_server: string
  listen_address: string
  post_up: string
  post_down: string
  enabled: boolean
  up: boolean
  peer_count: number
  created_at: string
  updated_at: string
}

export interface CreateInterfacePayload {
  name: string
  port: number
  subnet: string
  dns_server?: string
  post_up?: string
  post_down?: string
}

export const listInterfaces = () =>
  api.get<WGInterface[]>('/interfaces').then((r) => r.data)

export const getInterface = (id: number) =>
  api.get<WGInterface>(`/interfaces/${id}`).then((r) => r.data)

export const createInterface = (payload: CreateInterfacePayload) =>
  api.post<WGInterface>('/interfaces', payload).then((r) => r.data)

export const deleteInterface = (id: number) =>
  api.delete(`/interfaces/${id}`)

export const bringUp = (id: number) =>
  api.post(`/interfaces/${id}/up`)

export const bringDown = (id: number) =>
  api.post(`/interfaces/${id}/down`)
