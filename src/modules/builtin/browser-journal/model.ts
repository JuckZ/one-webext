import {
  BROWSER_JOURNAL_ENTRY_LIMIT,
  BROWSER_JOURNAL_SNAPSHOT_VERSION,
  BROWSER_JOURNAL_TITLE_LIMIT,
  BROWSER_JOURNAL_URL_LIMIT,
  type BrowserJournalEntry,
  type BrowserJournalObservation,
  type BrowserJournalSnapshot,
} from './contracts'

function isSafeBrowserId(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0
}

function normalizeOccurredAt(value: unknown) {
  if (typeof value !== 'string' || value.length > 64)
    return null
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null
}

export function normalizeBrowserJournalUrl(value: unknown) {
  if (typeof value !== 'string' || !value || value.length > BROWSER_JOURNAL_URL_LIMIT)
    return null
  try {
    const parsed = new URL(value)
    if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || parsed.username || parsed.password)
      return null
    parsed.hash = ''
    const normalized = parsed.href
    return normalized.length <= BROWSER_JOURNAL_URL_LIMIT ? normalized : null
  }
  catch {
    return null
  }
}

export function normalizeBrowserJournalTitle(value: unknown) {
  if (typeof value !== 'string')
    return ''
  return value.replace(/\s+/g, ' ').trim().slice(0, BROWSER_JOURNAL_TITLE_LIMIT)
}

function stableTextHash(value: string) {
  let hash = 0x811C9DC5
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}

export function createBrowserJournalEntryId(entry: Omit<BrowserJournalEntry, 'id'>) {
  const binding = [
    entry.occurredAt,
    entry.kind,
    entry.tabId,
    entry.windowId,
    entry.title,
    entry.url,
  ].join('\u001F')
  return `journal-${stableTextHash(binding)}`
}

export function normalizeBrowserJournalObservation(
  observation: BrowserJournalObservation,
): BrowserJournalEntry | null {
  if (observation.active !== true || observation.incognito === true)
    return null
  if (observation.kind !== 'activation' && observation.kind !== 'navigation')
    return null
  if (!isSafeBrowserId(observation.tabId) || !isSafeBrowserId(observation.windowId))
    return null
  const occurredAt = normalizeOccurredAt(observation.occurredAt)
  const url = normalizeBrowserJournalUrl(observation.url)
  if (!occurredAt || !url)
    return null
  const entry = {
    kind: observation.kind,
    tabId: observation.tabId,
    windowId: observation.windowId,
    occurredAt,
    title: normalizeBrowserJournalTitle(observation.title),
    url,
  }
  return { id: createBrowserJournalEntryId(entry), ...entry }
}

function equivalentConsecutiveEntry(left: BrowserJournalEntry, right: BrowserJournalEntry) {
  return left.tabId === right.tabId
    && left.windowId === right.windowId
    && left.title === right.title
    && left.url === right.url
}

export function appendBrowserJournalEntry(
  entries: readonly BrowserJournalEntry[],
  entry: BrowserJournalEntry,
  limit = BROWSER_JOURNAL_ENTRY_LIMIT,
) {
  const normalizedLimit = Number.isSafeInteger(limit) && limit > 0 ? limit : BROWSER_JOURNAL_ENTRY_LIMIT
  const last = entries.at(-1)
  if (last && equivalentConsecutiveEntry(last, entry))
    return [...entries]
  return [...entries, entry].slice(-normalizedLimit)
}

export function createEmptyBrowserJournalSnapshot(): BrowserJournalSnapshot {
  return {
    version: BROWSER_JOURNAL_SNAPSHOT_VERSION,
    status: 'stopped',
    sessionId: null,
    startedAt: null,
    stoppedAt: null,
    entries: [],
  }
}

export function isBrowserJournalEntry(value: unknown): value is BrowserJournalEntry {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return false
  const entry = value as Partial<BrowserJournalEntry>
  const canonical = typeof entry.id === 'string'
    && entry.id.length > 0
    && entry.id.length <= 128
    && (entry.kind === 'activation' || entry.kind === 'navigation')
    && isSafeBrowserId(entry.tabId)
    && isSafeBrowserId(entry.windowId)
    && normalizeOccurredAt(entry.occurredAt) === entry.occurredAt
    && typeof entry.title === 'string'
    && entry.title.length <= BROWSER_JOURNAL_TITLE_LIMIT
    && normalizeBrowserJournalUrl(entry.url) === entry.url
  return canonical && entry.id === createBrowserJournalEntryId(entry as Omit<BrowserJournalEntry, 'id'>)
}

export function isBrowserJournalSnapshot(value: unknown): value is BrowserJournalSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return false
  const snapshot = value as Partial<BrowserJournalSnapshot>
  if (!Array.isArray(snapshot.entries)
    || snapshot.entries.length > BROWSER_JOURNAL_ENTRY_LIMIT
    || !snapshot.entries.every(isBrowserJournalEntry)) {
    return false
  }
  const entries = snapshot.entries
  const validBase = snapshot.version === BROWSER_JOURNAL_SNAPSHOT_VERSION
    && (snapshot.status === 'stopped' || snapshot.status === 'recording')
    && (snapshot.sessionId === null || (typeof snapshot.sessionId === 'string' && snapshot.sessionId.length > 0 && snapshot.sessionId.length <= 128))
    && (snapshot.startedAt === null || normalizeOccurredAt(snapshot.startedAt) === snapshot.startedAt)
    && (snapshot.stoppedAt === null || normalizeOccurredAt(snapshot.stoppedAt) === snapshot.stoppedAt)
  if (!validBase)
    return false
  if (snapshot.status === 'recording')
    return snapshot.sessionId !== null && snapshot.startedAt !== null && snapshot.stoppedAt === null
  if (snapshot.sessionId === null) {
    return snapshot.startedAt === null
      && snapshot.stoppedAt === null
      && entries.length === 0
  }
  return snapshot.startedAt !== null && snapshot.stoppedAt !== null
}
