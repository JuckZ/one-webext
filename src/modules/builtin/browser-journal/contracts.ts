export const BROWSER_JOURNAL_MODULE_ID = 'dev.oneweb.browser-journal' as const
export const BROWSER_JOURNAL_ENTRY_ID = 'browser-journal' as const
export const BROWSER_JOURNAL_SNAPSHOT_VERSION = 1 as const
export const BROWSER_JOURNAL_ENTRY_LIMIT = 100 as const
export const BROWSER_JOURNAL_TITLE_LIMIT = 256 as const
export const BROWSER_JOURNAL_URL_LIMIT = 2048 as const
export const BROWSER_JOURNAL_ARCHIVE_SCHEMA_VERSION = 1 as const
export const BROWSER_JOURNAL_ARCHIVE_SESSION_LIMIT = 10 as const
export const BROWSER_JOURNAL_ARCHIVE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000

export type BrowserJournalStatus = 'stopped' | 'recording'
export type BrowserJournalEventKind = 'activation' | 'navigation'

export interface BrowserJournalObservation {
  kind: BrowserJournalEventKind
  tabId: unknown
  windowId: unknown
  occurredAt: unknown
  active: unknown
  incognito: unknown
  title: unknown
  url: unknown
}

export interface BrowserJournalEntry {
  id: string
  kind: BrowserJournalEventKind
  tabId: number
  windowId: number
  occurredAt: string
  title: string
  url: string
}

export interface BrowserJournalSnapshot {
  version: typeof BROWSER_JOURNAL_SNAPSHOT_VERSION
  status: BrowserJournalStatus
  sessionId: string | null
  startedAt: string | null
  stoppedAt: string | null
  entries: BrowserJournalEntry[]
}

export interface BrowserJournalSavedEntry {
  kind: BrowserJournalEventKind
  occurredAt: string
  title: string
  url: string
}

export interface BrowserJournalSavedSession {
  id: string
  startedAt: string
  stoppedAt: string
  savedAt: string
  entries: BrowserJournalSavedEntry[]
}

export interface BrowserJournalArchiveState {
  schemaVersion: typeof BROWSER_JOURNAL_ARCHIVE_SCHEMA_VERSION
  sessions: BrowserJournalSavedSession[]
}

export type BrowserJournalErrorCode =
  | 'module-unavailable'
  | 'module-disabled'
  | 'lifecycle-cancelled'
  | 'listener-failed'
  | 'archive-unavailable'
  | 'archive-read-failed'
  | 'archive-write-failed'
  | 'session-not-stopped'
  | 'session-empty'
  | 'saved-session-not-found'
  | 'invalid-clear-confirmation'

export type BrowserJournalStartResult =
  | { ok: true, changed: boolean, snapshot: BrowserJournalSnapshot }
  | { ok: false, reason: BrowserJournalErrorCode }

export interface BrowserJournalStopResult {
  ok: true
  changed: boolean
  snapshot: BrowserJournalSnapshot
}
