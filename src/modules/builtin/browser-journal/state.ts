import type { ModuleLocalStateStorageArea } from '../../module-state'
import { ModuleLocalStateStore } from '../../module-state'
import {
  BROWSER_JOURNAL_ARCHIVE_RETENTION_MS,
  BROWSER_JOURNAL_ARCHIVE_SCHEMA_VERSION,
  BROWSER_JOURNAL_ARCHIVE_SESSION_LIMIT,
  BROWSER_JOURNAL_ENTRY_LIMIT,
  BROWSER_JOURNAL_MODULE_ID,
  type BrowserJournalArchiveState,
  type BrowserJournalSavedEntry,
  type BrowserJournalSavedSession,
  type BrowserJournalSnapshot,
} from './contracts'
import {
  isBrowserJournalSnapshot,
  normalizeBrowserJournalTitle,
  normalizeBrowserJournalUrl,
} from './model'

function normalizeIsoTimestamp(value: unknown) {
  if (typeof value !== 'string' || value.length > 64)
    return null
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null
}

function isSavedEntry(value: unknown): value is BrowserJournalSavedEntry {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return false
  const entry = value as Partial<BrowserJournalSavedEntry>
  return (entry.kind === 'activation' || entry.kind === 'navigation')
    && normalizeIsoTimestamp(entry.occurredAt) === entry.occurredAt
    && typeof entry.title === 'string'
    && normalizeBrowserJournalTitle(entry.title) === entry.title
    && normalizeBrowserJournalUrl(entry.url) === entry.url
}

function normalizeSavedSession(value: unknown, nowMs: number) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return null
  const session = value as Partial<BrowserJournalSavedSession>
  const startedAt = normalizeIsoTimestamp(session.startedAt)
  const stoppedAt = normalizeIsoTimestamp(session.stoppedAt)
  const savedAt = normalizeIsoTimestamp(session.savedAt)
  if (typeof session.id !== 'string'
    || !session.id
    || session.id.length > 128
    || !startedAt
    || !stoppedAt
    || !savedAt
    || !Array.isArray(session.entries)
    || !session.entries.length
    || session.entries.length > BROWSER_JOURNAL_ENTRY_LIMIT
    || !session.entries.every(isSavedEntry)) {
    return null
  }
  const savedAtMs = Date.parse(savedAt)
  if (savedAtMs > nowMs || nowMs - savedAtMs >= BROWSER_JOURNAL_ARCHIVE_RETENTION_MS)
    return null
  return {
    id: session.id,
    startedAt,
    stoppedAt,
    savedAt,
    entries: structuredClone(session.entries),
  } satisfies BrowserJournalSavedSession
}

export function createEmptyBrowserJournalArchiveState(): BrowserJournalArchiveState {
  return {
    schemaVersion: BROWSER_JOURNAL_ARCHIVE_SCHEMA_VERSION,
    sessions: [],
  }
}

export function normalizeBrowserJournalArchiveState(
  value: unknown,
  now: string,
): BrowserJournalArchiveState {
  const nowMs = Date.parse(now)
  if (!Number.isFinite(nowMs)
    || !value
    || typeof value !== 'object'
    || Array.isArray(value)) {
    return createEmptyBrowserJournalArchiveState()
  }
  const state = value as Partial<BrowserJournalArchiveState>
  if (state.schemaVersion !== BROWSER_JOURNAL_ARCHIVE_SCHEMA_VERSION || !Array.isArray(state.sessions))
    return createEmptyBrowserJournalArchiveState()
  const sessions = new Map<string, BrowserJournalSavedSession>()
  for (const candidate of state.sessions) {
    const session = normalizeSavedSession(candidate, nowMs)
    if (session)
      sessions.set(session.id, session)
  }
  return {
    schemaVersion: BROWSER_JOURNAL_ARCHIVE_SCHEMA_VERSION,
    sessions: [...sessions.values()]
      .sort((left, right) => left.savedAt.localeCompare(right.savedAt))
      .slice(-BROWSER_JOURNAL_ARCHIVE_SESSION_LIMIT),
  }
}

export function createBrowserJournalSavedSession(
  snapshot: BrowserJournalSnapshot,
  savedAt: string,
  id: string,
): BrowserJournalSavedSession | null {
  if (!isBrowserJournalSnapshot(snapshot)
    || snapshot.status !== 'stopped'
    || snapshot.sessionId === null
    || snapshot.startedAt === null
    || snapshot.stoppedAt === null
    || !snapshot.entries.length
    || !id
    || id.length > 128
    || normalizeIsoTimestamp(savedAt) !== savedAt) {
    return null
  }
  return {
    id,
    startedAt: snapshot.startedAt,
    stoppedAt: snapshot.stoppedAt,
    savedAt,
    entries: snapshot.entries.map(entry => ({
      kind: entry.kind,
      occurredAt: entry.occurredAt,
      title: entry.title,
      url: entry.url,
    })),
  }
}

export function isBrowserJournalArchiveState(value: unknown): value is BrowserJournalArchiveState {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return false
  const state = value as Partial<BrowserJournalArchiveState>
  if (state.schemaVersion !== BROWSER_JOURNAL_ARCHIVE_SCHEMA_VERSION
    || !Array.isArray(state.sessions)
    || state.sessions.length > BROWSER_JOURNAL_ARCHIVE_SESSION_LIMIT) {
    return false
  }
  return state.sessions.every((session) => {
    if (!session || typeof session !== 'object' || Array.isArray(session))
      return false
    const candidate = session as Partial<BrowserJournalSavedSession>
    return typeof candidate.id === 'string'
      && candidate.id.length > 0
      && candidate.id.length <= 128
      && normalizeIsoTimestamp(candidate.startedAt) === candidate.startedAt
      && normalizeIsoTimestamp(candidate.stoppedAt) === candidate.stoppedAt
      && normalizeIsoTimestamp(candidate.savedAt) === candidate.savedAt
      && Array.isArray(candidate.entries)
      && candidate.entries.length > 0
      && candidate.entries.length <= BROWSER_JOURNAL_ENTRY_LIMIT
      && candidate.entries.every(isSavedEntry)
  })
}

export function createBrowserJournalArchiveStore(storage: ModuleLocalStateStorageArea) {
  return new ModuleLocalStateStore<BrowserJournalArchiveState>(storage, BROWSER_JOURNAL_MODULE_ID)
}
