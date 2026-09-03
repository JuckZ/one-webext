import type { InstalledModuleRecord } from '../../types'
import type {
  ClashConnectionPreparation,
  ClashConnectionSnapshot,
  ClashConnectionStatus,
  ClashControlErrorCode,
  ClashProxySwitchPlan,
  ClashReadOnlySnapshot,
  ClashReadState,
} from './contracts'
import { isClashProxySwitchPlan } from './proxy-switch'
import { isClashReadOnlySnapshot, isClashReadState } from './snapshot'

export const CLASH_CONTROL_CHANNEL = 'oneweb.clash-control' as const
export const CLASH_CONTROL_PROTOCOL_VERSION = 4 as const

interface ClashControlRequestBase {
  channel: typeof CLASH_CONTROL_CHANNEL
  version: typeof CLASH_CONTROL_PROTOCOL_VERSION
}

export type ClashControlRequest =
  | ClashControlRequestBase & { type: 'CLASH_CONTROL_PREPARE', controllerUrl: string }
  | ClashControlRequestBase & {
    type: 'CLASH_CONTROL_CONNECT'
    token: string
    generation: number
    controllerOrigin: string
    originPattern: string
    expiresAt: string
    secret: string
  }
  | ClashControlRequestBase & { type: 'CLASH_CONTROL_STATUS' }
  | ClashControlRequestBase & { type: 'CLASH_CONTROL_REFRESH' }
  | ClashControlRequestBase & {
    type: 'CLASH_CONTROL_PREPARE_PROXY_SWITCH'
    groupName: string
    targetNode: string
  }
  | ClashControlRequestBase & { type: 'CLASH_CONTROL_CONFIRM_PROXY_SWITCH', token: string }
  | ClashControlRequestBase & { type: 'CLASH_CONTROL_DISCONNECT' }

export type ClashControlRequestType = ClashControlRequest['type']

export type ClashControlResult =
  | { ok: true, operation: 'prepare', preparation: ClashConnectionPreparation }
  | { ok: false, operation: 'prepare', reason: ClashControlErrorCode }
  | { ok: true, operation: 'connect', status: ClashConnectionStatus, record: InstalledModuleRecord }
  | { ok: false, operation: 'connect', reason: ClashControlErrorCode }
  | {
    ok: true
    operation: 'status'
    connection: ClashConnectionSnapshot
    status: ClashConnectionStatus | null
    readState: ClashReadState
  }
  | { ok: true, operation: 'refresh', snapshot: ClashReadOnlySnapshot }
  | { ok: false, operation: 'refresh', reason: ClashControlErrorCode }
  | { ok: true, operation: 'prepare-proxy-switch', plan: ClashProxySwitchPlan }
  | { ok: false, operation: 'prepare-proxy-switch', reason: ClashControlErrorCode }
  | {
    ok: true
    operation: 'confirm-proxy-switch'
    groupName: string
    previousNode: string
    selectedNode: string
  }
  | { ok: false, operation: 'confirm-proxy-switch', reason: ClashControlErrorCode }
  | { ok: true, operation: 'disconnect', changed: boolean, releasedOrigin: boolean, record: InstalledModuleRecord }
  | { ok: false, operation: 'disconnect', reason: ClashControlErrorCode }

export interface ClashControlResponse {
  channel: typeof CLASH_CONTROL_CHANNEL
  version: typeof CLASH_CONTROL_PROTOCOL_VERSION
  type: 'CLASH_CONTROL_RESPONSE'
  requestType: ClashControlRequestType
  result: ClashControlResult
}

const errorCodes = new Set<ClashControlErrorCode>([
  'module-unavailable',
  'module-disabled',
  'invalid-controller-url',
  'controller-not-loopback',
  'connection-active',
  'invalid-preparation',
  'permission-missing',
  'permission-check-failed',
  'connection-required',
  'network-failure',
  'authentication-failed',
  'protocol-incompatible',
  'response-too-large',
  'response-malformed',
  'operation-active',
  'switch-snapshot-required',
  'switch-target-invalid',
  'switch-no-change',
  'switch-plan-not-found',
  'switch-plan-expired',
  'switch-plan-stale',
  'switch-outcome-unknown',
  'lifecycle-cancelled',
  'capability-sync-failed',
  'permission-remove-failed',
  'profile-read-failed',
  'profile-write-failed',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(value)
  return actual.length === keys.length && actual.every(key => keys.includes(key))
}

function isToken(value: unknown) {
  return typeof value === 'string' && value.length > 0 && value.length <= 128
}

function isErrorCode(value: unknown): value is ClashControlErrorCode {
  return typeof value === 'string' && errorCodes.has(value as ClashControlErrorCode)
}

function isPreparation(value: unknown): value is ClashConnectionPreparation {
  return isRecord(value)
    && isToken(value.token)
    && Number.isSafeInteger(value.generation)
    && Number(value.generation) >= 0
    && typeof value.controllerOrigin === 'string'
    && typeof value.originPattern === 'string'
    && typeof value.expiresAt === 'string'
}

function isProfile(value: unknown) {
  return isRecord(value)
    && value.version === 1
    && typeof value.controllerOrigin === 'string'
}

function isConnectionSnapshot(value: unknown): value is ClashConnectionSnapshot {
  if (!isRecord(value)
    || !Number.isSafeInteger(value.generation)
    || Number(value.generation) < 0
    || (value.profile !== null && !isProfile(value.profile))) {
    return false
  }
  if (value.phase === 'disconnected')
    return true
  if (value.phase === 'connecting')
    return isProfile(value.profile)
  if (value.phase === 'preparing')
    return isProfile(value.profile) && typeof value.preparationExpiresAt === 'string'
  if (value.phase === 'connected')
    return isProfile(value.profile) && isStatus(value.status)
  return value.phase === 'error'
    && isRecord(value.diagnostic)
    && isErrorCode(value.diagnostic.code)
    && typeof value.diagnostic.occurredAt === 'string'
}

function isStatus(value: unknown): value is ClashConnectionStatus {
  return isRecord(value)
    && typeof value.controllerOrigin === 'string'
    && typeof value.implementation === 'string'
    && typeof value.version === 'string'
    && typeof value.mode === 'string'
    && typeof value.connectedAt === 'string'
}

export function isClashControlRequest(value: unknown): value is ClashControlRequest {
  if (!isRecord(value)
    || value.channel !== CLASH_CONTROL_CHANNEL
    || value.version !== CLASH_CONTROL_PROTOCOL_VERSION) {
    return false
  }
  if (value.type === 'CLASH_CONTROL_PREPARE')
    return typeof value.controllerUrl === 'string' && value.controllerUrl.length <= 2048
  if (value.type === 'CLASH_CONTROL_CONNECT') {
    return isToken(value.token)
      && Number.isSafeInteger(value.generation)
      && Number(value.generation) >= 0
      && typeof value.controllerOrigin === 'string'
      && value.controllerOrigin.length <= 2048
      && typeof value.originPattern === 'string'
      && value.originPattern.length <= 2050
      && typeof value.expiresAt === 'string'
      && value.expiresAt.length <= 64
      && typeof value.secret === 'string'
      && value.secret.length <= 1024
      && !value.secret.includes('\r')
      && !value.secret.includes('\n')
  }
  if (value.type === 'CLASH_CONTROL_PREPARE_PROXY_SWITCH') {
    return hasOnlyKeys(value, ['channel', 'version', 'type', 'groupName', 'targetNode'])
      && typeof value.groupName === 'string'
      && value.groupName.length > 0
      && value.groupName.length <= 256
      && typeof value.targetNode === 'string'
      && value.targetNode.length > 0
      && value.targetNode.length <= 256
  }
  if (value.type === 'CLASH_CONTROL_CONFIRM_PROXY_SWITCH')
    return hasOnlyKeys(value, ['channel', 'version', 'type', 'token']) && isToken(value.token)
  return value.type === 'CLASH_CONTROL_STATUS'
    || value.type === 'CLASH_CONTROL_REFRESH'
    || value.type === 'CLASH_CONTROL_DISCONNECT'
}

export function createClashControlResponse(
  requestType: ClashControlRequestType,
  result: ClashControlResult,
): ClashControlResponse {
  return {
    channel: CLASH_CONTROL_CHANNEL,
    version: CLASH_CONTROL_PROTOCOL_VERSION,
    type: 'CLASH_CONTROL_RESPONSE',
    requestType,
    result,
  }
}

export function isClashControlResponse(value: unknown): value is ClashControlResponse {
  if (!isRecord(value)
    || value.channel !== CLASH_CONTROL_CHANNEL
    || value.version !== CLASH_CONTROL_PROTOCOL_VERSION
    || value.type !== 'CLASH_CONTROL_RESPONSE'
    || !isRecord(value.result)) {
    return false
  }
  const result = value.result
  if (value.requestType === 'CLASH_CONTROL_PREPARE' && result.operation === 'prepare')
    return result.ok === true ? isPreparation(result.preparation) : result.ok === false && isErrorCode(result.reason)
  if (value.requestType === 'CLASH_CONTROL_CONNECT' && result.operation === 'connect') {
    return result.ok === true
      ? isStatus(result.status) && isRecord(result.record)
      : result.ok === false && isErrorCode(result.reason)
  }
  if (value.requestType === 'CLASH_CONTROL_STATUS' && result.operation === 'status') {
    return result.ok === true
      && isConnectionSnapshot(result.connection)
      && (result.status === null || isStatus(result.status))
      && (result.connection.phase === 'connected' ? result.status !== null : result.status === null)
      && isClashReadState(result.readState)
  }
  if (value.requestType === 'CLASH_CONTROL_REFRESH' && result.operation === 'refresh') {
    return result.ok === true
      ? isClashReadOnlySnapshot(result.snapshot)
      : result.ok === false && isErrorCode(result.reason)
  }
  if (value.requestType === 'CLASH_CONTROL_PREPARE_PROXY_SWITCH'
    && result.operation === 'prepare-proxy-switch') {
    return result.ok === true
      ? isClashProxySwitchPlan(result.plan)
      : result.ok === false && isErrorCode(result.reason)
  }
  if (value.requestType === 'CLASH_CONTROL_CONFIRM_PROXY_SWITCH'
    && result.operation === 'confirm-proxy-switch') {
    if (result.ok === true) {
      return typeof result.groupName === 'string'
        && typeof result.previousNode === 'string'
        && typeof result.selectedNode === 'string'
    }
    return result.ok === false && isErrorCode(result.reason)
  }
  if (value.requestType === 'CLASH_CONTROL_DISCONNECT' && result.operation === 'disconnect') {
    return result.ok === true
      ? typeof result.changed === 'boolean' && typeof result.releasedOrigin === 'boolean' && isRecord(result.record)
      : result.ok === false && isErrorCode(result.reason)
  }
  return false
}
