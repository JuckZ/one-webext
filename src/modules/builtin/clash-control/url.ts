import type { ClashControlErrorCode, NormalizedClashController } from './contracts'

export type NormalizeClashControllerResult =
  | { ok: true, controller: NormalizedClashController }
  | { ok: false, reason: Extract<ClashControlErrorCode, 'invalid-controller-url' | 'controller-not-loopback'> }

function isIpv4Loopback(hostname: string) {
  const parts = hostname.split('.')
  return parts.length === 4
    && parts[0] === '127'
    && parts.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

function isExplicitLoopback(hostname: string) {
  const normalized = hostname.toLowerCase()
  return normalized === 'localhost'
    || normalized === '[::1]'
    || normalized === '::1'
    || isIpv4Loopback(normalized)
}

export function normalizeClashControllerUrl(value: unknown): NormalizeClashControllerResult {
  if (typeof value !== 'string')
    return { ok: false, reason: 'invalid-controller-url' }
  const raw = value.trim()
  if (!raw || raw.length > 2048)
    return { ok: false, reason: 'invalid-controller-url' }
  let url: URL
  try {
    url = new URL(raw)
  }
  catch {
    return { ok: false, reason: 'invalid-controller-url' }
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:')
    || url.username
    || url.password
    || (url.pathname !== '/' && url.pathname !== '')
    || url.search
    || url.hash) {
    return { ok: false, reason: 'invalid-controller-url' }
  }
  if (!isExplicitLoopback(url.hostname))
    return { ok: false, reason: 'controller-not-loopback' }
  return {
    ok: true,
    controller: {
      controllerOrigin: url.origin,
      originPattern: `${url.origin}/*`,
    },
  }
}
