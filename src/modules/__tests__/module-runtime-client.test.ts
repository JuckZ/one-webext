import type {
  RemoteFrameContextUpdate,
  RemoteFrameRuntimeAdapter,
  RemoteFrameRuntimeMessagePort,
  RemoteFrameRuntimePortEventType,
  RemoteFrameRuntimePortListener,
  RemoteFrameRuntimeWindowListener,
} from '@oneweb/module-sdk'
import {
  capabilityRpcSchema,
  createCapabilityRpcResultEnvelope,
  createModuleEnvelope,
  createRemoteFrameRuntimeClient,
  defineCapabilityRpcCatalog,
  normalizeRemoteFrameParentOrigin,
  ONEWEB_MODULE_PROTOCOL,
  ONEWEB_MODULE_PROTOCOL_VERSION,
} from '@oneweb/module-sdk'
import {
  beginRemoteFrameRuntime,
  connectRemoteFrameRuntime,
  createRemoteFrameRuntimeState,
  destroyRemoteFrameRuntime,
} from '../../../packages/module-sdk/src/runtime-state'

const moduleId = 'dev.oneweb.runtime.fixture'
const parentOrigin = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop'
const sessionNonce = '0123456789abcdefghijklmnop'
const capabilityCatalog = defineCapabilityRpcCatalog({
  'conformance.echo': {
    operations: {
      echo: {
        request: capabilityRpcSchema.object({
          text: capabilityRpcSchema.string({ maximumLength: 64 }),
        }),
        result: capabilityRpcSchema.object({
          echoed: capabilityRpcSchema.string({ maximumLength: 64 }),
        }),
      },
    },
  },
} as const)

class FakePort implements RemoteFrameRuntimeMessagePort {
  readonly messages: unknown[] = []
  readonly listeners = new Map<RemoteFrameRuntimePortEventType, Set<RemoteFrameRuntimePortListener>>()
  closed = false
  starts = 0
  throwOnPost = false

  addEventListener(type: RemoteFrameRuntimePortEventType, listener: RemoteFrameRuntimePortListener) {
    const listeners = this.listeners.get(type) || new Set()
    listeners.add(listener)
    this.listeners.set(type, listeners)
  }

  removeEventListener(type: RemoteFrameRuntimePortEventType, listener: RemoteFrameRuntimePortListener) {
    this.listeners.get(type)?.delete(listener)
  }

  postMessage(message: unknown) {
    if (this.throwOnPost)
      throw new Error('Synthetic port failure')
    this.messages.push(structuredClone(message))
  }

  start() {
    this.starts++
  }

  close() {
    this.closed = true
  }

  emit(type: RemoteFrameRuntimePortEventType, data: unknown) {
    for (const listener of [...(this.listeners.get(type) || [])])
      listener({ data })
  }
}

class FakeAdapter implements RemoteFrameRuntimeAdapter {
  readonly parent = {}
  readonly listeners = new Set<RemoteFrameRuntimeWindowListener>()
  readonly posts: Array<{ message: unknown, targetOrigin: string }> = []
  throwOnPost = false

  addMessageListener(listener: RemoteFrameRuntimeWindowListener) {
    this.listeners.add(listener)
  }

  removeMessageListener(listener: RemoteFrameRuntimeWindowListener) {
    this.listeners.delete(listener)
  }

  postToParent(message: unknown, targetOrigin: string) {
    if (this.throwOnPost)
      throw new Error('Synthetic parent failure')
    this.posts.push({ message: structuredClone(message), targetOrigin })
  }

  dispatch(event: Parameters<RemoteFrameRuntimeWindowListener>[0]) {
    for (const listener of [...this.listeners])
      listener(event)
  }
}

function createFixture(
  onContextUpdate: (_update: RemoteFrameContextUpdate) => void = vi.fn(),
  onConnected?: (_initFields: Readonly<Record<string, unknown>>) => void | Promise<void>,
) {
  const adapter = new FakeAdapter()
  const client = createRemoteFrameRuntimeClient({
    adapter,
    moduleId,
    onConnected,
    parentOrigin,
    onContextUpdate,
  })
  return { adapter, client, onContextUpdate }
}

function readHello(adapter: FakeAdapter) {
  const message = adapter.posts[0]?.message as { challenge?: unknown }
  if (typeof message?.challenge !== 'string')
    throw new Error('Expected runtime hello challenge')
  return { challenge: message.challenge, message }
}

function initEvent(
  adapter: FakeAdapter,
  challenge: string,
  port: FakePort,
  overrides: {
    data?: Record<string, unknown>
    origin?: string
    ports?: RemoteFrameRuntimeMessagePort[]
    source?: unknown
  } = {},
) {
  const canonical = createModuleEnvelope(moduleId, 'MODULE_INIT', {
    challenge,
    sessionNonce,
  })
  const data = { ...canonical, ...(overrides.data || {}) }
  return {
    data,
    origin: overrides.origin || parentOrigin,
    ports: overrides.ports || [port],
    source: overrides.source || adapter.parent,
  }
}

async function settleRuntime() {
  await Promise.resolve()
  await Promise.resolve()
}

describe('remote-frame runtime client', () => {
  it('keeps lifecycle transitions pure and clears authority at destruction', () => {
    const idle = createRemoteFrameRuntimeState()
    expect(idle).toEqual({ status: 'idle', challenge: null, sessionNonce: null })
    const begun = beginRemoteFrameRuntime(idle, 'challenge-123456789012345678901234')
    expect(begun).toMatchObject({ ok: true, state: { status: 'hello-sent' } })
    if (!begun.ok)
      throw new Error('Expected hello transition')
    expect(connectRemoteFrameRuntime(begun.state, 'stale-challenge', sessionNonce)).toMatchObject({
      ok: false,
      reason: 'challenge-mismatch',
    })
    expect(connectRemoteFrameRuntime(begun.state, begun.state.challenge || '', 'short')).toMatchObject({
      ok: false,
      reason: 'nonce-too-short',
    })
    const connected = connectRemoteFrameRuntime(begun.state, begun.state.challenge || '', sessionNonce)
    expect(connected).toMatchObject({ ok: true, state: { status: 'connected', challenge: null, sessionNonce } })
    if (!connected.ok)
      throw new Error('Expected connected transition')
    expect(destroyRemoteFrameRuntime(connected.state)).toEqual({
      status: 'destroyed',
      challenge: null,
      sessionNonce: null,
    })
  })

  it('performs one canonical handshake and delivers only validated context updates', () => {
    const fixture = createFixture()
    expect(fixture.client.start()).toBe(true)
    expect(fixture.client.start()).toBe(false)
    expect(fixture.client.status).toBe('hello-sent')
    expect(fixture.adapter.posts).toHaveLength(1)
    const hello = readHello(fixture.adapter)
    expect(hello.challenge).toMatch(/^[0-9a-f]{48}$/)
    expect(hello.message).toMatchObject({
      protocol: ONEWEB_MODULE_PROTOCOL,
      version: ONEWEB_MODULE_PROTOCOL_VERSION,
      moduleId,
      type: 'MODULE_HELLO',
    })

    const port = new FakePort()
    fixture.adapter.dispatch(initEvent(fixture.adapter, hello.challenge, port))
    expect(fixture.client.status).toBe('connected')
    expect(fixture.adapter.listeners.size).toBe(0)
    expect(port.starts).toBe(1)
    expect(port.messages).toEqual([{
      protocol: ONEWEB_MODULE_PROTOCOL,
      version: ONEWEB_MODULE_PROTOCOL_VERSION,
      moduleId,
      type: 'MODULE_READY',
      sessionNonce,
    }])

    port.emit('message', createModuleEnvelope(moduleId, 'UNKNOWN', { sessionNonce }))
    port.emit('message', createModuleEnvelope(moduleId, 'CONTEXT_UPDATE', {
      contexts: { 'tab.basic': { title: '<img onerror=owned>' } },
      revision: '1',
      sessionNonce,
    }))
    expect(fixture.onContextUpdate).toHaveBeenCalledOnce()
    expect(fixture.onContextUpdate).toHaveBeenCalledWith({
      revision: '1',
      contexts: { 'tab.basic': { title: '<img onerror=owned>' } },
    })
  })

  it('binds typed RPC to the authenticated runtime session and host generation', async () => {
    const adapter = new FakeAdapter()
    const client = createRemoteFrameRuntimeClient({
      adapter,
      capabilityRpcCatalog: capabilityCatalog,
      moduleId,
      parentOrigin,
      onContextUpdate() {},
    })
    client.start()
    const port = new FakePort()
    adapter.dispatch(initEvent(adapter, readHello(adapter).challenge, port, {
      data: { capabilityGeneration: 9 },
    }))
    expect(port.messages[0]).toMatchObject({ type: 'MODULE_READY', sessionNonce })

    const handle = client.request('conformance.echo', 'echo', { text: 'runtime' })
    const request = port.messages[1] as Parameters<typeof createCapabilityRpcResultEnvelope>[1]
    expect(request).toMatchObject({
      moduleId,
      sessionId: sessionNonce,
      generation: 9,
      requestId: handle.requestId,
      capability: 'conformance.echo',
      operation: 'echo',
    })
    port.emit('message', createCapabilityRpcResultEnvelope(
      capabilityCatalog,
      request as never,
      { echoed: 'runtime' },
    ))
    await expect(handle.result).resolves.toEqual({ echoed: 'runtime' })
    client.destroy()
  })

  it('rejects missing generations and destroys pending RPC authority with the runtime', async () => {
    const missingAdapter = new FakeAdapter()
    const missing = createRemoteFrameRuntimeClient({
      adapter: missingAdapter,
      capabilityRpcCatalog: capabilityCatalog,
      moduleId,
      parentOrigin,
      onContextUpdate() {},
    })
    missing.start()
    const missingPort = new FakePort()
    missingAdapter.dispatch(initEvent(missingAdapter, readHello(missingAdapter).challenge, missingPort))
    expect(missing.status).toBe('destroyed')
    expect(missingPort.closed).toBe(true)
    expect(missingPort.messages).toEqual([])

    const adapter = new FakeAdapter()
    const client = createRemoteFrameRuntimeClient({
      adapter,
      capabilityRpcCatalog: capabilityCatalog,
      moduleId,
      parentOrigin,
      onContextUpdate() {},
    })
    client.start()
    const port = new FakePort()
    adapter.dispatch(initEvent(adapter, readHello(adapter).challenge, port, {
      data: { capabilityGeneration: 1 },
    }))
    const handle = client.request('conformance.echo', 'echo', { text: 'pending' })
    const rejection = expect(handle.result).rejects.toMatchObject({ code: 'SESSION_DESTROYED' })
    client.destroy()
    await rejection
    port.emit('message', createCapabilityRpcResultEnvelope(
      capabilityCatalog,
      port.messages[1] as never,
      { echoed: 'late' },
    ))
    expect(port.closed).toBe(true)
  })

  it('projects only module-owned init fields and withholds READY until async setup resolves', async () => {
    let resolveSetup: (() => void) | undefined
    const onContextUpdate = vi.fn()
    const onConnected = vi.fn((_initFields: Readonly<Record<string, unknown>>) => new Promise<void>((resolve) => {
      resolveSetup = resolve
    }))
    const fixture = createFixture(onContextUpdate, onConnected)
    fixture.client.start()
    const { challenge } = readHello(fixture.adapter)
    const port = new FakePort()
    fixture.adapter.dispatch(initEvent(fixture.adapter, challenge, port, {
      data: {
        authorizationCode: 'one-time-module-code',
        grantedCapabilities: [],
        grantedContexts: ['github.repository'],
      },
    }))

    expect(fixture.client.status).toBe('connected')
    expect(port.messages).toEqual([])
    expect(onConnected).toHaveBeenCalledOnce()
    const [fields] = onConnected.mock.calls[0]
    expect(Object.isFrozen(fields)).toBe(true)
    expect(fields).toEqual({
      authorizationCode: 'one-time-module-code',
      grantedCapabilities: [],
      grantedContexts: ['github.repository'],
    })
    for (const canonical of ['challenge', 'moduleId', 'protocol', 'sessionNonce', 'type', 'version'])
      expect(fields).not.toHaveProperty(canonical)

    port.emit('message', createModuleEnvelope(moduleId, 'CONTEXT_UPDATE', {
      contexts: { 'github.repository': { repo: 'late/before-ready' } },
      revision: 'before-ready',
      sessionNonce,
    }))
    expect(onContextUpdate).not.toHaveBeenCalled()

    resolveSetup?.()
    await settleRuntime()
    expect(port.messages).toEqual([{
      protocol: ONEWEB_MODULE_PROTOCOL,
      version: ONEWEB_MODULE_PROTOCOL_VERSION,
      moduleId,
      type: 'MODULE_READY',
      sessionNonce,
    }])
  })

  it('destroys rejected setup and never revives a destroyed async connection', async () => {
    const rejected = createFixture(vi.fn(), async () => {
      throw new Error('Synthetic setup rejection')
    })
    rejected.client.start()
    const rejectedPort = new FakePort()
    rejected.adapter.dispatch(initEvent(
      rejected.adapter,
      readHello(rejected.adapter).challenge,
      rejectedPort,
    ))
    await settleRuntime()
    expect(rejected.client.status).toBe('destroyed')
    expect(rejectedPort.closed).toBe(true)
    expect(rejectedPort.messages).toEqual([])

    let resolveSetup: (() => void) | undefined
    const racing = createFixture(vi.fn(), () => new Promise<void>((resolve) => {
      resolveSetup = resolve
    }))
    racing.client.start()
    const racingPort = new FakePort()
    racing.adapter.dispatch(initEvent(
      racing.adapter,
      readHello(racing.adapter).challenge,
      racingPort,
    ))
    expect(racing.client.destroy()).toBe(true)
    resolveSetup?.()
    await settleRuntime()
    expect(racing.client.status).toBe('destroyed')
    expect(racingPort.closed).toBe(true)
    expect(racingPort.messages).toEqual([])

    let resolveFailedPortSetup: (() => void) | undefined
    const failedPort = createFixture(vi.fn(), () => new Promise<void>((resolve) => {
      resolveFailedPortSetup = resolve
    }))
    failedPort.client.start()
    const failedPortChannel = new FakePort()
    failedPort.adapter.dispatch(initEvent(
      failedPort.adapter,
      readHello(failedPort.adapter).challenge,
      failedPortChannel,
    ))
    failedPortChannel.emit('messageerror', null)
    resolveFailedPortSetup?.()
    await settleRuntime()
    expect(failedPort.client.status).toBe('destroyed')
    expect(failedPortChannel.closed).toBe(true)
    expect(failedPortChannel.messages).toEqual([])
  })

  it('ignores every forged init dimension without denying a later valid init', () => {
    const mutations: Array<{
      label: string
      event: (
        _adapter: FakeAdapter,
        _challenge: string,
        _port: FakePort,
      ) => ReturnType<typeof initEvent>
    }> = [
      { label: 'source', event: (adapter, challenge, port) => initEvent(adapter, challenge, port, { source: {} }) },
      { label: 'origin', event: (adapter, challenge, port) => initEvent(adapter, challenge, port, { origin: 'https://evil.example' }) },
      { label: 'protocol', event: (adapter, challenge, port) => initEvent(adapter, challenge, port, { data: { protocol: 'evil.module' } }) },
      { label: 'version', event: (adapter, challenge, port) => initEvent(adapter, challenge, port, { data: { version: 2 } }) },
      { label: 'module ID', event: (adapter, challenge, port) => initEvent(adapter, challenge, port, { data: { moduleId: 'dev.evil.module' } }) },
      { label: 'challenge', event: (adapter, challenge, port) => initEvent(adapter, challenge, port, { data: { challenge: `${challenge}-stale` } }) },
      { label: 'type', event: (adapter, challenge, port) => initEvent(adapter, challenge, port, { data: { type: 'CONTEXT_UPDATE' } }) },
      { label: 'short nonce', event: (adapter, challenge, port) => initEvent(adapter, challenge, port, { data: { sessionNonce: 'short' } }) },
      { label: 'missing port', event: (adapter, challenge, port) => initEvent(adapter, challenge, port, { ports: [] }) },
      { label: 'extra port', event: (adapter, challenge, port) => initEvent(adapter, challenge, port, { ports: [port, new FakePort()] }) },
    ]

    for (const mutation of mutations) {
      const fixture = createFixture()
      fixture.client.start()
      const { challenge } = readHello(fixture.adapter)
      const forgedPort = new FakePort()
      fixture.adapter.dispatch(mutation.event(fixture.adapter, challenge, forgedPort))
      expect(fixture.client.status, mutation.label).toBe('hello-sent')
      expect(forgedPort.starts, mutation.label).toBe(0)
      const validPort = new FakePort()
      fixture.adapter.dispatch(initEvent(fixture.adapter, challenge, validPort))
      expect(fixture.client.status, mutation.label).toBe('connected')
    }
  })

  it('rejects repeated init, unknown port messages and all late messages after destroy', () => {
    const pending = createFixture()
    pending.client.start()
    const pendingChallenge = readHello(pending.adapter).challenge
    expect(pending.client.destroy()).toBe(true)
    const lateInitPort = new FakePort()
    pending.adapter.dispatch(initEvent(pending.adapter, pendingChallenge, lateInitPort))
    expect(pending.client.status).toBe('destroyed')
    expect(lateInitPort.starts).toBe(0)

    const fixture = createFixture()
    fixture.client.start()
    const { challenge } = readHello(fixture.adapter)
    const port = new FakePort()
    fixture.adapter.dispatch(initEvent(fixture.adapter, challenge, port))
    const duplicatePort = new FakePort()
    fixture.adapter.dispatch(initEvent(fixture.adapter, challenge, duplicatePort))
    expect(duplicatePort.starts).toBe(0)

    port.emit('message', createModuleEnvelope(moduleId, 'CONTEXT_UPDATE', {
      contexts: {},
      revision: '1',
      sessionNonce: 'different-session-nonce-1234',
    }))
    port.emit('message', createModuleEnvelope('dev.evil.module', 'CONTEXT_UPDATE', {
      contexts: {},
      revision: '1',
      sessionNonce,
    }))
    expect(fixture.onContextUpdate).not.toHaveBeenCalled()

    expect(fixture.client.destroy()).toBe(true)
    expect(fixture.client.destroy()).toBe(false)
    expect(fixture.client.start()).toBe(false)
    expect(fixture.client.status).toBe('destroyed')
    expect(port.closed).toBe(true)
    expect(port.listeners.get('message')?.size || 0).toBe(0)
    port.emit('message', createModuleEnvelope(moduleId, 'CONTEXT_UPDATE', {
      contexts: { 'tab.basic': { url: 'https://late.example' } },
      revision: '2',
      sessionNonce,
    }))
    expect(fixture.onContextUpdate).not.toHaveBeenCalled()
  })

  it('terminates and closes the port on message errors or callback failure', () => {
    const readyFailureFixture = createFixture()
    readyFailureFixture.client.start()
    const readyFailurePort = new FakePort()
    readyFailurePort.throwOnPost = true
    readyFailureFixture.adapter.dispatch(initEvent(
      readyFailureFixture.adapter,
      readHello(readyFailureFixture.adapter).challenge,
      readyFailurePort,
    ))
    expect(readyFailureFixture.client.status).toBe('destroyed')
    expect(readyFailurePort.closed).toBe(true)

    const messageErrorFixture = createFixture()
    messageErrorFixture.client.start()
    const messageErrorPort = new FakePort()
    messageErrorFixture.adapter.dispatch(initEvent(
      messageErrorFixture.adapter,
      readHello(messageErrorFixture.adapter).challenge,
      messageErrorPort,
    ))
    messageErrorPort.emit('messageerror', null)
    expect(messageErrorFixture.client.status).toBe('destroyed')
    expect(messageErrorPort.closed).toBe(true)

    const callbackFixture = createFixture(() => {
      throw new Error('Synthetic consumer failure')
    })
    callbackFixture.client.start()
    const callbackPort = new FakePort()
    callbackFixture.adapter.dispatch(initEvent(
      callbackFixture.adapter,
      readHello(callbackFixture.adapter).challenge,
      callbackPort,
    ))
    callbackPort.emit('message', createModuleEnvelope(moduleId, 'CONTEXT_UPDATE', {
      contexts: {},
      revision: '1',
      sessionNonce,
    }))
    expect(callbackFixture.client.status).toBe('destroyed')
    expect(callbackPort.closed).toBe(true)
  })

  it('cleans up an initialization failure and keeps client instances isolated', () => {
    const failed = createFixture()
    failed.adapter.throwOnPost = true
    expect(() => failed.client.start()).toThrow('Synthetic parent failure')
    expect(failed.client.status).toBe('destroyed')
    expect(failed.adapter.listeners.size).toBe(0)

    const first = createFixture()
    const secondCalls = vi.fn()
    const secondAdapter = new FakeAdapter()
    const second = createRemoteFrameRuntimeClient({
      adapter: secondAdapter,
      moduleId: 'dev.oneweb.runtime.second',
      parentOrigin,
      onContextUpdate: secondCalls,
    })
    first.client.start()
    second.start()
    const firstPort = new FakePort()
    const secondPort = new FakePort()
    first.adapter.dispatch(initEvent(first.adapter, readHello(first.adapter).challenge, firstPort))
    secondAdapter.dispatch({
      ...initEvent(secondAdapter, readHello(secondAdapter).challenge, secondPort),
      data: createModuleEnvelope('dev.oneweb.runtime.second', 'MODULE_INIT', {
        challenge: readHello(secondAdapter).challenge,
        sessionNonce: `${sessionNonce}-second`,
      }),
    })
    firstPort.emit('message', createModuleEnvelope(moduleId, 'CONTEXT_UPDATE', {
      contexts: { 'tab.basic': { url: 'https://first.example' } },
      revision: 'first',
      sessionNonce,
    }))
    secondPort.emit('message', createModuleEnvelope('dev.oneweb.runtime.second', 'CONTEXT_UPDATE', {
      contexts: { 'tab.basic': { url: 'https://second.example' } },
      revision: 'second',
      sessionNonce: `${sessionNonce}-second`,
    }))
    expect(first.onContextUpdate).toHaveBeenCalledWith(expect.objectContaining({ revision: 'first' }))
    expect(secondCalls).toHaveBeenCalledWith(expect.objectContaining({ revision: 'second' }))
    first.client.destroy()
    expect(second.status).toBe('connected')
    expect(secondPort.closed).toBe(false)
  })

  it('requires canonical module and exact parent origins', () => {
    expect(normalizeRemoteFrameParentOrigin('https://Example.COM:443/')).toBe('https://example.com')
    expect(normalizeRemoteFrameParentOrigin(parentOrigin)).toBe(parentOrigin)
    expect(normalizeRemoteFrameParentOrigin('moz-extension://fixture-id')).toBe('moz-extension://fixture-id')
    expect(() => normalizeRemoteFrameParentOrigin('https://example.com/path')).toThrow('must not contain')
    expect(() => normalizeRemoteFrameParentOrigin('https://user:secret@example.com')).toThrow('must not contain')
    expect(() => normalizeRemoteFrameParentOrigin('data:text/plain,owned')).toThrow('unsupported')
    expect(() => createRemoteFrameRuntimeClient({
      adapter: new FakeAdapter(),
      moduleId: 'invalid',
      parentOrigin,
      onContextUpdate: vi.fn(),
    })).toThrow('reverse-domain')
  })
})
