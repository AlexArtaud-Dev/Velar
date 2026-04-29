import { api } from './client'

export interface LoginPayload {
  username: string
  password: string
  totp_code?: string
}

export const login = (payload: LoginPayload) =>
  api.post('/auth/login', payload).then((r) => r.data)

export const logout = () => api.post('/auth/logout')

export const getMe = () => api.get('/me').then((r) => r.data)

export const changePassword = (current_password: string, new_password: string) =>
  api.put('/auth/password', { current_password, new_password }).then((r) => r.data)

export const totpSetup = () => api.get('/auth/totp/setup').then((r) => r.data)

export const totpActivate = (code: string) =>
  api.post('/auth/totp/activate', { code }).then((r) => r.data)

export const totpDisable = (code: string) =>
  api.post('/auth/totp/disable', { code }).then((r) => r.data)
