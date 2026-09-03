import type { BrowserJournalEventSource } from '../builtin/browser-journal/event-source'
import { createBookmarkDoctorSeed } from '../builtin/bookmark-doctor'
import {
  BrowserJournalController,
  createBrowserJournalArchiveStore,
  createBrowserJournalSeed,
} from '../builtin/browser-journal'
import { createClashControlSeed } from '../builtin/clash-control'
import { getModuleLocalStateStorageKey } from '../module-state'
import { createRepoLensSeed } from '../seeds/repolens'
import { createConformanceModulePair, snapshotModule } from './fixtures/conformance-module-pair'

describe('browser journal builtin isolation', () => {
  it('keeps every other principal, permission and namespace unchanged through recording and disable', async () => {
    const journalSeed = createBrowserJournalSeed()
    journalSeed.enabled = true
    const bookmarkSeed = createBookmarkDoctorSeed()
    bookmarkSeed.enabled = true
    bookmarkSeed.grantedCapabilities = ['bookmarks.read']
    const clashSeed = createClashControlSeed()
    const repoLensSeed = createRepoLensSeed('https://repolens.example')
    const harness = createConformanceModulePair([repoLensSeed, bookmarkSeed, clashSeed, journalSeed])
    const alpha = await harness.install(harness.primary)
    const beta = await harness.install(harness.secondary)
    const untouchedIds = [
      repoLensSeed.manifest.id,
      bookmarkSeed.manifest.id,
      clashSeed.manifest.id,
      alpha.manifest.id,
      beta.manifest.id,
    ]
    const before = new Map(await Promise.all(untouchedIds.map(async id => [
      id,
      snapshotModule(await harness.registry.get(id)),
    ] as const)))
    const journalBefore = snapshotModule(await harness.registry.get(journalSeed.manifest.id))
    const stateKeys = [...untouchedIds, journalSeed.manifest.id].map(getModuleLocalStateStorageKey)
    await harness.storage.set(Object.fromEntries(stateKeys.map((key, index) => [key, { owner: index }])))
    const stateBefore = structuredClone(harness.storage.state)

    let sink: Parameters<BrowserJournalEventSource['start']>[0] | null = null
    const events: BrowserJournalEventSource = {
      start: (next) => { sink = next },
      stop: () => { sink = null },
    }
    const controller = new BrowserJournalController({
      registry: harness.registry,
      events,
      createSessionId: () => 'isolated-journal-session',
      now: () => '2026-08-29T08:00:00.000Z',
    })
    await expect(controller.start()).resolves.toMatchObject({ ok: true })
    const emit = sink as Parameters<BrowserJournalEventSource['start']>[0] | null
    emit?.({
      kind: 'activation',
      tabId: 7,
      windowId: 1,
      occurredAt: '2026-08-29T08:00:01.000Z',
      active: true,
      incognito: false,
      title: 'Private journal title',
      url: 'https://journal-private.example/path',
    })
    expect(controller.status().entries).toHaveLength(1)
    await harness.manager.setEnabled(journalSeed.manifest.id, false)
    controller.handleInstalledRecordChanged((await harness.registry.get(journalSeed.manifest.id))!)
    expect(controller.status()).toMatchObject({ status: 'stopped', entries: [] })

    for (const id of untouchedIds)
      expect(await harness.registry.get(id)).toEqual(before.get(id))
    expect(await harness.registry.get(journalSeed.manifest.id)).toEqual({
      ...journalBefore,
      enabled: false,
    })
    for (const key of stateKeys)
      expect(harness.storage.state[key]).toEqual(stateBefore[key])
    expect(JSON.stringify(harness.storage.state)).not.toContain('Private journal title')
    expect(JSON.stringify(harness.storage.state)).not.toContain('journal-private.example')
    expect(await harness.permissions.contains({ origins: [harness.primary.originPattern] })).toBe(true)
    expect(await harness.permissions.contains({ origins: [harness.secondary.originPattern] })).toBe(true)
  })

  it('persists an explicit archive only in its namespace without changing another principal', async () => {
    const journalSeed = createBrowserJournalSeed()
    journalSeed.enabled = true
    const bookmarkSeed = createBookmarkDoctorSeed()
    const clashSeed = createClashControlSeed()
    const repoLensSeed = createRepoLensSeed('https://repolens.example')
    const harness = createConformanceModulePair([repoLensSeed, bookmarkSeed, clashSeed, journalSeed])
    const alpha = await harness.install(harness.primary)
    const beta = await harness.install(harness.secondary)
    const moduleIds = [
      repoLensSeed.manifest.id,
      bookmarkSeed.manifest.id,
      clashSeed.manifest.id,
      journalSeed.manifest.id,
      alpha.manifest.id,
      beta.manifest.id,
    ]
    const recordsBefore = new Map(await Promise.all(moduleIds.map(async id => [
      id,
      snapshotModule(await harness.registry.get(id)),
    ] as const)))
    const otherStateIds = moduleIds.filter(id => id !== journalSeed.manifest.id)
    const otherState = Object.fromEntries(otherStateIds.map((id, index) => [
      getModuleLocalStateStorageKey(id),
      { owner: id, index },
    ]))
    await harness.storage.set(otherState)

    let sink: Parameters<BrowserJournalEventSource['start']>[0] | null = null
    const controller = new BrowserJournalController({
      registry: harness.registry,
      events: {
        start: (next) => { sink = next },
        stop: () => { sink = null },
      },
      archive: createBrowserJournalArchiveStore(harness.storage),
      createSessionId: () => 'live-isolated-session',
      createSavedSessionId: () => 'saved-isolated-session',
      now: (() => {
        let count = 0
        return () => new Date(Date.parse('2026-08-29T08:00:00.000Z') + count++ * 60_000).toISOString()
      })(),
    })
    await controller.start()
    const emit = sink as Parameters<BrowserJournalEventSource['start']>[0] | null
    emit?.({
      kind: 'navigation',
      tabId: 7,
      windowId: 1,
      occurredAt: '2026-08-29T08:00:30.000Z',
      active: true,
      incognito: false,
      title: 'Private retained title',
      url: 'https://retained-private.example/path',
    })
    controller.stop()
    await expect(controller.save()).resolves.toMatchObject({ ok: true, changed: true })

    for (const id of moduleIds)
      expect(await harness.registry.get(id)).toEqual(recordsBefore.get(id))
    for (const [key, value] of Object.entries(otherState))
      expect(harness.storage.state[key]).toEqual(value)
    const journalKey = getModuleLocalStateStorageKey(journalSeed.manifest.id)
    expect(harness.storage.state[journalKey]).toMatchObject({
      schemaVersion: 1,
      sessions: [{
        id: 'saved-isolated-session',
        entries: [{ title: 'Private retained title', url: 'https://retained-private.example/path' }],
      }],
    })
    expect(JSON.stringify(harness.storage.state[journalKey])).not.toContain('tabId')
    expect(JSON.stringify(harness.storage.state[journalKey])).not.toContain('windowId')
    expect(await harness.permissions.contains({ origins: [harness.primary.originPattern] })).toBe(true)
    expect(await harness.permissions.contains({ origins: [harness.secondary.originPattern] })).toBe(true)
  })
})
