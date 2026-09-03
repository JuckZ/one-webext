export const BOOKMARK_DOCTOR_MODULE_ID = 'dev.oneweb.bookmark-doctor' as const
export const BOOKMARK_DOCTOR_ENTRY_ID = 'bookmark-doctor' as const
export const BOOKMARK_DOCTOR_STATE_SCHEMA_VERSION = 2 as const
export const BOOKMARK_DOCTOR_SCAN_CONCURRENCY = 4 as const
export const BOOKMARK_DOCTOR_PROBE_TIMEOUT_MS = 8_000 as const
export const BOOKMARK_DOCTOR_REPAIR_PLAN_TTL_MS = 120_000 as const
export const BOOKMARK_DOCTOR_DELETION_BACKUP_LIMIT = 100 as const

export interface BookmarkTreeNodeInput {
  id?: unknown
  parentId?: unknown
  title?: unknown
  url?: unknown
  index?: unknown
  dateAdded?: unknown
  children?: unknown
}

export type BookmarkUrlReason =
  | 'http'
  | 'https'
  | 'missing'
  | 'invalid'
  | 'browser-internal'
  | 'local-resource'
  | 'loopback'
  | 'unsupported-scheme'

export interface BookmarkUrlClassification {
  eligibility: 'scannable' | 'unscannable'
  reason: BookmarkUrlReason
  normalizedUrl: string | null
}

export interface NormalizedBookmarkEntry {
  entryId: string
  bookmarkId: string | null
  parentId: string | null
  title: string
  url: string | null
  folderPath: string[]
  treePath: number[]
  dateAdded: number | null
  urlClassification: BookmarkUrlClassification
}

export type BookmarkTreeDiagnosticCode =
  | 'invalid-tree'
  | 'malformed-node'
  | 'invalid-children'
  | 'duplicate-node-id'
  | 'cyclic-node'

export interface BookmarkTreeDiagnostic {
  code: BookmarkTreeDiagnosticCode
  treePath: number[]
  bookmarkId: string | null
}

export interface BookmarkTreeNormalizationResult {
  valid: boolean
  entries: NormalizedBookmarkEntry[]
  diagnostics: BookmarkTreeDiagnostic[]
}

export type BookmarkDoctorErrorCode =
  | 'module-unavailable'
  | 'module-disabled'
  | 'capability-not-granted'
  | 'permission-missing'
  | 'permission-check-failed'
  | 'bookmark-read-failed'
  | 'invalid-tree'

export interface BookmarkDoctorError {
  code: BookmarkDoctorErrorCode
  message: string
}

export type BookmarkDoctorReadResult =
  | {
    status: 'ready'
    completedAt: string
    entries: NormalizedBookmarkEntry[]
    diagnostics: BookmarkTreeDiagnostic[]
    error: null
  }
  | {
    status: 'blocked' | 'failed'
    completedAt: string
    entries: []
    diagnostics: BookmarkTreeDiagnostic[]
    error: BookmarkDoctorError
  }

export interface BookmarkDoctorLocalState {
  schemaVersion: typeof BOOKMARK_DOCTOR_STATE_SCHEMA_VERSION
  lastResult: BookmarkDoctorReadResult | null
  ignoredBookmarks: BookmarkDoctorIgnoredBookmark[]
  deletionBackups: BookmarkDoctorDeletionBackup[]
}

export interface BookmarkNodeSnapshot {
  bookmarkId: string
  parentId: string | null
  index: number | null
  title: string
  url: string
}

export interface BookmarkDoctorIgnoredBookmark {
  bookmarkId: string
  title: string
  url: string
  ignoredAt: string
}

export interface BookmarkDoctorDeletionBackup extends BookmarkNodeSnapshot {
  repairToken: string
  deletedAt: string
}

export interface BookmarkDoctorWorkspaceState {
  ignoredBookmarks: BookmarkDoctorIgnoredBookmark[]
  deletionBackups: BookmarkDoctorDeletionBackup[]
}

export interface BookmarkRestorePlan {
  token: string
  createdAt: string
  expiresAt: string
  backup: BookmarkDoctorDeletionBackup
  confirmation: 'reviewed'
}

export interface BookmarkRestoreConfirmation {
  token: string
  confirmation: 'reviewed'
}

export type BookmarkRepairRequest =
  | {
    operation: 'update'
    bookmarkId: string
    changes: { title?: string, url?: string }
  }
  | {
    operation: 'move'
    bookmarkId: string
    destination: { parentId: string, index?: number }
  }
  | { operation: 'ignore', bookmarkId: string }
  | { operation: 'delete', bookmarkId: string }

export type BookmarkRepairPlan = {
  token: string
  createdAt: string
  expiresAt: string
  before: BookmarkNodeSnapshot
  confirmation: 'reviewed' | 'delete-confirmed'
} & (
  | {
    operation: 'update'
    proposed: { title?: string, url?: string }
  }
  | {
    operation: 'move'
    proposed: { parentId: string, index?: number }
  }
  | {
    operation: 'ignore'
    proposed: { ignored: true }
  }
  | {
    operation: 'delete'
    proposed: { deleted: true }
  }
)

export interface BookmarkRepairConfirmation {
  token: string
  confirmation: 'reviewed' | 'delete-confirmed'
}

export type BookmarkRepairFailureReason =
  | BookmarkDoctorErrorCode
  | 'scan-active'
  | 'repair-unavailable'
  | 'write-capability-not-granted'
  | 'invalid-repair-request'
  | 'bookmark-target-not-found'
  | 'bookmark-target-invalid'
  | 'repair-plan-not-found'
  | 'repair-plan-expired'
  | 'repair-plan-stale'
  | 'invalid-confirmation'
  | 'repair-state-failed'
  | 'bookmark-update-failed'
  | 'bookmark-move-failed'
  | 'bookmark-delete-failed'
  | 'restore-backup-not-found'
  | 'restore-backup-stale'
  | 'restore-parent-invalid'
  | 'restore-conflict'
  | 'bookmark-restore-failed'
  | 'restore-state-failed'
  | 'invalid-local-data-confirmation'
  | 'permission-remove-failed'

export type BookmarkRepairExecutionResult =
  | { ok: true, token: string, operation: BookmarkRepairPlan['operation'] }
  | { ok: false, token: string, operation: BookmarkRepairPlan['operation'] | null, reason: BookmarkRepairFailureReason }

export const bookmarkProbeOutcomes = [
  'reachable',
  'http-error',
  'timeout',
  'network-failure',
] as const

export type BookmarkProbeOutcome = typeof bookmarkProbeOutcomes[number]

export interface BookmarkUrlProbeResult {
  outcome: BookmarkProbeOutcome
  httpStatus: number | null
}

export interface BookmarkScanResult extends BookmarkUrlProbeResult {
  entryId: string
  bookmarkId: string | null
  parentId: string | null
  index: number | null
  title: string
  url: string
  folderPath: string[]
}

export type BookmarkScanStatus = 'scanning' | 'completed' | 'stopped'

export interface BookmarkScanSnapshot {
  runId: string
  status: BookmarkScanStatus
  total: number
  completed: number
  results: BookmarkScanResult[]
  startedAt: string
  completedAt: string | null
}

export interface BookmarkScanPreparation {
  token: string
  total: number
  skipped: number
  originPatterns: string[]
}
