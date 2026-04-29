import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface Admin {
  id: number
  username: string
  totp_enabled: boolean
  must_change_password: boolean
}

interface AuthState {
  accessToken: string | null
  admin: Admin | null
  isAuthenticated: boolean
  setAuth: (token: string, admin: Admin) => void
  setToken: (token: string) => void
  logout: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      accessToken: null,
      admin: null,
      isAuthenticated: false,
      setAuth: (token, admin) =>
        set({ accessToken: token, admin, isAuthenticated: true }),
      setToken: (token) => set({ accessToken: token }),
      logout: () => set({ accessToken: null, admin: null, isAuthenticated: false }),
    }),
    {
      name: 'velar-auth',
      partialize: (state) => ({ admin: state.admin, isAuthenticated: state.isAuthenticated, accessToken: state.accessToken }),
    },
  ),
)
