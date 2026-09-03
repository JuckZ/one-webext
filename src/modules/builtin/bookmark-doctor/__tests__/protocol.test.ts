import type { BookmarkRepairPlan, BookmarkScanSnapshot } from '../contracts'
import { BookmarkDoctorClient, type BookmarkDoctorClientError } from '../client'
import {
  BOOKMARK_DOCTOR_CHANNEL,
  BOOKMARK_DOCTOR_PROTOCOL_VERSION,
  createBookmarkDoctorResponse,
  isBookmarkDoctorRequest,
  isBookmarkDoctorResponse,
} from '../protocol'

const requestBase = {
  channel: BOOKMARK_DOCTOR_CHANNEL,
  version: BOOKMARK_DOCTOR_PROTOCOL_VERSION,
} as const

const completedSnapshot: BookmarkScanSnapshot = {
  runId: 'run-1',
  status: 'completed',
  total: 0,
  completed: 0,
  results: [],
  startedAt: '2026-08-28T00:00:00.000Z',
  completedAt: '2026-08-28T00:00:00.000Z',
}

describe('bookmark doctor protocol', () => {
  it('accepts only the narrow versioned operations and validates result classes', () => {
    expect(isBookmarkDoctorRequest({ ...requestBase, type: 'BOOKMARK_DOCTOR_PREPARE' })).toBe(true)
    expect(isBookmarkDoctorRequest({ ...requestBase, type: 'BOOKMARK_DOCTOR_START', token: 'plan-1' })).toBe(true)
    expect(isBookmarkDoctorRequest({ ...requestBase, type: 'BOOKMARK_DOCTOR_START', token: '' })).toBe(false)
    expect(isBookmarkDoctorRequest({ ...requestBase, type: 'BOOKMARK_DOCTOR_PAUSE' })).toBe(false)
    expect(isBookmarkDoctorRequest({ ...requestBase, version: 1, type: 'BOOKMARK_DOCTOR_STATUS' })).toBe(false)

    const response = createBookmarkDoctorResponse('BOOKMARK_DOCTOR_START', {
      ok: true,
      operation: 'start',
      snapshot: completedSnapshot,
    })
    expect(isBookmarkDoctorResponse(response)).toBe(true)
    expect(isBookmarkDoctorResponse({
      ...response,
      result: {
        ...response.result,
        snapshot: {
          ...completedSnapshot,
          results: [{ outcome: 'redirect-loop' }],
        },
      },
    })).toBe(false)
  })

  it('requests bookmarks and exact origins before sending trusted operations', async () => {
    const sequence: string[] = []
    const permissions = {
      request: vi.fn(async (request: { permissions?: Array<'bookmarks'>, origins?: string[] }) => {
        sequence.push(request.permissions ? 'permission:bookmarks' : `permission:${request.origins?.join(',')}`)
        return true
      }),
    }
    const sendMessage = vi.fn(async (request) => {
      sequence.push(`message:${request.type}`)
      if (request.type === 'BOOKMARK_DOCTOR_AUTHORIZE') {
        return createBookmarkDoctorResponse(request.type, {
          ok: false,
          operation: 'authorize',
          reason: 'module-disabled',
        })
      }
      return createBookmarkDoctorResponse('BOOKMARK_DOCTOR_START', {
        ok: true,
        operation: 'start',
        snapshot: completedSnapshot,
      })
    })
    const client = new BookmarkDoctorClient({ permissions, sendMessage })

    await client.authorize()
    await client.start({
      token: 'plan-1',
      total: 1,
      skipped: 0,
      originPatterns: ['https://example.com/*'],
    })
    expect(sequence).toEqual([
      'permission:bookmarks',
      'message:BOOKMARK_DOCTOR_AUTHORIZE',
      'permission:https://example.com/*',
      'message:BOOKMARK_DOCTOR_START',
    ])
  })

  it('does not send an operation after permission denial', async () => {
    const sendMessage = vi.fn()
    const client = new BookmarkDoctorClient({
      permissions: { request: vi.fn(async () => false) },
      sendMessage,
    })

    await expect(client.authorize()).rejects.toEqual(expect.objectContaining<Partial<BookmarkDoctorClientError>>({
      code: 'permission-denied',
    }))
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('validates reviewed repair requests, confirmation batches and typed responses', () => {
    expect(isBookmarkDoctorRequest({
      ...requestBase,
      type: 'BOOKMARK_DOCTOR_PREPARE_REPAIR',
      request: {
        operation: 'update',
        bookmarkId: 'bookmark-1',
        changes: { title: 'After', url: 'https://after.example' },
      },
    })).toBe(true)
    expect(isBookmarkDoctorRequest({
      ...requestBase,
      type: 'BOOKMARK_DOCTOR_PREPARE_REPAIR',
      request: {
        operation: 'delete',
        bookmarkId: 'bookmark-1',
        recursive: true,
      },
    })).toBe(false)
    expect(isBookmarkDoctorRequest({
      ...requestBase,
      type: 'BOOKMARK_DOCTOR_CONFIRM_REPAIRS',
      confirmations: [{ token: 'repair-1', confirmation: 'delete-confirmed' }],
    })).toBe(true)
    expect(isBookmarkDoctorRequest({
      ...requestBase,
      type: 'BOOKMARK_DOCTOR_CONFIRM_REPAIRS',
      confirmations: [],
    })).toBe(false)

    const plan: BookmarkRepairPlan = {
      token: 'repair-1',
      operation: 'delete',
      createdAt: '2026-08-28T00:00:00.000Z',
      expiresAt: '2026-08-28T00:02:00.000Z',
      before: {
        bookmarkId: 'bookmark-1',
        parentId: 'folder-1',
        index: 0,
        title: '<img src=x onerror=alert(1)>',
        url: 'https://example.com/',
      },
      proposed: { deleted: true },
      confirmation: 'delete-confirmed',
    }
    const prepared = createBookmarkDoctorResponse('BOOKMARK_DOCTOR_PREPARE_REPAIR', {
      ok: true,
      operation: 'prepare-repair',
      plan,
    })
    expect(isBookmarkDoctorResponse(prepared)).toBe(true)
    expect(isBookmarkDoctorResponse({
      ...prepared,
      result: { ...prepared.result, plan: { ...plan, confirmation: 'reviewed' } },
    })).toBe(false)

    const confirmed = createBookmarkDoctorResponse('BOOKMARK_DOCTOR_CONFIRM_REPAIRS', {
      ok: true,
      operation: 'confirm-repairs',
      results: [{ ok: false, token: 'repair-1', operation: 'delete', reason: 'repair-plan-stale' }],
    })
    expect(isBookmarkDoctorResponse(confirmed)).toBe(true)
  })
})
