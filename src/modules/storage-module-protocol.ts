import type {
  CapabilityRpcErrorCode,
  CapabilityRpcSessionBinding,
  StorageModuleRequestEnvelope,
  StorageModuleTransitionResult,
} from '@oneweb/module-sdk'
import {
  capabilityRpcErrorCodes,
  createCapabilityRpcLifecycleState,
} from '@oneweb/module-sdk'

export const ONEWEB_STORAGE_MODULE_CHANNEL = 'oneweb.storage-module' as const
export const ONEWEB_STORAGE_MODULE_VERSION = 1 as const

export type StorageModuleProtocolRequest =
  | {
    readonly channel: typeof ONEWEB_STORAGE_MODULE_CHANNEL
    readonly version: typeof ONEWEB_STORAGE_MODULE_VERSION
    readonly type: 'STORAGE_MODULE_SESSION_OPEN'
    readonly binding: CapabilityRpcSessionBinding
  }
  | {
    readonly channel: typeof ONEWEB_STORAGE_MODULE_CHANNEL
    readonly version: typeof ONEWEB_STORAGE_MODULE_VERSION
    readonly type: 'STORAGE_MODULE_EXECUTE'
    readonly binding: CapabilityRpcSessionBinding
    readonly request: StorageModuleRequestEnvelope
  }
  | {
    readonly channel: typeof ONEWEB_STORAGE_MODULE_CHANNEL
    readonly version: typeof ONEWEB_STORAGE_MODULE_VERSION
    readonly type: 'STORAGE_MODULE_SESSION_CLOSE'
    readonly binding: CapabilityRpcSessionBinding
  }

export type StorageModuleProtocolRequestType = StorageModuleProtocolRequest['type']

export type StorageModuleProtocolResult =
  | { readonly ok: true }
  | { readonly ok: true, readonly closed: boolean }
  | { readonly ok: true, readonly result: Exclude<StorageModuleTransitionResult, null> }
  | { readonly ok: false, readonly code: CapabilityRpcErrorCode }

export interface StorageModuleProtocolResponse {
  readonly channel: typeof ONEWEB_STORAGE_MODULE_CHANNEL
  readonly version: typeof ONEWEB_STORAGE_MODULE_VERSION
  readonly type: 'STORAGE_MODULE_RESPONSE'
  readonly requestType: StorageModuleProtocolRequestType
  readonly result: StorageModuleProtocolResult
}

const capabilityRpcErrorCodeSet = new Set<string>(capabilityRpcErrorCodes)

function exactRecord(value: unknown, expectedKeys: readonly string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return null
  const keys = Reflect.ownKeys(value)
  if (keys.length !== expectedKeys.length
    || keys.some(key => typeof key !== 'string' || !expectedKeys.includes(key))) {
    return null
  }
  const record: Record<string, unknown> = {}
  for (const key of keys as string[]) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor))
      return null
    record[key] = descriptor.value
  }
  return record
}

function canonicalBinding(value: unknown): CapabilityRpcSessionBinding | null {
  const record = exactRecord(value, ['moduleId', 'sessionId', 'generation'])
  if (!record)
    return null
  try {
    return createCapabilityRpcLifecycleState(record as unknown as CapabilityRpcSessionBinding).binding
  }
  catch {
    return null
  }
}

export function createStorageModuleSessionOpenRequest(
  binding: CapabilityRpcSessionBinding,
): StorageModuleProtocolRequest {
  return Object.freeze({
    channel: ONEWEB_STORAGE_MODULE_CHANNEL,
    version: ONEWEB_STORAGE_MODULE_VERSION,
    type: 'STORAGE_MODULE_SESSION_OPEN',
    binding: createCapabilityRpcLifecycleState(binding).binding,
  })
}

export function createStorageModuleExecuteRequest(
  binding: CapabilityRpcSessionBinding,
  request: StorageModuleRequestEnvelope,
): StorageModuleProtocolRequest {
  return Object.freeze({
    channel: ONEWEB_STORAGE_MODULE_CHANNEL,
    version: ONEWEB_STORAGE_MODULE_VERSION,
    type: 'STORAGE_MODULE_EXECUTE',
    binding: createCapabilityRpcLifecycleState(binding).binding,
    request,
  })
}

export function createStorageModuleSessionCloseRequest(
  binding: CapabilityRpcSessionBinding,
): StorageModuleProtocolRequest {
  return Object.freeze({
    channel: ONEWEB_STORAGE_MODULE_CHANNEL,
    version: ONEWEB_STORAGE_MODULE_VERSION,
    type: 'STORAGE_MODULE_SESSION_CLOSE',
    binding: createCapabilityRpcLifecycleState(binding).binding,
  })
}

export function validateStorageModuleProtocolRequest(value: unknown): StorageModuleProtocolRequest | null {
  const base = exactRecord(value, ['channel', 'version', 'type', 'binding'])
    || exactRecord(value, ['channel', 'version', 'type', 'binding', 'request'])
  if (!base
    || base.channel !== ONEWEB_STORAGE_MODULE_CHANNEL
    || base.version !== ONEWEB_STORAGE_MODULE_VERSION
    || (base.type !== 'STORAGE_MODULE_SESSION_OPEN'
      && base.type !== 'STORAGE_MODULE_EXECUTE'
      && base.type !== 'STORAGE_MODULE_SESSION_CLOSE')) {
    return null
  }
  const binding = canonicalBinding(base.binding)
  if (!binding)
    return null
  if (base.type === 'STORAGE_MODULE_EXECUTE') {
    if (!Object.hasOwn(base, 'request'))
      return null
    return Object.freeze({
      channel: ONEWEB_STORAGE_MODULE_CHANNEL,
      version: ONEWEB_STORAGE_MODULE_VERSION,
      type: base.type,
      binding,
      request: base.request as StorageModuleRequestEnvelope,
    })
  }
  if (Object.hasOwn(base, 'request'))
    return null
  return Object.freeze({
    channel: ONEWEB_STORAGE_MODULE_CHANNEL,
    version: ONEWEB_STORAGE_MODULE_VERSION,
    type: base.type,
    binding,
  })
}

export function createStorageModuleProtocolResponse(
  requestType: StorageModuleProtocolRequestType,
  result: StorageModuleProtocolResult,
): StorageModuleProtocolResponse {
  return Object.freeze({
    channel: ONEWEB_STORAGE_MODULE_CHANNEL,
    version: ONEWEB_STORAGE_MODULE_VERSION,
    type: 'STORAGE_MODULE_RESPONSE',
    requestType,
    result: structuredClone(result),
  })
}

export function validateStorageModuleProtocolResponse(
  value: unknown,
  requestType: StorageModuleProtocolRequestType,
): StorageModuleProtocolResponse | null {
  const response = exactRecord(value, ['channel', 'version', 'type', 'requestType', 'result'])
  if (!response
    || response.channel !== ONEWEB_STORAGE_MODULE_CHANNEL
    || response.version !== ONEWEB_STORAGE_MODULE_VERSION
    || response.type !== 'STORAGE_MODULE_RESPONSE'
    || response.requestType !== requestType) {
    return null
  }
  const result = exactRecord(response.result, ['ok'])
    || exactRecord(response.result, ['ok', 'closed'])
    || exactRecord(response.result, ['ok', 'result'])
    || exactRecord(response.result, ['ok', 'code'])
  if (!result || typeof result.ok !== 'boolean')
    return null
  if (!result.ok) {
    if (typeof result.code !== 'string' || !capabilityRpcErrorCodeSet.has(result.code))
      return null
  }
  else if (requestType === 'STORAGE_MODULE_SESSION_OPEN') {
    if (Object.keys(result).length !== 1)
      return null
  }
  else if (requestType === 'STORAGE_MODULE_SESSION_CLOSE') {
    if (typeof result.closed !== 'boolean')
      return null
  }
  else if (!Object.hasOwn(result, 'result')) {
    return null
  }
  return Object.freeze({
    channel: ONEWEB_STORAGE_MODULE_CHANNEL,
    version: ONEWEB_STORAGE_MODULE_VERSION,
    type: 'STORAGE_MODULE_RESPONSE',
    requestType,
    result: structuredClone(result) as StorageModuleProtocolResult,
  })
}
