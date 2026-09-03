import type { BookmarkNodeSnapshot } from '../contracts'
import {
  bookmarkNodeSnapshotsEqual,
  createBookmarkRepairPlan,
  isBookmarkRepairConfirmationValid,
  isBookmarkRepairPlanExpired,
  normalizeBookmarkRepairRequest,
  readBookmarkNodeSnapshot,
} from '../repair'
import { normalizeBookmarkDoctorState } from '../state'

const before: BookmarkNodeSnapshot = {
  bookmarkId: 'bookmark-1',
  parentId: 'folder-1',
  index: 2,
  title: 'Before',
  url: 'https://before.example/path',
}

describe('bookmark repair pure model', () => {
  it('allowlists update fields and normalizes only credential-free HTTP(S) URLs', () => {
    expect(normalizeBookmarkRepairRequest({
      operation: 'update',
      bookmarkId: 'bookmark-1',
      changes: { title: 'After', url: 'https://after.example' },
    })).toEqual({
      operation: 'update',
      bookmarkId: 'bookmark-1',
      changes: { title: 'After', url: 'https://after.example/' },
    })
    expect(normalizeBookmarkRepairRequest({
      operation: 'update',
      bookmarkId: 'bookmark-1',
      changes: { title: 'After', children: [] },
    })).toBeNull()
    expect(normalizeBookmarkRepairRequest({
      operation: 'update',
      bookmarkId: 'bookmark-1',
      changes: { url: 'javascript:alert(1)' },
    })).toBeNull()
    expect(normalizeBookmarkRepairRequest({
      operation: 'update',
      bookmarkId: 'bookmark-1',
      changes: { url: 'https://user:secret@example.com' },
    })).toBeNull()
  })

  it('validates move destinations, non-negative indexes and exact operation shapes', () => {
    expect(normalizeBookmarkRepairRequest({
      operation: 'move',
      bookmarkId: 'bookmark-1',
      destination: { parentId: 'folder-2', index: 0 },
    })).toEqual({
      operation: 'move',
      bookmarkId: 'bookmark-1',
      destination: { parentId: 'folder-2', index: 0 },
    })
    expect(normalizeBookmarkRepairRequest({
      operation: 'move',
      bookmarkId: 'bookmark-1',
      destination: { parentId: 'folder-2', index: -1 },
    })).toBeNull()
    expect(normalizeBookmarkRepairRequest({ operation: 'delete', bookmarkId: 'bookmark-1', recursive: true })).toBeNull()
  })

  it('creates exact mutable snapshots and detects every concurrent field change', () => {
    const snapshot = readBookmarkNodeSnapshot([{
      id: 'bookmark-1',
      parentId: 'folder-1',
      index: 2,
      title: 'Before',
      url: 'https://before.example/path',
      dateAdded: 1,
    }])
    expect(snapshot).toEqual(before)
    expect(bookmarkNodeSnapshotsEqual(snapshot!, before)).toBe(true)
    expect(bookmarkNodeSnapshotsEqual(snapshot!, { ...before, index: 3 })).toBe(false)
    expect(readBookmarkNodeSnapshot([])).toBeNull()
    expect(readBookmarkNodeSnapshot([{ id: 'folder', title: 'Folder' }])).toBeNull()
  })

  it('binds plans to a single confirmation strength and fixed expiry', () => {
    const update = createBookmarkRepairPlan({
      operation: 'update',
      bookmarkId: before.bookmarkId,
      changes: { title: 'After' },
    }, before, 'repair-1', '2026-08-28T00:00:00.000Z')!
    expect(update).toMatchObject({
      operation: 'update',
      confirmation: 'reviewed',
      expiresAt: '2026-08-28T00:02:00.000Z',
    })
    expect(isBookmarkRepairConfirmationValid(update, { token: 'repair-1', confirmation: 'reviewed' })).toBe(true)
    expect(isBookmarkRepairConfirmationValid(update, { token: 'repair-1', confirmation: 'delete-confirmed' })).toBe(false)
    expect(isBookmarkRepairPlanExpired(update, '2026-08-28T00:01:59.999Z')).toBe(false)
    expect(isBookmarkRepairPlanExpired(update, '2026-08-28T00:02:00.000Z')).toBe(true)

    const deletion = createBookmarkRepairPlan({ operation: 'delete', bookmarkId: before.bookmarkId }, before, 'repair-2', '2026-08-28T00:00:00.000Z')!
    expect(deletion.confirmation).toBe('delete-confirmed')
    expect(isBookmarkRepairConfirmationValid(deletion, { token: 'repair-2', confirmation: 'reviewed' })).toBe(false)
  })

  it('rejects no-op update and move plans', () => {
    expect(createBookmarkRepairPlan({
      operation: 'update',
      bookmarkId: before.bookmarkId,
      changes: { title: before.title },
    }, before, 'repair-1', '2026-08-28T00:00:00.000Z')).toBeNull()
    expect(createBookmarkRepairPlan({
      operation: 'move',
      bookmarkId: before.bookmarkId,
      destination: { parentId: before.parentId!, index: before.index! },
    }, before, 'repair-1', '2026-08-28T00:00:00.000Z')).toBeNull()
  })

  it('migrates the Phase 3A local state without inventing repair grants or records', () => {
    const lastResult = {
      status: 'blocked' as const,
      completedAt: '2026-08-28T00:00:00.000Z',
      entries: [] as [],
      diagnostics: [],
      error: { code: 'permission-missing' as const, message: 'missing' },
    }
    expect(normalizeBookmarkDoctorState({ schemaVersion: 1, lastResult })).toEqual({
      schemaVersion: 2,
      lastResult,
      ignoredBookmarks: [],
      deletionBackups: [],
    })
  })
})
