import type {
  InstallUserModuleInput,
  ModuleRegistry,
  ModuleUpdateApplicationErrorCode,
} from './registry'
import type {
  InstalledModuleRecord,
  ModuleCapabilityId,
  ModuleContextFieldGrants,
  OneWebModuleManifest,
  RemoteFrameModuleManifest,
} from './types'
import { validateModuleManifest } from './manifest'
import { getModuleOriginPattern, parseModuleSourceUrl } from './module-origin'
import { classifyModuleUpdate } from './module-update'

export const MAX_MODULE_MANIFEST_BYTES = 128 * 1024
export const MODULE_MANIFEST_FETCH_TIMEOUT_MS = 10_000

export type ModuleInstallErrorCode =
  | 'invalid-manifest-url'
  | 'installation-unavailable'
  | 'missing-origin-permission'
  | 'fetch-failed'
  | 'manifest-too-large'
  | 'manifest-invalid'
  | 'manifest-origin-mismatch'
  | 'host-incompatible'
  | 'already-installed'
  | 'manifest-changed'

export type ModuleUpdateCheckErrorCode =
  | ModuleInstallErrorCode
  | 'update-check-unavailable'
  | 'not-found'
  | 'not-updateable'
  | 'installed-record-changed'

export interface ModuleInstallReview {
  manifest: RemoteFrameModuleManifest
  manifestUrl: string
  manifestDigest: string
  originPattern: string
}

export interface ModuleInstallSelection {
  grantedContextFields: ModuleContextFieldGrants
  grantedCapabilities: ModuleCapabilityId[]
}

export type ModuleInstallPrepareResult =
  | { ok: true, review: ModuleInstallReview }
  | { ok: false, reason: ModuleInstallErrorCode }

export type ModuleInstallConfirmResult =
  | { ok: true, record: InstalledModuleRecord }
  | { ok: false, reason: ModuleInstallErrorCode }

export type ModuleUpdateCheckResult =
  | { ok: true, record: InstalledModuleRecord }
  | { ok: false, reason: ModuleUpdateCheckErrorCode }

export type ModuleUpdateApplyErrorCode =
  | ModuleInstallErrorCode
  | ModuleUpdateApplicationErrorCode
  | 'update-apply-unavailable'
  | 'not-updateable'

export type ModuleUpdateApplyResult =
  | { ok: true, record: InstalledModuleRecord }
  | { ok: false, reason: ModuleUpdateApplyErrorCode }

export interface ModuleOriginPermissions {
  contains: (_permissions: { origins: string[] }) => Promise<boolean>
  remove: (_permissions: { origins: string[] }) => Promise<boolean>
}

export interface ModuleInstallerOptions {
  registry: ModuleRegistry
  permissions: ModuleOriginPermissions
  hostVersion: string
  fetch?: typeof globalThis.fetch
  now?: () => string
  originInUse?: (_originPattern: string) => boolean | Promise<boolean>
}

interface LoadedManifest {
  manifest: RemoteFrameModuleManifest
  sourceUrl: string
  digest: string
  originPattern: string
}

type LoadManifestResult =
  | { ok: true, value: LoadedManifest }
  | { ok: false, reason: ModuleInstallErrorCode }

function compareSemver(left: string, right: string) {
  const [leftCore, leftPrerelease] = left.split('+', 1)[0].split('-', 2)
  const [rightCore, rightPrerelease] = right.split('+', 1)[0].split('-', 2)
  const leftParts = leftCore.split('.').map(Number)
  const rightParts = rightCore.split('.').map(Number)
  for (let index = 0; index < 3; index++) {
    if (leftParts[index] !== rightParts[index])
      return leftParts[index] - rightParts[index]
  }
  if (leftPrerelease === rightPrerelease)
    return 0
  if (!leftPrerelease)
    return 1
  if (!rightPrerelease)
    return -1
  const leftIdentifiers = leftPrerelease.split('.')
  const rightIdentifiers = rightPrerelease.split('.')
  const length = Math.max(leftIdentifiers.length, rightIdentifiers.length)
  for (let index = 0; index < length; index++) {
    const leftIdentifier = leftIdentifiers[index]
    const rightIdentifier = rightIdentifiers[index]
    if (leftIdentifier === rightIdentifier)
      continue
    if (leftIdentifier === undefined)
      return -1
    if (rightIdentifier === undefined)
      return 1
    const leftNumeric = /^\d+$/.test(leftIdentifier)
    const rightNumeric = /^\d+$/.test(rightIdentifier)
    if (leftNumeric && rightNumeric)
      return Number(leftIdentifier) - Number(rightIdentifier)
    if (leftNumeric)
      return -1
    if (rightNumeric)
      return 1
    return leftIdentifier.localeCompare(rightIdentifier)
  }
  return 0
}

export function isHostVersionCompatible(hostVersion: string, minimumVersion: string) {
  return compareSemver(hostVersion, minimumVersion) >= 0
}

export async function digestModuleManifest(manifest: OneWebModuleManifest) {
  const data = new TextEncoder().encode(JSON.stringify(manifest))
  const digest = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

export class ModuleInstaller {
  private readonly registry: ModuleRegistry
  private readonly permissions: ModuleOriginPermissions
  private readonly hostVersion: string
  private readonly fetch: typeof globalThis.fetch
  private readonly now: () => string
  private readonly originInUse: (_originPattern: string) => boolean | Promise<boolean>

  constructor({
    registry,
    permissions,
    hostVersion,
    fetch = globalThis.fetch,
    now = () => new Date().toISOString(),
    originInUse = () => false,
  }: ModuleInstallerOptions) {
    this.registry = registry
    this.permissions = permissions
    this.hostVersion = hostVersion
    this.fetch = fetch.bind(globalThis)
    this.now = now
    this.originInUse = originInUse
  }

  async prepare(manifestUrl: string): Promise<ModuleInstallPrepareResult> {
    const loaded = await this.loadManifest(manifestUrl)
    if (!loaded.ok) {
      await this.releaseOriginIfUnused(manifestUrl)
      return loaded
    }

    if (await this.registry.get(loaded.value.manifest.id)) {
      await this.releaseOriginIfUnused(loaded.value.sourceUrl)
      return { ok: false, reason: 'already-installed' }
    }

    return {
      ok: true,
      review: {
        manifest: loaded.value.manifest,
        manifestUrl: loaded.value.sourceUrl,
        manifestDigest: loaded.value.digest,
        originPattern: loaded.value.originPattern,
      },
    }
  }

  async confirm(
    manifestUrl: string,
    expectedDigest: string,
    selection: ModuleInstallSelection,
  ): Promise<ModuleInstallConfirmResult> {
    const loaded = await this.loadManifest(manifestUrl)
    if (!loaded.ok) {
      await this.releaseOriginIfUnused(manifestUrl)
      return loaded
    }
    if (loaded.value.digest !== expectedDigest) {
      await this.releaseOriginIfUnused(loaded.value.sourceUrl)
      return { ok: false, reason: 'manifest-changed' }
    }

    const input: InstallUserModuleInput = {
      manifest: loaded.value.manifest,
      sourceUrl: loaded.value.sourceUrl,
      grantedContextFields: selection.grantedContextFields,
      grantedCapabilities: selection.grantedCapabilities,
    }
    const installed = await this.registry.installUserModule(input)
    if (!installed.ok) {
      await this.releaseOriginIfUnused(loaded.value.sourceUrl)
      return {
        ok: false,
        reason: installed.reason === 'already-installed' ? 'already-installed' : 'manifest-invalid',
      }
    }
    return { ok: true, record: installed.record }
  }

  async cancel(manifestUrl: string) {
    return this.releaseOriginIfUnused(manifestUrl)
  }

  async checkForUpdate(moduleId: string): Promise<ModuleUpdateCheckResult> {
    const installed = await this.registry.get(moduleId)
    if (!installed)
      return { ok: false, reason: 'not-found' }
    if (installed.source !== 'user'
      || installed.manifest.runtime !== 'remote-frame'
      || !installed.sourceUrl) {
      return { ok: false, reason: 'not-updateable' }
    }

    const loaded = await this.loadManifest(installed.sourceUrl)
    if (!loaded.ok) {
      const cleared = await this.registry.setModuleUpdateCandidate(installed, null)
      if (!cleared.ok) {
        return {
          ok: false,
          reason: cleared.reason === 'not-found' ? 'not-found' : 'installed-record-changed',
        }
      }
      return loaded
    }

    const persisted = await this.registry.setModuleUpdateCandidate(installed, {
      candidateManifest: loaded.value.manifest,
      candidateSourceUrl: loaded.value.sourceUrl,
      normalizedManifestDigest: loaded.value.digest,
      checkedAt: this.now(),
    })
    if (!persisted.ok) {
      if (persisted.reason === 'invalid-candidate')
        return { ok: false, reason: 'manifest-invalid' }
      return { ok: false, reason: persisted.reason }
    }
    return { ok: true, record: persisted.record }
  }

  async applyUpdate(moduleId: string): Promise<ModuleUpdateApplyResult> {
    const installed = await this.registry.get(moduleId)
    if (!installed)
      return { ok: false, reason: 'not-found' }
    if (installed.source !== 'user'
      || installed.manifest.runtime !== 'remote-frame'
      || !installed.sourceUrl) {
      return { ok: false, reason: 'not-updateable' }
    }
    if (!installed.update)
      return { ok: false, reason: 'no-update-candidate' }

    const storedClassification = classifyModuleUpdate(installed, installed.update)
    if (storedClassification.outcome === 'rejected')
      return { ok: false, reason: 'update-rejected' }
    if (storedClassification.outcome === 'approval-required'
      && (installed.update.approvalStatus !== 'approved'
        || installed.update.approvedManifestDigest !== installed.update.normalizedManifestDigest)) {
      return { ok: false, reason: 'update-approval-required' }
    }

    const loaded = await this.loadManifest(installed.sourceUrl)
    if (!loaded.ok)
      return loaded
    if (loaded.value.digest !== installed.update.normalizedManifestDigest
      || (storedClassification.outcome === 'approval-required'
        && loaded.value.digest !== installed.update.approvedManifestDigest)) {
      return { ok: false, reason: 'update-candidate-changed' }
    }

    const applied = await this.registry.applyModuleUpdate(installed, {
      candidateManifest: loaded.value.manifest,
      candidateSourceUrl: loaded.value.sourceUrl,
      normalizedManifestDigest: loaded.value.digest,
      checkedAt: this.now(),
    })
    if (!applied.ok)
      return { ok: false, reason: applied.reason }
    return { ok: true, record: applied.record }
  }

  async releaseRemovedRecord(record: InstalledModuleRecord) {
    if (record.source !== 'user' || record.manifest.runtime !== 'remote-frame')
      return false
    return this.releaseOriginIfUnused(record.sourceUrl || record.manifest.entry_url)
  }

  private async loadManifest(manifestUrl: string): Promise<LoadManifestResult> {
    const source = parseModuleSourceUrl(manifestUrl)
    const originPattern = getModuleOriginPattern(manifestUrl)
    if (!source || !originPattern)
      return { ok: false, reason: 'invalid-manifest-url' }
    if (!await this.permissions.contains({ origins: [originPattern] }))
      return { ok: false, reason: 'missing-origin-permission' }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), MODULE_MANIFEST_FETCH_TIMEOUT_MS)
    let response: Response
    try {
      response = await this.fetch(source.href, {
        cache: 'no-store',
        credentials: 'omit',
        headers: { accept: 'application/json' },
        redirect: 'follow',
        signal: controller.signal,
      })
    }
    catch {
      return { ok: false, reason: 'fetch-failed' }
    }
    finally {
      clearTimeout(timeout)
    }
    if (!response.ok)
      return { ok: false, reason: 'fetch-failed' }

    const finalSource = parseModuleSourceUrl(response.url || source.href)
    if (!finalSource || finalSource.origin !== source.origin)
      return { ok: false, reason: 'manifest-origin-mismatch' }
    const declaredLength = Number(response.headers.get('content-length'))
    if (Number.isFinite(declaredLength) && declaredLength > MAX_MODULE_MANIFEST_BYTES)
      return { ok: false, reason: 'manifest-too-large' }

    let text: string
    try {
      text = await response.text()
    }
    catch {
      return { ok: false, reason: 'fetch-failed' }
    }
    if (new TextEncoder().encode(text).byteLength > MAX_MODULE_MANIFEST_BYTES)
      return { ok: false, reason: 'manifest-too-large' }

    let candidate: unknown
    try {
      candidate = JSON.parse(text)
    }
    catch {
      return { ok: false, reason: 'manifest-invalid' }
    }
    const validated = validateModuleManifest(candidate)
    if (!validated.ok || validated.manifest.runtime !== 'remote-frame')
      return { ok: false, reason: 'manifest-invalid' }
    if (new URL(validated.manifest.entry_url).origin !== finalSource.origin)
      return { ok: false, reason: 'manifest-origin-mismatch' }
    if (!isHostVersionCompatible(this.hostVersion, validated.manifest.min_host_version))
      return { ok: false, reason: 'host-incompatible' }

    return {
      ok: true,
      value: {
        manifest: validated.manifest,
        sourceUrl: finalSource.href,
        digest: await digestModuleManifest(validated.manifest),
        originPattern,
      },
    }
  }

  private async releaseOriginIfUnused(value: string) {
    const source = parseModuleSourceUrl(value)
    const originPattern = getModuleOriginPattern(value)
    if (!source || !originPattern)
      return false
    const records = await this.registry.list()
    const stillUsed = records.some(record => (
      record.manifest.runtime === 'remote-frame'
      && new URL(record.manifest.entry_url).origin === source.origin
    ))
    if (stillUsed)
      return false
    try {
      if (await this.originInUse(originPattern))
        return false
      return await this.permissions.remove({ origins: [originPattern] })
    }
    catch {
      return false
    }
  }
}
