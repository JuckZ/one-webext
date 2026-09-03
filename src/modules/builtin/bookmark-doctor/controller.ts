import type { ModuleLocalStateStore } from '../../module-state'
import type { SetModuleCapabilityGrantResult } from '../../registry'
import type { InstalledModuleRecord, ModuleCapabilityId } from '../../types'
import type {
  BookmarkDoctorLocalState,
  BookmarkDoctorReadResult,
  BookmarkDoctorWorkspaceState,
  BookmarkRepairConfirmation,
  BookmarkRepairExecutionResult,
  BookmarkRepairFailureReason,
  BookmarkRepairPlan,
  BookmarkRestoreConfirmation,
  BookmarkRestorePlan,
  BookmarkScanPreparation,
  BookmarkScanSnapshot,
  NormalizedBookmarkEntry,
} from './contracts'
import type { BookmarkMutationBoundary } from './repair-boundary'
import type { BookmarkScanCoordinator } from './scanner'
import {
  BOOKMARK_DOCTOR_DELETION_BACKUP_LIMIT,
  BOOKMARK_DOCTOR_ENTRY_ID,
  BOOKMARK_DOCTOR_MODULE_ID,
  BOOKMARK_DOCTOR_REPAIR_PLAN_TTL_MS,
} from './contracts'
import {
  bookmarkNodeSnapshotsEqual,
  createBookmarkRepairPlan,
  isBookmarkRepairConfirmationValid,
  isBookmarkRepairPlanExpired,
  normalizeBookmarkRepairRequest,
  readBookmarkNodeSnapshot,
} from './repair'
import { createEmptyBookmarkDoctorState, normalizeBookmarkDoctorState } from './state'

export type BookmarkDoctorOperationErrorCode =
  | BookmarkRepairFailureReason
  | 'capability-sync-failed'
  | 'invalid-preparation'
  | 'origin-permission-missing'
  | 'scan-failed'

export interface BookmarkDoctorRegistryBoundary {
  get: (_moduleId: string) => Promise<InstalledModuleRecord | null>
  list?: () => Promise<InstalledModuleRecord[]>
  setCapabilityGrant: (
    _moduleId: string,
    _capability: ModuleCapabilityId,
    _granted: boolean,
  ) => Promise<SetModuleCapabilityGrantResult>
}

export interface BookmarkDoctorPermissionBoundary {
  contains: (_permissions: { permissions?: Array<'bookmarks'>, origins?: string[] }) => Promise<boolean>
  remove?: (_permissions: { permissions?: Array<'bookmarks'>, origins?: string[] }) => Promise<boolean>
}

export interface BookmarkDoctorReadBoundary {
  read: () => Promise<BookmarkDoctorReadResult>
}

export interface BookmarkDoctorRepairBoundary {
  bookmarks: BookmarkMutationBoundary
  state: Pick<ModuleLocalStateStore<BookmarkDoctorLocalState>, 'read' | 'write'>
}

export interface BookmarkDoctorControllerOptions {
  registry: BookmarkDoctorRegistryBoundary
  permissions: BookmarkDoctorPermissionBoundary
  reader: BookmarkDoctorReadBoundary
  scanner: BookmarkScanCoordinator
  repair?: BookmarkDoctorRepairBoundary
  createPreparationToken?: () => string
  createRepairToken?: () => string
  createRestoreToken?: () => string
  now?: () => string
  originInUse?: (_originPattern: string) => boolean | Promise<boolean>
}

export type BookmarkDoctorAuthorizeResult =
  | { ok: true, record: InstalledModuleRecord }
  | { ok: false, reason: BookmarkDoctorOperationErrorCode }

export type BookmarkDoctorPrepareResult =
  | { ok: true, preparation: BookmarkScanPreparation }
  | { ok: false, reason: BookmarkDoctorOperationErrorCode }

export type BookmarkDoctorStartResult =
  | { ok: true, snapshot: BookmarkScanSnapshot }
  | { ok: false, reason: BookmarkDoctorOperationErrorCode }

export type BookmarkDoctorPrepareRepairResult =
  | { ok: true, plan: BookmarkRepairPlan }
  | { ok: false, reason: BookmarkDoctorOperationErrorCode }

export interface BookmarkDoctorConfirmRepairsResult {
  ok: true
  results: BookmarkRepairExecutionResult[]
}

export type BookmarkDoctorWorkspaceStateResult =
  | { ok: true, state: BookmarkDoctorWorkspaceState }
  | { ok: false, reason: BookmarkDoctorOperationErrorCode }

export type BookmarkDoctorRestoreResult =
  | { ok: true, plan: BookmarkRestorePlan }
  | { ok: false, reason: BookmarkDoctorOperationErrorCode }

export type BookmarkDoctorConfirmRestoreResult =
  | { ok: true, token: string }
  | { ok: false, token: string, reason: BookmarkDoctorOperationErrorCode }

interface PrivatePreparation extends BookmarkScanPreparation {
  entries: NormalizedBookmarkEntry[]
  preExistingOriginPatterns: string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function isBookmarkDoctorRecord(record: InstalledModuleRecord | null): record is InstalledModuleRecord {
  return Boolean(
    record
    && record.manifest.id === BOOKMARK_DOCTOR_MODULE_ID
    && record.source === 'seeded'
    && record.manifest.runtime === 'builtin'
    && record.manifest.entry_id === BOOKMARK_DOCTOR_ENTRY_ID,
  )
}

function validLocalId(value: unknown) {
  return typeof value === 'string' && value.length > 0 && value.length <= 128
}

function exactOriginPattern(url: string) {
  const parsed = new URL(url)
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
    return null
  return `${parsed.origin}/*`
}

function readFailureReason(result: Exclude<BookmarkDoctorReadResult, { status: 'ready' }>): BookmarkDoctorOperationErrorCode {
  const code = result.error.code
  if (code === 'module-unavailable'
    || code === 'module-disabled'
    || code === 'capability-not-granted'
    || code === 'permission-missing'
    || code === 'permission-check-failed'
    || code === 'bookmark-read-failed'
    || code === 'invalid-tree') {
    return code
  }
  return 'bookmark-read-failed'
}

export class BookmarkDoctorController {
  private readonly registry: BookmarkDoctorRegistryBoundary
  private readonly permissions: BookmarkDoctorPermissionBoundary
  private readonly reader: BookmarkDoctorReadBoundary
  private readonly scanner: BookmarkScanCoordinator
  private readonly repair?: BookmarkDoctorRepairBoundary
  private readonly createPreparationToken: () => string
  private readonly createRepairToken: () => string
  private readonly createRestoreToken: () => string
  private readonly now: () => string
  private originInUse: (_originPattern: string) => boolean | Promise<boolean>
  private preparation: PrivatePreparation | null = null
  private readonly repairPlans = new Map<string, BookmarkRepairPlan>()
  private readonly restorePlans = new Map<string, BookmarkRestorePlan>()
  private readonly ownedScanOrigins = new Set<string>()
  private repairQueue: Promise<void> = Promise.resolve()
  private repairGeneration = 0

  constructor({
    registry,
    permissions,
    reader,
    scanner,
    repair,
    createPreparationToken = () => crypto.randomUUID(),
    createRepairToken = () => crypto.randomUUID(),
    createRestoreToken = () => crypto.randomUUID(),
    now = () => new Date().toISOString(),
    originInUse = () => false,
  }: BookmarkDoctorControllerOptions) {
    this.registry = registry
    this.permissions = permissions
    this.reader = reader
    this.scanner = scanner
    this.repair = repair
    this.createPreparationToken = createPreparationToken
    this.createRepairToken = createRepairToken
    this.createRestoreToken = createRestoreToken
    this.now = now
    this.originInUse = originInUse
  }

  private runRepairExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.repairQueue.then(operation)
    this.repairQueue = result.then(() => undefined, () => undefined)
    return result
  }

  private async availableRecord() {
    const installed = await this.installedRecord()
    if (!installed.ok)
      return installed
    if (!installed.record.enabled)
      return { ok: false, reason: 'module-disabled' } as const
    return installed
  }

  private async installedRecord() {
    const record = await this.registry.get(BOOKMARK_DOCTOR_MODULE_ID)
    if (!isBookmarkDoctorRecord(record))
      return { ok: false, reason: 'module-unavailable' } as const
    return { ok: true, record } as const
  }

  private async releaseOwnedScanOrigins() {
    if (!this.ownedScanOrigins.size || !this.permissions.remove)
      return
    const shared = new Set<string>()
    if (this.registry.list) {
      try {
        for (const record of await this.registry.list()) {
          if (record.source !== 'user' || record.manifest.runtime !== 'remote-frame')
            continue
          for (const url of [record.sourceUrl, record.manifest.entry_url, record.manifest.icon_url]) {
            if (!url)
              continue
            const pattern = exactOriginPattern(url)
            if (pattern)
              shared.add(pattern)
          }
        }
      }
      catch {
        return
      }
    }
    for (const pattern of shared)
      this.ownedScanOrigins.delete(pattern)
    const removable: string[] = []
    for (const pattern of this.ownedScanOrigins) {
      if (shared.has(pattern))
        continue
      try {
        if (!await this.originInUse(pattern))
          removable.push(pattern)
      }
      catch {
        // A failed usage probe retains the grant conservatively.
      }
    }
    if (!removable.length)
      return
    try {
      if (await this.permissions.remove({ origins: removable })) {
        for (const pattern of removable)
          this.ownedScanOrigins.delete(pattern)
      }
    }
    catch {}
  }

  private async repairRecord() {
    const available = await this.availableRecord()
    if (!available.ok)
      return available
    const declaredCapabilities = available.record.manifest.capabilities as readonly ModuleCapabilityId[]
    if (!declaredCapabilities.includes('bookmarks.read')
      || !available.record.grantedCapabilities.includes('bookmarks.read')) {
      return { ok: false, reason: 'capability-not-granted' } as const
    }
    if (!declaredCapabilities.includes('bookmarks.write')
      || !available.record.grantedCapabilities.includes('bookmarks.write')) {
      return { ok: false, reason: 'write-capability-not-granted' } as const
    }
    try {
      if (!await this.permissions.contains({ permissions: ['bookmarks'] }))
        return { ok: false, reason: 'permission-missing' } as const
    }
    catch {
      return { ok: false, reason: 'permission-check-failed' } as const
    }
    return available
  }

  async authorize(): Promise<BookmarkDoctorAuthorizeResult> {
    const available = await this.availableRecord()
    if (!available.ok)
      return available

    let granted: boolean
    try {
      granted = await this.permissions.contains({ permissions: ['bookmarks'] })
    }
    catch {
      return { ok: false, reason: 'permission-check-failed' }
    }
    if (!granted)
      return { ok: false, reason: 'permission-missing' }

    const result = await this.registry.setCapabilityGrant(
      BOOKMARK_DOCTOR_MODULE_ID,
      'bookmarks.read',
      true,
    )
    return result.ok
      ? { ok: true, record: result.record }
      : { ok: false, reason: 'capability-sync-failed' }
  }

  async authorizeRepairs(): Promise<BookmarkDoctorAuthorizeResult> {
    const available = await this.availableRecord()
    if (!available.ok)
      return available
    if (!available.record.grantedCapabilities.includes('bookmarks.read'))
      return { ok: false, reason: 'capability-not-granted' }
    let granted: boolean
    try {
      granted = await this.permissions.contains({ permissions: ['bookmarks'] })
    }
    catch {
      return { ok: false, reason: 'permission-check-failed' }
    }
    if (!granted)
      return { ok: false, reason: 'permission-missing' }
    const result = await this.registry.setCapabilityGrant(
      BOOKMARK_DOCTOR_MODULE_ID,
      'bookmarks.write',
      true,
    )
    return result.ok
      ? { ok: true, record: result.record }
      : { ok: false, reason: 'capability-sync-failed' }
  }

  async prepare(): Promise<BookmarkDoctorPrepareResult> {
    if (this.scanner.isScanning())
      return { ok: false, reason: 'scan-active' }
    const read = await this.reader.read()
    if (read.status !== 'ready')
      return { ok: false, reason: readFailureReason(read) }

    let ignoredBookmarks = new Set<string>()
    if (this.repair) {
      try {
        const state = normalizeBookmarkDoctorState(await this.repair.state.read())
        ignoredBookmarks = new Set(state.ignoredBookmarks.map(entry => entry.bookmarkId))
      }
      catch {
        return { ok: false, reason: 'repair-state-failed' }
      }
    }
    const entries = read.entries.filter(entry => (
      entry.urlClassification.eligibility === 'scannable'
      && typeof entry.urlClassification.normalizedUrl === 'string'
      && (entry.bookmarkId === null || !ignoredBookmarks.has(entry.bookmarkId))
    ))
    const originPatterns = [...new Set(entries.flatMap((entry) => {
      const pattern = exactOriginPattern(entry.urlClassification.normalizedUrl!)
      return pattern ? [pattern] : []
    }))].sort()
    let preExistingOriginPatterns: string[]
    try {
      const states = await Promise.all(originPatterns.map(async pattern => (
        await this.permissions.contains({ origins: [pattern] }) ? pattern : null
      )))
      preExistingOriginPatterns = states.filter((pattern): pattern is string => pattern !== null)
    }
    catch {
      return { ok: false, reason: 'permission-check-failed' }
    }
    const preparation: PrivatePreparation = {
      token: this.createPreparationToken(),
      total: entries.length,
      skipped: read.entries.length - entries.length,
      originPatterns,
      preExistingOriginPatterns,
      entries,
    }
    this.preparation = preparation
    return {
      ok: true,
      preparation: {
        token: preparation.token,
        total: preparation.total,
        skipped: preparation.skipped,
        originPatterns: [...preparation.originPatterns],
      },
    }
  }

  async start(token: string): Promise<BookmarkDoctorStartResult> {
    const preparation = this.preparation
    if (!preparation || preparation.token !== token)
      return { ok: false, reason: 'invalid-preparation' }
    if (this.scanner.isScanning())
      return { ok: false, reason: 'scan-active' }

    const available = await this.availableRecord()
    if (!available.ok)
      return available
    if (!available.record.grantedCapabilities.includes('bookmarks.read'))
      return { ok: false, reason: 'capability-not-granted' }

    let hasBookmarks: boolean
    let hasOrigins: boolean
    try {
      [hasBookmarks, hasOrigins] = await Promise.all([
        this.permissions.contains({ permissions: ['bookmarks'] }),
        preparation.originPatterns.length
          ? this.permissions.contains({ origins: preparation.originPatterns })
          : Promise.resolve(true),
      ])
    }
    catch {
      return { ok: false, reason: 'permission-check-failed' }
    }
    if (!hasBookmarks)
      return { ok: false, reason: 'permission-missing' }
    if (!hasOrigins)
      return { ok: false, reason: 'origin-permission-missing' }

    this.preparation = null
    for (const pattern of preparation.originPatterns) {
      if (!preparation.preExistingOriginPatterns.includes(pattern))
        this.ownedScanOrigins.add(pattern)
    }
    try {
      return { ok: true, snapshot: await this.scanner.start(preparation.entries) }
    }
    catch {
      return { ok: false, reason: 'scan-failed' }
    }
    finally {
      await this.releaseOwnedScanOrigins()
    }
  }

  prepareRepair(value: unknown): Promise<BookmarkDoctorPrepareRepairResult> {
    return this.runRepairExclusive(async () => {
      const generation = this.repairGeneration
      if (!this.repair)
        return { ok: false, reason: 'repair-unavailable' }
      if (this.scanner.isScanning())
        return { ok: false, reason: 'scan-active' }
      const request = normalizeBookmarkRepairRequest(value)
      if (!request)
        return { ok: false, reason: 'invalid-repair-request' }
      const available = await this.repairRecord()
      if (!available.ok)
        return available

      let rawTarget: unknown
      try {
        rawTarget = await this.repair.bookmarks.get(request.bookmarkId)
      }
      catch {
        return { ok: false, reason: 'bookmark-target-not-found' }
      }
      if (Array.isArray(rawTarget) && rawTarget.length === 0)
        return { ok: false, reason: 'bookmark-target-not-found' }
      const before = readBookmarkNodeSnapshot(rawTarget)
      if (!before)
        return { ok: false, reason: 'bookmark-target-invalid' }

      if (request.operation === 'move') {
        let destination: unknown
        try {
          destination = await this.repair.bookmarks.get(request.destination.parentId)
        }
        catch {
          return { ok: false, reason: 'bookmark-target-not-found' }
        }
        const folder = Array.isArray(destination) && destination.length === 1 && isRecord(destination[0])
          ? destination[0]
          : null
        if (!folder || typeof folder.id !== 'string' || Object.hasOwn(folder, 'url'))
          return { ok: false, reason: 'bookmark-target-invalid' }
      }

      if (generation !== this.repairGeneration)
        return { ok: false, reason: 'repair-plan-stale' }

      const now = this.now()
      for (const [token, plan] of this.repairPlans) {
        if (isBookmarkRepairPlanExpired(plan, now))
          this.repairPlans.delete(token)
      }
      const plan = createBookmarkRepairPlan(request, before, this.createRepairToken(), now)
      if (!plan)
        return { ok: false, reason: 'invalid-repair-request' }
      this.repairPlans.set(plan.token, plan)
      while (this.repairPlans.size > 100)
        this.repairPlans.delete(this.repairPlans.keys().next().value!)
      return { ok: true, plan: structuredClone(plan) }
    })
  }

  confirmRepairs(confirmations: BookmarkRepairConfirmation[]): Promise<BookmarkDoctorConfirmRepairsResult> {
    return this.runRepairExclusive(async () => {
      const results: BookmarkRepairExecutionResult[] = []
      for (const confirmation of confirmations)
        results.push(await this.executeRepair(confirmation))
      return { ok: true, results }
    })
  }

  workspaceState(): Promise<BookmarkDoctorWorkspaceStateResult> {
    return this.runRepairExclusive(async () => {
      if (!this.repair)
        return { ok: false, reason: 'repair-unavailable' }
      const installed = await this.installedRecord()
      if (!installed.ok)
        return installed
      try {
        const state = normalizeBookmarkDoctorState(await this.repair.state.read())
        return {
          ok: true,
          state: {
            ignoredBookmarks: structuredClone(state.ignoredBookmarks),
            deletionBackups: structuredClone(state.deletionBackups),
          },
        }
      }
      catch {
        return { ok: false, reason: 'repair-state-failed' }
      }
    })
  }

  unignore(bookmarkId: string): Promise<BookmarkDoctorWorkspaceStateResult> {
    return this.runRepairExclusive(async () => {
      if (!validLocalId(bookmarkId))
        return { ok: false, reason: 'invalid-repair-request' }
      const available = await this.repairRecord()
      if (!available.ok)
        return available
      if (!this.repair)
        return { ok: false, reason: 'repair-unavailable' }
      try {
        const state = normalizeBookmarkDoctorState(await this.repair.state.read())
        state.ignoredBookmarks = state.ignoredBookmarks.filter(entry => entry.bookmarkId !== bookmarkId)
        await this.repair.state.write(state)
        return {
          ok: true,
          state: {
            ignoredBookmarks: structuredClone(state.ignoredBookmarks),
            deletionBackups: structuredClone(state.deletionBackups),
          },
        }
      }
      catch {
        return { ok: false, reason: 'repair-state-failed' }
      }
    })
  }

  clearLocalData(confirmation: string): Promise<BookmarkDoctorWorkspaceStateResult> {
    return this.runRepairExclusive(async () => {
      if (confirmation !== 'clear-local-data')
        return { ok: false, reason: 'invalid-local-data-confirmation' }
      const installed = await this.installedRecord()
      if (!installed.ok)
        return installed
      if (!this.repair)
        return { ok: false, reason: 'repair-unavailable' }
      try {
        await this.repair.state.write(createEmptyBookmarkDoctorState())
        return { ok: true, state: { ignoredBookmarks: [], deletionBackups: [] } }
      }
      catch {
        return { ok: false, reason: 'repair-state-failed' }
      }
    })
  }

  prepareRestore(backupToken: string): Promise<BookmarkDoctorRestoreResult> {
    return this.runRepairExclusive(async () => {
      const generation = this.repairGeneration
      if (!validLocalId(backupToken))
        return { ok: false, reason: 'restore-backup-not-found' }
      const available = await this.repairRecord()
      if (!available.ok)
        return available
      if (!this.repair)
        return { ok: false, reason: 'repair-unavailable' }
      let state: BookmarkDoctorLocalState
      try {
        state = normalizeBookmarkDoctorState(await this.repair.state.read())
      }
      catch {
        return { ok: false, reason: 'repair-state-failed' }
      }
      const backup = state.deletionBackups.find(entry => entry.repairToken === backupToken)
      if (!backup)
        return { ok: false, reason: 'restore-backup-not-found' }
      const destination = await this.validateRestoreDestination(backup)
      if (!destination.ok)
        return destination
      if (generation !== this.repairGeneration)
        return { ok: false, reason: 'restore-backup-stale' }
      const createdAt = Date.parse(this.now())
      const token = this.createRestoreToken()
      if (!validLocalId(token) || !Number.isFinite(createdAt))
        return { ok: false, reason: 'repair-unavailable' }
      const plan: BookmarkRestorePlan = {
        token,
        createdAt: new Date(createdAt).toISOString(),
        expiresAt: new Date(createdAt + BOOKMARK_DOCTOR_REPAIR_PLAN_TTL_MS).toISOString(),
        backup: structuredClone(backup),
        confirmation: 'reviewed',
      }
      this.restorePlans.set(token, plan)
      while (this.restorePlans.size > 100)
        this.restorePlans.delete(this.restorePlans.keys().next().value!)
      return { ok: true, plan: structuredClone(plan) }
    })
  }

  confirmRestore(confirmation: BookmarkRestoreConfirmation): Promise<BookmarkDoctorConfirmRestoreResult> {
    return this.runRepairExclusive(async () => {
      const plan = this.restorePlans.get(confirmation.token)
      if (!plan)
        return { ok: false, token: confirmation.token, reason: 'restore-backup-not-found' }
      this.restorePlans.delete(plan.token)
      const generation = this.repairGeneration
      if (confirmation.confirmation !== plan.confirmation
        || isBookmarkRepairPlanExpired(plan, this.now())) {
        return { ok: false, token: plan.token, reason: 'restore-backup-stale' }
      }
      const available = await this.repairRecord()
      if (!available.ok)
        return { ok: false, token: plan.token, reason: available.reason }
      if (!this.repair)
        return { ok: false, token: plan.token, reason: 'repair-unavailable' }
      let state: BookmarkDoctorLocalState
      try {
        state = normalizeBookmarkDoctorState(await this.repair.state.read())
      }
      catch {
        return { ok: false, token: plan.token, reason: 'repair-state-failed' }
      }
      const backup = state.deletionBackups.find(entry => entry.repairToken === plan.backup.repairToken)
      if (!backup || JSON.stringify(backup) !== JSON.stringify(plan.backup))
        return { ok: false, token: plan.token, reason: 'restore-backup-stale' }
      const destination = await this.validateRestoreDestination(backup)
      if (!destination.ok)
        return { ok: false, token: plan.token, reason: destination.reason }
      if (generation !== this.repairGeneration)
        return { ok: false, token: plan.token, reason: 'restore-backup-stale' }
      try {
        await this.repair.bookmarks.create({
          parentId: backup.parentId!,
          ...(backup.index === null ? {} : { index: backup.index }),
          title: backup.title,
          url: backup.url,
        })
      }
      catch {
        return { ok: false, token: plan.token, reason: 'bookmark-restore-failed' }
      }
      state.deletionBackups = state.deletionBackups.filter(entry => entry.repairToken !== backup.repairToken)
      try {
        await this.repair.state.write(state)
      }
      catch {
        return { ok: false, token: plan.token, reason: 'restore-state-failed' }
      }
      return { ok: true, token: plan.token }
    })
  }

  private async validateRestoreDestination(backup: BookmarkDoctorLocalState['deletionBackups'][number]) {
    if (!this.repair || !backup.parentId)
      return { ok: false, reason: 'restore-parent-invalid' } as const
    let parent: unknown
    let children: unknown
    try {
      [parent, children] = await Promise.all([
        this.repair.bookmarks.get(backup.parentId),
        this.repair.bookmarks.getChildren(backup.parentId),
      ])
    }
    catch {
      return { ok: false, reason: 'restore-parent-invalid' } as const
    }
    const folder = Array.isArray(parent) && parent.length === 1 && isRecord(parent[0]) ? parent[0] : null
    if (!folder || folder.id !== backup.parentId || Object.hasOwn(folder, 'url') || !Array.isArray(children))
      return { ok: false, reason: 'restore-parent-invalid' } as const
    const conflict = children.some(child => (
      isRecord(child)
      && child.title === backup.title
      && child.url === backup.url
    ))
    return conflict
      ? { ok: false, reason: 'restore-conflict' } as const
      : { ok: true } as const
  }

  private async executeRepair(confirmation: BookmarkRepairConfirmation): Promise<BookmarkRepairExecutionResult> {
    const plan = this.repairPlans.get(confirmation.token)
    if (!plan) {
      return {
        ok: false,
        token: confirmation.token,
        operation: null,
        reason: 'repair-plan-not-found',
      }
    }
    this.repairPlans.delete(plan.token)
    const generation = this.repairGeneration
    if (isBookmarkRepairPlanExpired(plan, this.now()))
      return { ok: false, token: plan.token, operation: plan.operation, reason: 'repair-plan-expired' }
    if (!isBookmarkRepairConfirmationValid(plan, confirmation))
      return { ok: false, token: plan.token, operation: plan.operation, reason: 'invalid-confirmation' }
    if (!this.repair)
      return { ok: false, token: plan.token, operation: plan.operation, reason: 'repair-unavailable' }
    const available = await this.repairRecord()
    if (!available.ok)
      return { ok: false, token: plan.token, operation: plan.operation, reason: available.reason }

    let rawTarget: unknown
    try {
      rawTarget = await this.repair.bookmarks.get(plan.before.bookmarkId)
    }
    catch {
      return { ok: false, token: plan.token, operation: plan.operation, reason: 'repair-plan-stale' }
    }
    const current = readBookmarkNodeSnapshot(rawTarget)
    if (generation !== this.repairGeneration
      || !current
      || !bookmarkNodeSnapshotsEqual(current, plan.before)) {
      return { ok: false, token: plan.token, operation: plan.operation, reason: 'repair-plan-stale' }
    }

    if (plan.operation === 'ignore') {
      const persisted = await this.persistRepairState((state) => {
        state.ignoredBookmarks = [
          ...state.ignoredBookmarks.filter(entry => entry.bookmarkId !== plan.before.bookmarkId),
          {
            bookmarkId: plan.before.bookmarkId,
            title: plan.before.title,
            url: plan.before.url,
            ignoredAt: this.now(),
          },
        ].slice(-BOOKMARK_DOCTOR_DELETION_BACKUP_LIMIT)
      })
      return persisted
        ? { ok: true, token: plan.token, operation: plan.operation }
        : { ok: false, token: plan.token, operation: plan.operation, reason: 'repair-state-failed' }
    }

    if (plan.operation === 'delete') {
      const persisted = await this.persistRepairState((state) => {
        state.deletionBackups = [
          ...state.deletionBackups,
          { ...plan.before, repairToken: plan.token, deletedAt: this.now() },
        ].slice(-BOOKMARK_DOCTOR_DELETION_BACKUP_LIMIT)
      })
      if (!persisted)
        return { ok: false, token: plan.token, operation: plan.operation, reason: 'repair-state-failed' }
      const stillAvailable = await this.repairRecord()
      if (!stillAvailable.ok)
        return { ok: false, token: plan.token, operation: plan.operation, reason: stillAvailable.reason }
      if (generation !== this.repairGeneration)
        return { ok: false, token: plan.token, operation: plan.operation, reason: 'repair-plan-stale' }
      try {
        await this.repair.bookmarks.remove(plan.before.bookmarkId)
        return { ok: true, token: plan.token, operation: plan.operation }
      }
      catch {
        return { ok: false, token: plan.token, operation: plan.operation, reason: 'bookmark-delete-failed' }
      }
    }

    try {
      if (plan.operation === 'update')
        await this.repair.bookmarks.update(plan.before.bookmarkId, plan.proposed)
      else
        await this.repair.bookmarks.move(plan.before.bookmarkId, plan.proposed)
      return { ok: true, token: plan.token, operation: plan.operation }
    }
    catch {
      return {
        ok: false,
        token: plan.token,
        operation: plan.operation,
        reason: plan.operation === 'update' ? 'bookmark-update-failed' : 'bookmark-move-failed',
      }
    }
  }

  private async persistRepairState(mutator: (_state: BookmarkDoctorLocalState) => void) {
    if (!this.repair)
      return false
    try {
      const state = normalizeBookmarkDoctorState(await this.repair.state.read())
      mutator(state)
      await this.repair.state.write(state)
      return true
    }
    catch {
      return false
    }
  }

  status() {
    return this.scanner.getSnapshot()
  }

  usesOriginPattern(pattern: string) {
    return this.preparation?.originPatterns.includes(pattern) === true
      || this.ownedScanOrigins.has(pattern)
  }

  setOriginInUse(probe: (_originPattern: string) => boolean | Promise<boolean>) {
    this.originInUse = probe
  }

  async stop() {
    const changed = this.scanner.stop()
    await this.releaseOwnedScanOrigins()
    return { changed, snapshot: this.scanner.getSnapshot() }
  }

  revoke(): Promise<BookmarkDoctorAuthorizeResult> {
    return this.runRepairExclusive(async () => {
      const installed = await this.installedRecord()
      if (!installed.ok)
        return installed
      this.repairGeneration += 1
      this.preparation = null
      this.repairPlans.clear()
      this.restorePlans.clear()
      this.scanner.stop()
      await this.releaseOwnedScanOrigins()
      let permissionRemoved = true
      if (this.permissions.remove) {
        try {
          await this.permissions.remove({ permissions: ['bookmarks'] })
          permissionRemoved = !await this.permissions.contains({ permissions: ['bookmarks'] })
        }
        catch {
          permissionRemoved = false
        }
      }
      else {
        permissionRemoved = false
      }
      const grantResults = await Promise.allSettled([
        this.registry.setCapabilityGrant(BOOKMARK_DOCTOR_MODULE_ID, 'bookmarks.read', false),
        this.registry.setCapabilityGrant(BOOKMARK_DOCTOR_MODULE_ID, 'bookmarks.write', false),
      ])
      if (grantResults.some(result => result.status === 'rejected' || !result.value.ok))
        return { ok: false, reason: 'capability-sync-failed' }
      if (!permissionRemoved)
        return { ok: false, reason: 'permission-remove-failed' }
      const current = await this.registry.get(BOOKMARK_DOCTOR_MODULE_ID)
      return isBookmarkDoctorRecord(current)
        ? { ok: true, record: current }
        : { ok: false, reason: 'module-unavailable' }
    })
  }

  handleInstalledRecordChanged(record: InstalledModuleRecord) {
    if (record.manifest.runtime === 'builtin'
      && record.manifest.entry_id === BOOKMARK_DOCTOR_ENTRY_ID
      && !record.enabled) {
      this.repairGeneration += 1
      this.preparation = null
      this.repairPlans.clear()
      this.restorePlans.clear()
      this.scanner.stop()
      void this.releaseOwnedScanOrigins()
    }
  }

  async handlePermissionsRemoved(removed: { permissions?: string[], origins?: string[] }) {
    const bookmarkPermissionRemoved = removed.permissions?.includes('bookmarks') || false
    const preparedOriginRemoved = Boolean(removed.origins?.some(origin => this.preparation?.originPatterns.includes(origin)))
    if (!bookmarkPermissionRemoved && !preparedOriginRemoved)
      return

    this.repairGeneration += 1
    this.preparation = null
    this.repairPlans.clear()
    this.restorePlans.clear()
    this.scanner.stop()
    await this.releaseOwnedScanOrigins()
    if (bookmarkPermissionRemoved) {
      await Promise.allSettled([
        this.registry.setCapabilityGrant(
          BOOKMARK_DOCTOR_MODULE_ID,
          'bookmarks.read',
          false,
        ),
        this.registry.setCapabilityGrant(
          BOOKMARK_DOCTOR_MODULE_ID,
          'bookmarks.write',
          false,
        ),
      ])
    }
  }
}
