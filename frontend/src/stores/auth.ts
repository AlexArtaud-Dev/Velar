import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface Admin {
  id: number
  username: string
  totp_enabled: boolean
  must_change_password: boolean
}

interface AuthState {
  // In-memory only — never written to localStorage
  accessToken: string | null
  // Persisted — not sensitive, needed to detect "logged-in" state on reload
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
      // accessToken intentionally excluded — kept in memory only (XSS mitigation)
      // refresh token is an httpOnly cookie handled by the backend
      partialize: (state) => ({
        admin: state.admin,
        isAuthenticated: state.isAuthenticated,
      }),
    },
  ),
)
