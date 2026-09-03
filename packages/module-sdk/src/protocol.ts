import {
  ONEWEB_MODULE_PROTOCOL,
  ONEWEB_MODULE_PROTOCOL_VERSION,
} from './catalog.js'

export const moduleToHostPortMessageTypes = Object.freeze([
  'MODULE_READY',
  'CONTEXT_ACCEPTED',
  'MODULE_STATUS',
] as const)
export const hostToModulePortMessageTypes = Object.freeze(['CONTEXT_UPDATE'] as const)

export type ModuleToHostPortMessageType = typeof moduleToHostPortMessageTypes[number]
export type HostToModulePortMessageType = typeof hostToModulePortMessageTypes[number]
export type HostWindowMessageType = 'MODULE_INIT'

export interface ModuleBridgeEnvelope {
  protocol: typeof ONEWEB_MODULE_PROTOCOL
  version: typeof ONEWEB_MODULE_PROTOCOL_VERSION
  moduleId: string
  type: string
  challenge?: string
  sessionNonce?: string | null
  revision?: string
  contexts?: Record<string, unknown>
  contextLabel?: string
  state?: string
  label?: string
  [key: string]: unknown
}

const moduleToHostPortMessageTypeSet = new Set<string>(moduleToHostPortMessageTypes)
const hostToModulePortMessageTypeSet = new Set<string>(hostToModulePortMessageTypes)

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function isModuleEnvelope(value: unknown, moduleId: string): value is ModuleBridgeEnvelope {
  if (!isRecord(value))
    return false
  return value.protocol === ONEWEB_MODULE_PROTOCOL
    && value.version === ONEWEB_MODULE_PROTOCOL_VERSION
    && value.moduleId === moduleId
    && typeof value.type === 'string'
}

export function createModuleEnvelope(
  moduleId: string,
  type: string,
  fields: Record<string, unknown> = {},
): ModuleBridgeEnvelope {
  return {
    ...fields,
    protocol: ONEWEB_MODULE_PROTOCOL,
    version: ONEWEB_MODULE_PROTOCOL_VERSION,
    moduleId,
    type,
  }
}

export function isModuleHelloEnvelope(
  value: unknown,
  moduleId: string,
): value is ModuleBridgeEnvelope & { type: 'MODULE_HELLO', challenge: string } {
  return isModuleEnvelope(value, moduleId)
    && value.type === 'MODULE_HELLO'
    && typeof value.challenge === 'string'
    && value.challenge.length >= 8
}

export function validateModulePortEnvelope(
  value: unknown,
  moduleId: string,
  sessionNonce: string,
): ModuleBridgeEnvelope | null {
  if (!isModuleEnvelope(value, moduleId))
    return null
  if (!moduleToHostPortMessageTypeSet.has(value.type) || value.sessionNonce !== sessionNonce)
    return null
  return value
}

export function validateHostInitEnvelope(
  value: unknown,
  moduleId: string,
  challenge: string,
): ModuleBridgeEnvelope | null {
  if (!isModuleEnvelope(value, moduleId)
    || value.type !== 'MODULE_INIT'
    || value.challenge !== challenge
    || typeof value.sessionNonce !== 'string'
    || value.sessionNonce.length < 24) {
    return null
  }
  return value
}

export function validateHostPortEnvelope(
  value: unknown,
  moduleId: string,
  sessionNonce: string,
): ModuleBridgeEnvelope | null {
  if (!isModuleEnvelope(value, moduleId)
    || !hostToModulePortMessageTypeSet.has(value.type)
    || value.sessionNonce !== sessionNonce
    || typeof value.revision !== 'string'
    || !isRecord(value.contexts)) {
    return null
  }
  return value
}
