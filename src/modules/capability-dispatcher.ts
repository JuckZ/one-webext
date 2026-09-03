import type {
  CapabilityRpcCapabilityId,
  CapabilityRpcCatalog,
  CapabilityRpcErrorCode,
  CapabilityRpcLifecycleState,
  CapabilityRpcOperationId,
  CapabilityRpcRequestEnvelope,
  CapabilityRpcRequestPayload,
  CapabilityRpcRequestReference,
  CapabilityRpcResultPayload,
  CapabilityRpcSessionBinding,
} from '@oneweb/module-sdk'
import {
  CAPABILITY_RPC_REQUEST_TIMEOUT_MS,
  capabilityRpcErrorCodes,
  createCapabilityRpcErrorEnvelope,
  createCapabilityRpcLifecycleState,
  createCapabilityRpcResultEnvelope,
  reduceCapabilityRpcLifecycle,
  validateCapabilityRpcCancelEnvelope,
  validateCapabilityRpcRequestEnvelope,
  validateCapabilityRpcRequestReference,
} from '@oneweb/module-sdk'

export interface ModuleCapabilityDispatcherPort {
  postMessage: (_message: unknown) => void
}

export interface ModuleCapabilityHandlerContext<Payload> {
  readonly payload: Payload
  readonly requestId: string
  readonly signal: AbortSignal
}

const capabilityRpcErrorCodeSet = new Set<string>(capabilityRpcErrorCodes)

export class ModuleCapabilityHandlerError extends Error {
  readonly code: CapabilityRpcErrorCode

  constructor(code: CapabilityRpcErrorCode) {
    if (!capabilityRpcErrorCodeSet.has(code))
      throw new TypeError('invalid module capability handler error code')
    super(code)
    this.name = 'ModuleCapabilityHandlerError'
    this.code = code
  }
}

export type ModuleCapabilityHandler<
  Catalog extends CapabilityRpcCatalog,
  Capability extends CapabilityRpcCapabilityId<Catalog>,
  Operation extends CapabilityRpcOperationId<Catalog, Capability>,
> = (
  _context: ModuleCapabilityHandlerContext<
    CapabilityRpcRequestPayload<Catalog, Capability, Operation>
  >,
) => CapabilityRpcResultPayload<Catalog, Capability, Operation>
  | Promise<CapabilityRpcResultPayload<Catalog, Capability, Operation>>

export type ModuleCapabilityHandlers<Catalog extends CapabilityRpcCatalog> = {
  readonly [Capability in CapabilityRpcCapabilityId<Catalog>]?: {
    readonly [Operation in CapabilityRpcOperationId<Catalog, Capability>]?:
    ModuleCapabilityHandler<Catalog, Capability, Operation>
  }
}

export interface ModuleCapabilityDispatcherOptions<Catalog extends CapabilityRpcCatalog> {
  readonly binding: CapabilityRpcSessionBinding
  readonly catalog: Catalog
  readonly manifestCapabilities: readonly string[]
  readonly grantedCapabilities: readonly string[]
  readonly handlers?: ModuleCapabilityHandlers<Catalog>
  readonly port: ModuleCapabilityDispatcherPort
}

export interface ModuleCapabilityDispatcher {
  readonly active: boolean
  dispatch: (_value: unknown) => boolean
  destroy: () => boolean
}

interface PendingHostRequest {
  readonly abortController: AbortController
  readonly request: CapabilityRpcRequestEnvelope
  readonly timeoutId: ReturnType<typeof globalThis.setTimeout>
}

function readEnvelopeType(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return null
  const descriptor = Object.getOwnPropertyDescriptor(value, 'type')
  return descriptor && descriptor.enumerable && 'value' in descriptor && typeof descriptor.value === 'string'
    ? descriptor.value
    : null
}

function readRequestId(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return null
  const descriptor = Object.getOwnPropertyDescriptor(value, 'requestId')
  return descriptor && descriptor.enumerable && 'value' in descriptor && typeof descriptor.value === 'string'
    ? descriptor.value
    : null
}

function snapshotHandlers<Catalog extends CapabilityRpcCatalog>(
  catalog: Catalog,
  handlers: ModuleCapabilityHandlers<Catalog> | undefined,
): ModuleCapabilityHandlers<Catalog> {
  if (!handlers)
    return Object.freeze({})
  const snapshot: Record<string, Readonly<Record<string, unknown>>> = {}
  for (const capability of Object.keys(catalog)) {
    const source = Object.hasOwn(handlers, capability)
      ? handlers[capability as CapabilityRpcCapabilityId<Catalog>]
      : undefined
    if (!source)
      continue
    const sourceRecord = source as Readonly<Record<string, unknown>>
    const operations: Record<string, unknown> = {}
    for (const operation of Object.keys(catalog[capability].operations)) {
      const handler = Object.hasOwn(sourceRecord, operation)
        ? sourceRecord[operation]
        : undefined
      if (typeof handler === 'function')
        operations[operation] = handler
    }
    if (Object.keys(operations).length)
      snapshot[capability] = Object.freeze(operations)
  }
  return Object.freeze(snapshot) as ModuleCapabilityHandlers<Catalog>
}

class ModuleCapabilityDispatcherImplementation<Catalog extends CapabilityRpcCatalog>
implements ModuleCapabilityDispatcher {
  private readonly catalog: Catalog
  private readonly manifestCapabilities: readonly string[]
  private readonly grantedCapabilities: readonly string[]
  private readonly handlers: ModuleCapabilityHandlers<Catalog>
  private readonly port: ModuleCapabilityDispatcherPort
  private state: CapabilityRpcLifecycleState
  private readonly pending = new Map<string, PendingHostRequest>()

  constructor(options: ModuleCapabilityDispatcherOptions<Catalog>) {
    if (!options.port || typeof options.port.postMessage !== 'function')
      throw new TypeError('capability dispatcher requires a message port')
    this.catalog = options.catalog
    this.manifestCapabilities = Object.freeze([...options.manifestCapabilities])
    this.grantedCapabilities = Object.freeze([...options.grantedCapabilities])
    this.handlers = snapshotHandlers(options.catalog, options.handlers)
    this.port = options.port
    this.state = createCapabilityRpcLifecycleState(options.binding)
  }

  get active() {
    return this.state.status === 'active'
  }

  dispatch(value: unknown) {
    if (!this.active)
      return false
    const type = readEnvelopeType(value)
    if (type === 'CAPABILITY_REQUEST') {
      this.acceptRequest(value)
      return true
    }
    if (type === 'CAPABILITY_CANCEL') {
      this.acceptCancel(value)
      return true
    }
    return false
  }

  destroy() {
    if (!this.active)
      return false
    const transition = reduceCapabilityRpcLifecycle(this.state, { type: 'destroy', now: Date.now() })
    this.state = transition.state
    for (const pending of this.pending.values()) {
      globalThis.clearTimeout(pending.timeoutId)
      pending.abortController.abort()
    }
    this.pending.clear()
    return true
  }

  private acceptRequest(value: unknown) {
    const validated = validateCapabilityRpcRequestEnvelope(
      this.catalog,
      value,
      this.state.binding,
      this.manifestCapabilities,
    )
    if (!validated.ok) {
      const reference = validateCapabilityRpcRequestReference(value, this.state.binding)
      if (reference.ok)
        this.postError(reference.value, validated.code)
      return
    }
    const request = validated.value
    const registered = reduceCapabilityRpcLifecycle(this.state, {
      type: 'register',
      request,
      now: Date.now(),
    })
    if (!registered.ok) {
      this.postError(request, registered.code)
      return
    }
    this.state = registered.state

    if (!this.grantedCapabilities.includes(request.capability)) {
      this.completeError(request, 'CAPABILITY_NOT_ALLOWED')
      return
    }

    const handler = this.readHandler(request.capability, request.operation)
    if (!handler) {
      this.completeError(request, 'CAPABILITY_UNAVAILABLE')
      return
    }

    const abortController = new AbortController()
    const timeoutId = globalThis.setTimeout(
      () => this.timeoutRequest(request.requestId),
      CAPABILITY_RPC_REQUEST_TIMEOUT_MS,
    )
    this.pending.set(request.requestId, { abortController, request, timeoutId })
    void Promise.resolve()
      .then(() => {
        const pending = this.pending.get(request.requestId)
        if (!pending || pending.abortController.signal.aborted)
          return undefined
        return handler({
          payload: request.payload,
          requestId: request.requestId,
          signal: pending.abortController.signal,
        })
      })
      .then(
        result => this.completeResult(request, result),
        error => this.completeError(
          request,
          error instanceof ModuleCapabilityHandlerError ? error.code : 'OPERATION_FAILED',
        ),
      )
  }

  private acceptCancel(value: unknown) {
    const requestId = readRequestId(value)
    const pending = requestId ? this.pending.get(requestId) : null
    if (!requestId || !pending)
      return
    const validated = validateCapabilityRpcCancelEnvelope(value, pending.request)
    if (!validated.ok)
      return
    const transition = reduceCapabilityRpcLifecycle(this.state, {
      type: 'cancel',
      response: validated.value,
      now: Date.now(),
    })
    if (!transition.ok)
      return
    this.state = transition.state
    this.finishPending(requestId, true)
  }

  private readHandler(capability: string, operation: string) {
    const capabilityHandlers = Object.hasOwn(this.handlers, capability)
      ? this.handlers[capability as CapabilityRpcCapabilityId<Catalog>]
      : undefined
    if (!capabilityHandlers || !Object.hasOwn(capabilityHandlers, operation))
      return null
    return capabilityHandlers[operation as keyof typeof capabilityHandlers] as
      | ((_context: ModuleCapabilityHandlerContext<unknown>) => unknown | Promise<unknown>)
      | undefined
      || null
  }

  private completeResult(request: CapabilityRpcRequestEnvelope, result: unknown) {
    if (!this.pending.has(request.requestId) || !this.active)
      return
    try {
      const response = createCapabilityRpcResultEnvelope(
        this.catalog,
        request as never,
        result as never,
      )
      const transition = reduceCapabilityRpcLifecycle(this.state, {
        type: 'result',
        response,
        now: Date.now(),
      })
      this.state = transition.state
      if (!transition.ok) {
        if (transition.code === 'REQUEST_TIMED_OUT')
          this.finishPending(request.requestId, true)
        return
      }
      this.finishPending(request.requestId, false)
      this.post(response)
    }
    catch {
      this.completeError(request, 'OPERATION_FAILED')
    }
  }

  private completeError(
    request: CapabilityRpcRequestEnvelope,
    code: Parameters<typeof createCapabilityRpcErrorEnvelope>[1],
  ) {
    if (!this.active)
      return
    const response = createCapabilityRpcErrorEnvelope(request, code)
    const transition = reduceCapabilityRpcLifecycle(this.state, {
      type: 'error',
      response,
      now: Date.now(),
    })
    this.state = transition.state
    if (!transition.ok) {
      if (transition.code === 'REQUEST_TIMED_OUT')
        this.finishPending(request.requestId, true)
      return
    }
    this.finishPending(request.requestId, code !== 'CAPABILITY_UNAVAILABLE' && code !== 'CAPABILITY_NOT_ALLOWED')
    this.post(response)
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
    if (!transition.ok)
      return
    this.finishPending(requestId, true)
    this.postError(pending.request, 'REQUEST_TIMED_OUT')
  }

  private finishPending(requestId: string, abort: boolean) {
    const pending = this.pending.get(requestId)
    if (!pending)
      return
    this.pending.delete(requestId)
    globalThis.clearTimeout(pending.timeoutId)
    if (abort)
      pending.abortController.abort()
  }

  private postError(
    request: CapabilityRpcRequestReference,
    code: Parameters<typeof createCapabilityRpcErrorEnvelope>[1],
  ) {
    this.post(createCapabilityRpcErrorEnvelope(request, code))
  }

  private post(message: unknown) {
    try {
      this.port.postMessage(message)
    }
    catch {
      this.destroy()
    }
  }
}

export function createModuleCapabilityDispatcher<const Catalog extends CapabilityRpcCatalog>(
  options: ModuleCapabilityDispatcherOptions<Catalog>,
): ModuleCapabilityDispatcher {
  return new ModuleCapabilityDispatcherImplementation(options)
}
