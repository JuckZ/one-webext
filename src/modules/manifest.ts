import { validateRemoteFrameModuleManifest } from '@oneweb/module-sdk'
import { isModuleContextField } from './context-fields'
import {
  type BuiltinModuleManifest,
  type ModuleActivationMode,
  moduleActivationModes,
  type ModuleCapabilityId,
  moduleCapabilityIds,
  type ModuleContextId,
  moduleContextIds,
  ONEWEB_MODULE_MANIFEST_VERSION,
  type OneWebModuleManifest,
} from './types'

export interface ModuleManifestValidationOptions {
  allowBuiltin?: boolean
}

export type ModuleManifestValidationResult =
  | { ok: true, manifest: OneWebModuleManifest }
  | { ok: false, issues: string[] }

const reverseDomainIdPattern = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?){2,}$/
const semanticVersionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Z.-]+)?(?:\+[0-9A-Z.-]+)?$/i
const builtinEntryPattern = /^[a-z][a-z0-9-]{1,63}$/
const matchPattern = /^(?:https?|\*):\/\/[^\s/]+\/.*$/
const contextIdSet = new Set<string>(moduleContextIds)
const capabilityIdSet = new Set<string>(moduleCapabilityIds)
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

function readStringList<T extends string>(
  value: unknown,
  field: string,
  issues: string[],
  supported?: Set<string>,
): T[] {
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
    if (supported && !supported.has(entry)) {
      issues.push(`${field} contains unsupported value: ${entry}`)
      continue
    }
    if (!normalized.includes(entry))
      normalized.push(entry)
  }
  return normalized as T[]
}

function readCommonFields(candidate: Record<string, unknown>, issues: string[]) {
  const id = readString(candidate.id, 'id', issues, 128)
  const name = readString(candidate.name, 'name', issues, 64)
  const version = readString(candidate.version, 'version', issues, 64)
  const description = readString(candidate.description, 'description', issues, 280)
  const minHostVersion = readString(candidate.min_host_version, 'min_host_version', issues, 64)
  const matches = readStringList<string>(candidate.matches, 'matches', issues)
  const contexts = readStringList<ModuleContextId>(candidate.contexts, 'contexts', issues, contextIdSet)
  const contextFields = readContextFields(candidate.context_fields, contexts, issues)
  const capabilities = readStringList<ModuleCapabilityId>(candidate.capabilities, 'capabilities', issues, capabilityIdSet)
  const activation = readString(candidate.activation, 'activation', issues, 32)

  if (id && !reverseDomainIdPattern.test(id))
    issues.push('id must use reverse-domain form with at least three segments')
  if (version && !semanticVersionPattern.test(version))
    issues.push('version must be a semantic version')
  if (minHostVersion && !semanticVersionPattern.test(minHostVersion))
    issues.push('min_host_version must be a semantic version')
  for (const pattern of matches) {
    if (pattern !== '<all_urls>' && !matchPattern.test(pattern))
      issues.push(`matches contains invalid pattern: ${pattern}`)
  }
  if (!activationModeSet.has(activation))
    issues.push(`activation contains unsupported value: ${activation}`)

  return {
    id,
    name,
    version,
    description,
    matches,
    contexts,
    context_fields: contextFields,
    capabilities,
    activation: activation as ModuleActivationMode,
    min_host_version: minHostVersion,
  }
}

function readContextFields(value: unknown, contexts: ModuleContextId[], issues: string[]) {
  if (!isRecord(value)) {
    issues.push('context_fields must be an object')
    return {}
  }
  const result: Partial<Record<ModuleContextId, string[]>> = {}
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
    const fields = readStringList<string>(rawFields, `context_fields.${contextId}`, issues)
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

export function validateModuleManifest(
  value: unknown,
  options: ModuleManifestValidationOptions = {},
): ModuleManifestValidationResult {
  if (!isRecord(value))
    return { ok: false, issues: ['manifest must be an object'] }

  if (value.runtime === 'remote-frame')
    return validateRemoteFrameModuleManifest(value)

  const issues: string[] = []
  const common = readCommonFields(value, issues)

  if (value.manifest_version !== ONEWEB_MODULE_MANIFEST_VERSION)
    issues.push(`manifest_version must be ${ONEWEB_MODULE_MANIFEST_VERSION}`)

  if (value.runtime === 'builtin') {
    if (!options.allowBuiltin)
      issues.push('builtin manifests are reserved for packaged OneWeb modules')
    const iconPath = readString(value.icon_path, 'icon_path', issues, 256)
    const entryId = readString(value.entry_id, 'entry_id', issues, 64)
    if (iconPath && (!iconPath.startsWith('/assets/') || !iconPath.endsWith('.png')))
      issues.push('icon_path must reference a packaged PNG under /assets/')
    if (entryId && !builtinEntryPattern.test(entryId))
      issues.push('entry_id must use lowercase letters, numbers and hyphens')
    if (issues.length)
      return { ok: false, issues }

    const manifest: BuiltinModuleManifest = {
      manifest_version: ONEWEB_MODULE_MANIFEST_VERSION,
      runtime: 'builtin',
      ...common,
      icon_path: iconPath,
      entry_id: entryId,
    }
    return { ok: true, manifest }
  }

  issues.push('runtime must be remote-frame or builtin')
  return { ok: false, issues }
}
