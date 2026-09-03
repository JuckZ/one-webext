import type {
  BookmarkDoctorWorkspaceState,
  BookmarkRestorePlan,
  BookmarkScanSnapshot,
} from '~/modules/builtin/bookmark-doctor'
import {
  bookmarkRepairRequestFromDraft,
  createBookmarkRepairDraft,
  presentBookmarkDoctorWorkspace,
  presentBookmarkRestorePlan,
} from '../bookmark-doctor-presentation'

const snapshot: BookmarkScanSnapshot = {
  runId: 'run-presentation',
  status: 'completed',
  total: 2,
  completed: 2,
  startedAt: '2026-08-28T00:00:00.000Z',
  completedAt: '2026-08-28T00:00:01.000Z',
  results: [
    {
      entryId: 'reachable-entry',
      bookmarkId: 'reachable-bookmark',
      parentId: 'folder-1',
      index: 0,
      folderPath: ['Bookmarks'],
      title: 'Reachable',
      url: 'https://reachable.example/',
      outcome: 'reachable',
      httpStatus: 200,
    },
    {
      entryId: 'problem-entry',
      bookmarkId: 'problem-bookmark',
      parentId: 'folder-1',
      index: 1,
      folderPath: ['Bookmarks'],
      title: '<img src=x onerror=alert(1)>',
      url: 'https://problem.example/',
      outcome: 'http-error',
      httpStatus: 404,
    },
  ],
}

const emptyState: BookmarkDoctorWorkspaceState = {
  ignoredBookmarks: [],
  deletionBackups: [],
}

describe('bookmark Doctor presentation', () => {
  it('filters result categories without mutating the scan snapshot', () => {
    expect(presentBookmarkDoctorWorkspace(snapshot, emptyState, 'problems').visibleResults)
      .toEqual([snapshot.results[1]])
    expect(presentBookmarkDoctorWorkspace(snapshot, emptyState, 'reachable').visibleResults)
      .toEqual([snapshot.results[0]])
    expect(presentBookmarkDoctorWorkspace(snapshot, emptyState, 'all').visibleResults)
      .toHaveLength(2)
    expect(snapshot.results).toHaveLength(2)
  })

  it('hides locally ignored bookmarks while preserving their in-memory scan result', () => {
    const state: BookmarkDoctorWorkspaceState = {
      ignoredBookmarks: [{
        bookmarkId: 'problem-bookmark',
        title: 'Ignored',
        url: 'https://problem.example/',
        ignoredAt: '2026-08-28T00:01:00.000Z',
      }],
      deletionBackups: [],
    }
    const result = presentBookmarkDoctorWorkspace(snapshot, state, 'all')
    expect(result.visibleResults.map(entry => entry.bookmarkId)).toEqual(['reachable-bookmark'])
    expect(result.ignoredCount).toBe(1)
    expect(snapshot.results).toHaveLength(2)
  })

  it('creates update and move requests only from a selected scan result', () => {
    const updateDraft = createBookmarkRepairDraft(snapshot.results[1]!, 'update')!
    expect(bookmarkRepairRequestFromDraft({ ...updateDraft, title: 'Fixed', url: 'https://fixed.example/' })).toEqual({
      operation: 'update',
      bookmarkId: 'problem-bookmark',
      changes: { title: 'Fixed', url: 'https://fixed.example/' },
    })

    const moveDraft = createBookmarkRepairDraft(snapshot.results[1]!, 'move')!
    expect(bookmarkRepairRequestFromDraft({ ...moveDraft, parentId: 'folder-2', index: '3' })).toEqual({
      operation: 'move',
      bookmarkId: 'problem-bookmark',
      destination: { parentId: 'folder-2', index: 3 },
    })
    expect(bookmarkRepairRequestFromDraft({ ...moveDraft, parentId: '', index: '-1' })).toBeNull()
  })

  it('refuses to create a repair draft for a result without a browser bookmark id', () => {
    expect(createBookmarkRepairDraft({ ...snapshot.results[1]!, bookmarkId: null }, 'delete')).toBeNull()
  })

  it('presents restore data as inert text values', () => {
    const plan: BookmarkRestorePlan = {
      token: 'restore-plan',
      createdAt: '2026-08-28T00:00:00.000Z',
      expiresAt: '2026-08-28T00:02:00.000Z',
      confirmation: 'reviewed',
      backup: {
        repairToken: 'backup-token',
        bookmarkId: 'deleted-bookmark',
        parentId: 'folder-1',
        index: 2,
        title: '<script>alert(1)</script>',
        url: 'https://deleted.example/',
        deletedAt: '2026-08-28T00:00:00.000Z',
      },
    }
    expect(presentBookmarkRestorePlan(plan)).toEqual({
      title: '<script>alert(1)</script>',
      url: 'https://deleted.example/',
      destination: 'folder-1 / 2',
      expiresAt: plan.expiresAt,
    })
  })
})
