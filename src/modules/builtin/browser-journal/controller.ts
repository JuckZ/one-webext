import type { InstalledModuleRecord } from '../../types'
import type { BrowserJournalEventSource } from './event-source'
import {
  BROWSER_JOURNAL_ENTRY_ID,
  BROWSER_JOURNAL_MODULE_ID,
  BROWSER_JOURNAL_SNAPSHOT_VERSION,
  type BrowserJournalArchiveState,
  type BrowserJournalErrorCode,
  type BrowserJournalObservation,
  type BrowserJournalSavedSession,
  type BrowserJournalSnapshot,
  type BrowserJournalStartResult,
  type BrowserJournalStopResult,
} from './contracts'
import {
  appendBrowserJournalEntry,
  createEmptyBrowserJournalSnapshot,
  normalizeBrowserJournalObservation,
} from './model'
import {
  createBrowserJournalSavedSession,
  createEmptyBrowserJournalArchiveState,
  normalizeBrowserJournalArchiveState,
} from './state'

export interface BrowserJournalRegistryBoundary {
  get: (_moduleId: string) => Promise<InstalledModuleRecord | null>
}

export interface BrowserJournalArchiveBoundary {
  read: () => Promise<BrowserJournalArchiveState | null>
  write: (_state: BrowserJournalArchiveState) => Promise<void>
}

export interface BrowserJournalControllerOptions {
  registry: BrowserJournalRegistryBoundary
  events: BrowserJournalEventSource
  archive?: BrowserJournalArchiveBoundary
  createSessionId?: () => string
  createSavedSessionId?: () => string
  now?: () => string
}

export type BrowserJournalArchiveResult =
  | { ok: true, state: BrowserJournalArchiveState }
  | { ok: false, reason: BrowserJournalErrorCode }

export type BrowserJournalSaveResult =
  | {
    ok: true
    changed: boolean
    savedSession: BrowserJournalSavedSession
    state: BrowserJournalArchiveState
  }
  | { ok: false, reason: BrowserJournalErrorCode }

export type BrowserJournalDeleteResult =
  | { ok: true, changed: true, state: BrowserJournalArchiveState }
  | { ok: false, reason: BrowserJournalErrorCode }

export type BrowserJournalClearArchiveResult =
  | { ok: true, changed: boolean, state: BrowserJournalArchiveState }
  | { ok: false, reason: BrowserJournalErrorCode }

function isBrowserJournalRecord(record: InstalledModuleRecord | null): record is InstalledModuleRecord {
  return Boolean(
    record
    && record.source === 'seeded'
    && record.manifest.id === BROWSER_JOURNAL_MODULE_ID
    && record.manifest.runtime === 'builtin'
    && record.manifest.entry_id === BROWSER_JOURNAL_ENTRY_ID,
  )
}

export class BrowserJournalController {
  private readonly registry: BrowserJournalRegistryBoundary
  private readonly events: BrowserJournalEventSource
  private readonly archive?: BrowserJournalArchiveBoundary
  private readonly createSessionId: () => string
  private readonly createSavedSessionId: () => string
  private readonly now: () => string
  private snapshot: BrowserJournalSnapshot = createEmptyBrowserJournalSnapshot()
  private lifecycleGeneration = 0
  private archiveQueue: Promise<void> = Promise.resolve()
  private lastSavedLiveSessionId: string | null = null
  private lastSavedArchiveId: string | null = null

  constructor({
    registry,
    events,
    archive,
    createSessionId = () => crypto.randomUUID(),
    createSavedSessionId = () => crypto.randomUUID(),
    now = () => new Date().toISOString(),
  }: BrowserJournalControllerOptions) {
    this.registry = registry
    this.events = events
    this.archive = archive
    this.createSessionId = createSessionId
    this.createSavedSessionId = createSavedSessionId
    this.now = now
  }

  private runArchiveExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.archiveQueue.then(operation)
    this.archiveQueue = result.then(() => undefined, () => undefined)
    return result
  }

  private async installedRecord() {
    const record = await this.registry.get(BROWSER_JOURNAL_MODULE_ID)
    return isBrowserJournalRecord(record)
      ? { ok: true, record } as const
      : { ok: false, reason: 'module-unavailable' } as const
  }

  private async availableRecord() {
    const installed = await this.installedRecord()
    if (!installed.ok)
      return installed
    return installed.record.enabled
      ? installed
      : { ok: false, reason: 'module-disabled' } as const
  }

  private async readNormalizedArchive(): Promise<BrowserJournalArchiveResult> {
    if (!this.archive)
      return { ok: false, reason: 'archive-unavailable' }
    let raw: BrowserJournalArchiveState | null
    try {
      raw = await this.archive.read()
    }
    catch {
      return { ok: false, reason: 'archive-read-failed' }
    }
    const state = normalizeBrowserJournalArchiveState(raw, this.now())
    if (raw !== null && JSON.stringify(raw) !== JSON.stringify(state)) {
      try {
        await this.archive.write(state)
      }
      catch {
        return { ok: false, reason: 'archive-write-failed' }
      }
    }
    return { ok: true, state }
  }

  private readonly acceptObservation = (observation: BrowserJournalObservation) => {
    if (this.snapshot.status !== 'recording')
      return
    const entry = normalizeBrowserJournalObservation(observation)
    if (!entry)
      return
    this.snapshot = {
      ...this.snapshot,
      entries: appendBrowserJournalEntry(this.snapshot.entries, entry),
    }
  }

  async start(): Promise<BrowserJournalStartResult> {
    if (this.snapshot.status === 'recording')
      return { ok: true, changed: false, snapshot: this.status() }
    const generation = ++this.lifecycleGeneration
    const available = await this.availableRecord()
    if (generation !== this.lifecycleGeneration)
      return { ok: false, reason: 'lifecycle-cancelled' }
    if (!available.ok)
      return available

    const startedAt = new Date(Date.parse(this.now())).toISOString()
    this.snapshot = {
      version: BROWSER_JOURNAL_SNAPSHOT_VERSION,
      status: 'recording',
      sessionId: this.createSessionId(),
      startedAt,
      stoppedAt: null,
      entries: [],
    }
    this.lastSavedLiveSessionId = null
    this.lastSavedArchiveId = null
    try {
      this.events.start(this.acceptObservation)
    }
    catch {
      this.clear()
      return { ok: false, reason: 'listener-failed' }
    }
    return { ok: true, changed: true, snapshot: this.status() }
  }

  stop(): BrowserJournalStopResult {
    const changed = this.snapshot.status === 'recording'
    if (changed) {
      this.lifecycleGeneration += 1
      this.events.stop()
      this.snapshot = {
        ...this.snapshot,
        status: 'stopped',
        stoppedAt: new Date(Date.parse(this.now())).toISOString(),
      }
    }
    return { ok: true, changed, snapshot: this.status() }
  }

  clear() {
    this.lifecycleGeneration += 1
    this.events.stop()
    this.snapshot = createEmptyBrowserJournalSnapshot()
    this.lastSavedLiveSessionId = null
    this.lastSavedArchiveId = null
  }

  status() {
    return structuredClone(this.snapshot)
  }

  startup() {
    return this.archiveState().then(() => undefined)
  }

  archiveState(): Promise<BrowserJournalArchiveResult> {
    return this.runArchiveExclusive(async () => {
      const installed = await this.installedRecord()
      if (!installed.ok)
        return installed
      return this.readNormalizedArchive()
    })
  }

  async save(): Promise<BrowserJournalSaveResult> {
    const snapshot = this.status()
    if (snapshot.status !== 'stopped' || snapshot.sessionId === null || snapshot.stoppedAt === null)
      return { ok: false, reason: 'session-not-stopped' }
    if (!snapshot.entries.length)
      return { ok: false, reason: 'session-empty' }
    const generation = this.lifecycleGeneration
    const available = await this.availableRecord()
    if (!available.ok)
      return available
    if (generation !== this.lifecycleGeneration || this.snapshot.sessionId !== snapshot.sessionId)
      return { ok: false, reason: 'lifecycle-cancelled' }

    return this.runArchiveExclusive(async () => {
      const archive = await this.readNormalizedArchive()
      if (!archive.ok)
        return archive
      if (generation !== this.lifecycleGeneration || this.snapshot.sessionId !== snapshot.sessionId)
        return { ok: false, reason: 'lifecycle-cancelled' } as const
      const previous = this.lastSavedLiveSessionId === snapshot.sessionId
        ? archive.state.sessions.find(session => session.id === this.lastSavedArchiveId)
        : null
      if (previous) {
        return {
          ok: true as const,
          changed: false,
          savedSession: structuredClone(previous),
          state: archive.state,
        }
      }
      const savedSession = createBrowserJournalSavedSession(
        snapshot,
        this.now(),
        this.createSavedSessionId(),
      )
      if (!savedSession)
        return { ok: false, reason: 'lifecycle-cancelled' } as const
      const state = normalizeBrowserJournalArchiveState({
        schemaVersion: archive.state.schemaVersion,
        sessions: [...archive.state.sessions, savedSession],
      }, savedSession.savedAt)
      try {
        await this.archive!.write(state)
      }
      catch {
        return { ok: false, reason: 'archive-write-failed' } as const
      }
      if (generation !== this.lifecycleGeneration || this.snapshot.sessionId !== snapshot.sessionId) {
        try {
          await this.archive!.write({
            ...state,
            sessions: state.sessions.filter(session => session.id !== savedSession.id),
          })
        }
        catch {}
        return { ok: false, reason: 'lifecycle-cancelled' } as const
      }
      this.lastSavedLiveSessionId = snapshot.sessionId
      this.lastSavedArchiveId = savedSession.id
      return {
        ok: true as const,
        changed: true,
        savedSession: structuredClone(savedSession),
        state,
      }
    })
  }

  deleteSavedSession(savedSessionId: string): Promise<BrowserJournalDeleteResult> {
    return this.runArchiveExclusive(async () => {
      const installed = await this.installedRecord()
      if (!installed.ok)
        return installed
      const archive = await this.readNormalizedArchive()
      if (!archive.ok)
        return archive
      const sessions = archive.state.sessions.filter(session => session.id !== savedSessionId)
      if (sessions.length === archive.state.sessions.length)
        return { ok: false, reason: 'saved-session-not-found' } as const
      const state = { ...archive.state, sessions }
      try {
        await this.archive!.write(state)
      }
      catch {
        return { ok: false, reason: 'archive-write-failed' } as const
      }
      if (this.lastSavedArchiveId === savedSessionId) {
        this.lastSavedArchiveId = null
        this.lastSavedLiveSessionId = null
      }
      return { ok: true as const, changed: true as const, state }
    })
  }

  clearArchive(confirmation: string): Promise<BrowserJournalClearArchiveResult> {
    if (confirmation !== 'clear-saved-sessions')
      return Promise.resolve({ ok: false, reason: 'invalid-clear-confirmation' })
    return this.runArchiveExclusive(async () => {
      const installed = await this.installedRecord()
      if (!installed.ok)
        return installed
      const archive = await this.readNormalizedArchive()
      if (!archive.ok)
        return archive
      const state = createEmptyBrowserJournalArchiveState()
      try {
        await this.archive!.write(state)
      }
      catch {
        return { ok: false, reason: 'archive-write-failed' } as const
      }
      this.lastSavedArchiveId = null
      this.lastSavedLiveSessionId = null
      return { ok: true as const, changed: archive.state.sessions.length > 0, state }
    })
  }

  handleInstalledRecordChanged(record: InstalledModuleRecord) {
    if (record.manifest.runtime === 'builtin'
      && record.manifest.entry_id === BROWSER_JOURNAL_ENTRY_ID
      && !record.enabled) {
      this.clear()
    }
  }

  handlePermissionsRemoved(permissions: { permissions?: string[] }) {
    if (permissions.permissions?.includes('tabs'))
      this.clear()
  }
}
