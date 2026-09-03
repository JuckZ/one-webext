import type { InstalledModuleRecord } from './types'
import {
  createModuleEnvelope as createSdkModuleEnvelope,
  isModuleHelloEnvelope,
  type ModuleBridgeEnvelope,
  moduleToHostPortMessageTypes,
  validateModulePortEnvelope,
} from '@oneweb/module-sdk'

export type { ModuleBridgeEnvelope } from '@oneweb/module-sdk'

export const modulePortMessageTypes = moduleToHostPortMessageTypes

export type ModulePortMessageType = typeof modulePortMessageTypes[number]
export type HostModuleMessageType = 'MODULE_INIT' | 'CONTEXT_UPDATE'

export function createModuleEnvelope(
  record: InstalledModuleRecord,
  type: HostModuleMessageType,
  fields: Record<string, unknown> = {},
) {
  return createSdkModuleEnvelope(record.manifest.id, type, fields)
}

export function isTrustedModuleHello(
  event: Pick<MessageEvent, 'origin' | 'source' | 'data'>,
  record: InstalledModuleRecord,
  expectedSource: Window | null,
): event is Pick<MessageEvent, 'origin' | 'source'> & { data: ModuleBridgeEnvelope & { type: 'MODULE_HELLO' } } {
  if (record.manifest.runtime !== 'remote-frame' || event.source !== expectedSource)
    return false
  if (event.origin !== new URL(record.manifest.entry_url).origin)
    return false
  return isModuleHelloEnvelope(event.data, record.manifest.id)
}

export function validateModulePortMessage(
  value: unknown,
  record: InstalledModuleRecord,
  sessionNonce: string,
): ModuleBridgeEnvelope | null {
  return validateModulePortEnvelope(value, record.manifest.id, sessionNonce)
}
