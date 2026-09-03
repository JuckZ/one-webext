import type { RemoteFrameModuleManifest } from '../types'
import { ModuleRegistry, MODULES_STORAGE_KEY, type ModuleStorageArea } from '../registry'
import { createRepoLensSeed } from '../seeds/repolens'

class MemoryStorage implements ModuleStorageArea {
  state: Record<string, unknown>
  writes = 0

  constructor(initial: Record<string, unknown> = {}) {
    this.state = structuredClone(initial)
  }

  async get(_key: string) {
    return structuredClone(this.state)
  }

  async set(items: Record<string, unknown>) {
    this.state = { ...this.state, ...structuredClone(items) }
    this.writes++
  }
}

describe('module registry', () => {
  const timestamp = '2026-08-26T10:00:00.000Z'
  const seed = createRepoLensSeed('http://127.0.0.1:4747')

  function createUserRecord(moduleId = 'dev.juck.example') {
    if (seed.manifest.runtime !== 'remote-frame')
      throw new Error('Expected a remote-frame fixture')
    return {
      manifest: {
        ...seed.manifest,
        id: moduleId,
        name: 'Example',
      },
      enabled: true,
      source: 'user',
      sourceUrl: 'http://127.0.0.1:4747/.well-known/oneweb-module.json',
      grantedContexts: ['github.repository'],
      grantedContextFields: { 'github.repository': ['repo'] },
      grantedCapabilities: [],
      installedAt: timestamp,
      updatedAt: timestamp,
    }
  }

  function createUpdate(
    record: ReturnType<typeof createUserRecord>,
    candidateManifest: RemoteFrameModuleManifest,
    overrides: Record<string, unknown> = {},
  ) {
    return {
      candidateManifest,
      candidateSourceUrl: record.sourceUrl,
      normalizedManifestDigest: 'a'.repeat(64),
      checkedAt: '2026-08-27T10:00:00.000Z',
      approvalStatus: 'pending',
      approvedManifestDigest: null,
      approvalSnapshot: null,
      ...overrides,
    }
  }

  it('seeds RepoLens once and returns defensive copies', async () => {
    const storage = new MemoryStorage()
    const registry = new ModuleRegistry({ storage, seeds: [seed], now: () => timestamp })

    const first = await registry.list()
    expect(first).toHaveLength(1)
    expect(first[0]).toMatchObject({
      source: 'seeded',
      enabled: true,
      manifest: { id: 'dev.juck.repolens', runtime: 'remote-frame' },
      grantedContexts: ['github.repository'],
      grantedContextFields: { 'github.repository': ['repo', 'url', 'pageType'] },
      grantedCapabilities: [],
    })
    expect(storage.writes).toBe(1)

    first[0].enabled = false
    const second = await registry.list()
    expect(second[0].enabled).toBe(true)
    expect(storage.writes).toBe(1)
  })

  it('drops invalid records and restores the protected seed deterministically', async () => {
    const storage = new MemoryStorage({
      [MODULES_STORAGE_KEY]: [
        { manifest: { id: 'malformed' } },
        {
          manifest: seed.manifest,
          enabled: true,
          source: 'user',
          grantedContexts: ['github.repository'],
          grantedContextFields: { 'github.repository': ['repo'] },
          grantedCapabilities: [],
          installedAt: timestamp,
          updatedAt: timestamp,
        },
      ],
    })
    const registry = new ModuleRegistry({ storage, seeds: [seed], now: () => timestamp })
    const records = await registry.list()

    expect(records).toHaveLength(1)
    expect(records[0].source).toBe('seeded')
    expect(records[0].manifest.id).toBe('dev.juck.repolens')
    expect(storage.writes).toBe(1)
  })

  it('removes stored grants that are outside the installed manifest', async () => {
    const record = {
      manifest: seed.manifest,
      enabled: true,
      source: 'seeded',
      grantedContexts: ['github.repository', 'page.selection'],
      grantedContextFields: {
        'github.repository': ['repo', 'cookies'],
        'page.selection': ['text'],
      },
      grantedCapabilities: ['tabs.open', 'clipboard.write'],
      installedAt: timestamp,
      updatedAt: timestamp,
    }
    const storage = new MemoryStorage({ [MODULES_STORAGE_KEY]: [record] })
    const registry = new ModuleRegistry({ storage, seeds: [seed], now: () => timestamp })
    const records = await registry.list()

    expect(records[0].grantedContexts).toEqual(['github.repository'])
    expect(records[0].grantedContextFields).toEqual({ 'github.repository': ['repo'] })
    expect(records[0].grantedCapabilities).toEqual([])
    expect(storage.writes).toBe(1)
  })

  it('migrates Phase 0–2C records to update null once without changing installed state', async () => {
    const legacy = createUserRecord()
    const installedState = {
      manifest: structuredClone(legacy.manifest),
      grantedContexts: structuredClone(legacy.grantedContexts),
      grantedContextFields: structuredClone(legacy.grantedContextFields),
      grantedCapabilities: structuredClone(legacy.grantedCapabilities),
      installedAt: legacy.installedAt,
      updatedAt: legacy.updatedAt,
    }
    const storage = new MemoryStorage({ [MODULES_STORAGE_KEY]: [legacy] })
    const registry = new ModuleRegistry({ storage, now: () => '2026-08-28T10:00:00.000Z' })

    const [record] = await registry.list()
    expect(record.update).toBeNull()
    expect(record).toMatchObject(installedState)
    expect(storage.writes).toBe(1)

    await registry.list()
    expect(storage.writes).toBe(1)
  })

  it('normalizes safe, pending, approved and rejected candidate approval states', async () => {
    const safeRecord = createUserRecord('dev.juck.safe')
    const pendingRecord = createUserRecord('dev.juck.pending')
    const approvedRecord = createUserRecord('dev.juck.approved')
    const legacyApprovedRecord = createUserRecord('dev.juck.legacy-approved')
    const rejectedRecord = createUserRecord('dev.juck.rejected')
    const expandedManifest = (record: ReturnType<typeof createUserRecord>) => ({
      ...record.manifest,
      capabilities: ['tabs.open'] as RemoteFrameModuleManifest['capabilities'],
    })
    const rejectedManifest = {
      ...rejectedRecord.manifest,
      entry_url: 'https://evil.example/embed',
      icon_url: 'https://evil.example/icon.png',
    }
    const {
      approvedManifestDigest: _legacyBinding,
      ...legacyApprovedUpdate
    } = createUpdate(legacyApprovedRecord, expandedManifest(legacyApprovedRecord), {
      approvalStatus: 'approved',
    })
    const storage = new MemoryStorage({
      [MODULES_STORAGE_KEY]: [
        {
          ...safeRecord,
          update: createUpdate(safeRecord, { ...safeRecord.manifest, version: '0.2.0' }, {
            approvalStatus: 'pending',
          }),
        },
        {
          ...pendingRecord,
          update: createUpdate(pendingRecord, expandedManifest(pendingRecord), {
            approvalStatus: 'rejected',
          }),
        },
        {
          ...approvedRecord,
          update: createUpdate(approvedRecord, expandedManifest(approvedRecord), {
            approvalStatus: 'approved',
            approvedManifestDigest: 'a'.repeat(64),
            approvalSnapshot: {
              approvedManifestDigest: 'a'.repeat(64),
              approvedMatches: approvedRecord.manifest.matches,
              approvedActivation: approvedRecord.manifest.activation,
              approvedContextFields: {},
              approvedCapabilities: [],
              approvedAt: '2026-08-27T11:00:00.000Z',
            },
          }),
        },
        {
          ...legacyApprovedRecord,
          update: legacyApprovedUpdate,
        },
        {
          ...rejectedRecord,
          update: createUpdate(rejectedRecord, rejectedManifest, {
            candidateSourceUrl: 'https://evil.example/manifest.json',
            approvalStatus: 'not-required',
          }),
        },
      ],
    })
    const records = await new ModuleRegistry({ storage }).list()

    expect(Object.fromEntries(records.map(record => [record.manifest.id, record.update?.approvalStatus]))).toEqual({
      'dev.juck.safe': 'not-required',
      'dev.juck.pending': 'pending',
      'dev.juck.approved': 'approved',
      'dev.juck.legacy-approved': 'pending',
      'dev.juck.rejected': 'rejected',
    })
    expect(storage.writes).toBe(1)

    const approved = records.find(record => record.manifest.id === approvedRecord.manifest.id)!
    const changedContent = await new ModuleRegistry({ storage }).setModuleUpdateCandidate(approved, {
      candidateManifest: {
        ...approved.update!.candidateManifest,
        version: '0.3.0',
      },
      candidateSourceUrl: approved.update!.candidateSourceUrl,
      normalizedManifestDigest: approved.update!.normalizedManifestDigest,
      checkedAt: '2026-08-28T10:00:00.000Z',
    })
    expect(changedContent).toMatchObject({
      ok: true,
      record: {
        update: {
          approvalStatus: 'pending',
          approvedManifestDigest: null,
          approvalSnapshot: null,
        },
      },
    })
  })

  it('discards invalid candidate metadata without deleting valid installed records', async () => {
    const invalidDigest = createUserRecord('dev.juck.invalid-digest')
    const invalidTime = createUserRecord('dev.juck.invalid-time')
    const invalidManifest = createUserRecord('dev.juck.invalid-manifest')
    const invalidSource = createUserRecord('dev.juck.invalid-source')
    const storage = new MemoryStorage({
      [MODULES_STORAGE_KEY]: [
        {
          ...invalidDigest,
          update: createUpdate(invalidDigest, invalidDigest.manifest, {
            normalizedManifestDigest: 'not-a-digest',
          }),
        },
        {
          ...invalidTime,
          update: createUpdate(invalidTime, invalidTime.manifest, { checkedAt: 'not-a-time' }),
        },
        {
          ...invalidManifest,
          update: createUpdate(invalidManifest, { id: invalidManifest.manifest.id } as RemoteFrameModuleManifest),
        },
        {
          ...invalidSource,
          update: createUpdate(invalidSource, invalidSource.manifest, {
            candidateSourceUrl: 'https://evil.example/manifest.json',
          }),
        },
      ],
    })
    const records = await new ModuleRegistry({ storage }).list()

    expect(records.map(record => record.manifest.id)).toEqual([
      'dev.juck.invalid-digest',
      'dev.juck.invalid-time',
      'dev.juck.invalid-manifest',
      'dev.juck.invalid-source',
    ])
    expect(records.every(record => record.update === null)).toBe(true)
    expect(storage.writes).toBe(1)
  })

  it('updates seeded metadata without automatically granting new access', async () => {
    const olderSeed = createRepoLensSeed('http://127.0.0.1:4747')
    if (olderSeed.manifest.runtime !== 'remote-frame')
      throw new Error('Expected a remote-frame fixture')
    const olderManifest: RemoteFrameModuleManifest = { ...olderSeed.manifest, version: '0.0.9' }
    olderSeed.manifest = olderManifest
    const initialRegistry = new ModuleRegistry({
      storage: new MemoryStorage(),
      seeds: [olderSeed],
      now: () => '2026-08-25T10:00:00.000Z',
    })
    const initial = await initialRegistry.list()
    const storage = new MemoryStorage({
      [MODULES_STORAGE_KEY]: [{
        ...initial[0],
        update: createUpdate(createUserRecord(initial[0].manifest.id), {
          ...olderManifest,
          version: '0.0.10',
        }, {
          candidateSourceUrl: null,
        }),
        grantedContexts: ['github.repository'],
        grantedContextFields: { 'github.repository': ['repo'] },
        grantedCapabilities: [],
      }],
    })
    const registry = new ModuleRegistry({ storage, seeds: [seed], now: () => timestamp })
    const records = await registry.list()

    expect(records[0].manifest.version).toBe('0.1.0')
    expect(records[0].grantedContexts).toEqual(['github.repository'])
    expect(records[0].grantedContextFields).toEqual({ 'github.repository': ['repo'] })
    expect(records[0].grantedCapabilities).toEqual([])
    expect(records[0].update).toBeNull()
    expect(records[0].updatedAt).toBe(timestamp)
  })

  it('keeps user modules only when their source URL is safe and origin-bound', async () => {
    const userRecord = createUserRecord()
    const storage = new MemoryStorage({ [MODULES_STORAGE_KEY]: [
      userRecord,
      { ...userRecord, manifest: { ...userRecord.manifest, id: 'dev.juck.forged' }, sourceUrl: 'https://evil.example/module.json' },
    ] })
    const registry = new ModuleRegistry({ storage, now: () => timestamp })
    const records = await registry.list()

    expect(records).toHaveLength(1)
    expect(records[0].manifest.id).toBe('dev.juck.example')
    expect(records[0].sourceUrl).toBe(userRecord.sourceUrl)
    expect(storage.writes).toBe(1)
  })

  it('allows disabling a seed but protects it from removal and no-op timestamp changes', async () => {
    let currentTime = timestamp
    const storage = new MemoryStorage()
    const registry = new ModuleRegistry({ storage, seeds: [seed], now: () => currentTime })
    await registry.list()

    currentTime = '2026-08-27T10:00:00.000Z'
    const disabled = await registry.setEnabled(seed.manifest.id, false)
    expect(disabled).toMatchObject({ ok: true, changed: true, record: { enabled: false, updatedAt: currentTime } })

    currentTime = '2026-08-28T10:00:00.000Z'
    const unchanged = await registry.setEnabled(seed.manifest.id, false)
    expect(unchanged).toMatchObject({ ok: true, changed: false, record: { updatedAt: '2026-08-27T10:00:00.000Z' } })
    expect(await registry.removeUserModule(seed.manifest.id)).toEqual({
      ok: false,
      changed: false,
      reason: 'protected-seed',
    })
    expect(storage.writes).toBe(2)
  })

  it('supports the complete user-module enable, disable and remove lifecycle', async () => {
    const userRecord = createUserRecord()
    const storage = new MemoryStorage({ [MODULES_STORAGE_KEY]: [userRecord] })
    const registry = new ModuleRegistry({ storage, seeds: [seed], now: () => timestamp })
    await registry.list()

    expect(await registry.setEnabled(userRecord.manifest.id, false)).toMatchObject({
      ok: true,
      changed: true,
      record: { enabled: false },
    })
    expect(await registry.setEnabled(userRecord.manifest.id, true)).toMatchObject({
      ok: true,
      changed: true,
      record: { enabled: true },
    })
    expect(await registry.removeUserModule(userRecord.manifest.id)).toMatchObject({
      ok: true,
      changed: true,
      removed: { manifest: { id: userRecord.manifest.id } },
    })

    const records = await registry.list()
    expect(records.map(record => record.manifest.id)).toEqual([seed.manifest.id])
    expect(records[0].enabled).toBe(true)
    expect(await registry.setEnabled(userRecord.manifest.id, false)).toEqual({
      ok: false,
      changed: false,
      reason: 'not-found',
    })
  })

  it('serializes concurrent mutations so independent changes are not lost', async () => {
    const userRecord = createUserRecord()
    const storage = new MemoryStorage({ [MODULES_STORAGE_KEY]: [userRecord] })
    const registry = new ModuleRegistry({ storage, seeds: [seed], now: () => timestamp })
    await registry.list()

    await Promise.all([
      registry.setEnabled(seed.manifest.id, false),
      registry.setEnabled(userRecord.manifest.id, false),
    ])

    const records = await registry.list()
    expect(records).toHaveLength(2)
    expect(records.every(record => !record.enabled)).toBe(true)
  })

  it('installs normalized remote user records without replacing an existing module ID', async () => {
    const storage = new MemoryStorage()
    const registry = new ModuleRegistry({ storage, seeds: [seed], now: () => timestamp })
    if (seed.manifest.runtime !== 'remote-frame')
      throw new Error('Expected a remote-frame seed')
    const manifest: RemoteFrameModuleManifest = {
      ...seed.manifest,
      id: 'dev.juck.installable',
      name: 'Installable',
      capabilities: ['tabs.open'],
    }
    const installed = await registry.installUserModule({
      manifest,
      sourceUrl: 'http://127.0.0.1:4747/.well-known/oneweb-module.json',
      grantedContextFields: {
        'github.repository': ['repo', 'not-allowed', 'repo'],
        'page.metadata': ['title'],
      },
      grantedCapabilities: ['tabs.open', 'clipboard.write'],
    })

    expect(installed).toMatchObject({
      ok: true,
      record: {
        source: 'user',
        enabled: true,
        grantedContexts: ['github.repository'],
        grantedContextFields: { 'github.repository': ['repo'] },
        grantedCapabilities: ['tabs.open'],
      },
    })
    expect(await registry.installUserModule({
      manifest,
      sourceUrl: 'http://127.0.0.1:4747/.well-known/oneweb-module.json',
      grantedContextFields: {},
      grantedCapabilities: [],
    })).toEqual({ ok: false, changed: false, reason: 'already-installed' })
    expect((await registry.list()).map(record => record.manifest.id)).toEqual([
      seed.manifest.id,
      manifest.id,
    ])
  })
})
