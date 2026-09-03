import type {
  ClashConnectionStatus,
  ClashControlErrorCode,
  ClashProxyNodeStatus,
  ClashReadOnlySnapshot,
  ClashReadState,
} from './contracts'
import {
  CLASH_CONTROL_READ_ENDPOINTS,
  CLASH_CONTROL_SNAPSHOT_VERSION,
} from './contracts'

const MAX_PROXY_ENTRIES = 512
const MAX_GROUP_NODES = 512
const MAX_TEXT_LENGTH = 256

interface ParseFailure {
  ok: false
  reason: Extract<ClashControlErrorCode, 'response-malformed'>
}

export interface ClashSnapshotPayloads {
  version: unknown
  configs: unknown
  proxies: unknown
}

export interface ClashSnapshotParseContext {
  controllerOrigin: string
  generation: number
  refreshedAt: string
  forbiddenText?: string
}

export type ClashProxyGroupsParseResult =
  | { ok: true, proxyGroups: ClashReadOnlySnapshot['proxyGroups'] }
  | ParseFailure

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function normalizedText(value: unknown, maxLength: number, forbiddenText = ''): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength)
    return null
  if (forbiddenText && value.includes(forbiddenText))
    return null
  return value
}

function compareText(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0
}

function parseControllerIdentity(
  versionValue: unknown,
  configsValue: unknown,
  forbiddenText = '',
) {
  if (!isRecord(versionValue) || !isRecord(configsValue))
    return null
  const controllerVersion = normalizedText(versionValue.version, 128, forbiddenText)
  const mode = normalizedText(configsValue.mode, 64, forbiddenText)
  if (!controllerVersion || !mode)
    return null
  return {
    implementation: versionValue.meta === true ? 'Clash.Meta' : 'Clash-compatible',
    controllerVersion,
    mode,
  }
}

export function isClashControlReadEndpoint(value: unknown): value is typeof CLASH_CONTROL_READ_ENDPOINTS[number] {
  return typeof value === 'string' && (CLASH_CONTROL_READ_ENDPOINTS as readonly string[]).includes(value)
}

export function parseClashConnectionStatus(
  versionValue: unknown,
  configsValue: unknown,
  context: Pick<ClashSnapshotParseContext, 'controllerOrigin' | 'refreshedAt' | 'forbiddenText'>,
): ClashConnectionStatus | null {
  const identity = parseControllerIdentity(versionValue, configsValue, context.forbiddenText)
  if (!identity)
    return null
  return {
    controllerOrigin: context.controllerOrigin,
    implementation: identity.implementation,
    version: identity.controllerVersion,
    mode: identity.mode,
    connectedAt: context.refreshedAt,
  }
}

export function parseClashProxyGroups(
  proxiesValue: unknown,
  forbiddenText = '',
): ClashProxyGroupsParseResult {
  if (!isRecord(proxiesValue) || !isRecord(proxiesValue.proxies))
    return { ok: false, reason: 'response-malformed' }

  const entries = Object.entries(proxiesValue.proxies)
  if (entries.length > MAX_PROXY_ENTRIES)
    return { ok: false, reason: 'response-malformed' }

  const nodes = new Map<string, ClashProxyNodeStatus>()
  const rawEntries = new Map<string, Record<string, unknown>>()
  for (const [rawName, rawEntry] of entries) {
    const name = normalizedText(rawName, MAX_TEXT_LENGTH, forbiddenText)
    if (!name || !isRecord(rawEntry))
      return { ok: false, reason: 'response-malformed' }
    const type = normalizedText(rawEntry.type, 64, forbiddenText)
    if (!type || (rawEntry.alive !== undefined && typeof rawEntry.alive !== 'boolean'))
      return { ok: false, reason: 'response-malformed' }
    nodes.set(name, {
      name,
      type,
      alive: typeof rawEntry.alive === 'boolean' ? rawEntry.alive : null,
    })
    rawEntries.set(name, rawEntry)
  }

  const proxyGroups = []
  for (const [name, rawEntry] of rawEntries) {
    if (!Object.prototype.hasOwnProperty.call(rawEntry, 'all'))
      continue
    if (!Array.isArray(rawEntry.all) || rawEntry.all.length > MAX_GROUP_NODES)
      return { ok: false, reason: 'response-malformed' }
    const selectedNode = normalizedText(rawEntry.now, MAX_TEXT_LENGTH, forbiddenText)
    if (!selectedNode)
      return { ok: false, reason: 'response-malformed' }
    const nodeNames: string[] = []
    const seen = new Set<string>()
    for (const rawNodeName of rawEntry.all) {
      const nodeName = normalizedText(rawNodeName, MAX_TEXT_LENGTH, forbiddenText)
      if (!nodeName || !nodes.has(nodeName))
        return { ok: false, reason: 'response-malformed' }
      if (!seen.has(nodeName)) {
        nodeNames.push(nodeName)
        seen.add(nodeName)
      }
    }
    if (!seen.has(selectedNode))
      return { ok: false, reason: 'response-malformed' }
    proxyGroups.push({
      name,
      type: nodes.get(name)!.type,
      selectedNode,
      nodes: nodeNames.map(nodeName => structuredClone(nodes.get(nodeName)!)),
    })
  }
  proxyGroups.sort((left, right) => compareText(left.name, right.name))
  return { ok: true, proxyGroups }
}

export function parseClashReadOnlySnapshot(
  payloads: ClashSnapshotPayloads,
  context: ClashSnapshotParseContext,
): { ok: true, snapshot: ClashReadOnlySnapshot } | ParseFailure {
  if (!Number.isSafeInteger(context.generation) || context.generation < 0)
    return { ok: false, reason: 'response-malformed' }
  const identity = parseControllerIdentity(payloads.version, payloads.configs, context.forbiddenText)
  if (!identity)
    return { ok: false, reason: 'response-malformed' }
  const parsedGroups = parseClashProxyGroups(payloads.proxies, context.forbiddenText)
  if (!parsedGroups.ok)
    return parsedGroups

  return {
    ok: true,
    snapshot: {
      version: CLASH_CONTROL_SNAPSHOT_VERSION,
      controllerOrigin: context.controllerOrigin,
      generation: context.generation,
      refreshedAt: context.refreshedAt,
      implementation: identity.implementation,
      controllerVersion: identity.controllerVersion,
      mode: identity.mode,
      proxyGroups: parsedGroups.proxyGroups,
    },
  }
}

function isDiagnostic(value: unknown) {
  return isRecord(value) && typeof value.code === 'string' && typeof value.occurredAt === 'string'
}

function isNode(value: unknown): value is ClashProxyNodeStatus {
  return isRecord(value)
    && typeof value.name === 'string'
    && typeof value.type === 'string'
    && (typeof value.alive === 'boolean' || value.alive === null)
}

export function isClashReadOnlySnapshot(value: unknown): value is ClashReadOnlySnapshot {
  return isRecord(value)
    && value.version === CLASH_CONTROL_SNAPSHOT_VERSION
    && typeof value.controllerOrigin === 'string'
    && Number.isSafeInteger(value.generation)
    && typeof value.refreshedAt === 'string'
    && typeof value.implementation === 'string'
    && typeof value.controllerVersion === 'string'
    && typeof value.mode === 'string'
    && Array.isArray(value.proxyGroups)
    && value.proxyGroups.every(group => isRecord(group)
      && typeof group.name === 'string'
      && typeof group.type === 'string'
      && typeof group.selectedNode === 'string'
      && Array.isArray(group.nodes)
      && group.nodes.every(isNode))
}

export function isClashReadState(value: unknown): value is ClashReadState {
  if (!isRecord(value))
    return false
  if (value.status === 'empty')
    return value.snapshot === null && (value.diagnostic === null || isDiagnostic(value.diagnostic))
  if (value.status === 'ready')
    return isClashReadOnlySnapshot(value.snapshot) && value.diagnostic === null
  return value.status === 'stale'
    && isClashReadOnlySnapshot(value.snapshot)
    && isDiagnostic(value.diagnostic)
}
