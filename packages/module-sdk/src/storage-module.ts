import type {
  CapabilityRpcErrorCode,
  CapabilityRpcJsonValue,
  CapabilityRpcRequestEnvelope,
  CapabilityRpcRequestIdentity,
  CapabilityRpcRequestPayload,
  CapabilityRpcResultEnvelope,
  CapabilityRpcResultPayload,
  CapabilityRpcSessionBinding,
  CapabilityRpcValidationResult,
} from './capability-rpc.js'
import {
  capabilityRpcSchema,
  createCapabilityRpcLifecycleState,
  createCapabilityRpcRequestEnvelope,
  createCapabilityRpcResultEnvelope,
  defineCapabilityRpcCatalog,
  validateCapabilityRpcRequestEnvelope,
  validateCapabilityRpcSchemaValue,
} from './capability-rpc.js'

export const STORAGE_MODULE_CAPABILITY = 'storage.module' as const
export const STORAGE_MODULE_DOCUMENT_MAX_BYTES = 12 * 1024
export const STORAGE_MODULE_DOCUMENT_MAX_DEPTH = 6
export const STORAGE_MODULE_DOCUMENT_MAX_NODES = 256
export const STORAGE_MODULE_REVISION_ENTROPY_BYTES = 24
export const STORAGE_MODULE_REVISION_PREFIX = 'storage-revision-' as const
export const storageModuleOperations = Object.freeze(['read', 'replace', 'clear'] as const)
export const storageModuleContractDescriptor = Object.freeze({
  operations: storageModuleOperations,
  document: Object.freeze({
    maximumBytes: STORAGE_MODULE_DOCUMENT_MAX_BYTES,
    maximumDepth: STORAGE_MODULE_DOCUMENT_MAX_DEPTH,
    maximumNodes: STORAGE_MODULE_DOCUMENT_MAX_NODES,
  }),
  revisionEntropyBytes: STORAGE_MODULE_REVISION_ENTROPY_BYTES,
})

const storageModuleRevisionPattern = /^storage-revision-[0-9a-f]{48}$/

export const storageModuleDocumentSchema = capabilityRpcSchema.json({
  maximumBytes: STORAGE_MODULE_DOCUMENT_MAX_BYTES,
  maximumDepth: STORAGE_MODULE_DOCUMENT_MAX_DEPTH,
  maximumNodes: STORAGE_MODULE_DOCUMENT_MAX_NODES,
})

const storageModuleRevisionSchema = capabilityRpcSchema.string({
  minimumLength: STORAGE_MODULE_REVISION_PREFIX.length + STORAGE_MODULE_REVISION_ENTROPY_BYTES * 2,
  maximumLength: STORAGE_MODULE_REVISION_PREFIX.length + STORAGE_MODULE_REVISION_ENTROPY_BYTES * 2,
})

export const storageModuleCapabilityCatalog = defineCapabilityRpcCatalog({
  [STORAGE_MODULE_CAPABILITY]: {
    operations: {
      read: {
        request: capabilityRpcSchema.literal(null),
        result: capabilityRpcSchema.object({
          revision: storageModuleRevisionSchema,
          document: storageModuleDocumentSchema,
        }),
      },
      replace: {
        request: capabilityRpcSchema.object({
          expectedRevision: storageModuleRevisionSchema,
          document: storageModuleDocumentSchema,
        }),
        result: capabilityRpcSchema.object({
          revision: storageModuleRevisionSchema,
        }),
      },
      clear: {
        request: capabilityRpcSchema.object({
          expectedRevision: storageModuleRevisionSchema,
        }),
        result: capabilityRpcSchema.object({
          revision: storageModuleRevisionSchema,
        }),
      },
    },
  },
} as const)

export type StorageModuleCatalog = typeof storageModuleCapabilityCatalog
export type StorageModuleOperation = keyof StorageModuleCatalog[typeof STORAGE_MODULE_CAPABILITY]['operations']
export type StorageModuleDocument = CapabilityRpcJsonValue

export type StorageModuleRequest<Operation extends StorageModuleOperation> = CapabilityRpcRequestEnvelope<
  typeof STORAGE_MODULE_CAPABILITY,
  Operation,
  CapabilityRpcRequestPayload<StorageModuleCatalog, typeof STORAGE_MODULE_CAPABILITY, Operation>
>
export type StorageModuleReadRequest = StorageModuleRequest<'read'>
export type StorageModuleReplaceRequest = StorageModuleRequest<'replace'>
export type StorageModuleClearRequest = StorageModuleRequest<'clear'>
export type StorageModuleRequestEnvelope =
  | StorageModuleReadRequest
  | StorageModuleReplaceRequest
  | StorageModuleClearRequest

export type StorageModuleResult<Operation extends StorageModuleOperation> = CapabilityRpcResultEnvelope<
  typeof STORAGE_MODULE_CAPABILITY,
  Operation,
  CapabilityRpcResultPayload<StorageModuleCatalog, typeof STORAGE_MODULE_CAPABILITY, Operation>
>
export type StorageModuleReadResult = StorageModuleResult<'read'>
export type StorageModuleMutationResult = StorageModuleResult<'replace' | 'clear'>

function validationFailure(code: CapabilityRpcErrorCode): CapabilityRpcValidationResult<never> {
  return Object.freeze({ ok: false, code })
}

function validationSuccess<Value>(value: Value): CapabilityRpcValidationResult<Value> {
  return Object.freeze({ ok: true, value })
}

export function isStorageModuleRevision(value: unknown): value is string {
  return typeof value === 'string' && storageModuleRevisionPattern.test(value)
}

export function createStorageModuleRevision(entropy: Uint8Array) {
  if (!(entropy instanceof Uint8Array) || entropy.byteLength !== STORAGE_MODULE_REVISION_ENTROPY_BYTES)
    throw new TypeError(`storage revision entropy must contain ${STORAGE_MODULE_REVISION_ENTROPY_BYTES} bytes`)
  return `${STORAGE_MODULE_REVISION_PREFIX}${Array.from(entropy, byte => byte.toString(16).padStart(2, '0')).join('')}`
}

function canonicalizeValidatedDocument(value: StorageModuleDocument): StorageModuleDocument {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number')
    return value
  if (Array.isArray(value))
    return Object.freeze(value.map(canonicalizeValidatedDocument))
  const source = value as { readonly [key: string]: StorageModuleDocument }
  const canonical: Record<string, StorageModuleDocument> = {}
  for (const key of Object.keys(source).sort()) {
    Object.defineProperty(canonical, key, {
      configurable: false,
      enumerable: true,
      value: canonicalizeValidatedDocument(source[key]),
      writable: false,
    })
  }
  return Object.freeze(canonical)
}

export function validateStorageModuleDocument(
  value: unknown,
): CapabilityRpcValidationResult<StorageModuleDocument> {
  const validated = validateCapabilityRpcSchemaValue(
    storageModuleDocumentSchema,
    value,
    STORAGE_MODULE_DOCUMENT_MAX_BYTES,
  )
  if (!validated.ok)
    return validated
  return validationSuccess(canonicalizeValidatedDocument(validated.value))
}

function canonicalDocument(value: unknown) {
  const validated = validateStorageModuleDocument(value)
  if (!validated.ok)
    throw new TypeError(validated.code)
  return validated.value
}

function assertStorageRevision(revision: unknown) {
  if (!isStorageModuleRevision(revision))
    throw new TypeError('PAYLOAD_INVALID')
}

export function createStorageModuleReadRequestEnvelope(
  identity: CapabilityRpcRequestIdentity,
): StorageModuleReadRequest {
  return createCapabilityRpcRequestEnvelope(
    storageModuleCapabilityCatalog,
    identity,
    STORAGE_MODULE_CAPABILITY,
    'read',
    null,
  )
}

export function createStorageModuleReplaceRequestEnvelope(
  identity: CapabilityRpcRequestIdentity,
  expectedRevision: string,
  document: unknown,
): StorageModuleReplaceRequest {
  assertStorageRevision(expectedRevision)
  return createCapabilityRpcRequestEnvelope(
    storageModuleCapabilityCatalog,
    identity,
    STORAGE_MODULE_CAPABILITY,
    'replace',
    { expectedRevision, document: canonicalDocument(document) },
  )
}

export function createStorageModuleClearRequestEnvelope(
  identity: CapabilityRpcRequestIdentity,
  expectedRevision: string,
): StorageModuleClearRequest {
  assertStorageRevision(expectedRevision)
  return createCapabilityRpcRequestEnvelope(
    storageModuleCapabilityCatalog,
    identity,
    STORAGE_MODULE_CAPABILITY,
    'clear',
    { expectedRevision },
  )
}

function requestIdentity(request: StorageModuleRequestEnvelope): CapabilityRpcRequestIdentity {
  return {
    moduleId: request.moduleId,
    sessionId: request.sessionId,
    generation: request.generation,
    requestId: request.requestId,
  }
}

export function validateStorageModuleRequestEnvelope(
  value: unknown,
  expectedSession: CapabilityRpcSessionBinding,
): CapabilityRpcValidationResult<StorageModuleRequestEnvelope> {
  const validated = validateCapabilityRpcRequestEnvelope(
    storageModuleCapabilityCatalog,
    value,
    expectedSession,
    [STORAGE_MODULE_CAPABILITY],
  )
  if (!validated.ok)
    return validated
  const request = validated.value as StorageModuleRequestEnvelope
  try {
    if (request.operation === 'read')
      return validationSuccess(createStorageModuleReadRequestEnvelope(requestIdentity(request)))
    if (!isStorageModuleRevision(request.payload.expectedRevision))
      return validationFailure('PAYLOAD_INVALID')
    if (request.operation === 'replace') {
      return validationSuccess(createStorageModuleReplaceRequestEnvelope(
        requestIdentity(request),
        request.payload.expectedRevision,
        request.payload.document,
      ))
    }
    return validationSuccess(createStorageModuleClearRequestEnvelope(
      requestIdentity(request),
      request.payload.expectedRevision,
    ))
  }
  catch (error) {
    return validationFailure(error instanceof TypeError && error.message === 'PAYLOAD_TOO_LARGE'
      ? 'PAYLOAD_TOO_LARGE'
      : 'PAYLOAD_INVALID')
  }
}

export function createStorageModuleReadResultEnvelope(
  request: StorageModuleReadRequest,
  revision: string,
  document: unknown,
): StorageModuleReadResult {
  assertStorageRevision(revision)
  return createCapabilityRpcResultEnvelope(
    storageModuleCapabilityCatalog,
    request,
    { revision, document: canonicalDocument(document) },
  )
}

export function createStorageModuleMutationResultEnvelope<Operation extends 'replace' | 'clear'>(
  request: StorageModuleRequest<Operation>,
  revision: string,
): StorageModuleResult<Operation> {
  assertStorageRevision(revision)
  return createCapabilityRpcResultEnvelope(
    storageModuleCapabilityCatalog,
    request,
    { revision } as CapabilityRpcResultPayload<
      StorageModuleCatalog,
      typeof STORAGE_MODULE_CAPABILITY,
      Operation
    >,
  )
}

export const storageModuleAuthorityStatuses = Object.freeze([
  'active',
  'revoked',
  'destroyed',
  'removed',
] as const)

export const storageModuleLifecycleReasons = Object.freeze([
  'disabled',
  'grant-revoked',
  'session-destroyed',
  'worker-restart',
  'removed',
] as const)

export type StorageModuleAuthorityStatus = typeof storageModuleAuthorityStatuses[number]
export type StorageModuleLifecycleReason = typeof storageModuleLifecycleReasons[number]

export interface StorageModuleState {
  readonly binding: CapabilityRpcSessionBinding
  readonly status: StorageModuleAuthorityStatus
  readonly revision: string
  readonly document: StorageModuleDocument
  readonly lifecycleReason: StorageModuleLifecycleReason | null
}

export type StorageModuleEvent =
  | { readonly type: 'read', readonly request: StorageModuleReadRequest }
  | {
    readonly type: 'replace'
    readonly request: StorageModuleReplaceRequest
    readonly nextRevision: string
  }
  | {
    readonly type: 'clear'
    readonly request: StorageModuleClearRequest
    readonly nextRevision: string
  }
  | { readonly type: 'revoke', readonly binding: CapabilityRpcSessionBinding }
  | {
    readonly type: 'destroy'
    readonly binding: CapabilityRpcSessionBinding
    readonly reason: 'disabled' | 'session-destroyed' | 'worker-restart'
  }
  | { readonly type: 'remove', readonly binding: CapabilityRpcSessionBinding }
  | { readonly type: 'resume', readonly binding: CapabilityRpcSessionBinding }
  | {
    readonly type: 'reinstall'
    readonly binding: CapabilityRpcSessionBinding
    readonly revision: string
  }

export type StorageModuleTransitionResult =
  | CapabilityRpcResultPayload<StorageModuleCatalog, typeof STORAGE_MODULE_CAPABILITY, 'read'>
  | CapabilityRpcResultPayload<StorageModuleCatalog, typeof STORAGE_MODULE_CAPABILITY, 'replace'>
  | null

export type StorageModuleTransition =
  | {
    readonly ok: true
    readonly state: StorageModuleState
    readonly result: StorageModuleTransitionResult
  }
  | {
    readonly ok: false
    readonly state: StorageModuleState
    readonly code: CapabilityRpcErrorCode
  }

function canonicalBinding(binding: CapabilityRpcSessionBinding) {
  return createCapabilityRpcLifecycleState(binding).binding
}

function freezeStorageModuleState(state: StorageModuleState): StorageModuleState {
  return Object.freeze({
    binding: canonicalBinding(state.binding),
    status: state.status,
    revision: state.revision,
    document: state.document,
    lifecycleReason: state.lifecycleReason,
  })
}

export function createStorageModuleState(
  binding: CapabilityRpcSessionBinding,
  revision: string,
  document: unknown = null,
): StorageModuleState {
  assertStorageRevision(revision)
  return freezeStorageModuleState({
    binding,
    status: 'active',
    revision,
    document: canonicalDocument(document),
    lifecycleReason: null,
  })
}

function transitionSuccess(
  state: StorageModuleState,
  result: StorageModuleTransitionResult,
): StorageModuleTransition {
  return Object.freeze({ ok: true, state, result })
}

function transitionFailure(
  state: StorageModuleState,
  code: CapabilityRpcErrorCode,
): StorageModuleTransition {
  return Object.freeze({ ok: false, state, code })
}

function sameBinding(left: CapabilityRpcSessionBinding, right: CapabilityRpcSessionBinding) {
  return left.moduleId === right.moduleId
    && left.sessionId === right.sessionId
    && left.generation === right.generation
}

function sameModule(left: CapabilityRpcSessionBinding, right: CapabilityRpcSessionBinding) {
  return left.moduleId === right.moduleId
}

function validateNewBinding(state: StorageModuleState, binding: CapabilityRpcSessionBinding) {
  const next = canonicalBinding(binding)
  if (!sameModule(state.binding, next))
    return null
  if (sameBinding(state.binding, next))
    return null
  return next
}

function inactiveFailure(state: StorageModuleState): StorageModuleTransition | null {
  if (state.status === 'revoked')
    return transitionFailure(state, 'CAPABILITY_NOT_ALLOWED')
  if (state.status === 'destroyed' || state.status === 'removed')
    return transitionFailure(state, 'SESSION_DESTROYED')
  return null
}

function nextMutationState(
  state: StorageModuleState,
  expectedRevision: string,
  nextRevision: string,
  document: StorageModuleDocument,
): StorageModuleTransition {
  assertStorageRevision(nextRevision)
  if (nextRevision === state.revision)
    throw new TypeError('next storage revision must differ from the current revision')
  if (expectedRevision !== state.revision)
    return transitionFailure(state, 'STORAGE_REVISION_CONFLICT')
  const nextState = freezeStorageModuleState({
    ...state,
    revision: nextRevision,
    document,
  })
  return transitionSuccess(nextState, Object.freeze({ revision: nextRevision }))
}

export function reduceStorageModuleState(
  state: StorageModuleState,
  event: StorageModuleEvent,
): StorageModuleTransition {
  if (event.type === 'resume') {
    if (state.status === 'active')
      return transitionFailure(state, 'OPERATION_FAILED')
    if (state.status === 'removed')
      return transitionFailure(state, 'SESSION_DESTROYED')
    const binding = validateNewBinding(state, event.binding)
    if (!binding)
      return transitionFailure(state, 'SESSION_MISMATCH')
    return transitionSuccess(freezeStorageModuleState({
      ...state,
      binding,
      status: 'active',
      lifecycleReason: null,
    }), null)
  }
  if (event.type === 'reinstall') {
    if (state.status !== 'removed')
      return transitionFailure(state, 'OPERATION_FAILED')
    const binding = validateNewBinding(state, event.binding)
    if (!binding)
      return transitionFailure(state, 'SESSION_MISMATCH')
    assertStorageRevision(event.revision)
    if (event.revision === state.revision)
      throw new TypeError('reinstall revision must differ from the removed revision')
    return transitionSuccess(freezeStorageModuleState({
      binding,
      status: 'active',
      revision: event.revision,
      document: null,
      lifecycleReason: null,
    }), null)
  }

  if (event.type === 'revoke' || event.type === 'destroy' || event.type === 'remove') {
    if (!sameBinding(state.binding, event.binding))
      return transitionFailure(state, 'SESSION_MISMATCH')
    if (event.type === 'remove') {
      return transitionSuccess(freezeStorageModuleState({
        ...state,
        status: 'removed',
        document: null,
        lifecycleReason: 'removed',
      }), null)
    }
    if (state.status === 'removed')
      return transitionFailure(state, 'SESSION_DESTROYED')
    if (event.type === 'revoke') {
      return transitionSuccess(freezeStorageModuleState({
        ...state,
        status: 'revoked',
        lifecycleReason: 'grant-revoked',
      }), null)
    }
    return transitionSuccess(freezeStorageModuleState({
      ...state,
      status: 'destroyed',
      lifecycleReason: event.reason,
    }), null)
  }

  const validated = validateStorageModuleRequestEnvelope(event.request, state.binding)
  if (!validated.ok)
    return transitionFailure(state, validated.code)
  if (validated.value.operation !== event.type)
    return transitionFailure(state, 'OPERATION_NOT_ALLOWED')
  const inactive = inactiveFailure(state)
  if (inactive)
    return inactive
  if (event.type === 'read') {
    return transitionSuccess(state, Object.freeze({
      revision: state.revision,
      document: state.document,
    }))
  }
  if (event.type === 'replace') {
    const request = validated.value as StorageModuleReplaceRequest
    return nextMutationState(
      state,
      request.payload.expectedRevision,
      event.nextRevision,
      request.payload.document,
    )
  }
  const request = validated.value as StorageModuleClearRequest
  return nextMutationState(
    state,
    request.payload.expectedRevision,
    event.nextRevision,
    null,
  )
}
