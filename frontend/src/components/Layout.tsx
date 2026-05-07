import React, { useState } from 'react'
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, Network, Users, Settings, LogOut,
  Shield, Wifi, WifiOff, Key, ChevronDown, Check, Server, ClipboardList,
  MoreHorizontal, X,
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

type NavItem = { to: string; label: string; icon: React.ComponentType<{ className?: string }>; end: boolean }
type NavGroup = { label: string | null; items: NavItem[] }

// Grouped nav definition for the desktop sidebar
const navGroups: NavGroup[] = [
  {
    label: null, // no section header for the first entry
    items: [
      { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
    ],
  },
  {
    label: 'Network',
    items: [
      { to: '/interfaces', label: 'Interfaces', icon: Network,    end: false },
      { to: '/clients',    label: 'Clients',    icon: Users,      end: false },
    ],
  },
  {
    label: 'Federation',
    items: [
      { to: '/instances', label: 'Instances', icon: Server, end: false },
      { to: '/adguard',   label: 'AdGuard',   icon: Shield, end: false },
    ],
  },
  {
    label: 'Access',
    items: [
      { to: '/tokens', label: 'API Keys',  icon: Key,         end: false },
      { to: '/audit',  label: 'Audit Log', icon: ClipboardList, end: false },
    ],
  },
  {
    label: 'System',
    items: [
      { to: '/settings', label: 'Settings', icon: Settings, end: false },
    ],
  },
]

const navItems = navGroups.flatMap((g) => g.items)
// Primary 4 items always in the bar; the rest go into "More"
const mobilePrimaryItems = navItems.filter((i) =>
  ['/', '/interfaces', '/clients', '/adguard'].includes(i.to),
)
const mobileMoreItems = navItems.filter((i) =>
  !['/', '/interfaces', '/clients', '/adguard'].includes(i.to),
)

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
          // Mobile: avatar circle only — chevron hidden, state shown by highlight
          <button className={cn(
            'group h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold transition-colors',
            isCyber
              ? 'bg-[rgba(0,255,255,0.15)] text-[hsl(180,80%,70%)] hover:bg-[rgba(0,255,255,0.25)]'
              : 'bg-accent text-foreground hover:bg-accent/80',
          )}>
            {initial}
          </button>
        ) : (
          // Desktop: full-width row — avatar + username + rotating chevron
          <button className={cn(
            'group flex items-center gap-2.5 w-full px-2 py-2 rounded-[var(--radius)] transition-colors',
            isCyber
              ? 'text-[hsl(180,60%,75%)] hover:bg-[rgba(0,255,255,0.08)]'
              : 'text-muted-foreground hover:text-foreground hover:bg-accent/60',
          )}>
            <span className={cn(
              'h-7 w-7 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0',
              isCyber
                ? 'bg-[rgba(0,255,255,0.15)] text-[hsl(180,80%,70%)]'
                : 'bg-primary/10 text-primary',
            )}>
              {initial}
            </span>
            <span className="flex-1 text-xs font-medium truncate text-left">{username}</span>
            <ChevronDown className="h-3.5 w-3.5 opacity-50 shrink-0 transition-transform duration-200 group-data-[state=open]:rotate-180" />
          </button>
        )}
      </DropdownMenuTrigger>

      <DropdownMenuContent
        side={compact ? 'bottom' : 'top'}
        align={compact ? 'end' : 'start'}
        sideOffset={6}
        className="w-[var(--radix-dropdown-menu-trigger-width)] min-w-44"
      >
        {/* Theme section label */}
        <div className="px-3 pt-2 pb-1 text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-widest">
          Theme
        </div>

        {THEMES.map((t) => {
          const m = THEME_META[t.value]
          const active = theme === t.value
          return (
            <DropdownMenuItem
              key={t.value}
              onClick={() => setTheme(t.value)}
              className={cn(
                'flex items-center gap-2.5 cursor-pointer px-3 py-2',
                active && 'font-medium',
              )}
            >
              <span className={cn('h-2.5 w-2.5 rounded-full shrink-0 border border-border/50', m.dot)} />
              <span className="flex-1 text-sm">{m.emoji} {m.label}</span>
              {active && <Check className="h-3.5 w-3.5 text-primary shrink-0" />}
            </DropdownMenuItem>
          )
        })}

        <DropdownMenuSeparator className="my-1" />

        {/* Logout */}
        <DropdownMenuItem
          onClick={onLogout}
          className="flex items-center gap-2.5 cursor-pointer px-3 py-2 text-muted-foreground focus:text-foreground"
        >
          <LogOut className="h-3.5 w-3.5 shrink-0" />
          <span className="text-sm">Logout</span>
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
  const [moreOpen, setMoreOpen] = useState(false)

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
        <nav className="flex-1 py-3 px-2 overflow-y-auto space-y-4">
          {navGroups.map((group, gi) => (
            <div key={gi}>
              {group.label && (
                <p className={cn(
                  'px-3 mb-1 text-[10px] font-semibold uppercase tracking-widest select-none',
                  isCyber ? 'text-[hsl(180,60%,50%)]' : 'text-muted-foreground/50',
                )}>
                  {group.label}
                </p>
              )}
              <div className="space-y-0.5">
                {group.items.map(({ to, label, icon: Icon, end }) => (
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
                          : cn(
                              'border-transparent text-muted-foreground hover:text-foreground hover:bg-accent/50',
                              isCyber && 'hover:text-[hsl(180,60%,80%)] hover:bg-[rgba(0,255,255,0.04)]',
                            ),
                      )
                    }
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    {label}
                  </NavLink>
                ))}
              </div>
            </div>
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
          {mobilePrimaryItems.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              onClick={() => setMoreOpen(false)}
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

          {/* More button */}
          <button
            onClick={() => setMoreOpen((o) => !o)}
            className={cn(
              'flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium transition-colors',
              moreOpen ? 'text-foreground' : 'text-muted-foreground',
            )}
          >
            <span className={cn('p-1 rounded-lg transition-colors', moreOpen ? 'bg-accent' : '')}>
              {moreOpen ? <X className="h-5 w-5" /> : <MoreHorizontal className="h-5 w-5" />}
            </span>
            More
          </button>
        </nav>

        {/* ── More drawer ── */}
        {moreOpen && (
          <>
            {/* Backdrop */}
            <div
              className="lg:hidden fixed inset-0 z-30 bg-black/30"
              onClick={() => setMoreOpen(false)}
            />
            {/* Sheet */}
            <div className={cn(
              'lg:hidden fixed bottom-14 inset-x-0 z-40 rounded-t-2xl border-t border-x border-border bg-background pb-2 shadow-xl',
              isCyber && 'border-[rgba(0,255,255,0.15)] bg-[rgba(7,12,23,0.97)]',
            )}>
              <div className={cn(
                'px-4 pt-3 pb-2 text-[10px] font-semibold uppercase tracking-widest',
                isCyber ? 'text-[hsl(180,50%,45%)]' : 'text-muted-foreground',
              )}>
                More
              </div>
              {mobileMoreItems.map(({ to, label, icon: Icon, end }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={end}
                  onClick={() => setMoreOpen(false)}
                  className={({ isActive }) =>
                    cn(
                      'flex items-center gap-3 px-5 py-3 text-sm font-medium transition-colors',
                      isActive
                        ? isCyber ? 'text-[hsl(180,80%,70%)]' : 'text-foreground'
                        : isCyber ? 'text-foreground/70 hover:text-[hsl(180,60%,75%)]' : 'text-muted-foreground hover:text-foreground',
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      <span className={cn(
                        'p-1.5 rounded-lg',
                        isActive
                          ? isCyber ? 'bg-[rgba(0,255,255,0.1)]' : 'bg-accent'
                          : 'bg-muted',
                      )}>
                        <Icon className="h-4 w-4" />
                      </span>
                      {label}
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          </>
        )}

      </div>
    </div>
  )
}
