import {
  BROWSER_JOURNAL_ARCHIVE_RETENTION_MS,
  type BrowserJournalArchiveState,
  type BrowserJournalSavedEntry,
} from '~/modules/builtin/browser-journal'

export interface BrowserJournalSavedSessionSummary {
  id: string
  entryCount: number
  startedAt: string
  stoppedAt: string
  savedAt: string
  expiresAt: string
}

export interface BrowserJournalSavedSessionDetail extends BrowserJournalSavedSessionSummary {
  entries: BrowserJournalSavedEntry[]
}

export interface BrowserJournalArchivePresentation {
  sessions: BrowserJournalSavedSessionSummary[]
  selectedSessionId: string | null
  selectedSession: BrowserJournalSavedSessionDetail | null
}

function expiryFrom(savedAt: string) {
  return new Date(Date.parse(savedAt) + BROWSER_JOURNAL_ARCHIVE_RETENTION_MS).toISOString()
}

export function presentBrowserJournalArchive(
  state: Readonly<BrowserJournalArchiveState>,
  requestedSessionId: string | null,
): BrowserJournalArchivePresentation {
  const ordered = [...state.sessions].sort((left, right) => (
    right.savedAt.localeCompare(left.savedAt) || right.id.localeCompare(left.id)
  ))
  const selected = ordered.find(session => session.id === requestedSessionId) || ordered[0] || null
  const sessions = ordered.map(session => ({
    id: session.id,
    entryCount: session.entries.length,
    startedAt: session.startedAt,
    stoppedAt: session.stoppedAt,
    savedAt: session.savedAt,
    expiresAt: expiryFrom(session.savedAt),
  }))
  if (!selected) {
    return {
      sessions,
      selectedSessionId: null,
      selectedSession: null,
    }
  }
  const summary = sessions.find(session => session.id === selected.id)!
  return {
    sessions,
    selectedSessionId: selected.id,
    selectedSession: {
      ...summary,
      entries: selected.entries.map(entry => ({ ...entry })),
    },
  }
}
