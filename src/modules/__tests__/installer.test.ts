import type { ModuleOriginPermissions } from '../installer'
import type { ModuleStorageArea } from '../registry'
import type { InstalledModuleRecord, RemoteFrameModuleManifest } from '../types'
import {
  digestModuleManifest,
  isHostVersionCompatible,
  MAX_MODULE_MANIFEST_BYTES,
  ModuleInstaller,
} from '../installer'
import { getModuleOriginPattern } from '../module-origin'
import { ModuleRegistry, MODULES_STORAGE_KEY } from '../registry'
import { createRepoLensSeed } from '../seeds/repolens'

class MemoryStorage implements ModuleStorageArea {
  state: Record<string, unknown> = {}

  async get(_key: string) {
    return structuredClone(this.state)
  }

  async set(items: Record<string, unknown>) {
    this.state = { ...this.state, ...structuredClone(items) }
  }
}

class MemoryPermissions implements ModuleOriginPermissions {
  readonly granted = new Set<string>()
  readonly contains = vi.fn(async ({ origins }: { origins: string[] }) => origins.every(origin => this.granted.has(origin)))
  readonly remove = vi.fn(async ({ origins }: { origins: string[] }) => {
    let changed = false
    for (const origin of origins)
      changed = this.granted.delete(origin) || changed
    return changed
  })
}

function installableManifest(origin = 'https://modules.example'): RemoteFrameModuleManifest {
  const manifest = createRepoLensSeed(origin).manifest
  if (manifest.runtime !== 'remote-frame')
    throw new Error('Expected a remote-frame fixture')
  return {
    ...manifest,
    id: 'dev.juck.installable',
    name: 'Installable',
    capabilities: ['tabs.open'],
  }
}

function manifestResponse(manifest: unknown, url: string, headers: Record<string, string> = {}) {
  const response = new Response(JSON.stringify(manifest), {
    status: 200,
    headers: { 'content-type': 'application/json', ...headers },
  })
  Object.defineProperty(response, 'url', { value: url })
  return response
}

async function installFixture(
  registry: ModuleRegistry,
  manifest: RemoteFrameModuleManifest,
  sourceUrl: string,
) {
  const installed = await registry.installUserModule({
    manifest,
    sourceUrl,
    grantedContextFields: { 'github.repository': ['repo'] },
    grantedCapabilities: ['tabs.open'],
  })
  if (!installed.ok)
    throw new Error('Expected an installed fixture')
  return installed.record
}

function installedState(record: InstalledModuleRecord) {
  return {
    manifest: structuredClone(record.manifest),
    enabled: record.enabled,
    source: record.source,
    sourceUrl: record.sourceUrl,
    grantedContexts: structuredClone(record.grantedContexts),
    grantedContextFields: structuredClone(record.grantedContextFields),
    grantedCapabilities: structuredClone(record.grantedCapabilities),
    installedAt: record.installedAt,
    updatedAt: record.updatedAt,
  }
}

describe('module installer', () => {
  const manifestUrl = 'https://modules.example/.well-known/oneweb-module.json'
  const originPattern = getModuleOriginPattern(manifestUrl)!

  it('compares stable, prerelease and build metadata versions correctly', () => {
    expect(isHostVersionCompatible('0.0.1+host.2', '0.0.1')).toBe(true)
    expect(isHostVersionCompatible('1.0.0-beta.10', '1.0.0-beta.2')).toBe(true)
    expect(isHostVersionCompatible('1.0.0-beta.2', '1.0.0')).toBe(false)
  })

  it('re-fetches the reviewed manifest and persists only normalized grants', async () => {
    const manifest = installableManifest()
    const registry = new ModuleRegistry({ storage: new MemoryStorage(), now: () => '2026-08-27T00:00:00.000Z' })
    const permissions = new MemoryPermissions()
    permissions.granted.add(originPattern)
    const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => (
      manifestResponse(manifest, manifestUrl)
    ))
    const installer = new ModuleInstaller({ registry, permissions, hostVersion: '0.1.0', fetch })

    const prepared = await installer.prepare(manifestUrl)
    expect(prepared).toMatchObject({
      ok: true,
      review: {
        manifest: { id: manifest.id },
        manifestUrl,
        originPattern,
      },
    })
    if (!prepared.ok)
      throw new Error('Expected install review')

    const confirmed = await installer.confirm(manifestUrl, prepared.review.manifestDigest, {
      grantedContextFields: { 'github.repository': ['repo', 'not-allowed'] },
      grantedCapabilities: ['tabs.open'],
    })
    expect(confirmed).toMatchObject({
      ok: true,
      record: {
        source: 'user',
        grantedContextFields: { 'github.repository': ['repo'] },
        grantedCapabilities: ['tabs.open'],
      },
    })
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(fetch.mock.contexts[0]).toBe(globalThis)
    expect(fetch.mock.calls[0][1]).toMatchObject({
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'follow',
    })
  })

  it('rejects a manifest changed after review and releases its unused origin', async () => {
    const manifest = installableManifest()
    const registry = new ModuleRegistry({ storage: new MemoryStorage() })
    const permissions = new MemoryPermissions()
    permissions.granted.add(originPattern)
    const fetch = vi.fn()
      .mockResolvedValueOnce(manifestResponse(manifest, manifestUrl))
      .mockResolvedValueOnce(manifestResponse({ ...manifest, version: '0.2.0' }, manifestUrl))
    const installer = new ModuleInstaller({ registry, permissions, hostVersion: '0.1.0', fetch })

    const prepared = await installer.prepare(manifestUrl)
    if (!prepared.ok)
      throw new Error('Expected install review')
    await expect(installer.confirm(manifestUrl, prepared.review.manifestDigest, {
      grantedContextFields: {},
      grantedCapabilities: [],
    })).resolves.toEqual({ ok: false, reason: 'manifest-changed' })
    expect(await registry.list()).toEqual([])
    expect(permissions.remove).toHaveBeenCalledWith({ origins: [originPattern] })
  })

  it('refuses fetches without the exact granted origin', async () => {
    const registry = new ModuleRegistry({ storage: new MemoryStorage() })
    const permissions = new MemoryPermissions()
    const fetch = vi.fn()
    const installer = new ModuleInstaller({ registry, permissions, hostVersion: '0.1.0', fetch })

    await expect(installer.prepare(manifestUrl)).resolves.toEqual({
      ok: false,
      reason: 'missing-origin-permission',
    })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rejects cross-origin redirects, entry origins, oversized manifests and incompatible hosts', async () => {
    const permissions = new MemoryPermissions()
    permissions.granted.add(originPattern)

    const redirected = new ModuleInstaller({
      registry: new ModuleRegistry({ storage: new MemoryStorage() }),
      permissions,
      hostVersion: '0.1.0',
      fetch: async () => manifestResponse(installableManifest(), 'https://evil.example/module.json'),
    })
    await expect(redirected.prepare(manifestUrl)).resolves.toEqual({
      ok: false,
      reason: 'manifest-origin-mismatch',
    })

    permissions.granted.add(originPattern)
    const crossOriginEntry = new ModuleInstaller({
      registry: new ModuleRegistry({ storage: new MemoryStorage() }),
      permissions,
      hostVersion: '0.1.0',
      fetch: async () => manifestResponse(installableManifest('https://evil.example'), manifestUrl),
    })
    await expect(crossOriginEntry.prepare(manifestUrl)).resolves.toEqual({
      ok: false,
      reason: 'manifest-origin-mismatch',
    })

    permissions.granted.add(originPattern)
    const oversizedBody = new ModuleInstaller({
      registry: new ModuleRegistry({ storage: new MemoryStorage() }),
      permissions,
      hostVersion: '0.1.0',
      fetch: async () => manifestResponse({
        ...installableManifest(),
        padding: 'x'.repeat(MAX_MODULE_MANIFEST_BYTES),
      }, manifestUrl),
    })
    await expect(oversizedBody.prepare(manifestUrl)).resolves.toEqual({
      ok: false,
      reason: 'manifest-too-large',
    })

    permissions.granted.add(originPattern)
    const oversized = new ModuleInstaller({
      registry: new ModuleRegistry({ storage: new MemoryStorage() }),
      permissions,
      hostVersion: '0.1.0',
      fetch: async () => manifestResponse(installableManifest(), manifestUrl, {
        'content-length': String(MAX_MODULE_MANIFEST_BYTES + 1),
      }),
    })
    await expect(oversized.prepare(manifestUrl)).resolves.toEqual({
      ok: false,
      reason: 'manifest-too-large',
    })

    permissions.granted.add(originPattern)
    const incompatible = new ModuleInstaller({
      registry: new ModuleRegistry({ storage: new MemoryStorage() }),
      permissions,
      hostVersion: '0.1.0',
      fetch: async () => manifestResponse({ ...installableManifest(), min_host_version: '1.0.0' }, manifestUrl),
    })
    await expect(incompatible.prepare(manifestUrl)).resolves.toEqual({
      ok: false,
      reason: 'host-incompatible',
    })
  })

  it('checks only the installed source URL and persists a safe candidate without changing installed state', async () => {
    const installedAt = '2026-08-27T08:00:00.000Z'
    const checkedAt = '2026-08-27T09:00:00.000Z'
    const storage = new MemoryStorage()
    const registry = new ModuleRegistry({ storage, now: () => installedAt })
    const installedManifest = installableManifest()
    const installed = await installFixture(registry, installedManifest, manifestUrl)
    const before = installedState(installed)
    const candidate = {
      ...installedManifest,
      version: '0.2.0',
      description: 'Updated copy',
    }
    const permissions = new MemoryPermissions()
    permissions.granted.add(originPattern)
    const fetch = vi.fn(async () => manifestResponse(candidate, manifestUrl))
    const installer = new ModuleInstaller({
      registry,
      permissions,
      hostVersion: '0.1.0',
      fetch,
      now: () => checkedAt,
    })

    const checked = await installer.checkForUpdate(installed.manifest.id)

    expect(checked).toMatchObject({
      ok: true,
      record: {
        ...before,
        update: {
          candidateManifest: { version: '0.2.0' },
          candidateSourceUrl: manifestUrl,
          checkedAt,
          approvalStatus: 'not-required',
          approvedManifestDigest: null,
        },
      },
    })
    expect(fetch).toHaveBeenCalledOnce()
    expect(fetch).toHaveBeenCalledWith(manifestUrl, expect.objectContaining({
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'follow',
    }))
    if (!checked.ok || !checked.record.update)
      throw new Error('Expected persisted update metadata')
    expect(checked.record.update.normalizedManifestDigest).toBe(
      await digestModuleManifest(checked.record.update.candidateManifest),
    )
  })

  it('does not fetch missing or seeded modules', async () => {
    const seed = createRepoLensSeed('https://modules.example')
    const fetch = vi.fn()
    const registry = new ModuleRegistry({
      storage: new MemoryStorage(),
      seeds: [seed],
      now: () => '2026-08-27T08:00:00.000Z',
    })
    const installer = new ModuleInstaller({
      registry,
      permissions: new MemoryPermissions(),
      hostVersion: '0.1.0',
      fetch,
    })

    await expect(installer.checkForUpdate('dev.juck.missing')).resolves.toEqual({
      ok: false,
      reason: 'not-found',
    })
    await expect(installer.checkForUpdate(seed.manifest.id)).resolves.toEqual({
      ok: false,
      reason: 'not-updateable',
    })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('persists expanded-access and malicious immutable-boundary candidates for later review', async () => {
    const registry = new ModuleRegistry({
      storage: new MemoryStorage(),
      now: () => '2026-08-27T08:00:00.000Z',
    })
    const installedManifest = installableManifest()
    const installed = await installFixture(registry, installedManifest, manifestUrl)
    const permissions = new MemoryPermissions()
    permissions.granted.add(originPattern)
    let candidate: RemoteFrameModuleManifest = {
      ...installedManifest,
      capabilities: ['tabs.open', 'clipboard.write'],
    }
    const installer = new ModuleInstaller({
      registry,
      permissions,
      hostVersion: '0.1.0',
      fetch: async () => manifestResponse(candidate, manifestUrl),
      now: () => '2026-08-27T09:00:00.000Z',
    })

    await expect(installer.checkForUpdate(installed.manifest.id)).resolves.toMatchObject({
      ok: true,
      record: { update: { approvalStatus: 'pending', approvedManifestDigest: null } },
    })

    candidate = { ...candidate, id: 'dev.evil.replacement' }
    await expect(installer.checkForUpdate(installed.manifest.id)).resolves.toMatchObject({
      ok: true,
      record: {
        manifest: { id: installed.manifest.id },
        update: {
          candidateManifest: { id: 'dev.evil.replacement' },
          approvalStatus: 'rejected',
          approvedManifestDigest: null,
        },
      },
    })
  })

  it('clears stale candidates after fetch, permission or redirect failure', async () => {
    const installedAt = '2026-08-27T08:00:00.000Z'
    const storage = new MemoryStorage()
    const registry = new ModuleRegistry({ storage, now: () => installedAt })
    const installedManifest = installableManifest()
    const installed = await installFixture(registry, installedManifest, manifestUrl)
    const candidate = { ...installedManifest, version: '0.2.0' }
    const permissions = new MemoryPermissions()
    permissions.granted.add(originPattern)
    const fetch = vi.fn(async () => manifestResponse(candidate, manifestUrl))
    const installer = new ModuleInstaller({
      registry,
      permissions,
      hostVersion: '0.1.0',
      fetch,
      now: () => '2026-08-27T09:00:00.000Z',
    })

    await installer.checkForUpdate(installed.manifest.id)
    fetch.mockRejectedValueOnce(new Error('offline'))
    await expect(installer.checkForUpdate(installed.manifest.id)).resolves.toEqual({
      ok: false,
      reason: 'fetch-failed',
    })
    expect((await registry.get(installed.manifest.id))?.update).toBeNull()

    await installer.checkForUpdate(installed.manifest.id)
    permissions.granted.clear()
    await expect(installer.checkForUpdate(installed.manifest.id)).resolves.toEqual({
      ok: false,
      reason: 'missing-origin-permission',
    })
    expect((await registry.get(installed.manifest.id))?.update).toBeNull()

    permissions.granted.add(originPattern)
    await installer.checkForUpdate(installed.manifest.id)
    fetch.mockResolvedValueOnce(manifestResponse(candidate, 'https://evil.example/manifest.json'))
    await expect(installer.checkForUpdate(installed.manifest.id)).resolves.toEqual({
      ok: false,
      reason: 'manifest-origin-mismatch',
    })
    const after = await registry.get(installed.manifest.id)
    expect(after?.update).toBeNull()
    expect(after).toMatchObject(installedState(installed))
  })

  it('keeps digest-bound approval only for the same candidate and resets changed candidates to pending', async () => {
    const storage = new MemoryStorage()
    const registry = new ModuleRegistry({
      storage,
      now: () => '2026-08-27T08:00:00.000Z',
    })
    const installedManifest = installableManifest()
    const installed = await installFixture(registry, installedManifest, manifestUrl)
    const permissions = new MemoryPermissions()
    permissions.granted.add(originPattern)
    let candidate: RemoteFrameModuleManifest = {
      ...installedManifest,
      capabilities: ['tabs.open', 'clipboard.write'],
    }
    let checkedAt = '2026-08-27T09:00:00.000Z'
    const installer = new ModuleInstaller({
      registry,
      permissions,
      hostVersion: '0.1.0',
      fetch: async () => manifestResponse(candidate, manifestUrl),
      now: () => checkedAt,
    })

    const first = await installer.checkForUpdate(installed.manifest.id)
    if (!first.ok || !first.record.update)
      throw new Error('Expected a persisted candidate')
    const digest = first.record.update.normalizedManifestDigest
    const records = storage.state[MODULES_STORAGE_KEY] as InstalledModuleRecord[]
    records[0].update = {
      ...records[0].update!,
      approvalStatus: 'approved',
      approvedManifestDigest: digest,
      approvalSnapshot: {
        approvedManifestDigest: digest,
        approvedMatches: candidate.matches,
        approvedActivation: candidate.activation,
        approvedContextFields: {},
        approvedCapabilities: [],
        approvedAt: '2026-08-27T09:30:00.000Z',
      },
    }

    checkedAt = '2026-08-27T10:00:00.000Z'
    await expect(installer.checkForUpdate(installed.manifest.id)).resolves.toMatchObject({
      ok: true,
      record: {
        update: {
          approvalStatus: 'approved',
          approvedManifestDigest: digest,
        },
      },
    })

    candidate = { ...candidate, version: '0.2.0' }
    checkedAt = '2026-08-27T11:00:00.000Z'
    const changed = await installer.checkForUpdate(installed.manifest.id)
    expect(changed).toMatchObject({
      ok: true,
      record: {
        update: {
          approvalStatus: 'pending',
          approvedManifestDigest: null,
          approvalSnapshot: null,
        },
      },
    })
    expect(changed.ok && changed.record.update?.normalizedManifestDigest).not.toBe(digest)
  })

  it('serializes concurrent candidate persistence without losing another installed module', async () => {
    const installedAt = '2026-08-27T08:00:00.000Z'
    const registry = new ModuleRegistry({ storage: new MemoryStorage(), now: () => installedAt })
    const firstManifest = installableManifest()
    const secondManifest = { ...firstManifest, id: 'dev.juck.concurrent' }
    const secondUrl = 'https://modules.example/concurrent.json'
    const first = await installFixture(registry, firstManifest, manifestUrl)
    const second = await installFixture(registry, secondManifest, secondUrl)
    const permissions = new MemoryPermissions()
    permissions.granted.add(originPattern)
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      const manifest = url === manifestUrl ? firstManifest : secondManifest
      return manifestResponse({ ...manifest, version: '0.2.0' }, url)
    })
    const installer = new ModuleInstaller({
      registry,
      permissions,
      hostVersion: '0.1.0',
      fetch,
      now: () => '2026-08-27T09:00:00.000Z',
    })

    await Promise.all([
      installer.checkForUpdate(first.manifest.id),
      installer.checkForUpdate(second.manifest.id),
    ])

    const records = await registry.list()
    expect(records).toHaveLength(2)
    expect(records.every(record => record.update?.candidateManifest.version === '0.2.0')).toBe(true)
    expect(records.map(record => record.sourceUrl)).toEqual([manifestUrl, secondUrl])
    expect(records.every(record => record.installedAt === installedAt && record.updatedAt === installedAt)).toBe(true)
  })

  it('does not let an older concurrent check overwrite a newer candidate', async () => {
    const registry = new ModuleRegistry({
      storage: new MemoryStorage(),
      now: () => '2026-08-27T08:00:00.000Z',
    })
    const manifest = installableManifest()
    const installed = await installFixture(registry, manifest, manifestUrl)
    const permissions = new MemoryPermissions()
    permissions.granted.add(originPattern)
    let finishOlder!: (_response: Response) => void
    const olderResponse = new Promise<Response>((resolve) => {
      finishOlder = resolve
    })
    const fetch = vi.fn()
      .mockImplementationOnce(async () => olderResponse)
      .mockResolvedValueOnce(manifestResponse({ ...manifest, version: '0.3.0' }, manifestUrl))
    const installer = new ModuleInstaller({
      registry,
      permissions,
      hostVersion: '0.1.0',
      fetch,
      now: () => '2026-08-27T09:00:00.000Z',
    })

    const olderCheck = installer.checkForUpdate(installed.manifest.id)
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce())
    await expect(installer.checkForUpdate(installed.manifest.id)).resolves.toMatchObject({
      ok: true,
      record: { update: { candidateManifest: { version: '0.3.0' } } },
    })

    finishOlder(manifestResponse({ ...manifest, version: '0.2.0' }, manifestUrl))
    await expect(olderCheck).resolves.toEqual({
      ok: false,
      reason: 'installed-record-changed',
    })
    expect((await registry.get(installed.manifest.id))?.update?.candidateManifest.version).toBe('0.3.0')
  })

  it('keeps shared origins and releases only the last user origin after removal', async () => {
    const registry = new ModuleRegistry({ storage: new MemoryStorage() })
    const permissions = new MemoryPermissions()
    permissions.granted.add(originPattern)
    const manifest = installableManifest()
    const installer = new ModuleInstaller({
      registry,
      permissions,
      hostVersion: '0.1.0',
      fetch: async () => manifestResponse(manifest, manifestUrl),
    })
    const prepared = await installer.prepare(manifestUrl)
    if (!prepared.ok)
      throw new Error('Expected install review')
    const installed = await installer.confirm(manifestUrl, prepared.review.manifestDigest, {
      grantedContextFields: {},
      grantedCapabilities: [],
    })
    if (!installed.ok)
      throw new Error('Expected installed record')

    const sharedManifest = { ...manifest, id: 'dev.juck.shared-origin' }
    const shared = await registry.installUserModule({
      manifest: sharedManifest,
      sourceUrl: manifestUrl,
      grantedContextFields: {},
      grantedCapabilities: [],
    })
    if (!shared.ok)
      throw new Error('Expected a shared-origin record')

    expect(await installer.cancel(manifestUrl)).toBe(false)
    const removed = await registry.removeUserModule(manifest.id)
    if (!removed.ok)
      throw new Error('Expected removed record')
    expect(await installer.releaseRemovedRecord(removed.removed)).toBe(false)
    expect(permissions.granted.has(originPattern)).toBe(true)

    const lastRemoved = await registry.removeUserModule(sharedManifest.id)
    if (!lastRemoved.ok)
      throw new Error('Expected the last shared-origin record')
    expect(await installer.releaseRemovedRecord(lastRemoved.removed)).toBe(true)
    expect(permissions.granted.has(originPattern)).toBe(false)
  })

  it('retains the last remote origin while a packaged builtin reports active use', async () => {
    const registry = new ModuleRegistry({ storage: new MemoryStorage() })
    const permissions = new MemoryPermissions()
    permissions.granted.add(originPattern)
    const originInUse = vi.fn(async () => true)
    const installer = new ModuleInstaller({
      registry,
      permissions,
      hostVersion: '0.1.0',
      originInUse,
    })

    const record = await installFixture(registry, installableManifest(), manifestUrl)
    const removed = await registry.removeUserModule(record.manifest.id)
    if (!removed.ok)
      throw new Error('Expected removed record')
    await expect(installer.releaseRemovedRecord(removed.removed)).resolves.toBe(false)
    expect(originInUse).toHaveBeenCalledWith(originPattern)
    expect(permissions.remove).not.toHaveBeenCalled()
    expect(permissions.granted).toContain(originPattern)
  })
})
