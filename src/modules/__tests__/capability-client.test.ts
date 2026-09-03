import type {
  CapabilityRpcClientPortEventType,
  CapabilityRpcClientPortListener,
} from '@oneweb/module-sdk'
import {
  CAPABILITY_RPC_MAX_IN_FLIGHT,
  CAPABILITY_RPC_REQUEST_TIMEOUT_MS,
  CapabilityRpcClientError,
  capabilityRpcSchema,
  createCapabilityRpcCancelEnvelope,
  createCapabilityRpcClient,
  createCapabilityRpcErrorEnvelope,
  createCapabilityRpcResultEnvelope,
  defineCapabilityRpcCatalog,
} from '@oneweb/module-sdk'

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
  moduleId: 'dev.oneweb.conformance.client',
  sessionId: 'session_123456789012345678901234',
  generation: 3,
})

class FakePort {
  readonly messages: unknown[] = []
  readonly listeners = new Map<CapabilityRpcClientPortEventType, Set<CapabilityRpcClientPortListener>>()
  throwOnPost = false

  addEventListener(type: CapabilityRpcClientPortEventType, listener: CapabilityRpcClientPortListener) {
    const listeners = this.listeners.get(type) || new Set()
    listeners.add(listener)
    this.listeners.set(type, listeners)
  }

  removeEventListener(type: CapabilityRpcClientPortEventType, listener: CapabilityRpcClientPortListener) {
    this.listeners.get(type)?.delete(listener)
  }

  postMessage(message: unknown) {
    if (this.throwOnPost)
      throw new Error('synthetic port failure')
    this.messages.push(message)
  }

  emit(type: CapabilityRpcClientPortEventType, data: unknown) {
    for (const listener of this.listeners.get(type) || [])
      listener({ data })
  }
}

function createFixture() {
  const port = new FakePort()
  const client = createCapabilityRpcClient({ binding, catalog, port })
  return { client, port }
}

function requestFrom(port: FakePort, index = 0) {
  const request = port.messages[index]
  if (!request || typeof request !== 'object' || !('requestId' in request))
    throw new Error('expected a capability request')
  return request as Parameters<typeof createCapabilityRpcErrorEnvelope>[0]
}

describe('capability RPC SDK client', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('binds a typed request to canonical session identity and accepts only a matching frozen result', async () => {
    const { client, port } = createFixture()
    const payload = { text: 'safe' }
    const handle = client.request('conformance.echo', 'echo', payload)
    payload.text = 'mutated'
    const request = requestFrom(port)
    expect(request).toMatchObject({
      ...binding,
      type: 'CAPABILITY_REQUEST',
      capability: 'conformance.echo',
      operation: 'echo',
      payload: { text: 'safe' },
    })
    expect(request.requestId).toMatch(/^request-[0-9a-f]{48}$/)
    expect(Object.isFrozen(request)).toBe(true)
    expect(Object.isFrozen(request.payload)).toBe(true)
    expect(() => client.request(
      'conformance.echo',
      'echo',
      { text: 'safe', moduleId: 'attacker.value' } as never,
    )).toThrow('PAYLOAD_INVALID')
    expect(() => client.request(
      'conformance.echo',
      'echo',
      { text: 'x'.repeat(16 * 1024) },
    )).toThrow('PAYLOAD_TOO_LARGE')

    const response = createCapabilityRpcResultEnvelope(catalog, request as never, { echoed: 'safe' })
    port.emit('message', response)
    const result = await handle.result
    expect(result).toEqual({ echoed: 'safe' })
    expect(Object.isFrozen(result)).toBe(true)
    expect(handle.cancel()).toBe(false)
    client.destroy()
  })

  it('ignores forged and replaced responses before accepting the exact original response', async () => {
    const { client, port } = createFixture()
    const handle = client.request('conformance.echo', 'echo', { text: 'safe' })
    const request = requestFrom(port)
    const response = createCapabilityRpcResultEnvelope(catalog, request as never, { echoed: 'safe' })
    for (const forged of [
      { ...response, moduleId: 'dev.oneweb.conformance.other' },
      { ...response, sessionId: 'session_aaaaaaaaaaaaaaaaaaaaaaaa' },
      { ...response, generation: binding.generation + 1 },
      { ...response, capability: 'conformance.replaced' },
      { ...response, operation: 'replaced' },
      { ...response, result: { echoed: 'safe' }, extra: true },
    ])
      port.emit('message', forged)

    let settled = false
    void handle.result.finally(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)
    port.emit('message', response)
    await expect(handle.result).resolves.toEqual({ echoed: 'safe' })
    client.destroy()
  })

  it('surfaces stable unavailable errors without accepting host details', async () => {
    const { client, port } = createFixture()
    const handle = client.request('conformance.echo', 'echo', { text: 'safe' })
    const request = requestFrom(port)
    port.emit('message', {
      ...createCapabilityRpcErrorEnvelope(request, 'CAPABILITY_UNAVAILABLE'),
      details: 'secret host stack',
    })
    port.emit('message', createCapabilityRpcErrorEnvelope(request, 'CAPABILITY_UNAVAILABLE'))
    await expect(handle.result).rejects.toMatchObject({
      name: 'CapabilityRpcClientError',
      code: 'CAPABILITY_UNAVAILABLE',
      message: 'CAPABILITY_UNAVAILABLE',
    })
    client.destroy()
  })

  it('makes cancellation terminal and ignores a late result', async () => {
    const { client, port } = createFixture()
    const handle = client.request('conformance.echo', 'echo', { text: 'safe' })
    const request = requestFrom(port)
    expect(client.cancel(handle.requestId)).toBe(true)
    expect(port.messages[1]).toMatchObject({
      ...binding,
      requestId: handle.requestId,
      type: 'CAPABILITY_CANCEL',
    })
    await expect(handle.result).rejects.toMatchObject({ code: 'REQUEST_CANCELLED' })
    port.emit('message', createCapabilityRpcResultEnvelope(catalog, request as never, { echoed: 'late' }))
    expect(client.cancel(handle.requestId)).toBe(false)
    client.destroy()
  })

  it('accepts only a host cancellation that matches the full original request identity', async () => {
    const { client, port } = createFixture()
    const handle = client.request('conformance.echo', 'echo', { text: 'safe' })
    const request = requestFrom(port)
    const cancel = createCapabilityRpcCancelEnvelope(request)
    port.emit('message', { ...cancel, generation: binding.generation + 1 })
    port.emit('message', { ...cancel, operation: 'replaced' })
    port.emit('message', cancel)
    await expect(handle.result).rejects.toMatchObject({ code: 'REQUEST_CANCELLED' })
    client.destroy()
  })

  it('times out at the fixed deadline and ignores every later response', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-29T00:00:00.000Z'))
    const { client, port } = createFixture()
    const handle = client.request('conformance.echo', 'echo', { text: 'safe' })
    const request = requestFrom(port)
    const rejection = expect(handle.result).rejects.toMatchObject({ code: 'REQUEST_TIMED_OUT' })
    await vi.advanceTimersByTimeAsync(CAPABILITY_RPC_REQUEST_TIMEOUT_MS)
    await rejection
    port.emit('message', createCapabilityRpcResultEnvelope(catalog, request as never, { echoed: 'late' }))
    client.destroy()
  })

  it('enforces per-session in-flight limits and unique high-entropy request IDs', async () => {
    const { client } = createFixture()
    const handles = Array.from({ length: CAPABILITY_RPC_MAX_IN_FLIGHT }, () =>
      client.request('conformance.echo', 'echo', { text: 'pending' }))
    expect(new Set(handles.map(handle => handle.requestId)).size).toBe(CAPABILITY_RPC_MAX_IN_FLIGHT)
    expect(() => client.request('conformance.echo', 'echo', { text: 'overflow' }))
      .toThrowError(new CapabilityRpcClientError('IN_FLIGHT_LIMIT_REACHED'))
    const rejections = handles.map(handle => expect(handle.result).rejects.toMatchObject({ code: 'SESSION_DESTROYED' }))
    client.destroy()
    await Promise.all(rejections)

    const total = createFixture()
    const terminalResults: Array<Promise<string>> = []
    for (let index = 0; index < 1024; index += 1) {
      const handle = total.client.request('conformance.echo', 'echo', { text: 'terminal' })
      terminalResults.push(handle.result.catch(error => error.code))
      total.port.emit('message', createCapabilityRpcErrorEnvelope(
        requestFrom(total.port, index),
        'CAPABILITY_UNAVAILABLE',
      ))
    }
    expect(() => total.client.request('conformance.echo', 'echo', { text: 'overflow' }))
      .toThrowError(new CapabilityRpcClientError('SESSION_REQUEST_LIMIT_REACHED'))
    expect(new Set(await Promise.all(terminalResults))).toEqual(new Set(['CAPABILITY_UNAVAILABLE']))
    total.client.destroy()
  })

  it('atomically rejects pending work on destroy, port failure and post failure', async () => {
    const destroyed = createFixture()
    const first = destroyed.client.request('conformance.echo', 'echo', { text: 'destroy' })
    const firstRejection = expect(first.result).rejects.toMatchObject({ code: 'SESSION_DESTROYED' })
    expect(destroyed.client.destroy()).toBe(true)
    expect(destroyed.client.destroy()).toBe(false)
    await firstRejection
    expect(destroyed.port.listeners.get('message')?.size || 0).toBe(0)

    const failed = createFixture()
    const second = failed.client.request('conformance.echo', 'echo', { text: 'failure' })
    const secondRejection = expect(second.result).rejects.toMatchObject({ code: 'SESSION_DESTROYED' })
    failed.port.emit('messageerror', null)
    await secondRejection
    expect(failed.client.active).toBe(false)

    const postFailure = createFixture()
    postFailure.port.throwOnPost = true
    const third = postFailure.client.request('conformance.echo', 'echo', { text: 'post' })
    await expect(third.result).rejects.toMatchObject({ code: 'SESSION_DESTROYED' })
    expect(postFailure.client.active).toBe(false)
  })

  it('keeps instances and identical operation calls isolated', async () => {
    const first = createFixture()
    const secondPort = new FakePort()
    const second = createCapabilityRpcClient({
      binding: {
        moduleId: 'dev.oneweb.conformance.second',
        sessionId: 'session_aaaaaaaaaaaaaaaaaaaaaaaa',
        generation: 1,
      },
      catalog,
      port: secondPort,
    })
    const firstHandle = first.client.request('conformance.echo', 'echo', { text: 'first' })
    const secondHandle = second.request('conformance.echo', 'echo', { text: 'second' })
    secondPort.emit('message', createCapabilityRpcResultEnvelope(
      catalog,
      requestFrom(secondPort) as never,
      { echoed: 'second' },
    ))
    await expect(secondHandle.result).resolves.toEqual({ echoed: 'second' })
    const firstRejection = expect(firstHandle.result).rejects.toMatchObject({ code: 'SESSION_DESTROYED' })
    first.client.destroy()
    await firstRejection
    expect(second.active).toBe(true)
    second.destroy()
  })
})
