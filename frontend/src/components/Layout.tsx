import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, Network, Users, Settings, LogOut,
  Shield, Wifi, WifiOff, Key, ChevronDown, Check,
} from 'lucide-react'
import { useAuthStore } from '@/stores/auth'
import { useThemeStore, THEMES, type Theme } from '@/stores/theme'
import { logout } from '@/api/auth'
import { useWebSocket } from '@/hooks/useWebSocket'
import { cn } from '@/lib/utils'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

const navItems = [
  { to: '/',           label: 'Dashboard',  icon: LayoutDashboard, end: true },
  { to: '/interfaces', label: 'Interfaces', icon: Network },
  { to: '/clients',    label: 'Clients',    icon: Users },
  { to: '/tokens',     label: 'API Keys',   icon: Key },
  { to: '/settings',   label: 'Settings',   icon: Settings },
]

const THEME_META: Record<Theme, { label: string; emoji: string; dot: string }> = {
  dark:      { label: 'Dark',      emoji: '🌙', dot: 'bg-slate-600' },
  light:     { label: 'Light',     emoji: '☀️', dot: 'bg-slate-300' },
  apple:     { label: 'Clear',     emoji: '🍎', dot: 'bg-[hsl(211,100%,50%)]' },
  cyberpunk: { label: 'Cyberpunk', emoji: '⚡', dot: 'bg-[hsl(180,100%,50%)]' },
}

/** User menu — combines avatar, theme picker, and logout in one dropdown */
function UserMenu({
  username,
  onLogout,
  compact = false,
}: {
  username?: string
  onLogout: () => void
  compact?: boolean
}) {
  const { theme, setTheme } = useThemeStore()
  const isCyber = theme === 'cyberpunk'
  const initial = username?.charAt(0).toUpperCase() ?? '?'

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {compact ? (
          // Mobile: just the avatar circle
          <button className={cn(
            'h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold transition-colors',
            isCyber
              ? 'bg-[rgba(0,255,255,0.15)] text-[hsl(180,80%,70%)] hover:bg-[rgba(0,255,255,0.25)]'
              : 'bg-accent text-foreground hover:bg-accent/80',
          )}>
            {initial}
          </button>
        ) : (
          // Desktop: full row with username + chevron
          <button className={cn(
            'flex items-center gap-2.5 w-full px-2 py-2 rounded-[var(--radius)] transition-colors',
            isCyber
              ? 'text-[hsl(180,60%,75%)] hover:bg-[rgba(0,255,255,0.08)]'
              : 'text-muted-foreground hover:text-foreground hover:bg-accent/60',
          )}>
            <span className={cn(
              'h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0',
              isCyber
                ? 'bg-[rgba(0,255,255,0.15)] text-[hsl(180,80%,70%)]'
                : 'bg-accent text-foreground',
            )}>
              {initial}
            </span>
            <span className="flex-1 text-xs font-medium truncate text-left">{username}</span>
            <ChevronDown className="h-3 w-3 opacity-50 shrink-0" />
          </button>
        )}
      </DropdownMenuTrigger>

      <DropdownMenuContent
        side={compact ? 'bottom' : 'top'}
        align={compact ? 'end' : 'start'}
        className="w-44"
      >
        {/* Theme options */}
        <div className="px-2 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
          Theme
        </div>
        {THEMES.map((t) => {
          const m = THEME_META[t.value]
          return (
            <DropdownMenuItem
              key={t.value}
              onClick={() => setTheme(t.value)}
              className="flex items-center gap-2 cursor-pointer"
            >
              <span className={cn('h-2 w-2 rounded-full shrink-0', m.dot)} />
              <span className="flex-1">{m.emoji} {m.label}</span>
              {theme === t.value && <Check className="h-3.5 w-3.5 text-primary" />}
            </DropdownMenuItem>
          )
        })}

        <DropdownMenuSeparator />

        {/* Logout */}
        <DropdownMenuItem
          onClick={onLogout}
          className="flex items-center gap-2 cursor-pointer text-muted-foreground focus:text-foreground"
        >
          <LogOut className="h-3.5 w-3.5" />
          <span>Logout</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
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

          {/* User menu */}
          <UserMenu username={admin?.username} onLogout={handleLogout} />
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

          {/* User menu (compact avatar) */}
          <UserMenu username={admin?.username} onLogout={handleLogout} compact />
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
