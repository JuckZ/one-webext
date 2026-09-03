import type { BrowserJournalObservation } from '../contracts'
import type { BrowserJournalEventSource } from '../event-source'
import { BROWSER_JOURNAL_MODULE_ID } from '../contracts'
import { BrowserJournalController } from '../controller'
import { createBrowserJournalSeed } from '../manifest'

function installedRecord(enabled = true) {
  const seed = createBrowserJournalSeed()
  return {
    manifest: seed.manifest,
    enabled,
    source: 'seeded' as const,
    grantedContexts: [],
    grantedContextFields: {},
    grantedCapabilities: [],
    update: null,
    installedAt: '2026-08-29T08:00:00.000Z',
    updatedAt: '2026-08-29T08:00:00.000Z',
  }
}

function eventHarness() {
  let sink: ((_event: BrowserJournalObservation) => void) | null = null
  const events: BrowserJournalEventSource = {
    start: vi.fn((next) => { sink = next }),
    stop: vi.fn(() => { sink = null }),
  }
  return {
    events,
    emit(event: Partial<BrowserJournalObservation> = {}) {
      sink?.({
        kind: 'activation',
        tabId: 3,
        windowId: 1,
        occurredAt: '2026-08-29T08:00:01.000Z',
        active: true,
        incognito: false,
        title: 'Journal page',
        url: 'https://example.com/start',
        ...event,
      })
    },
  }
}

function archiveHarness(initial: unknown = null) {
  let value = structuredClone(initial)
  return {
    archive: {
      read: vi.fn(async () => structuredClone(value) as never),
      write: vi.fn(async (state) => { value = structuredClone(state) }),
    },
    value: () => structuredClone(value),
  }
}

describe('browser journal controller', () => {
  it('records only between explicit start and stop and resets on the next start', async () => {
    const source = eventHarness()
    let now = '2026-08-29T08:00:00.000Z'
    const controller = new BrowserJournalController({
      registry: { get: vi.fn(async () => installedRecord(true)) },
      events: source.events,
      createSessionId: () => 'journal-session-1',
      now: () => now,
    })
    source.emit()
    expect(controller.status().entries).toEqual([])

    await expect(controller.start()).resolves.toMatchObject({
      ok: true,
      changed: true,
      snapshot: { status: 'recording', sessionId: 'journal-session-1', entries: [] },
    })
    source.emit()
    source.emit({ kind: 'navigation', occurredAt: '2026-08-29T08:00:02.000Z' })
    source.emit({ incognito: true, url: 'https://private.example/' })
    source.emit({ active: false, url: 'https://background.example/' })
    expect(controller.status().entries).toHaveLength(1)

    now = '2026-08-29T08:01:00.000Z'
    expect(controller.stop()).toMatchObject({
      changed: true,
      snapshot: { status: 'stopped', stoppedAt: now, entries: [{ url: 'https://example.com/start' }] },
    })
    source.emit({ url: 'https://after-stop.example/' })
    expect(controller.status().entries).toHaveLength(1)
    expect(source.events.stop).toHaveBeenCalledOnce()

    now = '2026-08-29T08:02:00.000Z'
    await controller.start()
    expect(controller.status()).toMatchObject({ status: 'recording', entries: [], startedAt: now })
  })

  it('fails safely while unavailable or disabled and never attaches listeners', async () => {
    const unavailable = eventHarness()
    const unavailableController = new BrowserJournalController({
      registry: { get: vi.fn(async () => null) },
      events: unavailable.events,
    })
    await expect(unavailableController.start()).resolves.toEqual({ ok: false, reason: 'module-unavailable' })
    expect(unavailable.events.start).not.toHaveBeenCalled()

    const disabled = eventHarness()
    const disabledController = new BrowserJournalController({
      registry: { get: vi.fn(async () => installedRecord(false)) },
      events: disabled.events,
    })
    await expect(disabledController.start()).resolves.toEqual({ ok: false, reason: 'module-disabled' })
    expect(disabled.events.start).not.toHaveBeenCalled()
  })

  it('clears authority and entries immediately on disable', async () => {
    const source = eventHarness()
    const controller = new BrowserJournalController({
      registry: { get: vi.fn(async () => installedRecord(true)) },
      events: source.events,
    })
    await controller.start()
    source.emit()
    expect(controller.status().entries).toHaveLength(1)

    controller.handleInstalledRecordChanged(installedRecord(false))
    expect(controller.status()).toEqual({
      version: 1,
      status: 'stopped',
      sessionId: null,
      startedAt: null,
      stoppedAt: null,
      entries: [],
    })
    expect(source.events.stop).toHaveBeenCalledOnce()
    source.emit({ url: 'https://after-disable.example/' })
    expect(controller.status().entries).toEqual([])
  })

  it('clears a session if its required tabs permission lifecycle is invalidated', async () => {
    const source = eventHarness()
    const controller = new BrowserJournalController({
      registry: { get: vi.fn(async () => installedRecord(true)) },
      events: source.events,
    })
    await controller.start()
    source.emit()
    controller.handlePermissionsRemoved({ permissions: ['tabs'] })
    expect(controller.status()).toMatchObject({ status: 'stopped', sessionId: null, entries: [] })
    expect(source.events.stop).toHaveBeenCalledOnce()
  })

  it('treats a fresh worker controller as stopped and empty without restoring state', async () => {
    const firstSource = eventHarness()
    const registry = { get: vi.fn(async (id: string) => id === BROWSER_JOURNAL_MODULE_ID ? installedRecord(true) : null) }
    const first = new BrowserJournalController({ registry, events: firstSource.events })
    await first.start()
    firstSource.emit()
    expect(first.status().entries).toHaveLength(1)

    const restartedSource = eventHarness()
    const restarted = new BrowserJournalController({ registry, events: restartedSource.events })
    expect(restarted.status()).toMatchObject({ status: 'stopped', sessionId: null, entries: [] })
    expect(restartedSource.events.start).not.toHaveBeenCalled()
  })

  it('rejects an in-flight start invalidated by lifecycle change', async () => {
    let resolveRecord!: (_value: ReturnType<typeof installedRecord>) => void
    const source = eventHarness()
    const controller = new BrowserJournalController({
      registry: {
        get: vi.fn(() => new Promise<ReturnType<typeof installedRecord>>((resolve) => {
          resolveRecord = resolve
        })),
      },
      events: source.events,
    })
    const starting = controller.start()
    controller.handleInstalledRecordChanged(installedRecord(false))
    resolveRecord(installedRecord(true))
    await expect(starting).resolves.toEqual({ ok: false, reason: 'lifecycle-cancelled' })
    expect(source.events.start).not.toHaveBeenCalled()
  })

  it('explicitly saves only a stopped non-empty session and projects no live identifiers', async () => {
    const source = eventHarness()
    const stored = archiveHarness()
    const controller = new BrowserJournalController({
      registry: { get: vi.fn(async () => installedRecord(true)) },
      events: source.events,
      archive: stored.archive,
      createSessionId: () => 'live-session',
      createSavedSessionId: () => 'saved-session',
      now: (() => {
        let calls = 0
        return () => new Date(Date.parse('2026-08-29T08:00:00.000Z') + calls++ * 60_000).toISOString()
      })(),
    })
    await expect(controller.save()).resolves.toEqual({ ok: false, reason: 'session-not-stopped' })
    await controller.start()
    await expect(controller.save()).resolves.toEqual({ ok: false, reason: 'session-not-stopped' })
    controller.stop()
    await expect(controller.save()).resolves.toEqual({ ok: false, reason: 'session-empty' })

    await controller.start()
    source.emit({ title: '<img src=x>', url: 'https://private.example/path#fragment' })
    controller.stop()
    const saved = await controller.save()
    expect(saved).toMatchObject({
      ok: true,
      changed: true,
      savedSession: {
        id: 'saved-session',
        entries: [{ title: '<img src=x>', url: 'https://private.example/path' }],
      },
      state: { schemaVersion: 1, sessions: [{ id: 'saved-session' }] },
    })
    expect(JSON.stringify(stored.value())).not.toContain('tabId')
    expect(JSON.stringify(stored.value())).not.toContain('windowId')
    expect(JSON.stringify(stored.value())).not.toContain('live-session')
    await expect(controller.save()).resolves.toMatchObject({ ok: true, changed: false })
    expect(stored.archive.write).toHaveBeenCalledOnce()
  })

  it('reads archives while disabled and supports individual delete and confirmed clear', async () => {
    const source = eventHarness()
    const stored = archiveHarness({
      schemaVersion: 1,
      sessions: [{
        id: 'saved-1',
        startedAt: '2026-08-29T07:00:00.000Z',
        stoppedAt: '2026-08-29T07:05:00.000Z',
        savedAt: '2026-08-29T07:06:00.000Z',
        entries: [{
          kind: 'navigation',
          occurredAt: '2026-08-29T07:01:00.000Z',
          title: 'Saved',
          url: 'https://example.com/saved',
        }],
      }],
    })
    const controller = new BrowserJournalController({
      registry: { get: vi.fn(async () => installedRecord(false)) },
      events: source.events,
      archive: stored.archive,
      now: () => '2026-08-29T08:00:00.000Z',
    })
    await expect(controller.archiveState()).resolves.toMatchObject({
      ok: true,
      state: { sessions: [{ id: 'saved-1' }] },
    })
    await expect(controller.deleteSavedSession('missing')).resolves.toEqual({
      ok: false,
      reason: 'saved-session-not-found',
    })
    await expect(controller.deleteSavedSession('saved-1')).resolves.toMatchObject({
      ok: true,
      changed: true,
      state: { sessions: [] },
    })
    await expect(controller.clearArchive('wrong')).resolves.toEqual({
      ok: false,
      reason: 'invalid-clear-confirmation',
    })
    await expect(controller.clearArchive('clear-saved-sessions')).resolves.toMatchObject({
      ok: true,
      changed: false,
      state: { sessions: [] },
    })
  })

  it('repairs expired startup state and keeps archive failures stable', async () => {
    const source = eventHarness()
    const expired = archiveHarness({
      schemaVersion: 1,
      sessions: [{
        id: 'expired',
        startedAt: '2026-08-01T00:00:00.000Z',
        stoppedAt: '2026-08-01T00:01:00.000Z',
        savedAt: '2026-08-01T00:02:00.000Z',
        entries: [{ kind: 'navigation', occurredAt: '2026-08-01T00:00:30.000Z', title: 'Old', url: 'https://old.example/' }],
      }],
    })
    const controller = new BrowserJournalController({
      registry: { get: vi.fn(async () => installedRecord(true)) },
      events: source.events,
      archive: expired.archive,
      now: () => '2026-08-29T08:00:00.000Z',
    })
    await controller.startup()
    expect(expired.value()).toEqual({ schemaVersion: 1, sessions: [] })

    const failed = new BrowserJournalController({
      registry: { get: vi.fn(async () => installedRecord(true)) },
      events: source.events,
      archive: {
        read: vi.fn(async () => Promise.reject(new Error('read failed'))),
        write: vi.fn(),
      },
    })
    await expect(failed.archiveState()).resolves.toEqual({ ok: false, reason: 'archive-read-failed' })
  })

  it('keeps the live result intact on write failure and removes a save invalidated during I/O', async () => {
    const source = eventHarness()
    const failed = new BrowserJournalController({
      registry: { get: vi.fn(async () => installedRecord(true)) },
      events: source.events,
      archive: {
        read: vi.fn(async () => null),
        write: vi.fn(async () => Promise.reject(new Error('write failed'))),
      },
      createSessionId: () => 'failed-live',
      createSavedSessionId: () => 'failed-saved',
      now: () => '2026-08-29T08:00:00.000Z',
    })
    await failed.start()
    source.emit()
    failed.stop()
    await expect(failed.save()).resolves.toEqual({ ok: false, reason: 'archive-write-failed' })
    expect(failed.status()).toMatchObject({ status: 'stopped', entries: [{ url: 'https://example.com/start' }] })

    let value: unknown = null
    let releaseWrite!: () => void
    const firstWrite = new Promise<void>((resolve) => {
      releaseWrite = resolve
    })
    const archive = {
      read: vi.fn(async () => structuredClone(value) as never),
      write: vi.fn(async (state) => {
        if (archive.write.mock.calls.length === 1)
          await firstWrite
        value = structuredClone(state)
      }),
    }
    const controller = new BrowserJournalController({
      registry: { get: vi.fn(async () => installedRecord(true)) },
      events: source.events,
      archive,
      createSessionId: () => 'stale-live',
      createSavedSessionId: () => 'stale-saved',
      now: () => '2026-08-29T08:00:00.000Z',
    })
    await controller.start()
    source.emit({ url: 'https://stale.example/' })
    controller.stop()
    const saving = controller.save()
    await vi.waitFor(() => expect(archive.write).toHaveBeenCalledOnce())
    controller.handleInstalledRecordChanged(installedRecord(false))
    releaseWrite()
    await expect(saving).resolves.toEqual({ ok: false, reason: 'lifecycle-cancelled' })
    expect(archive.write).toHaveBeenCalledTimes(2)
    expect(value).toEqual({ schemaVersion: 1, sessions: [] })
  })
})
