import type { InstalledModuleRecord } from '../../types'
import type {
  BookmarkDoctorOperationErrorCode,
} from './controller'
import {
  type BookmarkDoctorDeletionBackup,
  type BookmarkDoctorWorkspaceState,
  type BookmarkNodeSnapshot,
  bookmarkProbeOutcomes,
  type BookmarkRepairConfirmation,
  type BookmarkRepairExecutionResult,
  type BookmarkRepairPlan,
  type BookmarkRepairRequest,
  type BookmarkRestoreConfirmation,
  type BookmarkRestorePlan,
  type BookmarkScanPreparation,
  type BookmarkScanSnapshot,
} from './contracts'
import { normalizeBookmarkRepairRequest } from './repair'

export const BOOKMARK_DOCTOR_CHANNEL = 'oneweb.bookmark-doctor' as const
export const BOOKMARK_DOCTOR_PROTOCOL_VERSION = 3 as const

interface BookmarkDoctorRequestBase {
  channel: typeof BOOKMARK_DOCTOR_CHANNEL
  version: typeof BOOKMARK_DOCTOR_PROTOCOL_VERSION
}

export type BookmarkDoctorRequest =
  | BookmarkDoctorRequestBase & { type: 'BOOKMARK_DOCTOR_AUTHORIZE' }
  | BookmarkDoctorRequestBase & { type: 'BOOKMARK_DOCTOR_PREPARE' }
  | BookmarkDoctorRequestBase & { type: 'BOOKMARK_DOCTOR_START', token: string }
  | BookmarkDoctorRequestBase & { type: 'BOOKMARK_DOCTOR_STATUS' }
  | BookmarkDoctorRequestBase & { type: 'BOOKMARK_DOCTOR_STOP' }
  | BookmarkDoctorRequestBase & { type: 'BOOKMARK_DOCTOR_AUTHORIZE_REPAIRS' }
  | BookmarkDoctorRequestBase & { type: 'BOOKMARK_DOCTOR_PREPARE_REPAIR', request: BookmarkRepairRequest }
  | BookmarkDoctorRequestBase & { type: 'BOOKMARK_DOCTOR_CONFIRM_REPAIRS', confirmations: BookmarkRepairConfirmation[] }
  | BookmarkDoctorRequestBase & { type: 'BOOKMARK_DOCTOR_WORKSPACE_STATE' }
  | BookmarkDoctorRequestBase & { type: 'BOOKMARK_DOCTOR_UNIGNORE', bookmarkId: string }
  | BookmarkDoctorRequestBase & { type: 'BOOKMARK_DOCTOR_CLEAR_LOCAL_DATA', confirmation: 'clear-local-data' }
  | BookmarkDoctorRequestBase & { type: 'BOOKMARK_DOCTOR_PREPARE_RESTORE', backupToken: string }
  | BookmarkDoctorRequestBase & { type: 'BOOKMARK_DOCTOR_CONFIRM_RESTORE', confirmation: BookmarkRestoreConfirmation }
  | BookmarkDoctorRequestBase & { type: 'BOOKMARK_DOCTOR_REVOKE' }

export type BookmarkDoctorRequestType = BookmarkDoctorRequest['type']

export type BookmarkDoctorResult =
  | { ok: true, operation: 'authorize', record: InstalledModuleRecord }
  | { ok: false, operation: 'authorize', reason: BookmarkDoctorOperationErrorCode }
  | { ok: true, operation: 'prepare', preparation: BookmarkScanPreparation }
  | { ok: false, operation: 'prepare', reason: BookmarkDoctorOperationErrorCode }
  | { ok: true, operation: 'start', snapshot: BookmarkScanSnapshot }
  | { ok: false, operation: 'start', reason: BookmarkDoctorOperationErrorCode }
  | { ok: true, operation: 'status', snapshot: BookmarkScanSnapshot | null }
  | { ok: true, operation: 'stop', changed: boolean, snapshot: BookmarkScanSnapshot | null }
  | { ok: true, operation: 'authorize-repairs', record: InstalledModuleRecord }
  | { ok: false, operation: 'authorize-repairs', reason: BookmarkDoctorOperationErrorCode }
  | { ok: true, operation: 'prepare-repair', plan: BookmarkRepairPlan }
  | { ok: false, operation: 'prepare-repair', reason: BookmarkDoctorOperationErrorCode }
  | { ok: true, operation: 'confirm-repairs', results: BookmarkRepairExecutionResult[] }
  | { ok: true, operation: 'workspace-state', state: BookmarkDoctorWorkspaceState }
  | { ok: false, operation: 'workspace-state', reason: BookmarkDoctorOperationErrorCode }
  | { ok: true, operation: 'unignore', state: BookmarkDoctorWorkspaceState }
  | { ok: false, operation: 'unignore', reason: BookmarkDoctorOperationErrorCode }
  | { ok: true, operation: 'clear-local-data', state: BookmarkDoctorWorkspaceState }
  | { ok: false, operation: 'clear-local-data', reason: BookmarkDoctorOperationErrorCode }
  | { ok: true, operation: 'prepare-restore', plan: BookmarkRestorePlan }
  | { ok: false, operation: 'prepare-restore', reason: BookmarkDoctorOperationErrorCode }
  | { ok: true, operation: 'confirm-restore', token: string }
  | { ok: false, operation: 'confirm-restore', token: string, reason: BookmarkDoctorOperationErrorCode }
  | { ok: true, operation: 'revoke', record: InstalledModuleRecord }
  | { ok: false, operation: 'revoke', reason: BookmarkDoctorOperationErrorCode }

export interface BookmarkDoctorResponse {
  channel: typeof BOOKMARK_DOCTOR_CHANNEL
  version: typeof BOOKMARK_DOCTOR_PROTOCOL_VERSION
  type: 'BOOKMARK_DOCTOR_RESPONSE'
  requestType: BookmarkDoctorRequestType
  result: BookmarkDoctorResult
}

const errorCodes = new Set<string>([
  'module-unavailable',
  'module-disabled',
  'permission-missing',
  'permission-check-failed',
  'capability-sync-failed',
  'capability-not-granted',
  'bookmark-read-failed',
  'invalid-tree',
  'scan-active',
  'invalid-preparation',
  'origin-permission-missing',
  'scan-failed',
  'repair-unavailable',
  'write-capability-not-granted',
  'invalid-repair-request',
  'bookmark-target-not-found',
  'bookmark-target-invalid',
  'repair-plan-not-found',
  'repair-plan-expired',
  'repair-plan-stale',
  'invalid-confirmation',
  'repair-state-failed',
  'bookmark-update-failed',
  'bookmark-move-failed',
  'bookmark-delete-failed',
  'restore-backup-not-found',
  'restore-backup-stale',
  'restore-parent-invalid',
  'restore-conflict',
  'bookmark-restore-failed',
  'restore-state-failed',
  'invalid-local-data-confirmation',
  'permission-remove-failed',
] satisfies BookmarkDoctorOperationErrorCode[])
const outcomes = new Set<string>(bookmarkProbeOutcomes)

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function isToken(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 128
}

function isErrorCode(value: unknown): value is BookmarkDoctorOperationErrorCode {
  return typeof value === 'string' && errorCodes.has(value)
}

function isPreparation(value: unknown): value is BookmarkScanPreparation {
  return isRecord(value)
    && isToken(value.token)
    && Number.isSafeInteger(value.total)
    && (value.total as number) >= 0
    && Number.isSafeInteger(value.skipped)
    && (value.skipped as number) >= 0
    && Array.isArray(value.originPatterns)
    && value.originPatterns.every(origin => typeof origin === 'string' && origin.length <= 2048)
}

function isSnapshot(value: unknown): value is BookmarkScanSnapshot {
  if (!isRecord(value)
    || !isToken(value.runId)
    || !['scanning', 'completed', 'stopped'].includes(value.status as string)
    || !Number.isSafeInteger(value.total)
    || !Number.isSafeInteger(value.completed)
    || typeof value.startedAt !== 'string'
    || (value.completedAt !== null && typeof value.completedAt !== 'string')
    || !Array.isArray(value.results)) {
    return false
  }
  return value.results.every(result => isRecord(result)
    && typeof result.entryId === 'string'
    && (result.bookmarkId === null || typeof result.bookmarkId === 'string')
    && (result.parentId === null || typeof result.parentId === 'string')
    && (result.index === null || (Number.isSafeInteger(result.index) && (result.index as number) >= 0))
    && typeof result.title === 'string'
    && typeof result.url === 'string'
    && Array.isArray(result.folderPath)
    && result.folderPath.every(segment => typeof segment === 'string')
    && typeof result.outcome === 'string'
    && outcomes.has(result.outcome)
    && (result.httpStatus === null || Number.isInteger(result.httpStatus)))
}

function isNodeSnapshot(value: unknown): value is BookmarkNodeSnapshot {
  return isRecord(value)
    && isToken(value.bookmarkId)
    && (value.parentId === null || isToken(value.parentId))
    && (value.index === null || (Number.isSafeInteger(value.index) && (value.index as number) >= 0))
    && typeof value.title === 'string'
    && typeof value.url === 'string'
}

function isRepairPlan(value: unknown): value is BookmarkRepairPlan {
  if (!isRecord(value)
    || !isToken(value.token)
    || typeof value.createdAt !== 'string'
    || typeof value.expiresAt !== 'string'
    || !isNodeSnapshot(value.before)
    || !isRecord(value.proposed)) {
    return false
  }
  if (value.operation === 'update') {
    return value.confirmation === 'reviewed'
      && normalizeBookmarkRepairRequest({
        operation: 'update',
        bookmarkId: value.before.bookmarkId,
        changes: value.proposed,
      }) !== null
  }
  if (value.operation === 'move') {
    return value.confirmation === 'reviewed'
      && normalizeBookmarkRepairRequest({
        operation: 'move',
        bookmarkId: value.before.bookmarkId,
        destination: value.proposed,
      }) !== null
  }
  if (value.operation === 'ignore')
    return value.confirmation === 'reviewed' && value.proposed.ignored === true
  return value.operation === 'delete'
    && value.confirmation === 'delete-confirmed'
    && value.proposed.deleted === true
}

function isRepairConfirmation(value: unknown): value is BookmarkRepairConfirmation {
  return isRecord(value)
    && isToken(value.token)
    && (value.confirmation === 'reviewed' || value.confirmation === 'delete-confirmed')
}

function isRepairExecutionResult(value: unknown): value is BookmarkRepairExecutionResult {
  if (!isRecord(value)
    || typeof value.ok !== 'boolean'
    || !isToken(value.token)
    || (value.operation !== null && !['update', 'move', 'ignore', 'delete'].includes(value.operation as string))) {
    return false
  }
  return value.ok ? value.operation !== null : isErrorCode(value.reason)
}

function isDeletionBackup(value: unknown): value is BookmarkDoctorDeletionBackup {
  return isNodeSnapshot(value)
    && isToken((value as unknown as Record<string, unknown>).repairToken)
    && typeof (value as unknown as Record<string, unknown>).deletedAt === 'string'
}

function isWorkspaceState(value: unknown): value is BookmarkDoctorWorkspaceState {
  return isRecord(value)
    && Array.isArray(value.ignoredBookmarks)
    && value.ignoredBookmarks.every(entry => (
      isRecord(entry)
      && isToken(entry.bookmarkId)
      && typeof entry.title === 'string'
      && typeof entry.url === 'string'
      && typeof entry.ignoredAt === 'string'
    ))
    && Array.isArray(value.deletionBackups)
    && value.deletionBackups.every(isDeletionBackup)
}

function isRestorePlan(value: unknown): value is BookmarkRestorePlan {
  return isRecord(value)
    && isToken(value.token)
    && typeof value.createdAt === 'string'
    && typeof value.expiresAt === 'string'
    && value.confirmation === 'reviewed'
    && isDeletionBackup(value.backup)
}

function isRestoreConfirmation(value: unknown): value is BookmarkRestoreConfirmation {
  return isRecord(value) && isToken(value.token) && value.confirmation === 'reviewed'
}

export function isBookmarkDoctorRequest(value: unknown): value is BookmarkDoctorRequest {
  if (!isRecord(value)
    || value.channel !== BOOKMARK_DOCTOR_CHANNEL
    || value.version !== BOOKMARK_DOCTOR_PROTOCOL_VERSION) {
    return false
  }
  if (value.type === 'BOOKMARK_DOCTOR_START')
    return isToken(value.token)
  if (value.type === 'BOOKMARK_DOCTOR_PREPARE_REPAIR')
    return normalizeBookmarkRepairRequest(value.request) !== null
  if (value.type === 'BOOKMARK_DOCTOR_CONFIRM_REPAIRS') {
    return Array.isArray(value.confirmations)
      && value.confirmations.length > 0
      && value.confirmations.length <= 50
      && value.confirmations.every(isRepairConfirmation)
  }
  if (value.type === 'BOOKMARK_DOCTOR_UNIGNORE')
    return isToken(value.bookmarkId)
  if (value.type === 'BOOKMARK_DOCTOR_CLEAR_LOCAL_DATA')
    return value.confirmation === 'clear-local-data'
  if (value.type === 'BOOKMARK_DOCTOR_PREPARE_RESTORE')
    return isToken(value.backupToken)
  if (value.type === 'BOOKMARK_DOCTOR_CONFIRM_RESTORE')
    return isRestoreConfirmation(value.confirmation)
  return value.type === 'BOOKMARK_DOCTOR_AUTHORIZE'
    || value.type === 'BOOKMARK_DOCTOR_PREPARE'
    || value.type === 'BOOKMARK_DOCTOR_STATUS'
    || value.type === 'BOOKMARK_DOCTOR_STOP'
    || value.type === 'BOOKMARK_DOCTOR_AUTHORIZE_REPAIRS'
    || value.type === 'BOOKMARK_DOCTOR_WORKSPACE_STATE'
    || value.type === 'BOOKMARK_DOCTOR_REVOKE'
}

export function createBookmarkDoctorResponse(
  requestType: BookmarkDoctorRequestType,
  result: BookmarkDoctorResult,
): BookmarkDoctorResponse {
  return {
    channel: BOOKMARK_DOCTOR_CHANNEL,
    version: BOOKMARK_DOCTOR_PROTOCOL_VERSION,
    type: 'BOOKMARK_DOCTOR_RESPONSE',
    requestType,
    result,
  }
}

export function isBookmarkDoctorResponse(value: unknown): value is BookmarkDoctorResponse {
  if (!isRecord(value)
    || value.channel !== BOOKMARK_DOCTOR_CHANNEL
    || value.version !== BOOKMARK_DOCTOR_PROTOCOL_VERSION
    || value.type !== 'BOOKMARK_DOCTOR_RESPONSE'
    || !isRecord(value.result)) {
    return false
  }
  const result = value.result
  if (value.requestType === 'BOOKMARK_DOCTOR_AUTHORIZE' && result.operation === 'authorize')
    return result.ok === true ? isRecord(result.record) : result.ok === false && isErrorCode(result.reason)
  if (value.requestType === 'BOOKMARK_DOCTOR_PREPARE' && result.operation === 'prepare')
    return result.ok === true ? isPreparation(result.preparation) : result.ok === false && isErrorCode(result.reason)
  if (value.requestType === 'BOOKMARK_DOCTOR_START' && result.operation === 'start')
    return result.ok === true ? isSnapshot(result.snapshot) : result.ok === false && isErrorCode(result.reason)
  if (value.requestType === 'BOOKMARK_DOCTOR_STATUS' && result.operation === 'status')
    return result.ok === true && (result.snapshot === null || isSnapshot(result.snapshot))
  if (value.requestType === 'BOOKMARK_DOCTOR_STOP' && result.operation === 'stop') {
    return result.ok === true
      && typeof result.changed === 'boolean'
      && (result.snapshot === null || isSnapshot(result.snapshot))
  }
  if (value.requestType === 'BOOKMARK_DOCTOR_AUTHORIZE_REPAIRS' && result.operation === 'authorize-repairs')
    return result.ok === true ? isRecord(result.record) : result.ok === false && isErrorCode(result.reason)
  if (value.requestType === 'BOOKMARK_DOCTOR_PREPARE_REPAIR' && result.operation === 'prepare-repair')
    return result.ok === true ? isRepairPlan(result.plan) : result.ok === false && isErrorCode(result.reason)
  if (value.requestType === 'BOOKMARK_DOCTOR_CONFIRM_REPAIRS' && result.operation === 'confirm-repairs') {
    return result.ok === true
      && Array.isArray(result.results)
      && result.results.every(isRepairExecutionResult)
  }
  if (value.requestType === 'BOOKMARK_DOCTOR_WORKSPACE_STATE' && result.operation === 'workspace-state')
    return result.ok === true ? isWorkspaceState(result.state) : result.ok === false && isErrorCode(result.reason)
  if (value.requestType === 'BOOKMARK_DOCTOR_UNIGNORE' && result.operation === 'unignore')
    return result.ok === true ? isWorkspaceState(result.state) : result.ok === false && isErrorCode(result.reason)
  if (value.requestType === 'BOOKMARK_DOCTOR_CLEAR_LOCAL_DATA' && result.operation === 'clear-local-data')
    return result.ok === true ? isWorkspaceState(result.state) : result.ok === false && isErrorCode(result.reason)
  if (value.requestType === 'BOOKMARK_DOCTOR_PREPARE_RESTORE' && result.operation === 'prepare-restore')
    return result.ok === true ? isRestorePlan(result.plan) : result.ok === false && isErrorCode(result.reason)
  if (value.requestType === 'BOOKMARK_DOCTOR_CONFIRM_RESTORE' && result.operation === 'confirm-restore') {
    return isToken(result.token)
      && (result.ok === true || (result.ok === false && isErrorCode(result.reason)))
  }
  if (value.requestType === 'BOOKMARK_DOCTOR_REVOKE' && result.operation === 'revoke')
    return result.ok === true ? isRecord(result.record) : result.ok === false && isErrorCode(result.reason)
  return false
}
