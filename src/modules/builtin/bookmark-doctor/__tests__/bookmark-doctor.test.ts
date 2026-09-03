import type { SeededModuleDefinition } from '../../../types'
import { validateModuleManifest } from '../../../manifest'
import { ModuleRegistry, type ModuleStorageArea } from '../../../registry'
import {
  BOOKMARK_DOCTOR_MODULE_ID,
  type BookmarkTreeNodeInput,
} from '../contracts'
import { createBookmarkDoctorSeed } from '../manifest'
import {
  classifyBookmarkUrl,
  createStableBookmarkEntryId,
  normalizeBookmarkTree,
} from '../normalize'
import { BookmarkDoctorReader } from '../reader'

class MemoryStorage implements ModuleStorageArea {
  state: Record<string, unknown> = {}

  async get(_key: string) {
    return structuredClone(this.state)
  }

  async set(items: Record<string, unknown>) {
    this.state = { ...this.state, ...structuredClone(items) }
  }
}

function enabledSeed(granted = true): SeededModuleDefinition {
  const seed = createBookmarkDoctorSeed()
  seed.enabled = true
  seed.grantedCapabilities = granted ? ['bookmarks.read'] : []
  return seed
}

function nestedTree(): BookmarkTreeNodeInput[] {
  return [{
    id: '0',
    title: '',
    children: [{
      id: 'folder-1',
      parentId: '0',
      title: 'Research',
      children: [
        {
          id: 'bookmark-1',
          parentId: 'folder-1',
          title: ' Example ',
          url: 'https://example.com/docs',
          dateAdded: 123,
        },
        {
          id: 'bookmark-2',
          parentId: 'folder-1',
          title: 'Settings',
          url: 'chrome://settings/',
        },
      ],
    }],
  }]
}

function readerHarness(seed: SeededModuleDefinition, permission = true, tree: unknown = nestedTree()) {
  const storage = new MemoryStorage()
  const registry = new ModuleRegistry({ storage, seeds: [seed] })
  const permissions = { contains: vi.fn(async () => permission) }
  const bookmarks = { readTree: vi.fn(async () => structuredClone(tree)) }
  const reader = new BookmarkDoctorReader({
    registry,
    permissions,
    bookmarks,
    now: () => '2026-08-28T12:00:00.000Z',
  })
  return { bookmarks, permissions, reader, registry, storage }
}

describe('bookmark doctor Phase 3A contract', () => {
  it('defines a valid disabled builtin without contexts or default grants', async () => {
    const seed = createBookmarkDoctorSeed()
    expect(validateModuleManifest(seed.manifest)).toMatchObject({ ok: false })
    expect(validateModuleManifest(seed.manifest, { allowBuiltin: true })).toMatchObject({
      ok: true,
      manifest: {
        id: BOOKMARK_DOCTOR_MODULE_ID,
        runtime: 'builtin',
        matches: [],
        contexts: [],
        context_fields: {},
        capabilities: ['bookmarks.read', 'bookmarks.write'],
      },
    })

    const registry = new ModuleRegistry({
      storage: new MemoryStorage(),
      seeds: [seed],
      now: () => '2026-08-28T08:00:00.000Z',
    })
    const [record] = await registry.list()
    expect(record).toMatchObject({
      enabled: false,
      source: 'seeded',
      grantedContexts: [],
      grantedContextFields: {},
      grantedCapabilities: [],
      update: null,
    })
    await registry.setEnabled(BOOKMARK_DOCTOR_MODULE_ID, true)
    await expect(registry.get(BOOKMARK_DOCTOR_MODULE_ID)).resolves.toMatchObject({
      enabled: true,
      grantedCapabilities: [],
    })
  })

  it('normalizes nested bookmark leaves with independent folder paths', () => {
    const result = normalizeBookmarkTree(nestedTree())
    expect(result.valid).toBe(true)
    expect(result.entries).toEqual([
      expect.objectContaining({
        entryId: 'bookmark:bookmark-1',
        bookmarkId: 'bookmark-1',
        title: 'Example',
        url: 'https://example.com/docs',
        folderPath: ['Research'],
        treePath: [0, 0, 0],
        dateAdded: 123,
        urlClassification: {
          eligibility: 'scannable',
          reason: 'https',
          normalizedUrl: 'https://example.com/docs',
        },
      }),
      expect.objectContaining({
        entryId: 'bookmark:bookmark-2',
        folderPath: ['Research'],
        urlClassification: expect.objectContaining({
          eligibility: 'unscannable',
          reason: 'browser-internal',
        }),
      }),
    ])
    result.entries[0].folderPath.push('mutated')
    expect(result.entries[1].folderPath).toEqual(['Research'])
  })

  it('classifies scan eligibility without network access', () => {
    expect(classifyBookmarkUrl('https://example.com')).toMatchObject({ eligibility: 'scannable', reason: 'https' })
    expect(classifyBookmarkUrl('http://example.com')).toMatchObject({ eligibility: 'scannable', reason: 'http' })
    expect(classifyBookmarkUrl('http://localhost:3000')).toMatchObject({ eligibility: 'scannable', reason: 'loopback' })
    expect(classifyBookmarkUrl('http://127.0.0.1')).toMatchObject({ eligibility: 'scannable', reason: 'loopback' })
    expect(classifyBookmarkUrl('file:///tmp/a')).toMatchObject({ eligibility: 'unscannable', reason: 'local-resource' })
    expect(classifyBookmarkUrl('edge://settings')).toMatchObject({ eligibility: 'unscannable', reason: 'browser-internal' })
    expect(classifyBookmarkUrl('mailto:test@example.com')).toMatchObject({ eligibility: 'unscannable', reason: 'unsupported-scheme' })
    expect(classifyBookmarkUrl('not a URL')).toEqual({ eligibility: 'unscannable', reason: 'invalid', normalizedUrl: null })
    expect(classifyBookmarkUrl(undefined)).toEqual({ eligibility: 'unscannable', reason: 'missing', normalizedUrl: null })
  })

  it('keeps IDs stable and diagnoses duplicate nodes without collisions', () => {
    expect(createStableBookmarkEntryId('bookmark-1', [0])).toBe(createStableBookmarkEntryId('bookmark-1', [9, 4]))
    const result = normalizeBookmarkTree([
      { id: 'duplicate', title: 'A', url: 'https://a.example' },
      { id: 'duplicate', title: 'B', url: 'https://b.example' },
      { title: 'No ID', url: 'https://c.example' },
    ])
    expect(new Set(result.entries.map(entry => entry.entryId)).size).toBe(3)
    expect(result.diagnostics).toContainEqual({
      code: 'duplicate-node-id',
      treePath: [1],
      bookmarkId: 'duplicate',
    })
    expect(result.entries[2].entryId).toBe(createStableBookmarkEntryId(null, [2]))
  })

  it('handles empty and malformed trees without throwing', () => {
    expect(normalizeBookmarkTree([])).toEqual({ valid: true, entries: [], diagnostics: [] })
    expect(normalizeBookmarkTree(null)).toEqual({
      valid: false,
      entries: [],
      diagnostics: [{ code: 'invalid-tree', treePath: [], bookmarkId: null }],
    })

    const cyclic: Record<string, unknown> = { id: 'cycle', title: 'Cycle', children: [] }
    ;(cyclic.children as unknown[]).push(cyclic)
    const malformed = normalizeBookmarkTree([
      null,
      { id: 42, title: 7, url: 99, children: 'invalid' },
      cyclic,
    ])
    expect(malformed.valid).toBe(true)
    expect(malformed.diagnostics.map(diagnostic => diagnostic.code)).toEqual(expect.arrayContaining([
      'malformed-node',
      'invalid-children',
      'cyclic-node',
    ]))
  })

  it('does not inspect permission or bookmarks while disabled', async () => {
    const harness = readerHarness(createBookmarkDoctorSeed())
    await expect(harness.reader.read()).resolves.toMatchObject({
      status: 'blocked',
      entries: [],
      error: { code: 'module-disabled' },
    })
    expect(harness.permissions.contains).not.toHaveBeenCalled()
    expect(harness.bookmarks.readTree).not.toHaveBeenCalled()
  })

  it('blocks missing capability and optional permission before reading', async () => {
    const withoutGrant = readerHarness(enabledSeed(false))
    await expect(withoutGrant.reader.read()).resolves.toMatchObject({
      status: 'blocked',
      error: { code: 'capability-not-granted' },
    })
    expect(withoutGrant.permissions.contains).not.toHaveBeenCalled()
    expect(withoutGrant.bookmarks.readTree).not.toHaveBeenCalled()

    const withoutPermission = readerHarness(enabledSeed(), false)
    await expect(withoutPermission.reader.read()).resolves.toMatchObject({
      status: 'blocked',
      error: { code: 'permission-missing' },
    })
    expect(withoutPermission.bookmarks.readTree).not.toHaveBeenCalled()
  })

  it('returns normalized local data only after every read boundary passes', async () => {
    const harness = readerHarness(enabledSeed())
    await expect(harness.reader.read()).resolves.toMatchObject({
      status: 'ready',
      completedAt: '2026-08-28T12:00:00.000Z',
      entries: [
        { bookmarkId: 'bookmark-1' },
        { bookmarkId: 'bookmark-2' },
      ],
      error: null,
    })
    expect(harness.permissions.contains).toHaveBeenCalledWith({ permissions: ['bookmarks'] })
    expect(harness.bookmarks.readTree).toHaveBeenCalledOnce()
  })

  it('classifies permission, read and invalid-tree failures as pure local errors', async () => {
    const permissionFailure = readerHarness(enabledSeed())
    permissionFailure.permissions.contains.mockRejectedValueOnce(new Error('permission API failed'))
    await expect(permissionFailure.reader.read()).resolves.toMatchObject({
      status: 'failed',
      error: { code: 'permission-check-failed' },
    })

    const readFailure = readerHarness(enabledSeed())
    readFailure.bookmarks.readTree.mockRejectedValueOnce(new Error('bookmark API failed'))
    await expect(readFailure.reader.read()).resolves.toMatchObject({
      status: 'failed',
      error: { code: 'bookmark-read-failed' },
    })

    const invalidTree = readerHarness(enabledSeed(), true, null)
    await expect(invalidTree.reader.read()).resolves.toMatchObject({
      status: 'failed',
      diagnostics: [{ code: 'invalid-tree' }],
      error: { code: 'invalid-tree' },
    })
  })
})
