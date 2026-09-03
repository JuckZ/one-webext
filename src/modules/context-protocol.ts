import type { ContextMap, ContextSnapshot } from './context-broker'
import { type ModuleContextId, moduleContextIds } from './types'

export const ONEWEB_CONTEXT_CHANNEL = 'oneweb.context' as const
export const ONEWEB_CONTEXT_VERSION = 1 as const

export interface ContextProviderUpdateMessage {
  channel: typeof ONEWEB_CONTEXT_CHANNEL
  version: typeof ONEWEB_CONTEXT_VERSION
  type: 'CONTEXT_PROVIDER_UPDATE'
  contextId: ModuleContextId
  value: unknown
}

export interface ContextSubscriberReadyMessage {
  channel: typeof ONEWEB_CONTEXT_CHANNEL
  version: typeof ONEWEB_CONTEXT_VERSION
  type: 'CONTEXT_SUBSCRIBER_READY'
}

export interface ContextSnapshotMessage extends ContextSnapshot {
  channel: typeof ONEWEB_CONTEXT_CHANNEL
  version: typeof ONEWEB_CONTEXT_VERSION
  type: 'CONTEXT_SNAPSHOT'
  contexts: ContextMap
}

export type ContextRuntimeMessage = ContextProviderUpdateMessage | ContextSubscriberReadyMessage | ContextSnapshotMessage

const contextIdSet = new Set<string>(moduleContextIds)
const contextMessageTypes = new Set([
  'CONTEXT_PROVIDER_UPDATE',
  'CONTEXT_SUBSCRIBER_READY',
  'CONTEXT_SNAPSHOT',
])

export function isContextRuntimeMessage(value: unknown): value is ContextRuntimeMessage {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return false
  const message = value as Record<string, unknown>
  if (message.channel !== ONEWEB_CONTEXT_CHANNEL
    || message.version !== ONEWEB_CONTEXT_VERSION
    || typeof message.type !== 'string'
    || !contextMessageTypes.has(message.type)) {
    return false
  }
  if (message.type === 'CONTEXT_PROVIDER_UPDATE')
    return typeof message.contextId === 'string' && contextIdSet.has(message.contextId)
  if (message.type === 'CONTEXT_SNAPSHOT') {
    return Number.isInteger(message.tabId)
      && Number(message.tabId) >= 0
      && typeof message.revision === 'string'
      && Boolean(message.contexts && typeof message.contexts === 'object' && !Array.isArray(message.contexts))
  }
  return true
}

export function createContextSnapshotMessage(snapshot: ContextSnapshot): ContextSnapshotMessage {
  return {
    channel: ONEWEB_CONTEXT_CHANNEL,
    version: ONEWEB_CONTEXT_VERSION,
    type: 'CONTEXT_SNAPSHOT',
    ...snapshot,
  }
}
