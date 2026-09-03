import {
  isModuleContextField,
  type ModuleActivationMode,
  moduleActivationModes,
  type ModuleContextFieldGrants,
  type ModuleContextId,
  moduleContextIds,
  ONEWEB_MODULE_MANIFEST_VERSION,
  ONEWEB_MODULE_PROTOCOL,
  ONEWEB_MODULE_PROTOCOL_VERSION,
  REMOTE_FRAME_RUNTIME,
  type RemoteModuleCapabilityId,
  remoteModuleCapabilityIds,
} from './catalog.js'

export interface ModuleBridgeDescriptor {
  protocol: typeof ONEWEB_MODULE_PROTOCOL
  version: typeof ONEWEB_MODULE_PROTOCOL_VERSION
}

export interface RemoteFrameModuleManifest {
  manifest_version: typeof ONEWEB_MODULE_MANIFEST_VERSION
  runtime: typeof REMOTE_FRAME_RUNTIME
  id: string
  name: string
  version: string
  description: string
  icon_url: string
  entry_url: string
  matches: string[]
  contexts: ModuleContextId[]
  context_fields: ModuleContextFieldGrants
  capabilities: RemoteModuleCapabilityId[]
  activation: ModuleActivationMode
  min_host_version: string
  bridge: ModuleBridgeDescriptor
}

export type RemoteModuleManifestValidationResult =
  | { ok: true, manifest: RemoteFrameModuleManifest }
  | { ok: false, issues: string[] }

const reverseDomainIdPattern = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?){2,}$/
const semanticVersionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Z.-]+)?(?:\+[0-9A-Z.-]+)?$/i
const matchPattern = /^(?:https?|\*):\/\/[^\s/]+\/.*$/
const contextIdSet = new Set<string>(moduleContextIds)
const remoteCapabilityIdSet = new Set<string>(remoteModuleCapabilityIds)
const activationModeSet = new Set<string>(moduleActivationModes)

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function readString(value: unknown, field: string, issues: string[], maxLength: number) {
  if (typeof value !== 'string') {
    issues.push(`${field} must be a string`)
    return ''
  }
  const normalized = value.trim()
  if (!normalized)
    issues.push(`${field} must not be empty`)
  else if (normalized.length > maxLength)
    issues.push(`${field} must not exceed ${maxLength} characters`)
  return normalized
}

function readStringList(
  value: unknown,
  field: string,
  issues: string[],
): string[] {
  if (!Array.isArray(value)) {
    issues.push(`${field} must be an array`)
    return []
  }
  const normalized: string[] = []
  for (const item of value) {
    if (typeof item !== 'string' || !item.trim()) {
      issues.push(`${field} must contain only non-empty strings`)
      continue
    }
    const entry = item.trim()
    if (!normalized.includes(entry))
      normalized.push(entry)
  }
  return normalized
}

function parseRemoteUrl(value: unknown, field: string, issues: string[]) {
  const raw = readString(value, field, issues, 2048)
  if (!raw)
    return null
  try {
    const url = new URL(raw)
    const localHttp = url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')
    if (url.protocol !== 'https:' && !localHttp)
      issues.push(`${field} must use HTTPS or an explicit localhost HTTP origin`)
    if (url.username || url.password)
      issues.push(`${field} must not contain credentials`)
    return url
  }
  catch {
    issues.push(`${field} must be an absolute URL`)
    return null
  }
}

function readContextFields(value: unknown, contexts: ModuleContextId[], issues: string[]) {
  if (!isRecord(value)) {
    issues.push('context_fields must be an object')
    return {}
  }
  const result: ModuleContextFieldGrants = {}
  for (const [rawContextId, rawFields] of Object.entries(value)) {
    if (!contextIdSet.has(rawContextId)) {
      issues.push(`context_fields contains unsupported context: ${rawContextId}`)
      continue
    }
    const contextId = rawContextId as ModuleContextId
    if (!contexts.includes(contextId)) {
      issues.push(`context_fields.${contextId} is not listed in contexts`)
      continue
    }
    const fields = readStringList(rawFields, `context_fields.${contextId}`, issues)
    for (const field of fields) {
      if (!isModuleContextField(contextId, field))
        issues.push(`context_fields.${contextId} contains unsupported field: ${field}`)
    }
    const supportedFields = fields.filter(field => isModuleContextField(contextId, field))
    if (!supportedFields.length)
      issues.push(`context_fields.${contextId} must contain at least one supported field`)
    result[contextId] = supportedFields
  }
  for (const contextId of contexts) {
    if (!Object.hasOwn(result, contextId))
      issues.push(`context_fields.${contextId} is required`)
  }
  return result
}

export function validateRemoteFrameModuleManifest(
  value: unknown,
): RemoteModuleManifestValidationResult {
  if (!isRecord(value))
    return { ok: false, issues: ['manifest must be an object'] }

  const issues: string[] = []
  const id = readString(value.id, 'id', issues, 128)
  const name = readString(value.name, 'name', issues, 64)
  const version = readString(value.version, 'version', issues, 64)
  const description = readString(value.description, 'description', issues, 280)
  const minHostVersion = readString(value.min_host_version, 'min_host_version', issues, 64)
  const matches = readStringList(value.matches, 'matches', issues)
  const rawContexts = readStringList(value.contexts, 'contexts', issues)
  const contexts: ModuleContextId[] = []
  for (const contextId of rawContexts) {
    if (!contextIdSet.has(contextId))
      issues.push(`contexts contains unsupported value: ${contextId}`)
    else
      contexts.push(contextId as ModuleContextId)
  }
  const contextFields = readContextFields(value.context_fields, contexts, issues)
  const rawCapabilities = readStringList(value.capabilities, 'capabilities', issues)
  const capabilities: RemoteModuleCapabilityId[] = []
  for (const capability of rawCapabilities) {
    if (!remoteCapabilityIdSet.has(capability))
      issues.push(`capabilities contains unsupported value: ${capability}`)
    else
      capabilities.push(capability as RemoteModuleCapabilityId)
  }
  const activation = readString(value.activation, 'activation', issues, 32)

  if (value.manifest_version !== ONEWEB_MODULE_MANIFEST_VERSION)
    issues.push(`manifest_version must be ${ONEWEB_MODULE_MANIFEST_VERSION}`)
  if (value.runtime !== REMOTE_FRAME_RUNTIME)
    issues.push(`runtime must be ${REMOTE_FRAME_RUNTIME}`)
  if (id && !reverseDomainIdPattern.test(id))
    issues.push('id must use reverse-domain form with at least three segments')
  if (version && !semanticVersionPattern.test(version))
    issues.push('version must be a semantic version')
  if (minHostVersion && !semanticVersionPattern.test(minHostVersion))
    issues.push('min_host_version must be a semantic version')
  if (!matches.length)
    issues.push('remote-frame matches must contain at least one match pattern')
  for (const pattern of matches) {
    if (pattern !== '<all_urls>' && !matchPattern.test(pattern))
      issues.push(`matches contains invalid pattern: ${pattern}`)
  }
  if (!activationModeSet.has(activation))
    issues.push(`activation contains unsupported value: ${activation}`)

  const entryUrl = parseRemoteUrl(value.entry_url, 'entry_url', issues)
  const iconUrl = parseRemoteUrl(value.icon_url, 'icon_url', issues)
  if (entryUrl && iconUrl && entryUrl.origin !== iconUrl.origin)
    issues.push('icon_url and entry_url must use the same origin')

  const bridge = isRecord(value.bridge) ? value.bridge : null
  if (!bridge) {
    issues.push('bridge must be an object')
  }
  else {
    if (bridge.protocol !== ONEWEB_MODULE_PROTOCOL)
      issues.push(`bridge.protocol must be ${ONEWEB_MODULE_PROTOCOL}`)
    if (bridge.version !== ONEWEB_MODULE_PROTOCOL_VERSION)
      issues.push(`bridge.version must be ${ONEWEB_MODULE_PROTOCOL_VERSION}`)
  }

  if (issues.length || !entryUrl || !iconUrl || !bridge)
    return { ok: false, issues }

  return {
    ok: true,
    manifest: {
      manifest_version: ONEWEB_MODULE_MANIFEST_VERSION,
      runtime: REMOTE_FRAME_RUNTIME,
      id,
      name,
      version,
      description,
      icon_url: iconUrl.href,
      entry_url: entryUrl.href,
      matches,
      contexts,
      context_fields: contextFields,
      capabilities,
      activation: activation as ModuleActivationMode,
      min_host_version: minHostVersion,
      bridge: {
        protocol: ONEWEB_MODULE_PROTOCOL,
        version: ONEWEB_MODULE_PROTOCOL_VERSION,
      },
    },
  }
}

export function defineRemoteFrameModuleManifest(value: RemoteFrameModuleManifest) {
  const result = validateRemoteFrameModuleManifest(value)
  if (!result.ok)
    throw new TypeError(`Invalid OneWeb remote module manifest: ${result.issues.join('; ')}`)
  return result.manifest
}
