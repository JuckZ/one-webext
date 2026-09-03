import type { InstalledModuleRecord, ModuleCapabilityId } from '../../../types'
import type { BookmarkDoctorLocalState, BookmarkDoctorReadResult, NormalizedBookmarkEntry } from '../contracts'
import { createRepoLensSeed } from '../../../seeds/repolens'
import { BookmarkDoctorController } from '../controller'
import { createBookmarkDoctorSeed } from '../manifest'
import { classifyBookmarkUrl } from '../normalize'
import { BookmarkScanCoordinator } from '../scanner'

function bookmarkRecord(enabled = true, granted = true): InstalledModuleRecord {
  const seed = createBookmarkDoctorSeed()
  return {
    manifest: seed.manifest,
    enabled,
    source: 'seeded',
    grantedContexts: [],
    grantedContextFields: {},
    grantedCapabilities: granted ? ['bookmarks.read'] : [],
    update: null,
    installedAt: '2026-08-28T00:00:00.000Z',
    updatedAt: '2026-08-28T00:00:00.000Z',
  }
}

function entry(index: number, url: string): NormalizedBookmarkEntry {
  return {
    entryId: `entry-${index}`,
    bookmarkId: String(index),
    parentId: null,
    title: `Bookmark ${index}`,
    url,
    folderPath: [],
    treePath: [index],
    dateAdded: null,
    urlClassification: classifyBookmarkUrl(url),
  }
}

function ready(entries: NormalizedBookmarkEntry[]): BookmarkDoctorReadResult {
  return {
    status: 'ready',
    completedAt: '2026-08-28T00:00:00.000Z',
    entries,
    diagnostics: [],
    error: null,
  }
}

describe('bookmark doctor controller', () => {
  it('synchronizes the optional permission into only the declared builtin grant', async () => {
    const record = bookmarkRecord(true, false)
    const granted: InstalledModuleRecord = { ...record, grantedCapabilities: ['bookmarks.read'] }
    const registry = {
      get: vi.fn(async () => record),
      setCapabilityGrant: vi.fn(async () => ({ ok: true as const, changed: true, record: granted })),
    }
    const controller = new BookmarkDoctorController({
      registry,
      permissions: { contains: vi.fn(async () => true) },
      reader: { read: vi.fn(async () => ready([])) },
      scanner: new BookmarkScanCoordinator({
        probe: { probe: vi.fn() },
        createRunId: () => 'run',
      }),
    })

    await expect(controller.authorize()).resolves.toEqual({ ok: true, record: granted })
    expect(registry.setCapabilityGrant).toHaveBeenCalledWith(
      'dev.oneweb.bookmark-doctor',
      'bookmarks.read',
      true,
    )
  })

  it('prepares exact origins, skips non-HTTP(S), and requires the matching token and grants', async () => {
    const entries = [
      entry(1, 'https://example.com/a'),
      entry(2, 'https://example.com/b'),
      entry(3, 'http://localhost:8080/ok'),
      entry(4, 'file:///tmp/private'),
    ]
    const contains = vi.fn(async () => true)
    const probe = vi.fn(async () => ({ outcome: 'reachable' as const, httpStatus: 200 }))
    const controller = new BookmarkDoctorController({
      registry: {
        get: vi.fn(async () => bookmarkRecord()),
        setCapabilityGrant: vi.fn(),
      },
      permissions: { contains },
      reader: { read: vi.fn(async () => ready(entries)) },
      scanner: new BookmarkScanCoordinator({ probe: { probe }, createRunId: () => 'scan-1' }),
      createPreparationToken: () => 'preparation-1',
    })

    const prepared = await controller.prepare()
    expect(controller.usesOriginPattern('https://example.com/*')).toBe(true)
    expect(prepared).toEqual({
      ok: true,
      preparation: {
        token: 'preparation-1',
        total: 3,
        skipped: 1,
        originPatterns: ['http://localhost:8080/*', 'https://example.com/*'],
      },
    })
    await expect(controller.start('wrong-token')).resolves.toEqual({ ok: false, reason: 'invalid-preparation' })
    await expect(controller.start('preparation-1')).resolves.toMatchObject({
      ok: true,
      snapshot: { status: 'completed', total: 3, completed: 3 },
    })
    expect(contains).toHaveBeenCalledWith({ origins: ['http://localhost:8080/*', 'https://example.com/*'] })
    expect(probe).toHaveBeenCalledTimes(3)
    expect(controller.usesOriginPattern('https://example.com/*')).toBe(false)
  })

  it('immediately stops and revokes only its own capability when bookmarks permission is removed', async () => {
    const record = bookmarkRecord()
    const registry = {
      get: vi.fn(async () => record),
      setCapabilityGrant: vi.fn(async () => ({ ok: true as const, changed: true, record: bookmarkRecord(true, false) })),
    }
    const probe = vi.fn((_url: string, signal: AbortSignal) => new Promise<{ outcome: 'network-failure', httpStatus: null }>((resolve) => {
      signal.addEventListener('abort', () => resolve({ outcome: 'network-failure', httpStatus: null }), { once: true })
    }))
    const scanner = new BookmarkScanCoordinator({ probe: { probe }, createRunId: () => 'scan-active' })
    const controller = new BookmarkDoctorController({
      registry,
      permissions: { contains: vi.fn(async () => true) },
      reader: { read: vi.fn(async () => ready([entry(1, 'https://slow.example')])) },
      scanner,
      createPreparationToken: () => 'preparation-active',
    })

    await controller.prepare()
    const running = controller.start('preparation-active')
    await vi.waitFor(() => expect(scanner.isScanning()).toBe(true))
    await controller.handlePermissionsRemoved({ permissions: ['bookmarks'] })
    await expect(running).resolves.toMatchObject({ ok: true, snapshot: { status: 'stopped', completed: 0 } })
    expect(registry.setCapabilityGrant).toHaveBeenCalledWith(
      'dev.oneweb.bookmark-doctor',
      'bookmarks.read',
      false,
    )
    expect(registry.setCapabilityGrant).toHaveBeenCalledWith(
      'dev.oneweb.bookmark-doctor',
      'bookmarks.write',
      false,
    )
  })

  it('stops an active run when the packaged builtin entry is disabled', async () => {
    const probe = vi.fn((_url: string, signal: AbortSignal) => new Promise<{ outcome: 'network-failure', httpStatus: null }>((resolve) => {
      signal.addEventListener('abort', () => resolve({ outcome: 'network-failure', httpStatus: null }), { once: true })
    }))
    const scanner = new BookmarkScanCoordinator({ probe: { probe }, createRunId: () => 'scan-disabled' })
    const controller = new BookmarkDoctorController({
      registry: { get: vi.fn(), setCapabilityGrant: vi.fn() },
      permissions: { contains: vi.fn() },
      reader: { read: vi.fn() },
      scanner,
    })
    const running = scanner.start([entry(1, 'https://slow.example')])
    await vi.waitFor(() => expect(scanner.isScanning()).toBe(true))
    controller.handleInstalledRecordChanged(bookmarkRecord(false))

    await expect(running).resolves.toMatchObject({ status: 'stopped', completed: 0 })
    expect(scanner.isScanning()).toBe(false)
  })
})

interface RepairNode {
  id: string
  parentId?: string
  index?: number
  title: string
  url?: string
}

function createRepairHarness(initialNodes: RepairNode[]) {
  let record = bookmarkRecord()
  record = { ...record, grantedCapabilities: ['bookmarks.read', 'bookmarks.write'] }
  let extraRecords: InstalledModuleRecord[] = []
  const nodes = new Map(initialNodes.map(node => [node.id, structuredClone(node)]))
  let localState: BookmarkDoctorLocalState | null = null
  const events: string[] = []
  const bookmarks = {
    get: vi.fn(async (id: string) => nodes.has(id) ? [structuredClone(nodes.get(id)!)] : []),
    getChildren: vi.fn(async (id: string) => [...nodes.values()]
      .filter(node => node.parentId === id)
      .map(node => structuredClone(node))),
    create: vi.fn(async (value: { parentId: string, index?: number, title: string, url: string }) => {
      const id = `restored-${nodes.size}`
      const node = { id, ...structuredClone(value) }
      nodes.set(id, node)
      return structuredClone(node)
    }),
    update: vi.fn(async (id: string, changes: { title?: string, url?: string }) => {
      events.push(`update:${id}`)
      const node = nodes.get(id)
      if (!node)
        throw new Error('not found')
      Object.assign(node, changes)
      return structuredClone(node)
    }),
    move: vi.fn(async (id: string, destination: { parentId: string, index?: number }) => {
      events.push(`move:${id}`)
      const node = nodes.get(id)
      if (!node)
        throw new Error('not found')
      node.parentId = destination.parentId
      if (destination.index !== undefined)
        node.index = destination.index
      return structuredClone(node)
    }),
    remove: vi.fn(async (id: string) => {
      events.push(`remove:${id}`)
      if (!nodes.delete(id))
        throw new Error('not found')
    }),
  }
  let token = 0
  let currentTime = '2026-08-28T00:00:00.000Z'
  const state = {
    read: vi.fn(async () => structuredClone(localState)),
    write: vi.fn(async (value: BookmarkDoctorLocalState) => {
      events.push('state:write')
      localState = structuredClone(value)
    }),
  }
  const registry = {
    get: vi.fn(async () => structuredClone(record)),
    list: vi.fn(async () => structuredClone([record, ...extraRecords])),
    setCapabilityGrant: vi.fn(async (_id: string, capability: ModuleCapabilityId, granted: boolean) => {
      record = {
        ...record,
        grantedCapabilities: granted
          ? [...new Set([...record.grantedCapabilities, capability])]
          : record.grantedCapabilities.filter(value => value !== capability),
      }
      return { ok: true as const, changed: true, record: structuredClone(record) }
    }),
  }
  const reader = { read: vi.fn(async () => ready([])) }
  let hasBookmarksPermission = true
  const permissions = {
    contains: vi.fn(async (request: { permissions?: Array<'bookmarks'>, origins?: string[] }) => (
      request.permissions ? hasBookmarksPermission : true
    )),
    remove: vi.fn(async (request: { permissions?: Array<'bookmarks'>, origins?: string[] }) => {
      if (request.permissions?.includes('bookmarks'))
        hasBookmarksPermission = false
      return true
    }),
  }
  const probe = vi.fn(async () => ({ outcome: 'reachable' as const, httpStatus: 200 }))
  const scanner = new BookmarkScanCoordinator({ probe: { probe } })
  const controller = new BookmarkDoctorController({
    registry,
    permissions,
    reader,
    scanner,
    repair: { bookmarks, state },
    createRepairToken: () => `repair-${++token}`,
    now: () => currentTime,
  })
  return {
    bookmarks,
    controller,
    events,
    nodes,
    permissions,
    reader,
    scanner,
    registry,
    state,
    getLocalState: () => structuredClone(localState),
    setCurrentTime: (value: string) => currentTime = value,
    setExtraRecords: (value: InstalledModuleRecord[]) => extraRecords = structuredClone(value),
    setLocalState: (value: BookmarkDoctorLocalState | null) => localState = structuredClone(value),
    setRecord: (value: InstalledModuleRecord) => record = structuredClone(value),
  }
}

describe('bookmark doctor safe repairs', () => {
  const folder = (id: string): RepairNode => ({ id, title: `Folder ${id}` })
  const bookmark = (id: string, parentId = 'folder-a', index = 0): RepairNode => ({
    id,
    parentId,
    index,
    title: `Title ${id}`,
    url: `https://${id}.example/`,
  })

  it('grants bookmark write separately after read authorization', async () => {
    const harness = createRepairHarness([bookmark('target')])
    const readOnly = bookmarkRecord()
    harness.setRecord(readOnly)

    await expect(harness.controller.authorizeRepairs()).resolves.toMatchObject({
      ok: true,
      record: { grantedCapabilities: ['bookmarks.read', 'bookmarks.write'] },
    })
    expect(harness.registry.setCapabilityGrant).toHaveBeenCalledWith(
      'dev.oneweb.bookmark-doctor',
      'bookmarks.write',
      true,
    )
  })

  it('reviews and executes update, move, ignore and delete with backup-before-remove', async () => {
    const harness = createRepairHarness([
      folder('folder-a'),
      folder('folder-b'),
      bookmark('update'),
      bookmark('move'),
      bookmark('ignore'),
      bookmark('delete'),
    ])
    const update = await harness.controller.prepareRepair({
      operation: 'update',
      bookmarkId: 'update',
      changes: { title: 'Updated', url: 'https://updated.example/path' },
    })
    const move = await harness.controller.prepareRepair({
      operation: 'move',
      bookmarkId: 'move',
      destination: { parentId: 'folder-b', index: 3 },
    })
    const ignore = await harness.controller.prepareRepair({ operation: 'ignore', bookmarkId: 'ignore' })
    const deletion = await harness.controller.prepareRepair({ operation: 'delete', bookmarkId: 'delete' })
    if (!update.ok || !move.ok || !ignore.ok || !deletion.ok)
      throw new Error('Expected repair plans')

    const result = await harness.controller.confirmRepairs([
      { token: update.plan.token, confirmation: 'reviewed' },
      { token: move.plan.token, confirmation: 'reviewed' },
      { token: ignore.plan.token, confirmation: 'reviewed' },
      { token: deletion.plan.token, confirmation: 'delete-confirmed' },
    ])
    expect(result.results).toEqual([
      { ok: true, token: 'repair-1', operation: 'update' },
      { ok: true, token: 'repair-2', operation: 'move' },
      { ok: true, token: 'repair-3', operation: 'ignore' },
      { ok: true, token: 'repair-4', operation: 'delete' },
    ])
    expect(harness.nodes.get('update')).toMatchObject({ title: 'Updated', url: 'https://updated.example/path' })
    expect(harness.nodes.get('move')).toMatchObject({ parentId: 'folder-b', index: 3 })
    expect(harness.nodes.has('delete')).toBe(false)
    expect(harness.getLocalState()).toMatchObject({
      ignoredBookmarks: [{ bookmarkId: 'ignore' }],
      deletionBackups: [{ bookmarkId: 'delete', repairToken: 'repair-4' }],
    })
    expect(harness.events.indexOf('state:write')).toBeLessThan(harness.events.indexOf('remove:delete'))

    harness.reader.read.mockResolvedValueOnce(ready([
      { ...entry(1, 'https://ignored.example/'), bookmarkId: 'ignore' },
      { ...entry(2, 'https://kept.example/'), bookmarkId: 'kept' },
    ]))
    await expect(harness.controller.prepare()).resolves.toMatchObject({
      ok: true,
      preparation: { total: 1, skipped: 1 },
    })
  })

  it('rejects wrong confirmation, expired plans and targets changed after review', async () => {
    const harness = createRepairHarness([folder('folder-a'), bookmark('target')])
    const wrong = await harness.controller.prepareRepair({ operation: 'delete', bookmarkId: 'target' })
    if (!wrong.ok)
      throw new Error('Expected delete plan')
    await expect(harness.controller.confirmRepairs([
      { token: wrong.plan.token, confirmation: 'reviewed' },
    ])).resolves.toMatchObject({ results: [{ ok: false, reason: 'invalid-confirmation' }] })
    expect(harness.nodes.has('target')).toBe(true)

    const expired = await harness.controller.prepareRepair({ operation: 'ignore', bookmarkId: 'target' })
    if (!expired.ok)
      throw new Error('Expected ignore plan')
    harness.setCurrentTime('2026-08-28T00:02:00.000Z')
    await expect(harness.controller.confirmRepairs([
      { token: expired.plan.token, confirmation: 'reviewed' },
    ])).resolves.toMatchObject({ results: [{ ok: false, reason: 'repair-plan-expired' }] })

    harness.setCurrentTime('2026-08-28T00:03:00.000Z')
    const stale = await harness.controller.prepareRepair({
      operation: 'update',
      bookmarkId: 'target',
      changes: { title: 'Reviewed' },
    })
    if (!stale.ok)
      throw new Error('Expected update plan')
    harness.nodes.get('target')!.title = 'Concurrent change'
    await expect(harness.controller.confirmRepairs([
      { token: stale.plan.token, confirmation: 'reviewed' },
    ])).resolves.toMatchObject({ results: [{ ok: false, reason: 'repair-plan-stale' }] })
    expect(harness.bookmarks.update).not.toHaveBeenCalled()
  })

  it('continues a confirmed batch after an item-local mutation failure', async () => {
    const harness = createRepairHarness([folder('folder-a'), bookmark('broken'), bookmark('ignored')])
    harness.bookmarks.update.mockRejectedValueOnce(new Error('browser rejected'))
    const broken = await harness.controller.prepareRepair({
      operation: 'update',
      bookmarkId: 'broken',
      changes: { title: 'Never applied' },
    })
    const ignored = await harness.controller.prepareRepair({ operation: 'ignore', bookmarkId: 'ignored' })
    if (!broken.ok || !ignored.ok)
      throw new Error('Expected repair plans')

    await expect(harness.controller.confirmRepairs([
      { token: broken.plan.token, confirmation: 'reviewed' },
      { token: ignored.plan.token, confirmation: 'reviewed' },
    ])).resolves.toEqual({
      ok: true,
      results: [
        { ok: false, token: 'repair-1', operation: 'update', reason: 'bookmark-update-failed' },
        { ok: true, token: 'repair-2', operation: 'ignore' },
      ],
    })
    expect(harness.getLocalState()?.ignoredBookmarks).toMatchObject([{ bookmarkId: 'ignored' }])
  })

  it('invalidates unexecuted plans when disabled and preserves a backup after delete failure', async () => {
    const harness = createRepairHarness([folder('folder-a'), bookmark('target'), bookmark('failing')])
    const pending = await harness.controller.prepareRepair({ operation: 'ignore', bookmarkId: 'target' })
    if (!pending.ok)
      throw new Error('Expected ignore plan')
    const disabled: InstalledModuleRecord = { ...bookmarkRecord(false), grantedCapabilities: ['bookmarks.read', 'bookmarks.write'] }
    harness.controller.handleInstalledRecordChanged(disabled)
    await expect(harness.controller.confirmRepairs([
      { token: pending.plan.token, confirmation: 'reviewed' },
    ])).resolves.toMatchObject({ results: [{ ok: false, reason: 'repair-plan-not-found' }] })

    const deletion = await harness.controller.prepareRepair({ operation: 'delete', bookmarkId: 'failing' })
    if (!deletion.ok)
      throw new Error('Expected delete plan')
    harness.bookmarks.remove.mockRejectedValueOnce(new Error('remove failed'))
    await expect(harness.controller.confirmRepairs([
      { token: deletion.plan.token, confirmation: 'delete-confirmed' },
    ])).resolves.toMatchObject({ results: [{ ok: false, reason: 'bookmark-delete-failed' }] })
    expect(harness.getLocalState()?.deletionBackups).toMatchObject([{ bookmarkId: 'failing' }])
    expect(harness.nodes.has('failing')).toBe(true)
  })

  it('does not publish a plan when lifecycle invalidation races target re-reading', async () => {
    const harness = createRepairHarness([folder('folder-a'), bookmark('target')])
    let releaseRead: ((_value: RepairNode[]) => void) | undefined
    harness.bookmarks.get.mockImplementationOnce(() => new Promise(resolve => releaseRead = resolve))
    const pending = harness.controller.prepareRepair({ operation: 'ignore', bookmarkId: 'target' })
    await vi.waitFor(() => expect(harness.bookmarks.get).toHaveBeenCalledOnce())
    const disabled: InstalledModuleRecord = { ...bookmarkRecord(false), grantedCapabilities: ['bookmarks.read', 'bookmarks.write'] }
    harness.controller.handleInstalledRecordChanged(disabled)
    releaseRead?.([structuredClone(harness.nodes.get('target')!)])

    await expect(pending).resolves.toEqual({ ok: false, reason: 'repair-plan-stale' })
    await expect(harness.controller.confirmRepairs([
      { token: 'repair-1', confirmation: 'reviewed' },
    ])).resolves.toMatchObject({ results: [{ reason: 'repair-plan-not-found' }] })
  })

  it('restores a reviewed deletion backup once and rejects stale or conflicting backups', async () => {
    const harness = createRepairHarness([folder('folder-a'), bookmark('deleted')])
    const deletion = await harness.controller.prepareRepair({ operation: 'delete', bookmarkId: 'deleted' })
    if (!deletion.ok)
      throw new Error('Expected delete plan')
    await harness.controller.confirmRepairs([{ token: deletion.plan.token, confirmation: 'delete-confirmed' }])
    const restore = await harness.controller.prepareRestore(deletion.plan.token)
    if (!restore.ok)
      throw new Error('Expected restore plan')
    await expect(harness.controller.confirmRestore({
      token: restore.plan.token,
      confirmation: 'reviewed',
    })).resolves.toEqual({ ok: true, token: restore.plan.token })
    expect(harness.bookmarks.create).toHaveBeenCalledWith({
      parentId: 'folder-a',
      index: 0,
      title: 'Title deleted',
      url: 'https://deleted.example/',
    })
    expect(harness.getLocalState()?.deletionBackups).toEqual([])
    await expect(harness.controller.prepareRestore(deletion.plan.token)).resolves.toEqual({
      ok: false,
      reason: 'restore-backup-not-found',
    })

    const conflictBackup = {
      bookmarkId: 'removed-conflict',
      parentId: 'folder-a',
      index: 1,
      title: 'Existing',
      url: 'https://existing.example/',
      repairToken: 'backup-conflict',
      deletedAt: '2026-08-28T00:00:00.000Z',
    }
    harness.nodes.set('existing', {
      id: 'existing',
      parentId: 'folder-a',
      index: 1,
      title: conflictBackup.title,
      url: conflictBackup.url,
    })
    harness.setLocalState({
      schemaVersion: 2,
      lastResult: null,
      ignoredBookmarks: [],
      deletionBackups: [conflictBackup],
    })
    await expect(harness.controller.prepareRestore(conflictBackup.repairToken)).resolves.toEqual({
      ok: false,
      reason: 'restore-conflict',
    })

    harness.nodes.delete('existing')
    const stale = await harness.controller.prepareRestore(conflictBackup.repairToken)
    if (!stale.ok)
      throw new Error('Expected restore plan')
    harness.setLocalState({ schemaVersion: 2, lastResult: null, ignoredBookmarks: [], deletionBackups: [] })
    await expect(harness.controller.confirmRestore({
      token: stale.plan.token,
      confirmation: 'reviewed',
    })).resolves.toMatchObject({ ok: false, reason: 'restore-backup-stale' })
  })

  it('lists, removes and explicitly clears only namespaced local diagnostics', async () => {
    const harness = createRepairHarness([folder('folder-a'), bookmark('ignored'), bookmark('deleted')])
    const ignored = await harness.controller.prepareRepair({ operation: 'ignore', bookmarkId: 'ignored' })
    const deleted = await harness.controller.prepareRepair({ operation: 'delete', bookmarkId: 'deleted' })
    if (!ignored.ok || !deleted.ok)
      throw new Error('Expected repair plans')
    await harness.controller.confirmRepairs([
      { token: ignored.plan.token, confirmation: 'reviewed' },
      { token: deleted.plan.token, confirmation: 'delete-confirmed' },
    ])
    await expect(harness.controller.workspaceState()).resolves.toMatchObject({
      ok: true,
      state: {
        ignoredBookmarks: [{ bookmarkId: 'ignored' }],
        deletionBackups: [{ bookmarkId: 'deleted' }],
      },
    })
    await expect(harness.controller.unignore('ignored')).resolves.toMatchObject({
      ok: true,
      state: { ignoredBookmarks: [], deletionBackups: [{ bookmarkId: 'deleted' }] },
    })
    await expect(harness.controller.clearLocalData('wrong')).resolves.toEqual({
      ok: false,
      reason: 'invalid-local-data-confirmation',
    })
    await expect(harness.controller.clearLocalData('clear-local-data')).resolves.toEqual({
      ok: true,
      state: { ignoredBookmarks: [], deletionBackups: [] },
    })
    expect(harness.nodes.has('ignored')).toBe(true)
  })

  it('releases only owned scan origins, retains shared module origins and revokes both grants', async () => {
    const owned = createRepairHarness([folder('folder-a'), bookmark('target')])
    let ownedOriginChecks = 0
    owned.permissions.contains.mockImplementation(async (request) => {
      if (request.origins)
        return ++ownedOriginChecks > 1
      return true
    })
    owned.reader.read.mockResolvedValueOnce(ready([entry(1, 'https://owned.example/path')]))
    const prepared = await owned.controller.prepare()
    if (!prepared.ok)
      throw new Error('Expected scan preparation')
    await owned.controller.start(prepared.preparation.token)
    expect(owned.permissions.remove).toHaveBeenCalledWith({ origins: ['https://owned.example/*'] })

    const shared = createRepairHarness([folder('folder-a'), bookmark('target')])
    const seed = createRepoLensSeed('https://shared.example')
    const remote: InstalledModuleRecord = {
      manifest: seed.manifest,
      enabled: true,
      source: 'user',
      sourceUrl: 'https://shared.example/.well-known/oneweb-module.json',
      grantedContexts: seed.grantedContexts,
      grantedContextFields: seed.grantedContextFields,
      grantedCapabilities: seed.grantedCapabilities,
      update: null,
      installedAt: '2026-08-28T00:00:00.000Z',
      updatedAt: '2026-08-28T00:00:00.000Z',
    }
    shared.setExtraRecords([remote])
    let sharedOriginChecks = 0
    shared.permissions.contains.mockImplementation(async (request) => {
      if (request.origins)
        return ++sharedOriginChecks > 1
      return true
    })
    shared.reader.read.mockResolvedValueOnce(ready([entry(1, 'https://shared.example/path')]))
    const sharedPreparation = await shared.controller.prepare()
    if (!sharedPreparation.ok)
      throw new Error('Expected shared scan preparation')
    await shared.controller.start(sharedPreparation.preparation.token)
    expect(shared.permissions.remove).not.toHaveBeenCalledWith({ origins: ['https://shared.example/*'] })

    const repair = await shared.controller.prepareRepair({ operation: 'ignore', bookmarkId: 'target' })
    if (!repair.ok)
      throw new Error('Expected repair plan')
    shared.permissions.contains.mockImplementation(async request => !request.permissions)
    await expect(shared.controller.revoke()).resolves.toMatchObject({
      ok: true,
      record: { grantedCapabilities: [] },
    })
    expect(shared.permissions.remove).toHaveBeenCalledWith({ permissions: ['bookmarks'] })
    await expect(shared.controller.confirmRepairs([
      { token: repair.plan.token, confirmation: 'reviewed' },
    ])).resolves.toMatchObject({ results: [{ reason: 'repair-plan-not-found' }] })
  })

  it('retains an owned scan origin while another packaged builtin uses it', async () => {
    const harness = createRepairHarness([folder('folder-a'), bookmark('target')])
    let originChecks = 0
    harness.permissions.contains.mockImplementation(async (request) => {
      if (request.origins)
        return ++originChecks > 1
      return true
    })
    harness.reader.read.mockResolvedValueOnce(ready([entry(1, 'http://127.0.0.1:9090/path')]))
    const originInUse = vi.fn(async () => true)
    harness.controller.setOriginInUse(originInUse)
    const prepared = await harness.controller.prepare()
    if (!prepared.ok)
      throw new Error('Expected scan preparation')
    await harness.controller.start(prepared.preparation.token)

    expect(originInUse).toHaveBeenCalledWith('http://127.0.0.1:9090/*')
    expect(harness.permissions.remove).not.toHaveBeenCalledWith({
      origins: ['http://127.0.0.1:9090/*'],
    })
  })

  it('reports browser or Registry revocation failures instead of claiming success', async () => {
    const browserFailure = createRepairHarness([folder('folder-a'), bookmark('target')])
    browserFailure.permissions.remove.mockResolvedValueOnce(false)
    await expect(browserFailure.controller.revoke()).resolves.toEqual({
      ok: false,
      reason: 'permission-remove-failed',
    })
    expect((await browserFailure.registry.get()).grantedCapabilities).toEqual([])

    const registryFailure = createRepairHarness([folder('folder-a'), bookmark('target')])
    registryFailure.registry.setCapabilityGrant.mockRejectedValueOnce(new Error('storage unavailable'))
    await expect(registryFailure.controller.revoke()).resolves.toEqual({
      ok: false,
      reason: 'capability-sync-failed',
    })
  })
})
