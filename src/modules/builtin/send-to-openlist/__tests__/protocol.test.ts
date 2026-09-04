import type { SendToOpenListConnectionPreparationV1 } from '../contracts'
import { SendToOpenListClient, SendToOpenListClientError } from '../client'
import {
  createSendToOpenListResponse,
  isSendToOpenListRequest,
  SEND_TO_OPENLIST_CHANNEL,
  SEND_TO_OPENLIST_PROTOCOL_VERSION,
} from '../protocol'

const profile = {
  schemaVersion: 1 as const,
  id: 'primary',
  label: 'Home',
  controllerOrigin: 'https://openlist.example',
}
const base = { channel: SEND_TO_OPENLIST_CHANNEL, version: SEND_TO_OPENLIST_PROTOCOL_VERSION } as const

describe('send to OpenList trusted protocol', () => {
  it('accepts only the fourteen narrow messages and rejects escape hatches', () => {
    expect(isSendToOpenListRequest({ ...base, type: 'SEND_TO_OPENLIST_PREPARE', profile })).toBe(true)
    expect(isSendToOpenListRequest({ ...base, type: 'SEND_TO_OPENLIST_STATUS' })).toBe(true)
    expect(isSendToOpenListRequest({ ...base, type: 'SEND_TO_OPENLIST_DISCOVER_TOOLS', destinationPath: '/' })).toBe(true)
    expect(isSendToOpenListRequest({ ...base, type: 'SEND_TO_OPENLIST_LIST_TASKS', list: 'undone' })).toBe(true)
    expect(isSendToOpenListRequest({ ...base, type: 'SEND_TO_OPENLIST_LIST_TASKS', list: 'done' })).toBe(true)
    expect(isSendToOpenListRequest({ ...base, type: 'SEND_TO_OPENLIST_PREPARE_CANCEL', taskId: 'task-1' })).toBe(true)
    expect(isSendToOpenListRequest({
      ...base,
      type: 'SEND_TO_OPENLIST_CONFIRM_CANCEL',
      token: 'cancel-review-token-123456789012',
    })).toBe(true)
    expect(isSendToOpenListRequest({ ...base, type: 'SEND_TO_OPENLIST_DISCOVERY_STATUS' })).toBe(true)
    expect(isSendToOpenListRequest({ ...base, type: 'SEND_TO_OPENLIST_CAPTURE_CURRENT_PAGE' })).toBe(true)
    expect(isSendToOpenListRequest({ ...base, type: 'SEND_TO_OPENLIST_SCAN_CURRENT_PAGE' })).toBe(true)
    expect(isSendToOpenListRequest({ ...base, type: 'SEND_TO_OPENLIST_CLEAR_DISCOVERY' })).toBe(true)
    expect(isSendToOpenListRequest({ ...base, type: 'SEND_TO_OPENLIST_DISCONNECT' })).toBe(true)
    expect(isSendToOpenListRequest({ ...base, type: 'SEND_TO_OPENLIST_DELETE_PROFILE' })).toBe(true)
    expect(isSendToOpenListRequest({ ...base, type: 'SEND_TO_OPENLIST_FETCH', url: 'https://evil.example' })).toBe(false)
    expect(isSendToOpenListRequest({ ...base, type: 'SEND_TO_OPENLIST_STATUS', method: 'POST' })).toBe(false)
    expect(isSendToOpenListRequest({ ...base, type: 'SEND_TO_OPENLIST_LIST_TASKS', list: 'all' })).toBe(false)
    expect(isSendToOpenListRequest({ ...base, type: 'SEND_TO_OPENLIST_PREPARE_CANCEL', taskId: '' })).toBe(false)
    expect(isSendToOpenListRequest({
      ...base,
      type: 'SEND_TO_OPENLIST_CONFIRM_CANCEL',
      token: 'short',
      url: 'https://evil.example',
    })).toBe(false)
  })

  it('lets the client request only the preparation exact origin', async () => {
    const preparation: SendToOpenListConnectionPreparationV1 = {
      token: 'preparation-token-1234',
      profile,
      originPattern: 'https://openlist.example/*',
      generation: 2,
      expiresAt: '2026-09-03T00:02:00.000Z',
    }
    const transport = {
      sendMessage: vi.fn(async message => createSendToOpenListResponse(message.type, { ok: true })),
    }
    const permissions = { request: vi.fn(async () => true) }
    const client = new SendToOpenListClient(transport, permissions)
    await client.connect(preparation, 'raw-token')

    expect(permissions.request).toHaveBeenCalledWith({ origins: ['https://openlist.example/*'] })
    expect(transport.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'SEND_TO_OPENLIST_CONNECT',
      preparation,
      token: 'raw-token',
    }))
  })

  it('rejects denied permission and mismatched responses', async () => {
    const preparation = {
      token: 'preparation-token-1234',
      profile,
      originPattern: 'https://openlist.example/*',
      generation: 2,
      expiresAt: '2026-09-03T00:02:00.000Z',
    }
    const client = new SendToOpenListClient(
      { sendMessage: async () => createSendToOpenListResponse('SEND_TO_OPENLIST_STATUS', {}) },
      { request: async () => true },
    )
    await expect(client.connect(preparation, 'token')).rejects.toBeInstanceOf(SendToOpenListClientError)
    const denied = new SendToOpenListClient(
      { sendMessage: async () => null },
      { request: async () => false },
    )
    await expect(denied.connect(preparation, 'token')).rejects.toMatchObject({ code: 'permission-denied' })
  })
})
