import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, Network, Users, Settings, LogOut,
  Shield, Wifi, WifiOff, Key,
} from 'lucide-react'
import { useAuthStore } from '@/stores/auth'
import { useThemeStore, THEMES, type Theme } from '@/stores/theme'
import { logout } from '@/api/auth'
import { useWebSocket } from '@/hooks/useWebSocket'
import { cn } from '@/lib/utils'

const navItems = [
  { to: '/',           label: 'Dashboard',  icon: LayoutDashboard, end: true },
  { to: '/interfaces', label: 'Interfaces', icon: Network },
  { to: '/clients',    label: 'Clients',    icon: Users },
  { to: '/tokens',     label: 'API Keys',   icon: Key },
  { to: '/settings',   label: 'Settings',   icon: Settings },
]

const THEME_LABELS: Record<Theme, string> = {
  dark:      '🌙 Dark',
  light:     '☀️ Light',
  apple:     '🍎 Clear',
  cyberpunk: '⚡ Cyberpunk',
}

/** Compact theme selector dropdown */
function ThemeSelector() {
  const { theme, setTheme } = useThemeStore()

  return (
    <select
      value={theme}
      onChange={(e) => setTheme(e.target.value as Theme)}
      className={cn(
        'text-xs rounded-md px-1.5 py-1 border border-border bg-background text-muted-foreground',
        'hover:text-foreground focus:outline-none focus:ring-1 focus:ring-ring cursor-pointer transition-colors',
      )}
      title="Switch theme"
    >
      {THEMES.map((t) => (
        <option key={t.value} value={t.value}>
          {THEME_LABELS[t.value]}
        </option>
      ))}
    </select>
  )
}

export default function Layout() {
  const navigate = useNavigate()
  const { admin, logout: clearAuth } = useAuthStore()
  const { theme } = useThemeStore()
  const { connected } = useWebSocket()

  async function handleLogout() {
    await logout().catch(() => {})
    clearAuth()
    navigate('/login')
  }

  const isCyber = theme === 'cyberpunk'

  return (
    <div className="flex h-screen bg-background">

      {/* ── Desktop sidebar ── */}
      <aside className={cn(
        'hidden lg:flex w-60 border-r border-border flex-col shrink-0 transition-colors',
        isCyber && 'border-r-[rgba(0,255,255,0.15)]',
      )}>

        {/* Logo */}
        <div className={cn(
          'flex items-center gap-2.5 px-5 py-5 border-b border-border',
          isCyber && 'border-b-[rgba(0,255,255,0.15)]',
        )}>
          <Shield className={cn(
            'h-5 w-5',
            theme === 'apple'     && 'text-[hsl(211,100%,50%)]',
            theme === 'cyberpunk' && 'text-[hsl(180,100%,50%)] drop-shadow-[0_0_6px_rgba(0,255,255,0.7)]',
            theme === 'dark'      && 'text-primary',
            theme === 'light'     && 'text-primary',
          )} />
          <span className={cn(
            'text-base font-bold tracking-tight',
            theme === 'cyberpunk' && 'text-[hsl(180,60%,88%)] tracking-widest uppercase text-sm',
          )}>
            Velar
          </span>
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
                  'flex items-center gap-3 px-3 py-2 rounded-[var(--radius)] text-sm font-medium transition-all duration-150',
                  'border-l-2',
                  isActive
                    ? cn(
                        'border-primary bg-accent text-foreground',
                        isCyber && 'bg-[rgba(0,255,255,0.07)] border-[hsl(180,100%,50%)] text-[hsl(180,60%,85%)] [text-shadow:0_0_12px_rgba(0,255,255,0.4)]',
                      )
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
        <div className={cn(
          'px-3 py-4 border-t border-border space-y-3',
          isCyber && 'border-t-[rgba(0,255,255,0.15)]',
        )}>
          {/* Live indicator */}
          <div className="flex items-center gap-2 text-xs text-muted-foreground px-2">
            {connected ? (
              <>
                <span className={cn(
                  'h-1.5 w-1.5 rounded-full animate-pulse',
                  isCyber ? 'bg-[hsl(180,100%,50%)]' : 'bg-green-500',
                )} />
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
            <span className="text-xs text-muted-foreground truncate max-w-[6.5rem]">
              {admin?.username}
            </span>
            <div className="flex items-center gap-0.5">
              <ThemeSelector />
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
        <header className={cn(
          'lg:hidden flex items-center justify-between px-4 py-3 border-b border-border bg-background shrink-0',
          isCyber && 'border-b-[rgba(0,255,255,0.15)]',
        )}>
          {/* Live dot */}
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {connected
              ? <><span className={cn('h-1.5 w-1.5 rounded-full animate-pulse', isCyber ? 'bg-[hsl(180,100%,50%)]' : 'bg-green-500')} /><span>Live</span></>
              : <><Wifi className="h-3.5 w-3.5 text-red-500" /><WifiOff className="h-3.5 w-3.5 text-red-500 hidden" /></>
            }
          </div>

          {/* Logo */}
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            <span className={cn('font-bold tracking-tight', isCyber && 'uppercase tracking-widest text-sm')}>
              Velar
            </span>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1">
            <ThemeSelector />
            <button
              onClick={handleLogout}
              className="p-1.5 rounded-md text-muted-foreground hover:text-foreground transition-colors"
              title="Logout"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-auto max-lg:pb-14">
          <Outlet />
        </main>

        {/* ── Mobile bottom nav ── */}
        <nav className={cn(
          'lg:hidden fixed bottom-0 inset-x-0 z-40 flex bg-background border-t border-border',
          isCyber && 'border-t-[rgba(0,255,255,0.15)]',
        )}>
          {navItems.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  'flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium transition-colors',
                  isActive ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <span className={cn('p-1 rounded-lg transition-colors', isActive ? 'bg-accent' : '')}>
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
