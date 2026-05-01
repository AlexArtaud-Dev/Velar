import { useEffect, useRef, useState, useCallback } from 'react'
import { useAuthStore } from '@/stores/auth'

export interface PeerStatOut {
  client_id: number
  name: string
  public_key: string
  last_handshake: number
  bytes_rx: number
  bytes_tx: number
  connected: boolean
}

export interface IfaceStats {
  id: number
  name: string
  up: boolean
  peers: PeerStatOut[]
}

export interface StatsPayload {
  ts: number
  interfaces: IfaceStats[]
}

export function useWebSocket() {
  const [stats, setStats] = useState<StatsPayload | null>(null)
  const [connected, setConnected] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)
  // Tracks whether we should attempt to reconnect on close.
  // Set to false in the effect cleanup so a deliberate unmount doesn't trigger
  // a reconnect loop after the component is gone.
  const shouldReconnectRef = useRef(true)
  const { accessToken } = useAuthStore()

  const connect = useCallback(() => {
    if (!accessToken) return
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const url = `${proto}://${window.location.host}/ws/stats?token=${accessToken}`
    const ws = new WebSocket(url)

    ws.onopen = () => setConnected(true)
    ws.onclose = () => {
      setConnected(false)
      // Only reconnect if this was not a deliberate close (e.g. component unmount).
      if (shouldReconnectRef.current) {
        setTimeout(connect, 5000)
      }
    }
    ws.onerror = () => ws.close()
    ws.onmessage = (e) => {
      try {
        const payload = JSON.parse(e.data) as StatsPayload
        payload.interfaces = payload.interfaces ?? []
        setStats(payload)
      } catch {
        // ignore malformed frames
      }
    }
    wsRef.current = ws
  }, [accessToken])

  useEffect(() => {
    shouldReconnectRef.current = true
    connect()
    return () => {
      // Signal the onclose handler not to reconnect before closing the socket.
      shouldReconnectRef.current = false
      wsRef.current?.close()
    }
  }, [connect])

  return { stats, connected }
}
