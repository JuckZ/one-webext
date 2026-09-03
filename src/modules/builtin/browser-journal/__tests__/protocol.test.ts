import { BrowserJournalClient, type BrowserJournalClientError } from '../client'
import { createEmptyBrowserJournalSnapshot } from '../model'
import {
  BROWSER_JOURNAL_CHANNEL,
  BROWSER_JOURNAL_PROTOCOL_VERSION,
  createBrowserJournalResponse,
  isBrowserJournalRequest,
  isBrowserJournalResponse,
} from '../protocol'

const base = {
  channel: BROWSER_JOURNAL_CHANNEL,
  version: BROWSER_JOURNAL_PROTOCOL_VERSION,
} as const

describe('browser journal protocol', () => {
  it('accepts only start, stop and status without caller-provided event data', () => {
    expect(isBrowserJournalRequest({ ...base, type: 'BROWSER_JOURNAL_START' })).toBe(true)
    expect(isBrowserJournalRequest({ ...base, type: 'BROWSER_JOURNAL_STOP' })).toBe(true)
    expect(isBrowserJournalRequest({ ...base, type: 'BROWSER_JOURNAL_STATUS' })).toBe(true)
    expect(isBrowserJournalRequest({ ...base, type: 'BROWSER_JOURNAL_ARCHIVE' })).toBe(true)
    expect(isBrowserJournalRequest({ ...base, type: 'BROWSER_JOURNAL_SAVE' })).toBe(true)
    expect(isBrowserJournalRequest({ ...base, type: 'BROWSER_JOURNAL_DELETE_SAVED', savedSessionId: 'saved-1' })).toBe(true)
    expect(isBrowserJournalRequest({ ...base, type: 'BROWSER_JOURNAL_CLEAR_SAVED', confirmation: 'clear-saved-sessions' })).toBe(true)
    expect(isBrowserJournalRequest({
      ...base,
      type: 'BROWSER_JOURNAL_START',
      url: 'https://forged.example/',
    })).toBe(false)
    expect(isBrowserJournalRequest({ ...base, type: 'BROWSER_JOURNAL_APPEND' })).toBe(false)
    expect(isBrowserJournalRequest({ ...base, type: 'BROWSER_JOURNAL_SAVE', entries: [] })).toBe(false)
    expect(isBrowserJournalRequest({ ...base, type: 'BROWSER_JOURNAL_DELETE_SAVED', savedSessionId: '', url: 'https://evil.example' })).toBe(false)
    expect(isBrowserJournalRequest({ ...base, version: 1, type: 'BROWSER_JOURNAL_STATUS' })).toBe(false)
  })

  it('validates bounded snapshots and client responses', async () => {
    const snapshot = createEmptyBrowserJournalSnapshot()
    const response = createBrowserJournalResponse('BROWSER_JOURNAL_STATUS', {
      ok: true,
      operation: 'status',
      snapshot,
    })
    expect(isBrowserJournalResponse(response)).toBe(true)
    expect(isBrowserJournalResponse({
      ...response,
      result: {
        ...response.result,
        snapshot: { ...snapshot, entries: [{ url: 'javascript:alert(1)' }] },
      },
    })).toBe(false)

    const sendMessage = vi.fn(async () => response)
    const client = new BrowserJournalClient({ sendMessage })
    await expect(client.status()).resolves.toEqual(response.result)
    expect(sendMessage).toHaveBeenCalledWith({ ...base, type: 'BROWSER_JOURNAL_STATUS' })

    const invalid = new BrowserJournalClient({ sendMessage: vi.fn(async () => ({})) })
    await expect(invalid.start()).rejects.toEqual(expect.objectContaining<Partial<BrowserJournalClientError>>({
      code: 'invalid-response',
    }))
  })

  it('validates archive operations and sends only identifiers or exact confirmation', async () => {
    const state = {
      schemaVersion: 1 as const,
      sessions: [{
        id: 'saved-1',
        startedAt: '2026-08-29T08:00:00.000Z',
        stoppedAt: '2026-08-29T08:01:00.000Z',
        savedAt: '2026-08-29T08:02:00.000Z',
        entries: [{
          kind: 'navigation' as const,
          occurredAt: '2026-08-29T08:00:30.000Z',
          title: '<img src=x>',
          url: 'https://example.com/saved',
        }],
      }],
    }
    const response = createBrowserJournalResponse('BROWSER_JOURNAL_SAVE', {
      ok: true,
      operation: 'save',
      changed: true,
      savedSession: state.sessions[0]!,
      state,
    })
    expect(isBrowserJournalResponse(response)).toBe(true)
    expect(isBrowserJournalResponse({
      ...response,
      result: { ...response.result, savedSession: { ...state.sessions[0], entries: [{ url: 'javascript:evil' }] } },
    })).toBe(false)

    const sendMessage = vi.fn(async (request) => {
      if (request.type === 'BROWSER_JOURNAL_DELETE_SAVED') {
        return createBrowserJournalResponse(request.type, {
          ok: true,
          operation: 'delete-saved',
          changed: true,
          state: { schemaVersion: 1, sessions: [] },
        })
      }
      return createBrowserJournalResponse('BROWSER_JOURNAL_CLEAR_SAVED', {
        ok: true,
        operation: 'clear-saved',
        changed: true,
        state: { schemaVersion: 1, sessions: [] },
      })
    })
    const client = new BrowserJournalClient({ sendMessage })
    await client.deleteSaved('saved-1')
    await client.clearSaved()
    expect(sendMessage.mock.calls).toEqual([
      [{ ...base, type: 'BROWSER_JOURNAL_DELETE_SAVED', savedSessionId: 'saved-1' }],
      [{ ...base, type: 'BROWSER_JOURNAL_CLEAR_SAVED', confirmation: 'clear-saved-sessions' }],
    ])
  })
})
