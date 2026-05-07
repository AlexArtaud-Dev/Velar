import { api } from './client'

// null = master, number = slave instance ID
export type AdguardSource = null | number

export interface AdguardStatus {
  running: boolean
  version: string
  dns_addresses: string[]
  dns_port: number
  querylog_enabled: boolean
  protection_enabled: boolean
}

export interface SafeSearchSettings {
  enabled: boolean
  bing: boolean
  duckduckgo: boolean
  ecosia: boolean
  google: boolean
  pixabay: boolean
  yandex: boolean
  youtube: boolean
}

export interface AdguardStats {
  num_dns_queries: number
  num_blocked_filtering: number
  num_replaced_safebrowsing: number
  num_replaced_parental: number
  avg_processing_time: number
}

export interface AdguardFilter {
  id: number
  url: string
  name: string
  enabled: boolean
  rules_count: number
}

export interface AdguardFilteringStatus {
  enabled: boolean
  interval: number
  filters: AdguardFilter[]
}

export interface AdguardRewrite {
  domain: string
  answer: string
}

export interface AdguardServiceInfo {
  id: string
  name: string
  icon_svg: string
}

export interface AdguardServicesData {
  services: AdguardServiceInfo[]
  blocked: string[]
}

// ── Unified call ──────────────────────────────────────────────────────────────

async function call<T>(
  source: AdguardSource,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  if (source === null) {
    // Master — direct API call
    const adguardPath = '/adguard' + path
    switch (method.toUpperCase()) {
      case 'GET':    return api.get<T>(adguardPath).then((r) => r.data)
      case 'POST':   return api.post<T>(adguardPath, body).then((r) => r.data)
      case 'PUT':    return api.put<T>(adguardPath, body).then((r) => r.data)
      case 'DELETE': return api.delete<T>(adguardPath, { data: body }).then((r) => r.data)
      default:       throw new Error(`Unsupported method: ${method}`)
    }
  } else {
    // Slave — proxy through master
    const res = await api.post(`/instances/${source}/adguard/proxy`, {
      method,
      path: '/api/v1/adguard' + path,
      body: body ?? null,
    })
    const proxy = res.data as { status: number; body: string }
    if (proxy.status >= 400) {
      let msg = `AdGuard returned ${proxy.status}`
      try { msg = JSON.parse(proxy.body)?.error ?? msg } catch { /* noop */ }
      throw new Error(msg)
    }
    if (!proxy.body || proxy.body === '') return undefined as T
    return JSON.parse(proxy.body) as T
  }
}

// ── API functions ─────────────────────────────────────────────────────────────

export const getStatus = (src: AdguardSource) =>
  call<AdguardStatus>(src, 'GET', '/status')

export const getStats = (src: AdguardSource) =>
  call<AdguardStats>(src, 'GET', '/stats')

export const getFilteringStatus = (src: AdguardSource) =>
  call<AdguardFilteringStatus>(src, 'GET', '/filtering')

export const setFilteringEnabled = (src: AdguardSource, enabled: boolean) =>
  call<void>(src, 'PUT', '/filtering/config', { enabled, interval: 24 })

export const addFilter = (src: AdguardSource, url: string, name: string) =>
  call<void>(src, 'POST', '/filtering/add', { url, name })

export const removeFilter = (src: AdguardSource, url: string) =>
  call<void>(src, 'POST', '/filtering/remove', { url })

export const refreshFilters = (src: AdguardSource) =>
  call<void>(src, 'POST', '/filtering/refresh', {})

export const getUserRules = (src: AdguardSource) =>
  call<{ rules: string[] }>(src, 'GET', '/rules')

export const setUserRules = (src: AdguardSource, rules: string[]) =>
  call<void>(src, 'PUT', '/rules', { rules })

export const getRewrites = (src: AdguardSource) =>
  call<{ rewrites: AdguardRewrite[] }>(src, 'GET', '/rewrites')

export const addRewrite = (src: AdguardSource, domain: string, answer: string) =>
  call<void>(src, 'POST', '/rewrites', { domain, answer })

export const deleteRewrite = (src: AdguardSource, domain: string, answer: string) =>
  call<void>(src, 'DELETE', '/rewrites', { domain, answer })

export const setProtection = (src: AdguardSource, enabled: boolean) =>
  call<void>(src, 'POST', '/protection', { enabled })

export const getSafeBrowsingStatus = (src: AdguardSource) =>
  call<{ enabled: boolean }>(src, 'GET', '/safebrowsing')

export const setSafeBrowsing = (src: AdguardSource, enabled: boolean) =>
  call<void>(src, 'PUT', '/safebrowsing', { enabled })

export const getParentalStatus = (src: AdguardSource) =>
  call<{ enabled: boolean }>(src, 'GET', '/parental')

export const setParental = (src: AdguardSource, enabled: boolean) =>
  call<void>(src, 'PUT', '/parental', { enabled })

export const getSafeSearchStatus = (src: AdguardSource) =>
  call<SafeSearchSettings>(src, 'GET', '/safesearch')

export const setSafeSearch = (src: AdguardSource, settings: SafeSearchSettings) =>
  call<void>(src, 'PUT', '/safesearch', settings)

export const getServices = (src: AdguardSource) =>
  call<AdguardServicesData>(src, 'GET', '/services')

export const setBlockedServices = (src: AdguardSource, ids: string[]) =>
  call<void>(src, 'PUT', '/services', { ids })
