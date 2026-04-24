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
  const { accessToken } = useAuthStore()

  const connect = useCallback(() => {
    if (!accessToken) return
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const url = `${proto}://${window.location.host}/ws/stats?token=${accessToken}`
    const ws = new WebSocket(url)

    ws.onopen = () => setConnected(true)
    ws.onclose = () => {
      setConnected(false)
      // reconnect after 5s
      setTimeout(connect, 5000)
    }
    ws.onerror = () => ws.close()
    ws.onmessage = (e) => {
      try {
        setStats(JSON.parse(e.data))
      } catch {
        // ignore malformed frames
      }
    }
    wsRef.current = ws
  }, [accessToken])

  useEffect(() => {
    connect()
    return () => {
      wsRef.current?.close()
    }
  }, [connect])

  return { stats, connected }
}
