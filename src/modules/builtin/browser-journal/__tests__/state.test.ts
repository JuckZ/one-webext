import type { BrowserJournalSavedSession, BrowserJournalSnapshot } from '../contracts'
import {
  BROWSER_JOURNAL_ARCHIVE_RETENTION_MS,
  BROWSER_JOURNAL_ARCHIVE_SESSION_LIMIT,
  BROWSER_JOURNAL_ENTRY_LIMIT,
} from '../contracts'
import { createBrowserJournalEntryId } from '../model'
import {
  createBrowserJournalArchiveStore,
  createBrowserJournalSavedSession,
  createEmptyBrowserJournalArchiveState,
  normalizeBrowserJournalArchiveState,
} from '../state'

function stoppedSnapshot(entryCount = 1): BrowserJournalSnapshot {
  return {
    version: 1,
    status: 'stopped',
    sessionId: 'live-session',
    startedAt: '2026-08-29T00:00:00.000Z',
    stoppedAt: '2026-08-29T00:05:00.000Z',
    entries: Array.from({ length: entryCount }, (_, index) => {
      const entry = {
        kind: index % 2 ? 'navigation' as const : 'activation' as const,
        tabId: index + 1,
        windowId: 9,
        occurredAt: new Date(Date.parse('2026-08-29T00:00:01.000Z') + index * 1000).toISOString(),
        title: `Page ${index}`,
        url: `https://example.com/${index}`,
      }
      return { id: createBrowserJournalEntryId(entry), ...entry }
    }),
  }
}

function savedSession(id: string, savedAt: string): BrowserJournalSavedSession {
  return {
    id,
    startedAt: '2026-08-29T00:00:00.000Z',
    stoppedAt: '2026-08-29T00:05:00.000Z',
    savedAt,
    entries: [{
      kind: 'navigation',
      occurredAt: '2026-08-29T00:01:00.000Z',
      title: 'Saved page',
      url: 'https://example.com/saved',
    }],
  }
}

describe('browser journal archive state', () => {
  it('projects a stopped session without live tab, window, entry or session identifiers', () => {
    const snapshot = stoppedSnapshot()
    const saved = createBrowserJournalSavedSession(
      snapshot,
      '2026-08-29T00:06:00.000Z',
      'saved-1',
    )
    expect(saved).toEqual({
      id: 'saved-1',
      startedAt: snapshot.startedAt,
      stoppedAt: snapshot.stoppedAt,
      savedAt: '2026-08-29T00:06:00.000Z',
      entries: [{
        kind: 'activation',
        occurredAt: '2026-08-29T00:00:01.000Z',
        title: 'Page 0',
        url: 'https://example.com/0',
      }],
    })
    expect(JSON.stringify(saved)).not.toContain('tabId')
    expect(JSON.stringify(saved)).not.toContain('windowId')
    expect(JSON.stringify(saved)).not.toContain('live-session')
    expect(createBrowserJournalSavedSession(
      { ...snapshot, status: 'recording', stoppedAt: null },
      '2026-08-29T00:06:00.000Z',
      'saved-2',
    )).toBeNull()
  })

  it('drops expired, future and malformed sessions and retains only the newest ten', () => {
    const now = Date.parse('2026-08-29T12:00:00.000Z')
    const candidates = Array.from({ length: BROWSER_JOURNAL_ARCHIVE_SESSION_LIMIT + 2 }, (_, index) => (
      savedSession(`saved-${index}`, new Date(now - (20 - index) * 60_000).toISOString())
    ))
    candidates.push(savedSession('expired', new Date(now - BROWSER_JOURNAL_ARCHIVE_RETENTION_MS).toISOString()))
    candidates.push(savedSession('future', new Date(now + 1).toISOString()))
    const state = normalizeBrowserJournalArchiveState({
      schemaVersion: 1,
      sessions: [
        { id: 'malformed', entries: [{ url: 'javascript:alert(1)' }] },
        ...candidates,
      ],
    }, new Date(now).toISOString())
    expect(state.sessions).toHaveLength(BROWSER_JOURNAL_ARCHIVE_SESSION_LIMIT)
    expect(state.sessions.map(session => session.id)).toEqual(
      candidates.slice(-BROWSER_JOURNAL_ARCHIVE_SESSION_LIMIT - 2, -2).map(session => session.id),
    )
    expect(state.sessions.some(session => ['expired', 'future', 'malformed'].includes(session.id))).toBe(false)
  })

  it('fails closed for unknown schemas and overlong entry collections', () => {
    expect(normalizeBrowserJournalArchiveState({ schemaVersion: 0, sessions: [savedSession('old', '2026-08-29T00:00:00.000Z')] }, '2026-08-29T01:00:00.000Z')).toEqual(
      createEmptyBrowserJournalArchiveState(),
    )
    const tooLarge = savedSession('large', '2026-08-29T00:00:00.000Z')
    tooLarge.entries = Array.from({ length: BROWSER_JOURNAL_ENTRY_LIMIT + 1 }, () => tooLarge.entries[0]!)
    expect(normalizeBrowserJournalArchiveState({ schemaVersion: 1, sessions: [tooLarge] }, '2026-08-29T01:00:00.000Z').sessions).toEqual([])
  })

  it('uses only the generic Browser Journal module-local namespace', async () => {
    const storage = {
      state: {} as Record<string, unknown>,
      async get() { return structuredClone(this.state) },
      async set(items: Record<string, unknown>) { Object.assign(this.state, structuredClone(items)) },
    }
    const store = createBrowserJournalArchiveStore(storage)
    expect(store.storageKey).toBe('oneweb.module-state.v1:dev.oneweb.browser-journal')
    await store.write(createEmptyBrowserJournalArchiveState())
    expect(storage.state).toEqual({
      [store.storageKey]: { schemaVersion: 1, sessions: [] },
    })
  })
})
