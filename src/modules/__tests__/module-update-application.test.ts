import type { ModuleOriginPermissions } from '../installer'
import type { ModuleStorageArea } from '../registry'
import type {
  InstalledModuleRecord,
  ModuleCapabilityId,
  ModuleContextFieldGrants,
  RemoteFrameModuleManifest,
} from '../types'
import { ModuleInstaller } from '../installer'
import { getModuleOriginPattern } from '../module-origin'
import { ModuleRegistry } from '../registry'
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
  readonly contains = vi.fn(async ({ origins }: { origins: string[] }) => (
    origins.every(origin => this.granted.has(origin))
  ))

  readonly remove = vi.fn(async () => false)
}

function baseManifest(origin = 'https://modules.example'): RemoteFrameModuleManifest {
  const manifest = createRepoLensSeed(origin).manifest
  if (manifest.runtime !== 'remote-frame')
    throw new Error('Expected a remote-frame fixture')
  return {
    ...manifest,
    id: 'dev.juck.update-application',
    name: 'Update application fixture',
    capabilities: ['tabs.open'],
  }
}

function manifestResponse(manifest: unknown, url: string) {
  const response = new Response(JSON.stringify(manifest), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
  Object.defineProperty(response, 'url', { value: url })
  return response
}

function deferredResponse() {
  let resolve!: (_response: Response) => void
  const promise = new Promise<Response>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

async function installFixture(
  registry: ModuleRegistry,
  manifest: RemoteFrameModuleManifest,
  sourceUrl: string,
  grantedContextFields: ModuleContextFieldGrants = { 'github.repository': ['repo'] },
  grantedCapabilities: ModuleCapabilityId[] = ['tabs.open'],
) {
  const installed = await registry.installUserModule({
    manifest,
    sourceUrl,
    grantedContextFields,
    grantedCapabilities,
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

describe('module update approval and application', () => {
  const manifestUrl = 'https://modules.example/.well-known/oneweb-module.json'
  const originPattern = getModuleOriginPattern(manifestUrl)!
  const installedAt = '2026-08-27T08:00:00.000Z'
  const checkedAt = '2026-08-27T09:00:00.000Z'
  const approvedAt = '2026-08-27T10:00:00.000Z'
  const appliedAt = '2026-08-27T11:00:00.000Z'

  function createHarness(candidate: RemoteFrameModuleManifest, installedManifest = baseManifest()) {
    let now = installedAt
    const storage = new MemoryStorage()
    const registry = new ModuleRegistry({ storage, now: () => now })
    const permissions = new MemoryPermissions()
    permissions.granted.add(originPattern)
    let remoteCandidate = candidate
    const fetch = vi.fn(async () => manifestResponse(remoteCandidate, manifestUrl))
    const installer = new ModuleInstaller({
      registry,
      permissions,
      hostVersion: '0.1.0',
      fetch,
      now: () => now,
    })
    return {
      fetch,
      installer,
      installedManifest,
      registry,
      setCandidate(value: RemoteFrameModuleManifest) {
        remoteCandidate = value
      },
      setNow(value: string) {
        now = value
      },
      storage,
    }
  }

  it('applies a safe candidate without approval and preserves installation identity', async () => {
    const installedManifest = baseManifest()
    const candidate = { ...installedManifest, version: '0.2.0', description: 'Safe copy update' }
    const harness = createHarness(candidate, installedManifest)
    const installed = await installFixture(harness.registry, installedManifest, manifestUrl)
    const before = installedState(installed)

    harness.setNow(checkedAt)
    await harness.installer.checkForUpdate(installed.manifest.id)
    harness.setNow(appliedAt)
    const applied = await harness.installer.applyUpdate(installed.manifest.id)

    expect(applied).toMatchObject({
      ok: true,
      record: {
        ...before,
        manifest: { version: '0.2.0', description: 'Safe copy update' },
        update: null,
        updatedAt: appliedAt,
      },
    })
    expect(harness.fetch).toHaveBeenCalledTimes(2)
  })

  it('requires digest-bound approval and adds only selected context fields and capabilities', async () => {
    const installedManifest = baseManifest()
    const candidate: RemoteFrameModuleManifest = {
      ...installedManifest,
      matches: [...installedManifest.matches, 'https://example.com/*'],
      contexts: [...installedManifest.contexts, 'page.metadata'],
      context_fields: {
        ...installedManifest.context_fields,
        'page.metadata': ['title', 'description'],
      },
      capabilities: ['tabs.open', 'clipboard.write'],
      activation: 'suggest',
      version: '0.2.0',
    }
    const harness = createHarness(candidate, installedManifest)
    const installed = await installFixture(harness.registry, installedManifest, manifestUrl)
    harness.setNow(checkedAt)
    const checked = await harness.installer.checkForUpdate(installed.manifest.id)
    if (!checked.ok || !checked.record.update)
      throw new Error('Expected a pending candidate')

    await expect(harness.installer.applyUpdate(installed.manifest.id)).resolves.toEqual({
      ok: false,
      reason: 'update-approval-required',
    })
    expect(harness.fetch).toHaveBeenCalledOnce()
    await expect(harness.registry.approveModuleUpdate(
      installed.manifest.id,
      'f'.repeat(64),
      { approvedContextFields: {}, approvedCapabilities: [] },
    )).resolves.toEqual({
      ok: false,
      changed: false,
      reason: 'update-candidate-changed',
    })
    await expect(harness.registry.approveModuleUpdate(
      installed.manifest.id,
      checked.record.update.normalizedManifestDigest,
      {
        approvedContextFields: { 'page.metadata': ['language'] },
        approvedCapabilities: [],
      },
    )).resolves.toEqual({
      ok: false,
      changed: false,
      reason: 'invalid-update-approval',
    })

    harness.setNow(approvedAt)
    const approved = await harness.registry.approveModuleUpdate(
      installed.manifest.id,
      checked.record.update.normalizedManifestDigest,
      {
        approvedContextFields: { 'page.metadata': ['title'] },
        approvedCapabilities: ['clipboard.write'],
      },
    )
    expect(approved).toMatchObject({
      ok: true,
      record: {
        update: {
          approvalStatus: 'approved',
          approvedManifestDigest: checked.record.update.normalizedManifestDigest,
          approvalSnapshot: {
            approvedMatches: candidate.matches,
            approvedActivation: 'suggest',
            approvedContextFields: { 'page.metadata': ['title'] },
            approvedCapabilities: ['clipboard.write'],
            approvedAt,
          },
        },
      },
    })

    harness.setNow(appliedAt)
    const applied = await harness.installer.applyUpdate(installed.manifest.id)
    expect(applied).toMatchObject({
      ok: true,
      record: {
        manifest: { version: '0.2.0', activation: 'suggest' },
        grantedContexts: ['github.repository', 'page.metadata'],
        grantedContextFields: {
          'github.repository': ['repo'],
          'page.metadata': ['title'],
        },
        grantedCapabilities: ['tabs.open', 'clipboard.write'],
        update: null,
        installedAt,
        updatedAt: appliedAt,
      },
    })
    if (!applied.ok)
      throw new Error('Expected an applied update')
    expect(applied.record.grantedContextFields['page.metadata']).not.toContain('description')
  })

  it('does not approve safe candidates or approve/apply rejected candidates', async () => {
    const installedManifest = baseManifest()
    const safeCandidate = { ...installedManifest, version: '0.2.0' }
    const safe = createHarness(safeCandidate, installedManifest)
    const safeInstalled = await installFixture(safe.registry, installedManifest, manifestUrl)
    safe.setNow(checkedAt)
    const safeChecked = await safe.installer.checkForUpdate(safeInstalled.manifest.id)
    if (!safeChecked.ok || !safeChecked.record.update)
      throw new Error('Expected a safe candidate')
    await expect(safe.registry.approveModuleUpdate(
      safeInstalled.manifest.id,
      safeChecked.record.update.normalizedManifestDigest,
      { approvedContextFields: {}, approvedCapabilities: [] },
    )).resolves.toEqual({
      ok: false,
      changed: false,
      reason: 'update-approval-not-required',
    })

    const rejectedCandidate = { ...installedManifest, id: 'dev.evil.replacement' }
    const rejected = createHarness(rejectedCandidate, installedManifest)
    const rejectedInstalled = await installFixture(rejected.registry, installedManifest, manifestUrl)
    rejected.setNow(checkedAt)
    const rejectedChecked = await rejected.installer.checkForUpdate(rejectedInstalled.manifest.id)
    if (!rejectedChecked.ok || !rejectedChecked.record.update)
      throw new Error('Expected a rejected candidate')
    await expect(rejected.registry.approveModuleUpdate(
      rejectedInstalled.manifest.id,
      rejectedChecked.record.update.normalizedManifestDigest,
      { approvedContextFields: {}, approvedCapabilities: [] },
    )).resolves.toEqual({
      ok: false,
      changed: false,
      reason: 'update-rejected',
    })
    await expect(rejected.installer.applyUpdate(rejectedInstalled.manifest.id)).resolves.toEqual({
      ok: false,
      reason: 'update-rejected',
    })
    expect(rejected.fetch).toHaveBeenCalledOnce()
    expect(await rejected.registry.get(rejectedInstalled.manifest.id)).toMatchObject({
      manifest: { id: rejectedInstalled.manifest.id },
      installedAt,
      updatedAt: installedAt,
    })
  })

  it('rejects an application-time remote replacement without changing installed state', async () => {
    const installedManifest = baseManifest()
    const checkedCandidate = { ...installedManifest, version: '0.2.0' }
    const harness = createHarness(checkedCandidate, installedManifest)
    const installed = await installFixture(harness.registry, installedManifest, manifestUrl)
    harness.setNow(checkedAt)
    await harness.installer.checkForUpdate(installed.manifest.id)
    const before = await harness.registry.get(installed.manifest.id)

    harness.setCandidate({ ...checkedCandidate, version: '0.3.0' })
    harness.setNow(appliedAt)
    await expect(harness.installer.applyUpdate(installed.manifest.id)).resolves.toEqual({
      ok: false,
      reason: 'update-candidate-changed',
    })
    expect(await harness.registry.get(installed.manifest.id)).toEqual(before)
  })

  it('invalidates an old approval when candidate content and digest change', async () => {
    const installedManifest = baseManifest()
    let candidate: RemoteFrameModuleManifest = {
      ...installedManifest,
      capabilities: ['tabs.open', 'clipboard.write'],
    }
    const harness = createHarness(candidate, installedManifest)
    const installed = await installFixture(harness.registry, installedManifest, manifestUrl)
    harness.setNow(checkedAt)
    const first = await harness.installer.checkForUpdate(installed.manifest.id)
    if (!first.ok || !first.record.update)
      throw new Error('Expected a pending candidate')
    harness.setNow(approvedAt)
    await harness.registry.approveModuleUpdate(
      installed.manifest.id,
      first.record.update.normalizedManifestDigest,
      { approvedContextFields: {}, approvedCapabilities: ['clipboard.write'] },
    )

    candidate = { ...candidate, version: '0.2.0' }
    harness.setCandidate(candidate)
    harness.setNow(appliedAt)
    const refreshed = await harness.installer.checkForUpdate(installed.manifest.id)
    expect(refreshed).toMatchObject({
      ok: true,
      record: {
        update: {
          approvalStatus: 'pending',
          approvedManifestDigest: null,
          approvalSnapshot: null,
        },
      },
    })
    await expect(harness.installer.applyUpdate(installed.manifest.id)).resolves.toEqual({
      ok: false,
      reason: 'update-approval-required',
    })
  })

  it('automatically removes grants no longer declared by a safe candidate', async () => {
    const installedManifest: RemoteFrameModuleManifest = {
      ...baseManifest(),
      contexts: ['github.repository', 'page.metadata'],
      context_fields: {
        'github.repository': ['repo', 'url'],
        'page.metadata': ['title'],
      },
      capabilities: ['tabs.open', 'clipboard.write'],
    }
    const candidate: RemoteFrameModuleManifest = {
      ...installedManifest,
      version: '0.2.0',
      contexts: ['github.repository'],
      context_fields: { 'github.repository': ['repo'] },
      capabilities: ['tabs.open'],
    }
    const harness = createHarness(candidate, installedManifest)
    const installed = await installFixture(
      harness.registry,
      installedManifest,
      manifestUrl,
      {
        'github.repository': ['repo', 'url'],
        'page.metadata': ['title'],
      },
      ['tabs.open', 'clipboard.write'],
    )
    harness.setNow(checkedAt)
    await harness.installer.checkForUpdate(installed.manifest.id)
    harness.setNow(appliedAt)
    await expect(harness.installer.applyUpdate(installed.manifest.id)).resolves.toMatchObject({
      ok: true,
      record: {
        grantedContexts: ['github.repository'],
        grantedContextFields: { 'github.repository': ['repo'] },
        grantedCapabilities: ['tabs.open'],
      },
    })
  })

  it('preserves the complete installed record when application acquisition fails', async () => {
    const installedManifest = baseManifest()
    const candidate = { ...installedManifest, version: '0.2.0' }
    const harness = createHarness(candidate, installedManifest)
    const installed = await installFixture(harness.registry, installedManifest, manifestUrl)
    harness.setNow(checkedAt)
    await harness.installer.checkForUpdate(installed.manifest.id)
    const before = await harness.registry.get(installed.manifest.id)
    harness.fetch.mockRejectedValueOnce(new Error('offline'))

    await expect(harness.installer.applyUpdate(installed.manifest.id)).resolves.toEqual({
      ok: false,
      reason: 'fetch-failed',
    })
    expect(await harness.registry.get(installed.manifest.id)).toEqual(before)
  })

  it('prevents a concurrent check from overwriting an approval', async () => {
    const installedManifest = baseManifest()
    const firstCandidate: RemoteFrameModuleManifest = {
      ...installedManifest,
      capabilities: ['tabs.open', 'clipboard.write'],
    }
    const harness = createHarness(firstCandidate, installedManifest)
    const installed = await installFixture(harness.registry, installedManifest, manifestUrl)
    harness.setNow(checkedAt)
    const first = await harness.installer.checkForUpdate(installed.manifest.id)
    if (!first.ok || !first.record.update)
      throw new Error('Expected a pending candidate')

    const slowCheck = deferredResponse()
    harness.fetch.mockImplementationOnce(async () => slowCheck.promise)
    const checking = harness.installer.checkForUpdate(installed.manifest.id)
    await vi.waitFor(() => expect(harness.fetch).toHaveBeenCalledTimes(2))
    harness.setNow(approvedAt)
    await harness.registry.approveModuleUpdate(
      installed.manifest.id,
      first.record.update.normalizedManifestDigest,
      { approvedContextFields: {}, approvedCapabilities: ['clipboard.write'] },
    )

    slowCheck.resolve(manifestResponse({ ...firstCandidate, version: '0.2.0' }, manifestUrl))
    await expect(checking).resolves.toEqual({
      ok: false,
      reason: 'installed-record-changed',
    })
    expect((await harness.registry.get(installed.manifest.id))?.update?.approvalStatus).toBe('approved')
  })

  it('prevents a concurrent reapproval from letting a stale application land', async () => {
    const installedManifest = baseManifest()
    const candidate: RemoteFrameModuleManifest = {
      ...installedManifest,
      capabilities: ['tabs.open', 'clipboard.write'],
    }
    const harness = createHarness(candidate, installedManifest)
    const installed = await installFixture(harness.registry, installedManifest, manifestUrl)
    harness.setNow(checkedAt)
    const checked = await harness.installer.checkForUpdate(installed.manifest.id)
    if (!checked.ok || !checked.record.update)
      throw new Error('Expected a pending candidate')

    harness.setNow(approvedAt)
    await harness.registry.approveModuleUpdate(
      installed.manifest.id,
      checked.record.update.normalizedManifestDigest,
      { approvedContextFields: {}, approvedCapabilities: ['clipboard.write'] },
    )

    const slowApply = deferredResponse()
    harness.fetch.mockImplementationOnce(async () => slowApply.promise)
    const applying = harness.installer.applyUpdate(installed.manifest.id)
    await vi.waitFor(() => expect(harness.fetch).toHaveBeenCalledTimes(2))

    const reapprovedAt = '2026-08-27T10:30:00.000Z'
    harness.setNow(reapprovedAt)
    await harness.registry.approveModuleUpdate(
      installed.manifest.id,
      checked.record.update.normalizedManifestDigest,
      { approvedContextFields: {}, approvedCapabilities: [] },
    )
    slowApply.resolve(manifestResponse(candidate, manifestUrl))

    await expect(applying).resolves.toEqual({
      ok: false,
      reason: 'installed-record-changed',
    })
    expect(await harness.registry.get(installed.manifest.id)).toMatchObject({
      manifest: { version: installedManifest.version },
      update: {
        approvalSnapshot: {
          approvedCapabilities: [],
          approvedAt: reapprovedAt,
        },
      },
      installedAt,
      updatedAt: installedAt,
    })
  })

  it('prevents a pre-removal application from landing on a reinstalled module', async () => {
    const installedManifest = baseManifest()
    const candidate = { ...installedManifest, version: '0.2.0' }
    const harness = createHarness(candidate, installedManifest)
    const installed = await installFixture(harness.registry, installedManifest, manifestUrl)
    harness.setNow(checkedAt)
    await harness.installer.checkForUpdate(installed.manifest.id)

    const slowApply = deferredResponse()
    harness.fetch.mockImplementationOnce(async () => slowApply.promise)
    const applying = harness.installer.applyUpdate(installed.manifest.id)
    await vi.waitFor(() => expect(harness.fetch).toHaveBeenCalledTimes(2))

    await harness.registry.removeUserModule(installed.manifest.id)
    harness.setNow(appliedAt)
    await installFixture(harness.registry, installedManifest, manifestUrl)
    slowApply.resolve(manifestResponse(candidate, manifestUrl))

    await expect(applying).resolves.toEqual({
      ok: false,
      reason: 'installed-record-changed',
    })
    expect(await harness.registry.get(installed.manifest.id)).toMatchObject({
      manifest: { version: installedManifest.version },
      update: null,
      installedAt: appliedAt,
      updatedAt: appliedAt,
    })
  })

  it('prevents concurrent checks or removal from letting a stale application land', async () => {
    const installedManifest = baseManifest()
    const firstCandidate = { ...installedManifest, version: '0.2.0' }
    const harness = createHarness(firstCandidate, installedManifest)
    const installed = await installFixture(harness.registry, installedManifest, manifestUrl)
    harness.setNow(checkedAt)
    await harness.installer.checkForUpdate(installed.manifest.id)

    const slowApply = deferredResponse()
    harness.fetch.mockImplementationOnce(async () => slowApply.promise)
    const applying = harness.installer.applyUpdate(installed.manifest.id)
    await vi.waitFor(() => expect(harness.fetch).toHaveBeenCalledTimes(2))
    const newerCandidate = { ...firstCandidate, version: '0.3.0' }
    harness.setCandidate(newerCandidate)
    await harness.installer.checkForUpdate(installed.manifest.id)
    slowApply.resolve(manifestResponse(firstCandidate, manifestUrl))
    await expect(applying).resolves.toEqual({
      ok: false,
      reason: 'installed-record-changed',
    })
    expect((await harness.registry.get(installed.manifest.id))?.update?.candidateManifest.version).toBe('0.3.0')

    const removedDuringApply = deferredResponse()
    harness.fetch.mockImplementationOnce(async () => removedDuringApply.promise)
    const secondApply = harness.installer.applyUpdate(installed.manifest.id)
    await vi.waitFor(() => expect(harness.fetch).toHaveBeenCalledTimes(4))
    await harness.registry.removeUserModule(installed.manifest.id)
    removedDuringApply.resolve(manifestResponse(newerCandidate, manifestUrl))
    await expect(secondApply).resolves.toEqual({
      ok: false,
      reason: 'not-found',
    })
    expect(await harness.registry.get(installed.manifest.id)).toBeNull()
  })
})
