import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard,
  Network,
  Users,
  Settings,
  LogOut,
  Shield,
  Wifi,
  WifiOff,
  Sun,
  Moon,
} from 'lucide-react'
import { useAuthStore } from '@/stores/auth'
import { useThemeStore } from '@/stores/theme'
import { logout } from '@/api/auth'
import { useWebSocket } from '@/hooks/useWebSocket'
import { cn } from '@/lib/utils'

const navItems = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/interfaces', label: 'Interfaces', icon: Network },
  { to: '/clients', label: 'Clients', icon: Users },
  { to: '/settings', label: 'Settings', icon: Settings },
]

export default function Layout() {
  const navigate = useNavigate()
  const { admin, logout: clearAuth } = useAuthStore()
  const { theme, toggleTheme } = useThemeStore()
  const { connected } = useWebSocket()

  async function handleLogout() {
    await logout().catch(() => {})
    clearAuth()
    navigate('/login')
  }

  return (
    <div className="flex h-screen bg-background">

      {/* ── Desktop sidebar ── */}
      <aside className="hidden lg:flex w-60 border-r border-border flex-col shrink-0">

        {/* Logo */}
        <div className="flex items-center gap-2.5 px-5 py-5 border-b border-border">
          <Shield className="h-5 w-5 text-primary" />
          <span className="text-base font-bold tracking-tight">Velar</span>
        </div>

        {/* Nav */}
        <nav className="flex-1 py-3 px-2 space-y-0.5">
          {navItems.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-all duration-150',
                  'border-l-2',
                  isActive
                    ? 'border-primary bg-accent text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-accent/50',
                )
              }
            >
              <Icon className="h-4 w-4 shrink-0" />
              {label}
            </NavLink>
          ))}
        </nav>

        {/* Footer */}
        <div className="px-3 py-4 border-t border-border space-y-3">
          {/* Live indicator */}
          <div className="flex items-center gap-2 text-xs text-muted-foreground px-2">
            {connected ? (
              <>
                <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
                <span>Live</span>
              </>
            ) : (
              <>
                <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                <span>Reconnecting…</span>
              </>
            )}
          </div>

          {/* User row */}
          <div className="flex items-center justify-between px-1">
            <span className="text-sm text-muted-foreground truncate">{admin?.username}</span>
            <div className="flex items-center gap-0.5">
              <button
                onClick={toggleTheme}
                className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/60 transition-colors"
                title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
              >
                {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </button>
              <button
                onClick={handleLogout}
                className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/60 transition-colors"
                title="Logout"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </aside>

      {/* ── Main area ── */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">

        {/* Mobile top bar */}
        <header className="lg:hidden flex items-center justify-between px-4 py-3 border-b border-border bg-background shrink-0">
          {/* Live dot */}
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {connected
              ? <><span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" /><span>Live</span></>
              : <><Wifi className="h-3.5 w-3.5 text-red-500" /><WifiOff className="h-3.5 w-3.5 text-red-500 hidden" /></>
            }
          </div>

          {/* Logo */}
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            <span className="font-bold tracking-tight">Velar</span>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1">
            <button
              onClick={toggleTheme}
              className="p-1.5 rounded-md text-muted-foreground hover:text-foreground transition-colors"
              title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
            >
              {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            <button
              onClick={handleLogout}
              className="p-1.5 rounded-md text-muted-foreground hover:text-foreground transition-colors"
              title="Logout"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </header>

        {/* Page content — extra bottom padding on mobile clears the 56px bottom nav */}
        <main className="flex-1 overflow-auto max-lg:pb-14">
          <Outlet />
        </main>

        {/* ── Mobile bottom nav ── */}
        <nav className="lg:hidden fixed bottom-0 inset-x-0 z-40 flex bg-background border-t border-border">
          {navItems.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  'flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium transition-colors',
                  isActive
                    ? 'text-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <span className={cn(
                    'p-1 rounded-lg transition-colors',
                    isActive ? 'bg-accent' : '',
                  )}>
                    <Icon className="h-5 w-5" />
                  </span>
                  {label}
                </>
              )}
            </NavLink>
          ))}
        </nav>

      </div>
    </div>
  )
}
