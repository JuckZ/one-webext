import type { SendToOpenListStableErrorCode } from './contracts'
import {
  SEND_TO_OPENLIST_MAX_RESPONSE_BYTES,
  SEND_TO_OPENLIST_REQUEST_TIMEOUT_MS,
} from './contracts'
import { normalizeSendToOpenListTasks, normalizeSendToOpenListTools } from './results'
import { utf8ByteLength } from './validation'

export type SendToOpenListConnectorErrorCode = Extract<SendToOpenListStableErrorCode, | 'authentication-failed'
  | 'http-error'
  | 'upstream-rejected'
  | 'network-failed'
  | 'outcome-unknown'
  | 'protocol-incompatible'
  | 'response-too-large'>

export class SendToOpenListConnectorError extends Error {
  constructor(readonly code: SendToOpenListConnectorErrorCode) {
    super(code)
    this.name = 'SendToOpenListConnectorError'
  }
}

export interface SendToOpenListConnectorOptions {
  fetch?: typeof globalThis.fetch
  timeoutMs?: number
}

interface UpstreamEnvelope {
  code: number
  message: string
  data: unknown
}

function clientId(profileId: string, origin: string) {
  let hash = 2166136261
  const source = `${profileId}\0${origin}`
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `oneweb-${(hash >>> 0).toString(16).padStart(8, '0')}`
}

function parseEnvelope(input: unknown): UpstreamEnvelope | null {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    return null
  const record = input as Record<string, unknown>
  if (!Number.isSafeInteger(record.code)
    || typeof record.message !== 'string'
    || utf8ByteLength(record.message) > 512
    || !Object.prototype.hasOwnProperty.call(record, 'data')) {
    return null
  }
  return { code: Number(record.code), message: record.message, data: record.data }
}

async function readBoundedResponse(response: Response) {
  const declared = response.headers.get('content-length')
  if (declared !== null && Number(declared) > SEND_TO_OPENLIST_MAX_RESPONSE_BYTES)
    throw new SendToOpenListConnectorError('response-too-large')
  if (!response.body) {
    const text = await response.text()
    if (utf8ByteLength(text) > SEND_TO_OPENLIST_MAX_RESPONSE_BYTES)
      throw new SendToOpenListConnectorError('response-too-large')
    return text
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done)
        break
      total += chunk.value.byteLength
      if (total > SEND_TO_OPENLIST_MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined)
        throw new SendToOpenListConnectorError('response-too-large')
      }
      chunks.push(chunk.value)
    }
  }
  finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(bytes)
}

export class SendToOpenListConnector {
  private readonly fetcher: typeof globalThis.fetch
  private readonly timeoutMs: number

  constructor({ fetch = globalThis.fetch, timeoutMs = SEND_TO_OPENLIST_REQUEST_TIMEOUT_MS }: SendToOpenListConnectorOptions = {}) {
    this.fetcher = fetch
    this.timeoutMs = timeoutMs
  }

  private async request(
    origin: string,
    profileId: string,
    path: string,
    options: { method: 'GET' | 'POST', token?: string, body?: string, signal?: AbortSignal },
  ) {
    const abort = new AbortController()
    const relayAbort = () => abort.abort()
    options.signal?.addEventListener('abort', relayAbort, { once: true })
    const timeout = globalThis.setTimeout(() => abort.abort(), this.timeoutMs)
    const writeStarted = options.method === 'POST'
    let response: Response
    try {
      response = await this.fetcher.call(globalThis, `${origin}${path}`, {
        method: options.method,
        headers: {
          'accept': 'application/json',
          'client-id': clientId(profileId, origin),
          ...(options.token === undefined ? {} : { authorization: options.token }),
          ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(options.body === undefined ? {} : { body: options.body }),
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'manual',
        referrerPolicy: 'no-referrer',
        signal: abort.signal,
      })
    }
    catch {
      globalThis.clearTimeout(timeout)
      options.signal?.removeEventListener('abort', relayAbort)
      throw new SendToOpenListConnectorError(writeStarted ? 'outcome-unknown' : 'network-failed')
    }
    try {
      if (response.redirected || (response.status >= 300 && response.status < 400))
        throw new SendToOpenListConnectorError('protocol-incompatible')
      if (response.status === 401 || response.status === 403)
        throw new SendToOpenListConnectorError('authentication-failed')
      if (!response.ok)
        throw new SendToOpenListConnectorError('http-error')
      let value: unknown
      try {
        value = JSON.parse(await readBoundedResponse(response))
      }
      catch (error) {
        if (error instanceof SendToOpenListConnectorError)
          throw error
        throw new SendToOpenListConnectorError('protocol-incompatible')
      }
      const envelope = parseEnvelope(value)
      if (!envelope)
        throw new SendToOpenListConnectorError('protocol-incompatible')
      if (envelope.code === 401 || envelope.code === 403)
        throw new SendToOpenListConnectorError('authentication-failed')
      if (envelope.code !== 200)
        throw new SendToOpenListConnectorError('upstream-rejected')
      return envelope.data
    }
    finally {
      globalThis.clearTimeout(timeout)
      options.signal?.removeEventListener('abort', relayAbort)
    }
  }

  async verify(origin: string, profileId: string, token: string, signal?: AbortSignal) {
    const data = await this.request(origin, profileId, '/api/me', { method: 'GET', token, signal })
    if (!data || typeof data !== 'object' || Array.isArray(data))
      throw new SendToOpenListConnectorError('protocol-incompatible')
    return { authenticated: true as const }
  }

  async discoverTools(origin: string, profileId: string, destinationPath: string, signal?: AbortSignal) {
    const data = await this.request(
      origin,
      profileId,
      `/api/public/offline_download_tools?path=${encodeURIComponent(destinationPath)}`,
      { method: 'GET', signal },
    )
    const normalized = normalizeSendToOpenListTools(data)
    if (!normalized.ok) {
      throw new SendToOpenListConnectorError(
        normalized.code === 'response-too-large' ? 'response-too-large' : 'protocol-incompatible',
      )
    }
    return normalized.value
  }

  async addResource(
    origin: string,
    profileId: string,
    token: string,
    input: { url: string, destinationPath: string, tool: string },
    signal?: AbortSignal,
  ) {
    const data = await this.request(origin, profileId, '/api/fs/add_offline_download', {
      method: 'POST',
      token,
      body: JSON.stringify({
        urls: [input.url],
        path: input.destinationPath,
        tool: input.tool,
        delete_policy: 'delete_on_upload_succeed',
      }),
      signal,
    })
    if (!data || typeof data !== 'object' || Array.isArray(data))
      throw new SendToOpenListConnectorError('protocol-incompatible')
    const tasks = (data as Record<string, unknown>).tasks
    if (!Array.isArray(tasks) || tasks.length > 1)
      throw new SendToOpenListConnectorError('protocol-incompatible')
    if (tasks.length === 0)
      return null
    const task = tasks[0]
    const id = task && typeof task === 'object' && !Array.isArray(task)
      ? (task as Record<string, unknown>).id
      : null
    if (typeof id !== 'string' || !id)
      throw new SendToOpenListConnectorError('protocol-incompatible')
    return id
  }

  async listTasks(
    origin: string,
    profileId: string,
    token: string,
    list: 'undone' | 'done',
    signal?: AbortSignal,
  ) {
    const data = await this.request(
      origin,
      profileId,
      `/api/task/offline_download/${list}`,
      { method: 'GET', token, signal },
    )
    const normalized = normalizeSendToOpenListTasks(data)
    if (!normalized.ok) {
      throw new SendToOpenListConnectorError(
        normalized.code === 'response-too-large' ? 'response-too-large' : 'protocol-incompatible',
      )
    }
    return normalized.value
  }

  async cancelTask(
    origin: string,
    profileId: string,
    token: string,
    taskId: string,
    signal?: AbortSignal,
  ) {
    await this.request(
      origin,
      profileId,
      `/api/task/offline_download/cancel?tid=${encodeURIComponent(taskId)}`,
      { method: 'POST', token, signal },
    )
    return { cancelled: true as const }
  }
}
