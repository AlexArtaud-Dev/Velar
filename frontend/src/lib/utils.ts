import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`
}

/** Compact variant for chart axis ticks — no decimals above KB. */
export function formatBytesShort(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  if (bytes < k)        return `${bytes} B`
  if (bytes < k * k)    return `${Math.round(bytes / k)} KB`
  if (bytes < k * k * k) return `${Math.round(bytes / (k * k))} MB`
  return `${(bytes / (k * k * k)).toFixed(1)} GB`
}

export function timeAgo(timestamp: number): string {
  if (!timestamp) return 'Never'
  const diff = Math.floor(Date.now() / 1000) - Math.floor(timestamp)
  if (diff < 60) return `${Math.max(0, diff)}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}
