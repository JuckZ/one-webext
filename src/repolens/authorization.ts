import type { InstalledModuleRecord } from '~/modules/types'

export async function resolveRepoLensInitFields(
  record: InstalledModuleRecord,
  extensionOrigin: string,
): Promise<Record<string, unknown>> {
  if (record.manifest.id !== 'dev.juck.repolens' || record.manifest.runtime !== 'remote-frame')
    return {}
  try {
    const stored = await browser.storage.local.get('repolensPairingToken')
    const pairingToken = typeof stored.repolensPairingToken === 'string' ? stored.repolensPairingToken : ''
    const origin = new URL(record.manifest.entry_url).origin
    const response = await fetch(`${origin}/api/auth/extension-grants`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(pairingToken ? { 'x-repolens-pairing-token': pairingToken } : {}),
      },
      body: JSON.stringify({ extensionOrigin }),
    })
    if (!response.ok)
      return {}
    const data = await response.json() as { authorizationCode?: unknown }
    return typeof data.authorizationCode === 'string' ? { authorizationCode: data.authorizationCode } : {}
  }
  catch {
    return {}
  }
}
