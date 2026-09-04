import {
  SendToOpenListConnector,
} from '../connector'
import { SEND_TO_OPENLIST_MAX_RESPONSE_BYTES } from '../contracts'

function json(data: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(data), { status: 200, ...init })
}

describe('send to OpenList fixed connector', () => {
  it('uses raw authorization only on authenticated fixed endpoints', async () => {
    const calls: Array<{ url: string, init: RequestInit }> = []
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init: init! })
      if (String(input).includes('offline_download_tools'))
        return json({ code: 200, message: 'success', data: ['qBittorrent', 'SimpleHttp'] })
      if (String(input).endsWith('/api/me'))
        return json({ code: 200, message: 'success', data: { id: 7, username: 'user' } })
      return json({ code: 200, message: 'success', data: { tasks: [] } })
    })
    const connector = new SendToOpenListConnector({ fetch: fetcher })

    await expect(connector.verify('https://openlist.example', 'primary', 'raw-token')).resolves.toEqual({ authenticated: true })
    await expect(connector.discoverTools('https://openlist.example', 'primary', '/signed path')).resolves.toEqual(['qBittorrent', 'SimpleHttp'])
    await expect(connector.addResource('https://openlist.example', 'primary', 'raw-token', {
      url: 'https://cdn.example/file?sig=a%2Bb',
      destinationPath: '/downloads',
      tool: 'SimpleHttp',
    })).resolves.toBeNull()

    expect(calls.map(call => call.url)).toEqual([
      'https://openlist.example/api/me',
      'https://openlist.example/api/public/offline_download_tools?path=%2Fsigned%20path',
      'https://openlist.example/api/fs/add_offline_download',
    ])
    expect(calls[0]!.init.headers).toMatchObject({ authorization: 'raw-token' })
    expect(calls[1]!.init.headers).not.toHaveProperty('authorization')
    expect(calls[2]!.init.headers).toMatchObject({ authorization: 'raw-token' })
    expect(JSON.parse(String(calls[2]!.init.body))).toEqual({
      urls: ['https://cdn.example/file?sig=a%2Bb'],
      path: '/downloads',
      tool: 'SimpleHttp',
      delete_policy: 'delete_on_upload_succeed',
    })
    expect(JSON.stringify(calls)).not.toContain('Bearer')
  })

  it.each([
    [401, { code: 200, message: '', data: {} }, 'authentication-failed'],
    [500, { code: 200, message: '', data: {} }, 'http-error'],
    [200, { code: 500, message: 'rejected', data: null }, 'upstream-rejected'],
    [200, { message: 'missing code', data: null }, 'protocol-incompatible'],
  ] as const)('classifies HTTP %s and body errors as %s', async (status, body, code) => {
    const connector = new SendToOpenListConnector({
      fetch: async () => json(body, { status }),
    })
    await expect(connector.verify('https://openlist.example', 'primary', 'token'))
      .rejects
      .toMatchObject({ code })
  })

  it('rejects redirects and oversized responses without following them', async () => {
    const redirect = new SendToOpenListConnector({
      fetch: async () => new Response(null, { status: 302, headers: { location: 'https://evil.example' } }),
    })
    await expect(redirect.verify('https://openlist.example', 'primary', 'token'))
      .rejects
      .toMatchObject({ code: 'protocol-incompatible' })

    const oversized = new SendToOpenListConnector({
      fetch: async () => new Response('{}', {
        status: 200,
        headers: { 'content-length': String(SEND_TO_OPENLIST_MAX_RESPONSE_BYTES + 1) },
      }),
    })
    await expect(oversized.verify('https://openlist.example', 'primary', 'token'))
      .rejects
      .toMatchObject({ code: 'response-too-large' })
  })

  it('marks an ambiguous failed write outcome without retrying', async () => {
    const fetcher = vi.fn(async () => Promise.reject(new Error('socket closed')))
    const connector = new SendToOpenListConnector({ fetch: fetcher as typeof globalThis.fetch })
    await expect(connector.addResource('https://openlist.example', 'primary', 'token', {
      url: 'magnet:?xt=urn:btih:abc',
      destinationPath: '/downloads',
      tool: 'qBittorrent',
    })).rejects.toMatchObject({ code: 'outcome-unknown' })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('projects bounded task lists and encodes the reviewed task ID on cancellation', async () => {
    const calls: string[] = []
    const connector = new SendToOpenListConnector({
      fetch: async (input) => {
        calls.push(String(input))
        return json({
          code: 200,
          message: 'success',
          data: String(input).includes('/cancel?')
            ? null
            : [{
                id: 'task /? 你好',
                name: '<img src=x>',
                state: 1,
                status: 'running',
                progress: 25,
                total_bytes: 1024,
                error: '',
                creator: 'must be dropped',
              }],
        })
      },
    })
    await expect(connector.listTasks('https://openlist.example', 'primary', 'token', 'undone'))
      .resolves
      .toEqual([{
        id: 'task /? 你好',
        name: '<img src=x>',
        state: 1,
        status: 'running',
        progress: 25,
        totalBytes: 1024,
        error: '',
      }])
    await expect(connector.cancelTask('https://openlist.example', 'primary', 'token', 'task /? 你好'))
      .resolves
      .toEqual({ cancelled: true })
    expect(calls[1]).toBe('https://openlist.example/api/task/offline_download/cancel?tid=task%20%2F%3F%20%E4%BD%A0%E5%A5%BD')
  })
})
