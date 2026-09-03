import type { BrowserJournalArchiveState, BrowserJournalSavedSession } from '~/modules/builtin/browser-journal'
import { presentBrowserJournalArchive } from '../browser-journal-presentation'

function savedSession(
  id: string,
  savedAt: string,
  title = id,
): BrowserJournalSavedSession {
  return {
    id,
    startedAt: '2026-08-29T08:00:00.000Z',
    stoppedAt: '2026-08-29T08:01:00.000Z',
    savedAt,
    entries: [{
      kind: 'navigation',
      occurredAt: '2026-08-29T08:00:30.000Z',
      title,
      url: `https://example.com/${id}`,
    }],
  }
}

describe('browser Journal archive presentation', () => {
  it('presents an empty archive without a selection', () => {
    expect(presentBrowserJournalArchive({ schemaVersion: 1, sessions: [] }, 'missing')).toEqual({
      sessions: [],
      selectedSessionId: null,
      selectedSession: null,
    })
  })

  it('orders newest first, defaults to newest and derives exact expiry', () => {
    const archive: BrowserJournalArchiveState = {
      schemaVersion: 1,
      sessions: [
        savedSession('older', '2026-08-29T08:02:00.000Z'),
        savedSession('newer', '2026-08-29T09:02:00.000Z'),
      ],
    }
    const presented = presentBrowserJournalArchive(archive, null)

    expect(presented.sessions.map(session => session.id)).toEqual(['newer', 'older'])
    expect(presented.selectedSessionId).toBe('newer')
    expect(presented.selectedSession).toMatchObject({
      id: 'newer',
      entryCount: 1,
      expiresAt: '2026-09-05T09:02:00.000Z',
    })
  })

  it('preserves a valid selection and falls back when it becomes stale', () => {
    const archive: BrowserJournalArchiveState = {
      schemaVersion: 1,
      sessions: [
        savedSession('older', '2026-08-29T08:02:00.000Z'),
        savedSession('newer', '2026-08-29T09:02:00.000Z'),
      ],
    }

    expect(presentBrowserJournalArchive(archive, 'older').selectedSessionId).toBe('older')
    expect(presentBrowserJournalArchive({
      ...archive,
      sessions: archive.sessions.filter(session => session.id !== 'older'),
    }, 'older').selectedSessionId).toBe('newer')
  })

  it('keeps hostile text inert and does not mutate the archive', () => {
    const hostile = '<img src=x onerror=alert(1)> <script>ignored</script>'
    const archive: BrowserJournalArchiveState = {
      schemaVersion: 1,
      sessions: [savedSession('hostile', '2026-08-29T08:02:00.000Z', hostile)],
    }
    const before = structuredClone(archive)
    const presented = presentBrowserJournalArchive(archive, null)

    expect(presented.selectedSession?.entries[0]?.title).toBe(hostile)
    expect(archive).toEqual(before)
    presented.selectedSession!.entries[0]!.title = 'changed projection'
    expect(archive).toEqual(before)
  })
})
