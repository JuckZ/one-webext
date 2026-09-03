import type { NormalizedBookmarkEntry } from '../contracts'
import { classifyBookmarkUrl } from '../normalize'
import { type BookmarkProbeFetch, BookmarkUrlProbe } from '../probe'
import { BookmarkScanCoordinator } from '../scanner'

function entry(index: number, url: string): NormalizedBookmarkEntry {
  return {
    entryId: `entry-${index}`,
    bookmarkId: String(index),
    parentId: null,
    title: `Bookmark ${index}`,
    url,
    folderPath: [],
    treePath: [index],
    dateAdded: null,
    urlClassification: classifyBookmarkUrl(url),
  }
}

describe('bookmark URL probe', () => {
  afterEach(() => vi.useRealTimers())

  it('uses a credential-free no-store GET, cancels the body and classifies HTTP status', async () => {
    const cancel = vi.fn(async () => undefined)
    const fetch: BookmarkProbeFetch = vi.fn(async () => ({ ok: true, status: 204, body: { cancel } }))
    const probe = new BookmarkUrlProbe({ fetch })
    const signal = new AbortController().signal

    await expect(probe.probe('https://example.com/path', signal)).resolves.toEqual({
      outcome: 'reachable',
      httpStatus: 204,
    })
    expect(fetch).toHaveBeenCalledWith('https://example.com/path', expect.objectContaining({
      method: 'GET',
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'follow',
      signal: expect.any(AbortSignal),
    }))
    expect(cancel).toHaveBeenCalledOnce()

    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 503, body: null })
    await expect(probe.probe('https://example.com/error', signal)).resolves.toEqual({
      outcome: 'http-error',
      httpStatus: 503,
    })
  })

  it('distinguishes the fixed timeout from a network failure', async () => {
    vi.useFakeTimers()
    const timedFetch = vi.fn((_url: string, init: { signal: AbortSignal }) => new Promise<never>((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
    }))
    const probe = new BookmarkUrlProbe({ fetch: timedFetch })
    const pending = probe.probe('https://slow.example', new AbortController().signal)
    await vi.advanceTimersByTimeAsync(7_999)
    let settled = false
    void pending.then(() => settled = true)
    await Promise.resolve()
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await expect(pending).resolves.toEqual({ outcome: 'timeout', httpStatus: null })

    const failed = new BookmarkUrlProbe({ fetch: vi.fn(async () => Promise.reject(new Error('offline'))) })
    await expect(failed.probe('https://offline.example', new AbortController().signal)).resolves.toEqual({
      outcome: 'network-failure',
      httpStatus: null,
    })
  })
})

describe('bookmark scan coordinator', () => {
  afterEach(() => vi.useRealTimers())

  it('never exceeds four workers and always passes the eight-second timeout', async () => {
    vi.useFakeTimers()
    let active = 0
    let maximum = 0
    const probe = {
      probe: vi.fn(async (_url: string, _signal: AbortSignal, _timeoutMs?: number) => {
        active += 1
        maximum = Math.max(maximum, active)
        await new Promise(resolve => setTimeout(resolve, 10))
        active -= 1
        return { outcome: 'reachable' as const, httpStatus: 200 }
      }),
    }
    const scanner = new BookmarkScanCoordinator({
      probe,
      now: () => '2026-08-28T00:00:00.000Z',
      createRunId: () => 'run-1',
    })
    const pending = scanner.start(Array.from({ length: 12 }, (_, index) => entry(index, `https://example.com/${index}`)))
    await vi.advanceTimersByTimeAsync(100)
    const result = await pending

    expect(maximum).toBe(4)
    expect(probe.probe).toHaveBeenCalledTimes(12)
    expect(vi.mocked(probe.probe).mock.calls.every(call => call[2] === 8_000)).toBe(true)
    expect(result).toMatchObject({ status: 'completed', total: 12, completed: 12 })
  })

  it('stops active requests, leaves queued URLs untouched and rejects stale results', async () => {
    let firstRun = true
    const probe = {
      probe: vi.fn((_url: string, signal: AbortSignal) => {
        if (!firstRun)
          return Promise.resolve({ outcome: 'reachable' as const, httpStatus: 200 })
        return new Promise<{ outcome: 'network-failure', httpStatus: null }>((resolve) => {
          signal.addEventListener('abort', () => resolve({ outcome: 'network-failure', httpStatus: null }), { once: true })
        })
      }),
    }
    let run = 0
    const scanner = new BookmarkScanCoordinator({ probe, createRunId: () => `run-${++run}` })
    const stoppedRun = scanner.start(Array.from({ length: 10 }, (_, index) => entry(index, `https://slow.example/${index}`)))
    await vi.waitFor(() => expect(probe.probe).toHaveBeenCalledTimes(4))
    expect(scanner.stop()).toBe(true)
    firstRun = false
    const completedRun = await scanner.start([entry(20, 'https://fresh.example')])
    await stoppedRun

    expect(completedRun).toMatchObject({ runId: 'run-2', status: 'completed', completed: 1 })
    expect(scanner.getSnapshot()).toEqual(completedRun)
    expect(scanner.getSnapshot()?.results.map(result => result.url)).toEqual(['https://fresh.example/'])
    expect(probe.probe).toHaveBeenCalledTimes(5)
  })

  it('never probes non-HTTP(S) entries', async () => {
    const probe = {
      probe: vi.fn(async (_url: string, _signal: AbortSignal, _timeoutMs?: number) => ({ outcome: 'reachable' as const, httpStatus: 200 })),
    }
    const scanner = new BookmarkScanCoordinator({ probe, createRunId: () => 'run-http-only' })
    const result = await scanner.start([
      entry(1, 'https://secure.example'),
      entry(2, 'http://localhost:8080/ok'),
      entry(3, 'file:///tmp/private'),
      entry(4, 'chrome://settings'),
      entry(5, 'mailto:user@example.com'),
    ])

    expect(probe.probe.mock.calls.map(call => call[0])).toEqual([
      'https://secure.example/',
      'http://localhost:8080/ok',
    ])
    expect(result).toMatchObject({ total: 2, completed: 2 })
  })

  it('publishes only the four MVP result classes', async () => {
    const outcomes = [
      { outcome: 'reachable' as const, httpStatus: 200 },
      { outcome: 'http-error' as const, httpStatus: 404 },
      { outcome: 'timeout' as const, httpStatus: null },
      { outcome: 'network-failure' as const, httpStatus: null },
    ]
    const probe = { probe: vi.fn(async () => outcomes.shift()!) }
    const scanner = new BookmarkScanCoordinator({ probe, createRunId: () => 'run-outcomes' })
    const result = await scanner.start(Array.from(
      { length: 4 },
      (_, index) => entry(index, `https://result.example/${index}`),
    ))

    expect(result.results.map(item => [item.outcome, item.httpStatus])).toEqual([
      ['reachable', 200],
      ['http-error', 404],
      ['timeout', null],
      ['network-failure', null],
    ])
  })
})
