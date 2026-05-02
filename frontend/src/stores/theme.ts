import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type Theme = 'light' | 'dark' | 'apple' | 'cyberpunk'

export const THEMES: { value: Theme; label: string; emoji: string }[] = [
  { value: 'dark',      label: 'Dark',      emoji: '🌙' },
  { value: 'light',     label: 'Light',     emoji: '☀️' },
  { value: 'apple',     label: 'Apple',     emoji: '🍎' },
  { value: 'cyberpunk', label: 'Cyberpunk', emoji: '⚡' },
]

interface ThemeState {
  theme: Theme
  setTheme: (theme: Theme) => void
  cycleTheme: () => void
}

function applyTheme(theme: Theme) {
  const root = document.documentElement
  root.classList.remove('dark', 'apple', 'cyberpunk')
  if (theme !== 'light') root.classList.add(theme)
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: 'dark',
      setTheme: (theme) => {
        applyTheme(theme)
        set({ theme })
      },
      cycleTheme: () => {
        const order: Theme[] = ['dark', 'light', 'apple', 'cyberpunk']
        const idx = order.indexOf(get().theme)
        const next = order[(idx + 1) % order.length]
        applyTheme(next)
        set({ theme: next })
      },
    }),
    {
      name: 'velar-theme',
      onRehydrateStorage: () => (state) => {
        if (state) applyTheme(state.theme)
      },
    },
  ),
)
