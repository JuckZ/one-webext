import type { CapabilityRpcRequestEnvelope } from '@oneweb/module-sdk'
import {
  CAPABILITY_RPC_MAX_IN_FLIGHT,
  CAPABILITY_RPC_REQUEST_TIMEOUT_MS,
  capabilityRpcSchema,
  createCapabilityRpcCancelEnvelope,
  createCapabilityRpcRequestEnvelope,
  defineCapabilityRpcCatalog,
} from '@oneweb/module-sdk'
import { createModuleCapabilityDispatcher } from '../capability-dispatcher'

const catalog = defineCapabilityRpcCatalog({
  'conformance.echo': {
    operations: {
      echo: {
        request: capabilityRpcSchema.object({
          text: capabilityRpcSchema.string({ maximumLength: 128 }),
        }),
        result: capabilityRpcSchema.object({
          echoed: capabilityRpcSchema.string({ maximumLength: 128 }),
        }),
      },
    },
  },
} as const)

const binding = Object.freeze({
  moduleId: 'dev.oneweb.conformance.dispatcher',
  sessionId: 'session_123456789012345678901234',
  generation: 4,
})

class FakePort {
  readonly messages: unknown[] = []
  throwOnPost = false

  postMessage(message: unknown) {
    if (this.throwOnPost)
      throw new Error('synthetic port failure')
    this.messages.push(message)
  }
}

function request(requestId = 'request_12345678', text = 'safe') {
  return createCapabilityRpcRequestEnvelope(
    catalog,
    { ...binding, requestId },
    'conformance.echo',
    'echo',
    { text },
  )
}

function createFixture(options: {
  granted?: readonly string[]
  handlers?: Parameters<typeof createModuleCapabilityDispatcher<typeof catalog>>[0]['handlers']
  manifest?: readonly string[]
} = {}) {
  const port = new FakePort()
  const dispatcher = createModuleCapabilityDispatcher({
    binding,
    catalog,
    manifestCapabilities: options.manifest || ['conformance.echo'],
    grantedCapabilities: options.granted || ['conformance.echo'],
    handlers: options.handlers,
    port,
  })
  return { dispatcher, port }
}

async function settle() {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

describe('trusted module capability dispatcher skeleton', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('executes only an injected typed handler and returns a canonical frozen result', async () => {
    const handler = vi.fn(({ payload }) => {
      expect(Object.isFrozen(payload)).toBe(true)
      return { echoed: payload.text }
    })
    const { dispatcher, port } = createFixture({
      handlers: { 'conformance.echo': { echo: handler } },
    })
    expect(dispatcher.dispatch(request())).toBe(true)
    await settle()
    expect(handler).toHaveBeenCalledOnce()
    expect(port.messages).toHaveLength(1)
    expect(port.messages[0]).toMatchObject({
      ...binding,
      requestId: 'request_12345678',
      capability: 'conformance.echo',
      operation: 'echo',
      type: 'CAPABILITY_RESULT',
      result: { echoed: 'safe' },
    })
    expect(Object.isFrozen(port.messages[0])).toBe(true)
    dispatcher.destroy()
  })

  it('returns stable unavailable without a handler and does no privileged work', () => {
    const { dispatcher, port } = createFixture()
    dispatcher.dispatch(request())
    expect(port.messages).toEqual([expect.objectContaining({
      type: 'CAPABILITY_ERROR',
      code: 'CAPABILITY_UNAVAILABLE',
    })])
    expect(Object.keys(port.messages[0] as object)).not.toContain('details')
    dispatcher.destroy()
  })

  it('requires both manifest declaration and installed grant', () => {
    const undeclared = createFixture({ manifest: [] })
    undeclared.dispatcher.dispatch(request())
    expect(undeclared.port.messages).toEqual([expect.objectContaining({
      type: 'CAPABILITY_ERROR',
      code: 'CAPABILITY_NOT_DECLARED',
    })])

    const ungranted = createFixture({ granted: [] })
    ungranted.dispatcher.dispatch(request())
    expect(ungranted.port.messages).toEqual([expect.objectContaining({
      type: 'CAPABILITY_ERROR',
      code: 'CAPABILITY_NOT_ALLOWED',
    })])
    undeclared.dispatcher.destroy()
    ungranted.dispatcher.destroy()
  })

  it('rejects unknown operations and cross-module/session/generation substitution', () => {
    const { dispatcher, port } = createFixture()
    dispatcher.dispatch({ ...request(), operation: 'arbitrary-method' })
    dispatcher.dispatch({ ...request('request_unknown_capability'), capability: 'conformance.unknown' })
    dispatcher.dispatch({ ...request('request_oversized'), payload: { text: 'x'.repeat(16 * 1024) } })
    dispatcher.dispatch({ ...request('request_extra_payload'), payload: { text: 'safe', method: 'browser.call' } })
    for (const forged of [
      { ...request(), moduleId: 'dev.oneweb.conformance.other' },
      { ...request(), sessionId: 'session_aaaaaaaaaaaaaaaaaaaaaaaa' },
      { ...request(), generation: binding.generation + 1 },
      { ...request(), protocol: 'arbitrary.protocol' },
    ])
      dispatcher.dispatch(forged)
    expect(port.messages).toEqual([
      expect.objectContaining({ code: 'OPERATION_NOT_ALLOWED' }),
      expect.objectContaining({ code: 'CAPABILITY_NOT_DECLARED' }),
      expect.objectContaining({ code: 'PAYLOAD_TOO_LARGE' }),
      expect.objectContaining({ code: 'PAYLOAD_INVALID' }),
    ])

    const notAllowed = createFixture({ manifest: ['conformance.echo', 'conformance.unknown'] })
    notAllowed.dispatcher.dispatch({
      ...request('request_catalog_denied'),
      capability: 'conformance.unknown',
    })
    expect(notAllowed.port.messages).toEqual([
      expect.objectContaining({ code: 'CAPABILITY_NOT_ALLOWED' }),
    ])
    notAllowed.dispatcher.destroy()
    dispatcher.destroy()
  })

  it('does not start handler work cancelled or destroyed before its microtask and snapshots handlers', async () => {
    const original = vi.fn(({ payload }: { payload: { text: string } }) => ({ echoed: payload.text }))
    const replacement = vi.fn(() => ({ echoed: 'replacement' }))
    const handlers = { 'conformance.echo': { echo: original } }
    const cancelled = createFixture({ handlers })
    handlers['conformance.echo'].echo = replacement
    const pending = request()
    cancelled.dispatcher.dispatch(pending)
    cancelled.dispatcher.dispatch(createCapabilityRpcCancelEnvelope(pending))
    await settle()
    expect(original).not.toHaveBeenCalled()
    expect(replacement).not.toHaveBeenCalled()
    expect(cancelled.port.messages).toEqual([])
    cancelled.dispatcher.destroy()

    const destroyed = createFixture({ handlers: { 'conformance.echo': { echo: original } } })
    destroyed.dispatcher.dispatch(request('request_destroy_before_start'))
    destroyed.dispatcher.destroy()
    await settle()
    expect(original).not.toHaveBeenCalled()
  })

  it('makes cancellation terminal, aborts the handler and drops its late result', async () => {
    let resolveHandler: ((_result: { echoed: string }) => void) | undefined
    let handlerSignal: AbortSignal | undefined
    const { dispatcher, port } = createFixture({
      handlers: {
        'conformance.echo': {
          echo: ({ signal }) => new Promise((resolve) => {
            handlerSignal = signal
            resolveHandler = resolve
          }),
        },
      },
    })
    const pending = request()
    dispatcher.dispatch(pending)
    await Promise.resolve()
    expect(handlerSignal?.aborted).toBe(false)
    dispatcher.dispatch(createCapabilityRpcCancelEnvelope(pending))
    expect(handlerSignal?.aborted).toBe(true)
    resolveHandler?.({ echoed: 'late' })
    await settle()
    expect(port.messages).toEqual([])
    dispatcher.destroy()
  })

  it('maps thrown handlers and invalid results to one stable error without raw details', async () => {
    const thrown = createFixture({
      handlers: {
        'conformance.echo': {
          echo: () => {
            throw new Error('secret stack and host path')
          },
        },
      },
    })
    thrown.dispatcher.dispatch(request())
    await settle()
    expect(thrown.port.messages).toEqual([expect.objectContaining({
      type: 'CAPABILITY_ERROR',
      code: 'OPERATION_FAILED',
    })])
    expect(JSON.stringify(thrown.port.messages)).not.toContain('secret')

    const invalid = createFixture({
      handlers: {
        'conformance.echo': {
          echo: () => ({ echoed: 42 } as never),
        },
      },
    })
    invalid.dispatcher.dispatch(request())
    await settle()
    expect(invalid.port.messages).toEqual([expect.objectContaining({ code: 'OPERATION_FAILED' })])
    thrown.dispatcher.destroy()
    invalid.dispatcher.destroy()
  })

  it('enforces the in-flight quota and rejects duplicate IDs without replacing authority', async () => {
    const { dispatcher, port } = createFixture({
      handlers: {
        'conformance.echo': {
          echo: () => new Promise(() => {}),
        },
      },
    })
    for (let index = 0; index < CAPABILITY_RPC_MAX_IN_FLIGHT; index += 1)
      dispatcher.dispatch(request(`request_${String(index).padStart(8, '0')}`))
    await Promise.resolve()
    dispatcher.dispatch(request('request_overflow'))
    dispatcher.dispatch(request('request_00000000'))
    expect(port.messages).toEqual([
      expect.objectContaining({ requestId: 'request_overflow', code: 'IN_FLIGHT_LIMIT_REACHED' }),
      expect.objectContaining({ requestId: 'request_00000000', code: 'REQUEST_ID_REUSED' }),
    ])
    dispatcher.destroy()

    const total = createFixture()
    for (let index = 0; index < 1024; index += 1)
      total.dispatcher.dispatch(request(`request_total_${String(index).padStart(8, '0')}`))
    total.dispatcher.dispatch(request('request_total_overflow'))
    expect(total.port.messages).toHaveLength(1025)
    expect(total.port.messages.at(-1)).toMatchObject({ code: 'SESSION_REQUEST_LIMIT_REACHED' })
    total.dispatcher.destroy()
  })

  it('times out at 15 seconds, aborts work and ignores its late completion', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-29T00:00:00.000Z'))
    let signal: AbortSignal | undefined
    let resolveHandler: ((_result: { echoed: string }) => void) | undefined
    const { dispatcher, port } = createFixture({
      handlers: {
        'conformance.echo': {
          echo: context => new Promise((resolve) => {
            signal = context.signal
            resolveHandler = resolve
          }),
        },
      },
    })
    dispatcher.dispatch(request())
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(CAPABILITY_RPC_REQUEST_TIMEOUT_MS)
    expect(signal?.aborted).toBe(true)
    expect(port.messages).toEqual([expect.objectContaining({ code: 'REQUEST_TIMED_OUT' })])
    resolveHandler?.({ echoed: 'late' })
    await settle()
    expect(port.messages).toHaveLength(1)
    dispatcher.destroy()
  })

  it('destroys all pending authority on lifecycle loss and isolates dispatcher instances', async () => {
    let firstSignal: AbortSignal | undefined
    const first = createFixture({
      handlers: {
        'conformance.echo': {
          echo: ({ signal }) => {
            firstSignal = signal
            return new Promise(() => {})
          },
        },
      },
    })
    const second = createFixture()
    first.dispatcher.dispatch(request())
    await Promise.resolve()
    expect(first.dispatcher.destroy()).toBe(true)
    expect(first.dispatcher.destroy()).toBe(false)
    expect(firstSignal?.aborted).toBe(true)
    expect(first.dispatcher.dispatch(request('request_after_destroy'))).toBe(false)
    second.dispatcher.dispatch(request())
    expect(second.port.messages).toEqual([expect.objectContaining({ code: 'CAPABILITY_UNAVAILABLE' })])
    expect(first.port.messages).toEqual([])
    second.dispatcher.destroy()
  })

  it('destroys the dispatcher if posting to its authenticated port fails', () => {
    const { dispatcher, port } = createFixture()
    port.throwOnPost = true
    dispatcher.dispatch(request())
    expect(dispatcher.active).toBe(false)
  })
})

void (null as CapabilityRpcRequestEnvelope | null)
