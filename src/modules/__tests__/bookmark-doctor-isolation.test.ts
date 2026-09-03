import { createBookmarkDoctorSeed } from '../builtin/bookmark-doctor'
import {
  BOOKMARK_DOCTOR_MODULE_ID,
  BOOKMARK_DOCTOR_STATE_SCHEMA_VERSION,
} from '../builtin/bookmark-doctor/contracts'
import { BookmarkDoctorController } from '../builtin/bookmark-doctor/controller'
import { BookmarkDoctorReader } from '../builtin/bookmark-doctor/reader'
import { BookmarkScanCoordinator } from '../builtin/bookmark-doctor/scanner'
import { createBookmarkDoctorStateStore } from '../builtin/bookmark-doctor/state'
import { getModuleLocalStateStorageKey } from '../module-state'
import { createRepoLensSeed } from '../seeds/repolens'
import {
  createConformanceModulePair,
  snapshotModule,
} from './fixtures/conformance-module-pair'

describe('bookmark doctor builtin isolation', () => {
  it('serializes builtin capability grants without changing either remote module', async () => {
    const bookmarkSeed = createBookmarkDoctorSeed()
    bookmarkSeed.enabled = true
    const harness = createConformanceModulePair([bookmarkSeed])
    const alpha = await harness.install(harness.primary)
    const beta = await harness.install(harness.secondary)
    const alphaBefore = snapshotModule(alpha)
    const betaBefore = snapshotModule(beta)

    await expect(harness.registry.setCapabilityGrant(
      BOOKMARK_DOCTOR_MODULE_ID,
      'bookmarks.read',
      true,
    )).resolves.toMatchObject({
      ok: true,
      changed: true,
      record: { grantedCapabilities: ['bookmarks.read'] },
    })
    await expect(harness.registry.setCapabilityGrant(
      BOOKMARK_DOCTOR_MODULE_ID,
      'tabs.open',
      true,
    )).resolves.toEqual({
      ok: false,
      changed: false,
      reason: 'capability-not-declared',
    })
    expect(await harness.registry.get(alpha.manifest.id)).toEqual(alphaBefore)
    expect(await harness.registry.get(beta.manifest.id)).toEqual(betaBefore)
  })

  it('keeps local state and read failures isolated from two remote modules', async () => {
    const bookmarkSeed = createBookmarkDoctorSeed()
    bookmarkSeed.enabled = true
    bookmarkSeed.grantedCapabilities = ['bookmarks.read']
    const repoLensSeed = createRepoLensSeed('https://repolens.example')
    const harness = createConformanceModulePair([repoLensSeed, bookmarkSeed])
    const alpha = await harness.install(harness.primary)
    const beta = await harness.install(harness.secondary)
    const alphaBefore = snapshotModule(alpha)
    const betaBefore = snapshotModule(beta)
    const bookmarkBefore = snapshotModule(await harness.registry.get(BOOKMARK_DOCTOR_MODULE_ID))
    const repoLensBefore = snapshotModule(await harness.registry.get(repoLensSeed.manifest.id))

    const alphaStateKey = getModuleLocalStateStorageKey(alpha.manifest.id)
    const betaStateKey = getModuleLocalStateStorageKey(beta.manifest.id)
    await harness.storage.set({
      [alphaStateKey]: { owner: 'alpha' },
      [betaStateKey]: { owner: 'beta' },
    })
    const permissions = { contains: vi.fn(async () => false) }
    const bookmarks = { readTree: vi.fn(async () => [{ id: 'secret', url: 'https://private.example' }]) }
    const reader = new BookmarkDoctorReader({
      registry: harness.registry,
      permissions,
      bookmarks,
      now: () => '2026-08-28T12:00:00.000Z',
    })
    const failure = await reader.read()
    expect(failure).toMatchObject({ status: 'blocked', error: { code: 'permission-missing' } })
    expect(bookmarks.readTree).not.toHaveBeenCalled()

    const bookmarkState = createBookmarkDoctorStateStore(harness.storage)
    expect(bookmarkState.storageKey).toBe('oneweb.module-state.v1:dev.oneweb.bookmark-doctor')
    await bookmarkState.write({
      schemaVersion: BOOKMARK_DOCTOR_STATE_SCHEMA_VERSION,
      lastResult: failure,
      ignoredBookmarks: [],
      deletionBackups: [],
    })
    const stored = await harness.storage.get(bookmarkState.storageKey)
    expect(stored[alphaStateKey]).toEqual({ owner: 'alpha' })
    expect(stored[betaStateKey]).toEqual({ owner: 'beta' })
    expect(stored[bookmarkState.storageKey]).toMatchObject({
      schemaVersion: BOOKMARK_DOCTOR_STATE_SCHEMA_VERSION,
      lastResult: { error: { code: 'permission-missing' } },
    })
    expect(await bookmarkState.read()).toEqual(stored[bookmarkState.storageKey])
    expect(await harness.registry.get(alpha.manifest.id)).toEqual(alphaBefore)
    expect(await harness.registry.get(beta.manifest.id)).toEqual(betaBefore)
    expect(await harness.registry.get(BOOKMARK_DOCTOR_MODULE_ID)).toEqual(bookmarkBefore)
    expect(await harness.registry.get(repoLensSeed.manifest.id)).toEqual(repoLensBefore)
  })

  it('disables only the builtin and prevents subsequent bookmark reads', async () => {
    const bookmarkSeed = createBookmarkDoctorSeed()
    bookmarkSeed.enabled = true
    bookmarkSeed.grantedCapabilities = ['bookmarks.read']
    const harness = createConformanceModulePair([bookmarkSeed])
    const alpha = await harness.install(harness.primary)
    const beta = await harness.install(harness.secondary)
    const alphaBefore = snapshotModule(alpha)
    const betaBefore = snapshotModule(beta)
    const bookmarks = { readTree: vi.fn(async () => []) }
    const reader = new BookmarkDoctorReader({
      registry: harness.registry,
      permissions: { contains: vi.fn(async () => true) },
      bookmarks,
    })

    await expect(reader.read()).resolves.toMatchObject({ status: 'ready' })
    expect(bookmarks.readTree).toHaveBeenCalledOnce()
    await harness.manager.setEnabled(BOOKMARK_DOCTOR_MODULE_ID, false)
    bookmarks.readTree.mockClear()
    await expect(reader.read()).resolves.toMatchObject({
      status: 'blocked',
      error: { code: 'module-disabled' },
    })
    expect(bookmarks.readTree).not.toHaveBeenCalled()
    expect(await harness.registry.get(alpha.manifest.id)).toEqual(alphaBefore)
    expect(await harness.registry.get(beta.manifest.id)).toEqual(betaBefore)
  })

  it('keeps confirmed repair state and a failed delete isolated from both remote modules', async () => {
    const bookmarkSeed = createBookmarkDoctorSeed()
    bookmarkSeed.enabled = true
    bookmarkSeed.grantedCapabilities = ['bookmarks.read', 'bookmarks.write']
    const harness = createConformanceModulePair([bookmarkSeed])
    const alpha = await harness.install(harness.primary)
    const beta = await harness.install(harness.secondary)
    const alphaBefore = snapshotModule(alpha)
    const betaBefore = snapshotModule(beta)
    const alphaStateKey = getModuleLocalStateStorageKey(alpha.manifest.id)
    const betaStateKey = getModuleLocalStateStorageKey(beta.manifest.id)
    await harness.storage.set({
      [alphaStateKey]: { owner: 'alpha' },
      [betaStateKey]: { owner: 'beta' },
    })
    const nodes = new Map([
      ['ignored', { id: 'ignored', parentId: 'folder', index: 0, title: 'Ignored', url: 'https://ignored.example/' }],
      ['deleted', { id: 'deleted', parentId: 'folder', index: 1, title: 'Deleted', url: 'https://deleted.example/' }],
    ])
    const bookmarks = {
      get: vi.fn(async (id: string) => nodes.has(id) ? [structuredClone(nodes.get(id)!)] : []),
      getChildren: vi.fn(async () => []),
      create: vi.fn(),
      update: vi.fn(),
      move: vi.fn(),
      remove: vi.fn(async () => Promise.reject(new Error('delete failed'))),
    }
    let token = 0
    const controller = new BookmarkDoctorController({
      registry: harness.registry,
      permissions: { contains: vi.fn(async () => true) },
      reader: { read: vi.fn() },
      scanner: new BookmarkScanCoordinator({ probe: { probe: vi.fn() } }),
      repair: {
        bookmarks,
        state: createBookmarkDoctorStateStore(harness.storage),
      },
      createRepairToken: () => `repair-${++token}`,
      now: () => '2026-08-28T12:00:00.000Z',
    })
    const ignored = await controller.prepareRepair({ operation: 'ignore', bookmarkId: 'ignored' })
    const deleted = await controller.prepareRepair({ operation: 'delete', bookmarkId: 'deleted' })
    if (!ignored.ok || !deleted.ok)
      throw new Error('Expected repair plans')
    await expect(controller.confirmRepairs([
      { token: ignored.plan.token, confirmation: 'reviewed' },
      { token: deleted.plan.token, confirmation: 'delete-confirmed' },
    ])).resolves.toMatchObject({
      results: [
        { ok: true, operation: 'ignore' },
        { ok: false, operation: 'delete', reason: 'bookmark-delete-failed' },
      ],
    })

    expect(await harness.registry.get(alpha.manifest.id)).toEqual(alphaBefore)
    expect(await harness.registry.get(beta.manifest.id)).toEqual(betaBefore)
    const stored = await harness.storage.get(alphaStateKey)
    expect(stored[alphaStateKey]).toEqual({ owner: 'alpha' })
    expect(stored[betaStateKey]).toEqual({ owner: 'beta' })
    expect(stored[getModuleLocalStateStorageKey(BOOKMARK_DOCTOR_MODULE_ID)]).toMatchObject({
      ignoredBookmarks: [{ bookmarkId: 'ignored' }],
      deletionBackups: [{ bookmarkId: 'deleted' }],
    })
  })
})
