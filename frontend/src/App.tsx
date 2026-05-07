import { useEffect, useMemo, useRef, useState } from 'react'
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
import Instances from '@/pages/Instances'
import Audit from '@/pages/Audit'
import Adguard from '@/pages/Adguard'

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

const RAIN_EMOJIS = ['🌈','🦄','✨','💫','🔮','🎠','🌀','💥','🎆','🍭','🎡','👾','🌟','🎇','🎉','🌸','💎','🍄','🎊','🏳️‍🌈','⚡','🫧','🎐','🪩','🌊']

function RainbowRain() {
  const drops = useMemo(() =>
    Array.from({ length: 55 }, (_, i) => ({
      id: i,
      emoji: RAIN_EMOJIS[Math.floor(Math.random() * RAIN_EMOJIS.length)],
      left: Math.random() * 100,
      delay: -(Math.random() * 9),
      duration: 2.8 + Math.random() * 4,
      size: 15 + Math.random() * 20,
    }))
  , [])

  return (
    <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 99994, overflow: 'hidden' }}>
      {drops.map((d) => (
        <span
          key={d.id}
          style={{
            position: 'absolute',
            left: `${d.left}%`,
            top: 0,
            fontSize: `${d.size}px`,
            lineHeight: 1,
            userSelect: 'none',
            animation: `sr-rain-fall ${d.duration}s ${d.delay}s linear infinite`,
            filter: 'drop-shadow(0 0 4px rgba(255,200,0,0.5))',
          }}
        >
          {d.emoji}
        </span>
      ))}
    </div>
  )
}

const KONAMI = ['ArrowUp','ArrowUp','ArrowDown','ArrowDown','ArrowLeft','ArrowRight','ArrowLeft','ArrowRight','b','a']

export default function App() {
  const { isAuthenticated, admin } = useAuthStore()
  const konamiSeq = useRef<string[]>([])
  const [surrealist, setSurrealist] = useState(false)
  const [konamiFlash, setKonamiFlash] = useState(false)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      konamiSeq.current = [...konamiSeq.current, e.key].slice(-KONAMI.length)
      if (konamiSeq.current.join(',') === KONAMI.join(',')) {
        konamiSeq.current = []
        setSurrealist((prev) => {
          const next = !prev
          if (next) document.documentElement.classList.add('surrealist')
          else document.documentElement.classList.remove('surrealist')
          return next
        })
        setKonamiFlash(true)
        setTimeout(() => setKonamiFlash(false), 3200)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <BrowserRouter>
      {surrealist && <RainbowRain />}
      {konamiFlash && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 999999,
          pointerEvents: 'none',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{
            padding: '1.75rem 3rem',
            borderRadius: '1.5rem',
            background: 'linear-gradient(135deg, #ff0055, #ff8800, #ffee00, #00ee88, #00aaff, #8800ff, #ff00cc)',
            backgroundSize: '300% 300%',
            animation: 'sr-pop 3.2s ease-out forwards, sr-shift 1.8s ease infinite',
            color: '#fff',
            fontWeight: 900,
            fontSize: '2rem',
            textAlign: 'center',
            lineHeight: 1.35,
            letterSpacing: '0.03em',
            textShadow: '0 2px 10px rgba(0,0,0,0.45)',
            boxShadow: '0 0 60px rgba(200,0,255,0.55), 0 0 120px rgba(0,180,255,0.3)',
          }}>
            {surrealist ? (
              <><div>🌈 SURREALIST MODE</div><div>ACTIVATED 🦄</div></>
            ) : (
              <><div>🌑 REALITY</div><div>RESTORED 🌑</div></>
            )}
          </div>
        </div>
      )}
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
              <Route path="/instances" element={<Instances />} />
              <Route path="/adguard" element={<Adguard />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/audit" element={<Audit />} />
            </Route>
          </Route>
          <Route path="/portal/:token" element={<ClientPortal />} />
          <Route path="/portal/s/:instanceId/:token" element={<ClientPortal />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        {isAuthenticated && admin?.must_change_password && <ForceChangePassword />}
      </AuthInit>
    </BrowserRouter>
  )
}
