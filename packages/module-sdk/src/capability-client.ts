import type {
  CapabilityRpcCancelEnvelope,
  CapabilityRpcCapabilityId,
  CapabilityRpcCatalog,
  CapabilityRpcErrorCode,
  CapabilityRpcLifecycleState,
  CapabilityRpcOperationId,
  CapabilityRpcRequestEnvelope,
  CapabilityRpcRequestPayload,
  CapabilityRpcResultPayload,
  CapabilityRpcSessionBinding,
} from './capability-rpc.js'
import {
  CAPABILITY_RPC_REQUEST_TIMEOUT_MS,
  createCapabilityRpcCancelEnvelope,
  createCapabilityRpcLifecycleState,
  createCapabilityRpcRequestEnvelope,
  reduceCapabilityRpcLifecycle,
  validateCapabilityRpcCancelEnvelope,
  validateCapabilityRpcErrorEnvelope,
  validateCapabilityRpcResultEnvelope,
} from './capability-rpc.js'

export type CapabilityRpcClientPortEventType = 'message' | 'messageerror'

export interface CapabilityRpcClientPortEvent {
  readonly data: unknown
}

export type CapabilityRpcClientPortListener = (_event: CapabilityRpcClientPortEvent) => void

export interface CapabilityRpcClientPort {
  addEventListener: (
    _type: CapabilityRpcClientPortEventType,
    _listener: CapabilityRpcClientPortListener,
  ) => void
  removeEventListener: (
    _type: CapabilityRpcClientPortEventType,
    _listener: CapabilityRpcClientPortListener,
  ) => void
  postMessage: (_message: unknown) => void
}

export type CapabilityRpcClientErrorCode = CapabilityRpcErrorCode | 'REQUEST_CANCELLED'

export class CapabilityRpcClientError extends Error {
  readonly code: CapabilityRpcClientErrorCode

  constructor(code: CapabilityRpcClientErrorCode) {
    super(code)
    this.name = 'CapabilityRpcClientError'
    this.code = code
  }
}

export interface CapabilityRpcRequestHandle<Result> {
  readonly requestId: string
  readonly result: Promise<Result>
  cancel: () => boolean
}

export interface CapabilityRpcClient<Catalog extends CapabilityRpcCatalog> {
  readonly active: boolean
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

export interface CapabilityRpcClientOptions<Catalog extends CapabilityRpcCatalog> {
  readonly binding: CapabilityRpcSessionBinding
  readonly catalog: Catalog
  readonly port: CapabilityRpcClientPort
}

interface PendingRequest {
  readonly request: CapabilityRpcRequestEnvelope
  readonly resolve: (_value: unknown) => void
  readonly reject: (_error: CapabilityRpcClientError) => void
  readonly timeoutId: ReturnType<typeof globalThis.setTimeout>
}

function createRequestId() {
  const bytes = globalThis.crypto?.getRandomValues(new Uint8Array(24))
  if (!bytes)
    throw new Error('OneWeb capability RPC requires Web Crypto request ID generation')
  return `request-${Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')}`
}

function requestIdFromMessage(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return null
  const descriptor = Object.getOwnPropertyDescriptor(value, 'requestId')
  return descriptor && descriptor.enumerable && 'value' in descriptor && typeof descriptor.value === 'string'
    ? descriptor.value
    : null
}

class CapabilityRpcClientImplementation<Catalog extends CapabilityRpcCatalog>
implements CapabilityRpcClient<Catalog> {
  private readonly catalog: Catalog
  private readonly port: CapabilityRpcClientPort
  private state: CapabilityRpcLifecycleState
  private readonly pending = new Map<string, PendingRequest>()
  private listening = true

  constructor(options: CapabilityRpcClientOptions<Catalog>) {
    if (!options.port || typeof options.port.postMessage !== 'function')
      throw new TypeError('capability RPC client requires a message port')
    this.catalog = options.catalog
    this.port = options.port
    this.state = createCapabilityRpcLifecycleState(options.binding)
    this.port.addEventListener('message', this.handleMessage)
    this.port.addEventListener('messageerror', this.handlePortFailure)
  }

  get active() {
    return this.state.status === 'active'
  }

  request<
    Capability extends CapabilityRpcCapabilityId<Catalog>,
    Operation extends CapabilityRpcOperationId<Catalog, Capability>,
  >(
    capability: Capability,
    operation: Operation,
    payload: CapabilityRpcRequestPayload<Catalog, Capability, Operation>,
  ): CapabilityRpcRequestHandle<CapabilityRpcResultPayload<Catalog, Capability, Operation>> {
    if (!this.active)
      throw new CapabilityRpcClientError('SESSION_DESTROYED')

    const request = createCapabilityRpcRequestEnvelope(
      this.catalog,
      { ...this.state.binding, requestId: createRequestId() },
      capability,
      operation,
      payload,
    )
    const now = Date.now()
    const registered = reduceCapabilityRpcLifecycle(this.state, { type: 'register', request, now })
    if (!registered.ok)
      throw new CapabilityRpcClientError(registered.code)
    this.state = registered.state

    let resolvePromise: (_value: unknown) => void = () => {}
    let rejectPromise: (_error: CapabilityRpcClientError) => void = () => {}
    const result = new Promise<unknown>((resolve, reject) => {
      resolvePromise = resolve
      rejectPromise = reject
    })
    const timeoutId = globalThis.setTimeout(
      () => this.timeoutRequest(request.requestId),
      CAPABILITY_RPC_REQUEST_TIMEOUT_MS,
    )
    this.pending.set(request.requestId, {
      request,
      resolve: resolvePromise,
      reject: rejectPromise,
      timeoutId,
    })
    const handle = Object.freeze({
      requestId: request.requestId,
      result: result as Promise<CapabilityRpcResultPayload<Catalog, Capability, Operation>>,
      cancel: () => this.cancel(request.requestId),
    })
    try {
      this.port.postMessage(request)
    }
    catch {
      this.destroy()
    }
    return handle
  }

  cancel(requestId: string) {
    const pending = this.pending.get(requestId)
    if (!pending || !this.active)
      return false
    const cancel = createCapabilityRpcCancelEnvelope(pending.request)
    const transition = reduceCapabilityRpcLifecycle(this.state, {
      type: 'cancel',
      response: cancel,
      now: Date.now(),
    })
    if (!transition.ok)
      return false
    this.state = transition.state
    this.finishRejected(requestId, 'REQUEST_CANCELLED')
    try {
      this.port.postMessage(cancel)
    }
    catch {
      this.destroy()
    }
    return true
  }

  destroy() {
    if (!this.active)
      return false
    const transition = reduceCapabilityRpcLifecycle(this.state, { type: 'destroy', now: Date.now() })
    this.state = transition.state
    this.stopListening()
    for (const requestId of [...this.pending.keys()])
      this.finishRejected(requestId, 'SESSION_DESTROYED')
    return true
  }

  private readonly handleMessage = (event: CapabilityRpcClientPortEvent) => {
    if (!this.active)
      return
    const requestId = requestIdFromMessage(event.data)
    const pending = requestId ? this.pending.get(requestId) : null
    if (!requestId || !pending)
      return

    const result = validateCapabilityRpcResultEnvelope(
      this.catalog,
      event.data,
      pending.request as never,
    )
    if (result.ok) {
      const transition = reduceCapabilityRpcLifecycle(this.state, {
        type: 'result',
        response: result.value,
        now: Date.now(),
      })
      this.state = transition.state
      if (transition.ok)
        this.finishResolved(requestId, result.value.result)
      else if (transition.code === 'REQUEST_TIMED_OUT')
        this.finishRejected(requestId, transition.code)
      return
    }

    const error = validateCapabilityRpcErrorEnvelope(event.data, pending.request)
    if (error.ok) {
      const transition = reduceCapabilityRpcLifecycle(this.state, {
        type: 'error',
        response: error.value,
        now: Date.now(),
      })
      this.state = transition.state
      if (transition.ok)
        this.finishRejected(requestId, error.value.code)
      else if (transition.code === 'REQUEST_TIMED_OUT')
        this.finishRejected(requestId, transition.code)
      return
    }

    const cancel = validateCapabilityRpcCancelEnvelope(event.data, pending.request)
    if (!cancel.ok)
      return
    const transition = reduceCapabilityRpcLifecycle(this.state, {
      type: 'cancel',
      response: cancel.value as CapabilityRpcCancelEnvelope,
      now: Date.now(),
    })
    this.state = transition.state
    if (transition.ok)
      this.finishRejected(requestId, 'REQUEST_CANCELLED')
  }

  private readonly handlePortFailure = () => {
    this.destroy()
  }

  private timeoutRequest(requestId: string) {
    const pending = this.pending.get(requestId)
    if (!pending || !this.active)
      return
    const transition = reduceCapabilityRpcLifecycle(this.state, {
      type: 'timeout',
      identity: pending.request,
      now: Date.now(),
    })
    this.state = transition.state
    if (transition.ok)
      this.finishRejected(requestId, 'REQUEST_TIMED_OUT')
  }

  private finishResolved(requestId: string, value: unknown) {
    const pending = this.takePending(requestId)
    pending?.resolve(value)
  }

  private finishRejected(requestId: string, code: CapabilityRpcClientErrorCode) {
    const pending = this.takePending(requestId)
    pending?.reject(new CapabilityRpcClientError(code))
  }

  private takePending(requestId: string) {
    const pending = this.pending.get(requestId)
    if (!pending)
      return null
    this.pending.delete(requestId)
    globalThis.clearTimeout(pending.timeoutId)
    return pending
  }

  private stopListening() {
    if (!this.listening)
      return
    this.listening = false
    try {
      this.port.removeEventListener('message', this.handleMessage)
    }
    catch {}
    try {
      this.port.removeEventListener('messageerror', this.handlePortFailure)
    }
    catch {}
  }
}

export function createCapabilityRpcClient<const Catalog extends CapabilityRpcCatalog>(
  options: CapabilityRpcClientOptions<Catalog>,
): CapabilityRpcClient<Catalog> {
  return new CapabilityRpcClientImplementation(options)
}
