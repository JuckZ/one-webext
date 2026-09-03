import type { BookmarkUrlProbeResult } from './contracts'
import { BOOKMARK_DOCTOR_PROBE_TIMEOUT_MS } from './contracts'

interface ProbeResponseBody {
  cancel: () => Promise<void>
}

export interface BookmarkProbeResponse {
  ok: boolean
  status: number
  body?: ProbeResponseBody | null
}

export interface BookmarkProbeFetch {
  (
    _url: string,
    _init: {
      method: 'GET'
      credentials: 'omit'
      cache: 'no-store'
      redirect: 'follow'
      signal: AbortSignal
    },
  ): Promise<BookmarkProbeResponse>
}

export interface BookmarkUrlProbeOptions {
  fetch?: BookmarkProbeFetch
  setTimer?: (_callback: () => void, _timeoutMs: number) => ReturnType<typeof setTimeout>
  clearTimer?: (_timer: ReturnType<typeof setTimeout>) => void
}

export class BookmarkUrlProbe {
  private readonly fetch: BookmarkProbeFetch
  private readonly setTimer: NonNullable<BookmarkUrlProbeOptions['setTimer']>
  private readonly clearTimer: NonNullable<BookmarkUrlProbeOptions['clearTimer']>

  constructor({
    fetch = (url, init) => globalThis.fetch(url, init as RequestInit),
    setTimer = (callback, timeoutMs) => globalThis.setTimeout(callback, timeoutMs),
    clearTimer = timer => globalThis.clearTimeout(timer),
  }: BookmarkUrlProbeOptions = {}) {
    this.fetch = fetch
    this.setTimer = setTimer
    this.clearTimer = clearTimer
  }

  async probe(
    url: string,
    signal: AbortSignal,
    timeoutMs: number = BOOKMARK_DOCTOR_PROBE_TIMEOUT_MS,
  ): Promise<BookmarkUrlProbeResult> {
    const controller = new AbortController()
    let timedOut = false
    const abortFromRun = () => controller.abort()
    signal.addEventListener('abort', abortFromRun, { once: true })
    if (signal.aborted)
      controller.abort()
    const timer = this.setTimer(() => {
      timedOut = true
      controller.abort()
    }, timeoutMs)

    try {
      const response = await this.fetch(url, {
        method: 'GET',
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'follow',
        signal: controller.signal,
      })
      await response.body?.cancel().catch(() => undefined)
      return {
        outcome: response.ok ? 'reachable' : 'http-error',
        httpStatus: response.status,
      }
    }
    catch {
      return {
        outcome: timedOut ? 'timeout' : 'network-failure',
        httpStatus: null,
      }
    }
    finally {
      this.clearTimer(timer)
      signal.removeEventListener('abort', abortFromRun)
    }
  }
}
