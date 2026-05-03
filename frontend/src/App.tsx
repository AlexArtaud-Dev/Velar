import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/auth'
import { refreshToken } from '@/api/auth'
import ProtectedRoute from '@/components/ProtectedRoute'
import Layout from '@/components/Layout'
import Login from '@/pages/Login'
import Dashboard from '@/pages/Dashboard'
import Interfaces from '@/pages/Interfaces'
import Clients from '@/pages/Clients'
import Settings from '@/pages/Settings'
import ForceChangePassword from '@/components/ForceChangePassword'
import ClientPortal from '@/pages/ClientPortal'
import ApiKeys from '@/pages/ApiKeys'

/**
 * Handles the silent token refresh on page load.
 *
 * When the user reloads the page:
 *  - accessToken is null (in-memory only, not persisted)
 *  - isAuthenticated may be true (persisted in localStorage)
 *
 * In that case we call /auth/refresh — the httpOnly refresh-token cookie is
 * sent automatically. On success we store the new access token in memory.
 * On failure we clear auth state and let the router redirect to /login.
 *
 * Children are not rendered until initialisation is complete, preventing a
 * flash of the login page or unauthenticated API calls.
 */
function AuthInit({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, accessToken, setToken, logout } = useAuthStore()
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (isAuthenticated && !accessToken) {
      refreshToken()
        .then((token) => setToken(token))
        .catch(() => logout())
        .finally(() => setReady(true))
    } else {
      setReady(true)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!ready) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-foreground" />
      </div>
    )
  }

  return <>{children}</>
}

export default function App() {
  const { isAuthenticated, admin } = useAuthStore()

  return (
    <BrowserRouter>
      <AuthInit>
        <Routes>
          <Route
            path="/login"
            element={isAuthenticated ? <Navigate to="/" replace /> : <Login />}
          />
          <Route element={<ProtectedRoute />}>
            <Route element={<Layout />}>
              <Route path="/" element={<Dashboard />} />
              <Route path="/interfaces" element={<Interfaces />} />
              <Route path="/interfaces/:id/clients" element={<Clients />} />
              <Route path="/clients" element={<Clients />} />
              <Route path="/tokens" element={<ApiKeys />} />
              <Route path="/settings" element={<Settings />} />
            </Route>
          </Route>
          <Route path="/portal/:token" element={<ClientPortal />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        {isAuthenticated && admin?.must_change_password && <ForceChangePassword />}
      </AuthInit>
    </BrowserRouter>
  )
}
