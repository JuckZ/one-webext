export function parseModuleSourceUrl(value: string): URL | null {
  try {
    const url = new URL(value)
    const localHttp = url.protocol === 'http:'
      && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')
    if ((url.protocol !== 'https:' && !localHttp)
      || url.username
      || url.password
      || url.hash) {
      return null
    }
    return url
  }
  catch {
    return null
  }
}

export function getModuleOriginPattern(value: string): string | null {
  const url = parseModuleSourceUrl(value)
  return url ? `${url.origin}/*` : null
}
