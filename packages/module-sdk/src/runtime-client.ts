import type {
  CapabilityRpcClient,
  CapabilityRpcRequestHandle,
} from './capability-client.js'
import type {
  CapabilityRpcCapabilityId,
  CapabilityRpcCatalog,
  CapabilityRpcOperationId,
  CapabilityRpcRequestPayload,
  CapabilityRpcResultPayload,
} from './capability-rpc.js'
import type { ModuleBridgeEnvelope } from './protocol.js'
import type {
  RemoteFrameRuntimeState,
  RemoteFrameRuntimeStatus,
} from './runtime-state.js'
import {
  CapabilityRpcClientError,
  createCapabilityRpcClient,
} from './capability-client.js'
import {
  createModuleEnvelope,
  validateHostInitEnvelope,
  validateHostPortEnvelope,
} from './protocol.js'
import {
  beginRemoteFrameRuntime,
  connectRemoteFrameRuntime,
  createRemoteFrameRuntimeState,
  destroyRemoteFrameRuntime,
} from './runtime-state.js'

const moduleIdPattern = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?){2,}$/
const allowedParentProtocols = new Set([
  'chrome-extension:',
  'http:',
  'https:',
  'moz-extension:',
])

export interface RemoteFrameRuntimeMessageEvent {
  data: unknown
}

export type RemoteFrameRuntimePortEventType = 'message' | 'messageerror'
export type RemoteFrameRuntimePortListener = (_event: RemoteFrameRuntimeMessageEvent) => void

export interface RemoteFrameRuntimeMessagePort {
  addEventListener: (
    _type: RemoteFrameRuntimePortEventType,
    _listener: RemoteFrameRuntimePortListener,
  ) => void
  removeEventListener: (
    _type: RemoteFrameRuntimePortEventType,
    _listener: RemoteFrameRuntimePortListener,
  ) => void
  postMessage: (_message: unknown) => void
  start: () => void
  close: () => void
}

export interface RemoteFrameRuntimeWindowMessageEvent extends RemoteFrameRuntimeMessageEvent {
  origin: string
  source: unknown
  ports: readonly RemoteFrameRuntimeMessagePort[]
}

export type RemoteFrameRuntimeWindowListener = (
  _event: RemoteFrameRuntimeWindowMessageEvent,
) => void

export interface RemoteFrameRuntimeAdapter {
  readonly parent: unknown
  addMessageListener: (_listener: RemoteFrameRuntimeWindowListener) => void
  removeMessageListener: (_listener: RemoteFrameRuntimeWindowListener) => void
  postToParent: (_message: unknown, _targetOrigin: string) => void
}

export interface RemoteFrameContextUpdate {
  revision: string
  contexts: Readonly<Record<string, unknown>>
}

export type RemoteFrameRuntimeInitFields = Readonly<Record<string, unknown>>

type EmptyCapabilityRpcCatalog = Readonly<Record<never, never>>

export interface RemoteFrameRuntimeClientOptions<
  Catalog extends CapabilityRpcCatalog = EmptyCapabilityRpcCatalog,
> {
  moduleId: string
  parentOrigin: string
  capabilityRpcCatalog?: Catalog
  onConnected?: (
    _initFields: RemoteFrameRuntimeInitFields,
  ) => void | Promise<void>
  onContextUpdate: (_update: RemoteFrameContextUpdate) => void
  adapter?: RemoteFrameRuntimeAdapter
}

export interface RemoteFrameRuntimeClient<
  Catalog extends CapabilityRpcCatalog = EmptyCapabilityRpcCatalog,
> {
  readonly status: RemoteFrameRuntimeStatus
  start: () => boolean
  request: <
    Capability extends CapabilityRpcCapabilityId<Catalog>,
    Operation extends CapabilityRpcOperationId<Catalog, Capability>,
  >(
    _capability: Capability,
    _operation: Operation,
    _payload: CapabilityRpcRequestPayload<Catalog, Capability, Operation>,
  ) => CapabilityRpcRequestHandle<CapabilityRpcResultPayload<Catalog, Capability, Operation>>
  cancel: (_requestId: string) => boolean
  destroy: () => boolean
}

function createChallenge() {
  const bytes = globalThis.crypto?.getRandomValues(new Uint8Array(24))
  if (!bytes)
    throw new Error('OneWeb runtime requires Web Crypto challenge generation')
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
}

function adaptMessagePort(port: MessagePort): RemoteFrameRuntimeMessagePort {
  const listeners = new Map<RemoteFrameRuntimePortListener, EventListener>()
  return {
    addEventListener(type, listener) {
      const wrapped: EventListener = (event) => {
        listener({ data: (event as MessageEvent).data })
      }
      listeners.set(listener, wrapped)
      port.addEventListener(type, wrapped)
    },
    removeEventListener(type, listener) {
      const wrapped = listeners.get(listener)
      if (!wrapped)
        return
      listeners.delete(listener)
      port.removeEventListener(type, wrapped)
    },
    postMessage(message) {
      port.postMessage(message)
    },
    start() {
      port.start()
    },
    close() {
      port.close()
    },
  }
}

export function normalizeRemoteFrameParentOrigin(value: string) {
  if (typeof value !== 'string' || !value.trim())
    throw new TypeError('parentOrigin must be an explicit origin')
  let url: URL
  try {
    url = new URL(value)
  }
  catch {
    throw new TypeError('parentOrigin must be an absolute origin')
  }
  if (!allowedParentProtocols.has(url.protocol) || !url.host)
    throw new TypeError('parentOrigin uses an unsupported origin scheme')
  if (url.username || url.password || url.search || url.hash || (url.pathname && url.pathname !== '/'))
    throw new TypeError('parentOrigin must not contain credentials, path, query or fragment')
  if (url.protocol === 'http:' || url.protocol === 'https:')
    return url.origin
  return `${url.protocol}//${url.host}`
}

export function createBrowserRemoteFrameRuntimeAdapter(
  sourceWindow: Window,
): RemoteFrameRuntimeAdapter {
  if (sourceWindow.parent === sourceWindow)
    throw new Error('OneWeb remote-frame runtime requires an iframe parent')
  const listeners = new Map<RemoteFrameRuntimeWindowListener, EventListener>()
  return {
    parent: sourceWindow.parent,
    addMessageListener(listener) {
      const wrapped: EventListener = (event) => {
        const messageEvent = event as MessageEvent
        listener({
          data: messageEvent.data,
          origin: messageEvent.origin,
          source: messageEvent.source,
          ports: messageEvent.ports.map(adaptMessagePort),
        })
      }
      listeners.set(listener, wrapped)
      sourceWindow.addEventListener('message', wrapped)
    },
    removeMessageListener(listener) {
      const wrapped = listeners.get(listener)
      if (!wrapped)
        return
      listeners.delete(listener)
      sourceWindow.removeEventListener('message', wrapped)
    },
    postToParent(message, targetOrigin) {
      sourceWindow.parent.postMessage(message, targetOrigin)
    },
  }
}

function defaultRuntimeAdapter() {
  if (typeof globalThis.window === 'undefined')
    throw new Error('OneWeb remote-frame runtime requires a browser window or explicit adapter')
  return createBrowserRemoteFrameRuntimeAdapter(globalThis.window)
}

const canonicalInitFieldNames = new Set([
  'challenge',
  'capabilityGeneration',
  'moduleId',
  'protocol',
  'sessionNonce',
  'type',
  'version',
])

export function projectRemoteFrameRuntimeInitFields(
  message: ModuleBridgeEnvelope,
): RemoteFrameRuntimeInitFields {
  return Object.freeze(Object.fromEntries(
    Object.entries(message).filter(([key]) => !canonicalInitFieldNames.has(key)),
  ))
}

class RemoteFrameRuntimeClientImplementation<Catalog extends CapabilityRpcCatalog>
implements RemoteFrameRuntimeClient<Catalog> {
  private readonly moduleId: string
  private readonly parentOrigin: string
  private readonly adapter: RemoteFrameRuntimeAdapter
  private readonly capabilityRpcCatalog: Catalog | null
  private onConnected: RemoteFrameRuntimeClientOptions<Catalog>['onConnected'] | null
  private onContextUpdate: RemoteFrameRuntimeClientOptions<Catalog>['onContextUpdate'] | null
  private state: RemoteFrameRuntimeState = createRemoteFrameRuntimeState()
  private listeningForInit = false
  private port: RemoteFrameRuntimeMessagePort | null = null
  private capabilityRpcClient: CapabilityRpcClient<Catalog> | null = null
  private ready = false

  constructor(options: RemoteFrameRuntimeClientOptions<Catalog>) {
    if (!moduleIdPattern.test(options.moduleId))
      throw new TypeError('moduleId must use reverse-domain form with at least three segments')
    if (typeof options.onContextUpdate !== 'function')
      throw new TypeError('onContextUpdate must be a function')
    if (options.onConnected !== undefined && typeof options.onConnected !== 'function')
      throw new TypeError('onConnected must be a function when provided')
    this.moduleId = options.moduleId
    this.parentOrigin = normalizeRemoteFrameParentOrigin(options.parentOrigin)
    this.adapter = options.adapter || defaultRuntimeAdapter()
    if (!this.adapter.parent)
      throw new TypeError('runtime adapter must expose the exact parent object')
    this.onConnected = options.onConnected || null
    this.onContextUpdate = options.onContextUpdate
    this.capabilityRpcCatalog = options.capabilityRpcCatalog || null
  }

  get status() {
    return this.state.status
  }

  start() {
    if (this.state.status !== 'idle')
      return false
    try {
      const transition = beginRemoteFrameRuntime(this.state, createChallenge())
      if (!transition.ok)
        return false
      this.state = transition.state
      this.adapter.addMessageListener(this.handleWindowMessage)
      this.listeningForInit = true
      this.adapter.postToParent(createModuleEnvelope(this.moduleId, 'MODULE_HELLO', {
        challenge: this.state.challenge,
      }), this.parentOrigin)
      return true
    }
    catch (error) {
      this.destroy()
      throw error
    }
  }

  request<
    Capability extends CapabilityRpcCapabilityId<Catalog>,
    Operation extends CapabilityRpcOperationId<Catalog, Capability>,
  >(
    capability: Capability,
    operation: Operation,
    payload: CapabilityRpcRequestPayload<Catalog, Capability, Operation>,
  ): CapabilityRpcRequestHandle<CapabilityRpcResultPayload<Catalog, Capability, Operation>> {
    if (!this.ready || !this.capabilityRpcClient)
      throw new CapabilityRpcClientError('SESSION_DESTROYED')
    const handle = this.capabilityRpcClient.request(capability, operation, payload)
    if (!this.capabilityRpcClient.active)
      this.destroy()
    return handle
  }

  cancel(requestId: string) {
    return this.ready && this.capabilityRpcClient?.cancel(requestId) === true
  }

  destroy() {
    if (this.state.status === 'destroyed')
      return false
    if (this.listeningForInit) {
      try {
        this.adapter.removeMessageListener(this.handleWindowMessage)
      }
      catch {}
      this.listeningForInit = false
    }
    this.closePort()
    this.onConnected = null
    this.onContextUpdate = null
    this.state = destroyRemoteFrameRuntime(this.state)
    return true
  }

  private readonly handleWindowMessage = (event: RemoteFrameRuntimeWindowMessageEvent) => {
    if (this.state.status !== 'hello-sent'
      || event.source !== this.adapter.parent
      || event.origin !== this.parentOrigin
      || event.ports.length !== 1
      || !this.state.challenge) {
      return
    }
    const message = validateHostInitEnvelope(event.data, this.moduleId, this.state.challenge)
    if (!message || !message.sessionNonce)
      return
    const transition = connectRemoteFrameRuntime(
      this.state,
      this.state.challenge,
      message.sessionNonce,
    )
    if (!transition.ok)
      return

    try {
      this.adapter.removeMessageListener(this.handleWindowMessage)
      this.listeningForInit = false
      this.port = event.ports[0]
      this.state = transition.state
      if (this.capabilityRpcCatalog) {
        if (!Number.isSafeInteger(message.capabilityGeneration)
          || Number(message.capabilityGeneration) < 1) {
          this.destroy()
          return
        }
        this.capabilityRpcClient = createCapabilityRpcClient({
          binding: {
            moduleId: this.moduleId,
            sessionId: message.sessionNonce,
            generation: Number(message.capabilityGeneration),
          },
          catalog: this.capabilityRpcCatalog,
          port: this.port,
        })
      }
      this.port.addEventListener('message', this.handlePortMessage)
      this.port.addEventListener('messageerror', this.handlePortFailure)
      this.port.start()
      if (this.onConnected) {
        void this.completeConnection(
          this.port,
          message.sessionNonce,
          projectRemoteFrameRuntimeInitFields(message),
        )
      }
      else {
        this.sendReady(this.port, message.sessionNonce)
      }
    }
    catch {
      this.destroy()
    }
  }

  private readonly handlePortMessage = (event: RemoteFrameRuntimeMessageEvent) => {
    if (!this.ready || this.state.status !== 'connected' || !this.state.sessionNonce)
      return
    const message: ModuleBridgeEnvelope | null = validateHostPortEnvelope(
      event.data,
      this.moduleId,
      this.state.sessionNonce,
    )
    if (!message || message.type !== 'CONTEXT_UPDATE' || !message.revision || !message.contexts)
      return
    try {
      this.onContextUpdate?.({
        revision: message.revision,
        contexts: message.contexts,
      })
    }
    catch {
      this.destroy()
    }
  }

  private readonly handlePortFailure = () => {
    this.destroy()
  }

  private async completeConnection(
    port: RemoteFrameRuntimeMessagePort,
    sessionNonce: string,
    initFields: RemoteFrameRuntimeInitFields,
  ) {
    try {
      await this.onConnected?.(initFields)
      if (this.state.status !== 'connected'
        || this.state.sessionNonce !== sessionNonce
        || this.port !== port) {
        return
      }
      this.sendReady(port, sessionNonce)
    }
    catch {
      if (this.state.status === 'connected' && this.port === port)
        this.destroy()
    }
  }

  private sendReady(port: RemoteFrameRuntimeMessagePort, sessionNonce: string) {
    port.postMessage(createModuleEnvelope(this.moduleId, 'MODULE_READY', {
      sessionNonce,
    }))
    if (this.state.status === 'connected' && this.port === port)
      this.ready = true
  }

  private closePort() {
    this.ready = false
    this.capabilityRpcClient?.destroy()
    this.capabilityRpcClient = null
    if (!this.port)
      return
    try {
      this.port.removeEventListener('message', this.handlePortMessage)
    }
    catch {}
    try {
      this.port.removeEventListener('messageerror', this.handlePortFailure)
    }
    catch {}
    try {
      this.port.close()
    }
    catch {}
    this.port = null
  }
}

export function createRemoteFrameRuntimeClient<
  const Catalog extends CapabilityRpcCatalog = EmptyCapabilityRpcCatalog,
>(
  options: RemoteFrameRuntimeClientOptions<Catalog>,
): RemoteFrameRuntimeClient<Catalog> {
  return new RemoteFrameRuntimeClientImplementation(options)
}
