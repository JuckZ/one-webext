import type { ModuleLocalStateStorageArea } from '../../module-state'
import type { BookmarkDoctorLocalState } from './contracts'
import { ModuleLocalStateStore } from '../../module-state'
import {
  BOOKMARK_DOCTOR_DELETION_BACKUP_LIMIT,
  BOOKMARK_DOCTOR_MODULE_ID,
  BOOKMARK_DOCTOR_STATE_SCHEMA_VERSION,
} from './contracts'

export function createEmptyBookmarkDoctorState(): BookmarkDoctorLocalState {
  return {
    schemaVersion: BOOKMARK_DOCTOR_STATE_SCHEMA_VERSION,
    lastResult: null,
    ignoredBookmarks: [],
    deletionBackups: [],
  }
}

export function normalizeBookmarkDoctorState(value: unknown): BookmarkDoctorLocalState {
  const empty = createEmptyBookmarkDoctorState()
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return empty
  const record = value as Partial<Omit<BookmarkDoctorLocalState, 'schemaVersion'>> & { schemaVersion?: unknown }
  if (record.schemaVersion === 1) {
    return {
      ...empty,
      lastResult: record.lastResult ?? null,
    }
  }
  if (record.schemaVersion !== BOOKMARK_DOCTOR_STATE_SCHEMA_VERSION)
    return empty

  const ignoredBookmarks = Array.isArray(record.ignoredBookmarks)
    ? record.ignoredBookmarks.filter(entry => (
      entry
      && typeof entry.bookmarkId === 'string'
      && typeof entry.title === 'string'
      && typeof entry.url === 'string'
      && typeof entry.ignoredAt === 'string'
    )).slice(-BOOKMARK_DOCTOR_DELETION_BACKUP_LIMIT)
    : []
  const deletionBackups = Array.isArray(record.deletionBackups)
    ? record.deletionBackups.filter(entry => (
      entry
      && typeof entry.bookmarkId === 'string'
      && typeof entry.title === 'string'
      && typeof entry.url === 'string'
      && typeof entry.repairToken === 'string'
      && typeof entry.deletedAt === 'string'
    )).slice(-BOOKMARK_DOCTOR_DELETION_BACKUP_LIMIT)
    : []
  return {
    schemaVersion: BOOKMARK_DOCTOR_STATE_SCHEMA_VERSION,
    lastResult: record.lastResult ?? null,
    ignoredBookmarks: structuredClone(ignoredBookmarks),
    deletionBackups: structuredClone(deletionBackups),
  }
}

export function createBookmarkDoctorStateStore(storage: ModuleLocalStateStorageArea) {
  return new ModuleLocalStateStore<BookmarkDoctorLocalState>(storage, BOOKMARK_DOCTOR_MODULE_ID)
}
