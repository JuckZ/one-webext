import type {
  BrowserJournalArchiveState,
  BrowserJournalErrorCode,
  BrowserJournalSavedSession,
  BrowserJournalSnapshot,
} from './contracts'
import { isBrowserJournalSnapshot } from './model'
import { isBrowserJournalArchiveState } from './state'

export const BROWSER_JOURNAL_CHANNEL = 'oneweb.browser-journal' as const
export const BROWSER_JOURNAL_PROTOCOL_VERSION = 2 as const

interface BrowserJournalRequestBase {
  channel: typeof BROWSER_JOURNAL_CHANNEL
  version: typeof BROWSER_JOURNAL_PROTOCOL_VERSION
}

export type BrowserJournalRequest =
  | BrowserJournalRequestBase & {
    type: 'BROWSER_JOURNAL_START' | 'BROWSER_JOURNAL_STOP' | 'BROWSER_JOURNAL_STATUS' | 'BROWSER_JOURNAL_ARCHIVE' | 'BROWSER_JOURNAL_SAVE'
  }
  | BrowserJournalRequestBase & { type: 'BROWSER_JOURNAL_DELETE_SAVED', savedSessionId: string }
  | BrowserJournalRequestBase & {
    type: 'BROWSER_JOURNAL_CLEAR_SAVED'
    confirmation: 'clear-saved-sessions'
  }

export type BrowserJournalRequestType = BrowserJournalRequest['type']

export type BrowserJournalResult =
  | { ok: true, operation: 'start', changed: boolean, snapshot: BrowserJournalSnapshot }
  | { ok: false, operation: 'start', reason: BrowserJournalErrorCode }
  | { ok: true, operation: 'stop', changed: boolean, snapshot: BrowserJournalSnapshot }
  | { ok: true, operation: 'status', snapshot: BrowserJournalSnapshot }
  | { ok: true, operation: 'archive', state: BrowserJournalArchiveState }
  | { ok: false, operation: 'archive', reason: BrowserJournalErrorCode }
  | {
    ok: true
    operation: 'save'
    changed: boolean
    savedSession: BrowserJournalSavedSession
    state: BrowserJournalArchiveState
  }
  | { ok: false, operation: 'save', reason: BrowserJournalErrorCode }
  | { ok: true, operation: 'delete-saved', changed: true, state: BrowserJournalArchiveState }
  | { ok: false, operation: 'delete-saved', reason: BrowserJournalErrorCode }
  | { ok: true, operation: 'clear-saved', changed: boolean, state: BrowserJournalArchiveState }
  | { ok: false, operation: 'clear-saved', reason: BrowserJournalErrorCode }

export interface BrowserJournalResponse {
  channel: typeof BROWSER_JOURNAL_CHANNEL
  version: typeof BROWSER_JOURNAL_PROTOCOL_VERSION
  type: 'BROWSER_JOURNAL_RESPONSE'
  requestType: BrowserJournalRequestType
  result: BrowserJournalResult
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(value)
  return actual.length === keys.length && actual.every(key => keys.includes(key))
}

function isErrorCode(value: unknown): value is BrowserJournalErrorCode {
  return value === 'module-unavailable'
    || value === 'module-disabled'
    || value === 'lifecycle-cancelled'
    || value === 'listener-failed'
    || value === 'archive-unavailable'
    || value === 'archive-read-failed'
    || value === 'archive-write-failed'
    || value === 'session-not-stopped'
    || value === 'session-empty'
    || value === 'saved-session-not-found'
    || value === 'invalid-clear-confirmation'
}

export function isBrowserJournalRequest(value: unknown): value is BrowserJournalRequest {
  if (!isRecord(value)
    || value.channel !== BROWSER_JOURNAL_CHANNEL
    || value.version !== BROWSER_JOURNAL_PROTOCOL_VERSION) {
    return false
  }
  if (value.type === 'BROWSER_JOURNAL_DELETE_SAVED') {
    return hasOnlyKeys(value, ['channel', 'version', 'type', 'savedSessionId'])
      && typeof value.savedSessionId === 'string'
      && value.savedSessionId.length > 0
      && value.savedSessionId.length <= 128
  }
  if (value.type === 'BROWSER_JOURNAL_CLEAR_SAVED') {
    return hasOnlyKeys(value, ['channel', 'version', 'type', 'confirmation'])
      && value.confirmation === 'clear-saved-sessions'
  }
  return hasOnlyKeys(value, ['channel', 'version', 'type'])
    && (value.type === 'BROWSER_JOURNAL_START'
      || value.type === 'BROWSER_JOURNAL_STOP'
      || value.type === 'BROWSER_JOURNAL_STATUS'
      || value.type === 'BROWSER_JOURNAL_ARCHIVE'
      || value.type === 'BROWSER_JOURNAL_SAVE')
}

export function createBrowserJournalResponse(
  requestType: BrowserJournalRequestType,
  result: BrowserJournalResult,
): BrowserJournalResponse {
  return {
    channel: BROWSER_JOURNAL_CHANNEL,
    version: BROWSER_JOURNAL_PROTOCOL_VERSION,
    type: 'BROWSER_JOURNAL_RESPONSE',
    requestType,
    result,
  }
}

export function isBrowserJournalResponse(value: unknown): value is BrowserJournalResponse {
  if (!isRecord(value)
    || value.channel !== BROWSER_JOURNAL_CHANNEL
    || value.version !== BROWSER_JOURNAL_PROTOCOL_VERSION
    || value.type !== 'BROWSER_JOURNAL_RESPONSE'
    || !isRecord(value.result)) {
    return false
  }
  const result = value.result
  if (value.requestType === 'BROWSER_JOURNAL_START' && result.operation === 'start') {
    return result.ok === true
      ? typeof result.changed === 'boolean' && isBrowserJournalSnapshot(result.snapshot)
      : result.ok === false && isErrorCode(result.reason)
  }
  if (value.requestType === 'BROWSER_JOURNAL_STOP' && result.operation === 'stop') {
    return result.ok === true
      && typeof result.changed === 'boolean'
      && isBrowserJournalSnapshot(result.snapshot)
  }
  if (value.requestType === 'BROWSER_JOURNAL_STATUS' && result.operation === 'status')
    return result.ok === true && isBrowserJournalSnapshot(result.snapshot)
  if (value.requestType === 'BROWSER_JOURNAL_ARCHIVE' && result.operation === 'archive')
    return result.ok === true ? isBrowserJournalArchiveState(result.state) : result.ok === false && isErrorCode(result.reason)
  if (value.requestType === 'BROWSER_JOURNAL_SAVE' && result.operation === 'save') {
    return result.ok === true
      ? typeof result.changed === 'boolean'
      && isBrowserJournalArchiveState(result.state)
      && isBrowserJournalArchiveState({ schemaVersion: 1, sessions: [result.savedSession] })
      : result.ok === false && isErrorCode(result.reason)
  }
  if (value.requestType === 'BROWSER_JOURNAL_DELETE_SAVED' && result.operation === 'delete-saved') {
    return result.ok === true
      ? result.changed === true && isBrowserJournalArchiveState(result.state)
      : result.ok === false && isErrorCode(result.reason)
  }
  return value.requestType === 'BROWSER_JOURNAL_CLEAR_SAVED'
    && result.operation === 'clear-saved'
    && (result.ok === true
      ? typeof result.changed === 'boolean' && isBrowserJournalArchiveState(result.state)
      : result.ok === false && isErrorCode(result.reason))
}
