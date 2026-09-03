import type {
  PageToolAuthorityV1,
  PageToolboxSettingsV1,
  PageToolCatalogEntryV1,
  PageToolCatalogV1,
  PageToolDescriptorV1,
  PageToolDomAccess,
  PageToolJsonValue,
  PageToolPlanV1,
  PageToolRuntimeBindingV1,
  PageToolSettingsSchemaDefinitionV1,
  PageToolSiteSettingsV1,
  PageToolValidationErrorCode,
  PageToolValidationResult,
} from './contracts'
import {
  PAGE_TOOL_DESCRIPTION_MAX_LENGTH,
  PAGE_TOOL_DESCRIPTOR_SCHEMA_VERSION,
  PAGE_TOOL_DOM_ACCESS,
  PAGE_TOOL_ID_MAX_LENGTH,
  PAGE_TOOL_NAVIGATION_ID_MAX_LENGTH,
  PAGE_TOOL_OPERATION_ID_MAX_LENGTH,
  PAGE_TOOL_RUNTIME_BINDING_SCHEMA_VERSION,
  PAGE_TOOL_SCHEMA_ID_MAX_LENGTH,
  PAGE_TOOL_SETTINGS_SCHEMA_VERSION,
  PAGE_TOOL_TITLE_MAX_LENGTH,
  PAGE_TOOLBOX_MAX_SETTINGS_BYTES,
  PAGE_TOOLBOX_MAX_SETTINGS_DEPTH,
  PAGE_TOOLBOX_MAX_SETTINGS_NODES,
  PAGE_TOOLBOX_MAX_SITE_SETTINGS_BYTES,
  PAGE_TOOLBOX_MAX_SITES,
  PAGE_TOOLBOX_MAX_TOOL_SETTINGS_BYTES,
  PAGE_TOOLBOX_MAX_TOOLS_PER_SITE,
  PAGE_TOOLBOX_MODULE_ID,
  PAGE_TOOLBOX_SETTINGS_SCHEMA_VERSION,
} from './contracts'

interface CanonicalJsonResult {
  bytes: number
  maximumDepth: number
  nodes: number
  value: PageToolJsonValue
}

interface MutableJsonMetrics {
  maximumDepth: number
  nodes: number
}

const identifierPattern = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/
const operationIdentifierPattern = /^[\w.:-]+$/
const domAccessValues = new Set<string>(PAGE_TOOL_DOM_ACCESS)

function fail<Value>(code: PageToolValidationErrorCode, path: string): PageToolValidationResult<Value> {
  return { ok: false, code, path }
}

function hasOnlyDataProperties(value: object, expectedKeys?: ReadonlySet<string>): value is Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null)
    return false
  const keys = Reflect.ownKeys(value)
  if (keys.some(key => typeof key !== 'string'))
    return false
  if (expectedKeys && (keys.length !== expectedKeys.size || keys.some(key => !expectedKeys.has(key as string))))
    return false
  return keys.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    return Boolean(descriptor && 'value' in descriptor && descriptor.enumerable)
  })
}

function readDataProperty(value: Record<string, unknown>, key: string): unknown {
  return Object.getOwnPropertyDescriptor(value, key)?.value
}

function isBoundedIdentifier(value: unknown, maximumLength: number): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= maximumLength
    && identifierPattern.test(value)
}

function isBoundedText(value: unknown, maximumLength: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maximumLength
}

function isDenseDataArray(value: unknown): value is unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype)
    return false
  const ownKeys = Reflect.ownKeys(value)
  if (ownKeys.some(key => typeof key !== 'string'))
    return false
  if (ownKeys.length !== value.length + 1 || !ownKeys.includes('length'))
    return false
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable)
      return false
  }
  return true
}

function utf8ByteLength(value: string): number {
  let bytes = 0
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code <= 0x7F) {
      bytes += 1
    }
    else if (code <= 0x7FF) {
      bytes += 2
    }
    else if (code >= 0xD800 && code <= 0xDBFF
      && index + 1 < value.length
      && value.charCodeAt(index + 1) >= 0xDC00
      && value.charCodeAt(index + 1) <= 0xDFFF) {
      bytes += 4
      index += 1
    }
    else {
      bytes += 3
    }
  }
  return bytes
}

function cloneJsonValue(
  input: unknown,
  path: string,
  depth: number,
  metrics: MutableJsonMetrics,
  stack: WeakSet<object>,
): PageToolValidationResult<PageToolJsonValue> {
  metrics.nodes += 1
  metrics.maximumDepth = Math.max(metrics.maximumDepth, depth)
  if (metrics.nodes > PAGE_TOOLBOX_MAX_SETTINGS_NODES)
    return fail('settings-node-limit', path)
  if (depth > PAGE_TOOLBOX_MAX_SETTINGS_DEPTH)
    return fail('settings-depth-limit', path)

  if (input === null || typeof input === 'boolean' || typeof input === 'string')
    return { ok: true, value: input }
  if (typeof input === 'number') {
    if (!Number.isFinite(input))
      return fail('invalid-json-value', path)
    return { ok: true, value: Object.is(input, -0) ? 0 : input }
  }
  if (typeof input !== 'object')
    return fail('invalid-json-value', path)
  if (stack.has(input))
    return fail('invalid-json-value', path)

  stack.add(input)
  try {
    if (Array.isArray(input)) {
      if (!isDenseDataArray(input))
        return fail('invalid-json-value', path)
      const output: PageToolJsonValue[] = []
      for (let index = 0; index < input.length; index += 1) {
        const child = cloneJsonValue(input[index], `${path}[${index}]`, depth + 1, metrics, stack)
        if (!child.ok)
          return child
        output.push(child.value)
      }
      return { ok: true, value: Object.freeze(output) }
    }

    if (!hasOnlyDataProperties(input))
      return fail('invalid-json-value', path)
    const output = Object.create(null) as Record<string, PageToolJsonValue>
    for (const key of Object.keys(input).sort()) {
      const child = cloneJsonValue(readDataProperty(input, key), `${path}.${key}`, depth + 1, metrics, stack)
      if (!child.ok)
        return child
      Object.defineProperty(output, key, {
        configurable: false,
        enumerable: true,
        value: child.value,
        writable: false,
      })
    }
    return { ok: true, value: Object.freeze(output) }
  }
  finally {
    stack.delete(input)
  }
}

export function canonicalizePageToolJson(input: unknown): PageToolValidationResult<CanonicalJsonResult> {
  const metrics: MutableJsonMetrics = { maximumDepth: 0, nodes: 0 }
  const cloned = cloneJsonValue(input, '$', 1, metrics, new WeakSet())
  if (!cloned.ok)
    return cloned
  const serialized = JSON.stringify(cloned.value)
  return {
    ok: true,
    value: Object.freeze({
      bytes: utf8ByteLength(serialized),
      maximumDepth: metrics.maximumDepth,
      nodes: metrics.nodes,
      value: cloned.value,
    }),
  }
}

export function normalizePageToolExactOrigin(input: unknown): string | null {
  if (typeof input !== 'string' || input.length === 0 || input.length > 2048)
    return null
  try {
    const parsed = new URL(input)
    if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
      || parsed.username
      || parsed.password
      || parsed.pathname !== '/'
      || parsed.search
      || parsed.hash
      || parsed.origin === 'null') {
      return null
    }
    return parsed.origin
  }
  catch {
    return null
  }
}

const descriptorKeys = new Set([
  'schemaVersion',
  'id',
  'title',
  'description',
  'siteScope',
  'requiredSiteGrant',
  'runAt',
  'frames',
  'defaultEnabled',
  'domAccess',
  'requiresMainWorld',
  'settingsSchemaId',
  'settingsSchemaVersion',
])

export function validatePageToolDescriptor(
  input: unknown,
  schemas: readonly PageToolSettingsSchemaDefinitionV1[],
): PageToolValidationResult<PageToolDescriptorV1> {
  if (!input || typeof input !== 'object' || !hasOnlyDataProperties(input, descriptorKeys))
    return fail('invalid-descriptor', '$')
  const record = input as Record<string, unknown>
  const schemaVersion = readDataProperty(record, 'schemaVersion')
  const id = readDataProperty(record, 'id')
  const title = readDataProperty(record, 'title')
  const description = readDataProperty(record, 'description')
  const siteScope = readDataProperty(record, 'siteScope')
  const requiredSiteGrant = readDataProperty(record, 'requiredSiteGrant')
  const runAt = readDataProperty(record, 'runAt')
  const frames = readDataProperty(record, 'frames')
  const defaultEnabled = readDataProperty(record, 'defaultEnabled')
  const domAccess = readDataProperty(record, 'domAccess')
  const requiresMainWorld = readDataProperty(record, 'requiresMainWorld')
  const settingsSchemaId = readDataProperty(record, 'settingsSchemaId')
  const settingsSchemaVersion = readDataProperty(record, 'settingsSchemaVersion')

  if (schemaVersion !== PAGE_TOOL_DESCRIPTOR_SCHEMA_VERSION
    || !isBoundedIdentifier(id, PAGE_TOOL_ID_MAX_LENGTH)
    || !isBoundedText(title, PAGE_TOOL_TITLE_MAX_LENGTH)
    || !isBoundedText(description, PAGE_TOOL_DESCRIPTION_MAX_LENGTH)
    || siteScope !== 'user-approved-exact-http-origin'
    || requiredSiteGrant !== 'exact-origin'
    || (runAt !== 'document-start' && runAt !== 'document-idle')
    || frames !== 'top'
    || defaultEnabled !== false
    || !isDenseDataArray(domAccess)
    || requiresMainWorld !== false
    || !isBoundedIdentifier(settingsSchemaId, PAGE_TOOL_SCHEMA_ID_MAX_LENGTH)
    || settingsSchemaVersion !== PAGE_TOOL_SETTINGS_SCHEMA_VERSION) {
    return fail('invalid-descriptor', '$')
  }

  const normalizedAccess: PageToolDomAccess[] = []
  for (const value of domAccess) {
    if (typeof value !== 'string' || !domAccessValues.has(value) || normalizedAccess.includes(value as PageToolDomAccess))
      return fail('invalid-descriptor', '$.domAccess')
    normalizedAccess.push(value as PageToolDomAccess)
  }

  const matchingSchemas = schemas.filter(schema => schema.toolId === id
    && schema.schemaId === settingsSchemaId
    && schema.schemaVersion === settingsSchemaVersion
    && typeof schema.validate === 'function')
  if (matchingSchemas.length !== 1)
    return fail('unknown-settings-schema', '$.settingsSchemaId')

  return {
    ok: true,
    value: Object.freeze({
      schemaVersion,
      id,
      title,
      description,
      siteScope,
      requiredSiteGrant,
      runAt,
      frames,
      defaultEnabled,
      domAccess: Object.freeze(normalizedAccess),
      requiresMainWorld,
      settingsSchemaId,
      settingsSchemaVersion,
    }),
  }
}

export function createPageToolCatalog(
  descriptors: readonly unknown[],
  schemas: readonly PageToolSettingsSchemaDefinitionV1[],
): PageToolValidationResult<PageToolCatalogV1> {
  const output = Object.create(null) as Record<string, PageToolCatalogEntryV1>
  for (const input of descriptors) {
    const descriptor = validatePageToolDescriptor(input, schemas)
    if (!descriptor.ok)
      return descriptor
    if (Object.hasOwn(output, descriptor.value.id))
      return fail('duplicate-tool', `$.${descriptor.value.id}`)
    const schema = schemas.find(schema => schema.toolId === descriptor.value.id
      && schema.schemaId === descriptor.value.settingsSchemaId
      && schema.schemaVersion === descriptor.value.settingsSchemaVersion)!
    const settingsSchema = Object.freeze({
      toolId: schema.toolId,
      schemaId: schema.schemaId,
      schemaVersion: schema.schemaVersion,
      validate: schema.validate,
    })
    Object.defineProperty(output, descriptor.value.id, {
      configurable: false,
      enumerable: true,
      value: Object.freeze({ descriptor: descriptor.value, settingsSchema }),
      writable: false,
    })
  }
  return { ok: true, value: Object.freeze(output) }
}

export function validatePageToolSettingsValue(
  toolId: string,
  input: unknown,
  catalog: PageToolCatalogV1,
): PageToolValidationResult<PageToolJsonValue> {
  const entry = catalog[toolId]
  if (!entry)
    return fail('invalid-settings', '$.toolId')
  const cloned = canonicalizePageToolJson(input)
  if (!cloned.ok)
    return cloned
  if (cloned.value.bytes > PAGE_TOOLBOX_MAX_TOOL_SETTINGS_BYTES)
    return fail('tool-settings-bytes-limit', '$')
  try {
    if (!entry.settingsSchema.validate(cloned.value.value))
      return fail('settings-schema-rejected', '$')
  }
  catch {
    return fail('settings-schema-rejected', '$')
  }
  return { ok: true, value: cloned.value.value }
}

export function validatePageToolPlans(
  input: unknown,
  catalog: PageToolCatalogV1,
): PageToolValidationResult<readonly PageToolPlanV1[]> {
  if (!isDenseDataArray(input) || input.length > PAGE_TOOLBOX_MAX_TOOLS_PER_SITE)
    return fail('invalid-settings', '$.tools')
  const plans = new Map<string, PageToolPlanV1>()
  for (let index = 0; index < input.length; index += 1) {
    const candidate = input[index]
    if (!candidate
      || typeof candidate !== 'object'
      || !hasOnlyDataProperties(candidate, new Set(['toolId', 'settings']))) {
      return fail('invalid-settings', `$.tools[${index}]`)
    }
    const record = candidate as Record<string, unknown>
    const toolId = readDataProperty(record, 'toolId')
    if (typeof toolId !== 'string' || plans.has(toolId))
      return fail('invalid-settings', `$.tools[${index}].toolId`)
    const settings = validatePageToolSettingsValue(toolId, readDataProperty(record, 'settings'), catalog)
    if (!settings.ok)
      return { ...settings, path: `$.tools[${index}].settings${settings.path.slice(1)}` }
    plans.set(toolId, Object.freeze({ toolId, settings: settings.value }))
  }
  return {
    ok: true,
    value: Object.freeze([...plans.values()].sort((left, right) => left.toolId.localeCompare(right.toolId))),
  }
}

export function createPageToolPlansForSite(
  site: PageToolSiteSettingsV1,
  catalog: PageToolCatalogV1,
): PageToolValidationResult<readonly PageToolPlanV1[]> {
  return validatePageToolPlans(site.enabledToolIds.map(toolId => ({
    toolId,
    settings: site.toolSettings[toolId],
  })), catalog)
}

const settingsKeys = new Set(['schemaVersion', 'sites'])
const siteSettingsKeys = new Set(['enabledToolIds', 'toolSettings'])

export function createDefaultPageToolboxSettings(): PageToolboxSettingsV1 {
  return Object.freeze({
    schemaVersion: PAGE_TOOLBOX_SETTINGS_SCHEMA_VERSION,
    sites: Object.freeze(Object.create(null) as Record<string, PageToolSiteSettingsV1>),
  })
}

export function validatePageToolboxSettings(
  input: unknown,
  catalog: PageToolCatalogV1,
): PageToolValidationResult<PageToolboxSettingsV1> {
  if (!input || typeof input !== 'object' || !hasOnlyDataProperties(input, settingsKeys))
    return fail('invalid-settings', '$')
  const root = input as Record<string, unknown>
  if (readDataProperty(root, 'schemaVersion') !== PAGE_TOOLBOX_SETTINGS_SCHEMA_VERSION)
    return fail('invalid-settings', '$.schemaVersion')
  const sitesInput = readDataProperty(root, 'sites')
  if (!sitesInput || typeof sitesInput !== 'object' || !hasOnlyDataProperties(sitesInput))
    return fail('invalid-settings', '$.sites')
  const siteKeys = Object.keys(sitesInput)
  if (siteKeys.length > PAGE_TOOLBOX_MAX_SITES)
    return fail('site-limit', '$.sites')

  const normalizedSites = new Map<string, PageToolSiteSettingsV1>()
  for (const rawOrigin of siteKeys) {
    const origin = normalizePageToolExactOrigin(rawOrigin)
    if (!origin || normalizedSites.has(origin))
      return fail('invalid-settings', `$.sites.${rawOrigin}`)
    const siteInput = readDataProperty(sitesInput, rawOrigin)
    if (!siteInput || typeof siteInput !== 'object' || !hasOnlyDataProperties(siteInput, siteSettingsKeys))
      return fail('invalid-settings', `$.sites.${rawOrigin}`)
    const siteRecord = siteInput as Record<string, unknown>
    const enabledInput = readDataProperty(siteRecord, 'enabledToolIds')
    const toolSettingsInput = readDataProperty(siteRecord, 'toolSettings')
    if (!isDenseDataArray(enabledInput)
      || !toolSettingsInput
      || typeof toolSettingsInput !== 'object'
      || !hasOnlyDataProperties(toolSettingsInput)) {
      return fail('invalid-settings', `$.sites.${rawOrigin}`)
    }

    const enabledToolIds: string[] = []
    for (const toolId of enabledInput) {
      if (typeof toolId !== 'string'
        || !catalog[toolId]
        || enabledToolIds.includes(toolId)) {
        return fail('invalid-settings', `$.sites.${rawOrigin}.enabledToolIds`)
      }
      enabledToolIds.push(toolId)
    }

    const toolSettingIds = Object.keys(toolSettingsInput)
    const allToolIds = new Set([...enabledToolIds, ...toolSettingIds])
    if (enabledToolIds.length > PAGE_TOOLBOX_MAX_TOOLS_PER_SITE
      || allToolIds.size > PAGE_TOOLBOX_MAX_TOOLS_PER_SITE) {
      return fail('tool-limit', `$.sites.${rawOrigin}`)
    }

    const toolSettings = Object.create(null) as Record<string, PageToolJsonValue>
    for (const toolId of toolSettingIds.sort()) {
      const setting = validatePageToolSettingsValue(toolId, readDataProperty(toolSettingsInput, toolId), catalog)
      if (!setting.ok)
        return { ...setting, path: `$.sites.${rawOrigin}.toolSettings.${toolId}${setting.path.slice(1)}` }
      Object.defineProperty(toolSettings, toolId, {
        configurable: false,
        enumerable: true,
        value: setting.value,
        writable: false,
      })
    }

    const normalizedSite = Object.freeze({
      enabledToolIds: Object.freeze(enabledToolIds.sort()),
      toolSettings: Object.freeze(toolSettings),
    })
    const siteMeasurement = canonicalizePageToolJson(normalizedSite)
    if (!siteMeasurement.ok)
      return siteMeasurement
    if (siteMeasurement.value.bytes > PAGE_TOOLBOX_MAX_SITE_SETTINGS_BYTES)
      return fail('site-settings-bytes-limit', `$.sites.${rawOrigin}`)
    normalizedSites.set(origin, normalizedSite)
  }

  const sites = Object.create(null) as Record<string, PageToolSiteSettingsV1>
  for (const origin of [...normalizedSites.keys()].sort()) {
    Object.defineProperty(sites, origin, {
      configurable: false,
      enumerable: true,
      value: normalizedSites.get(origin),
      writable: false,
    })
  }
  const output = Object.freeze({
    schemaVersion: PAGE_TOOLBOX_SETTINGS_SCHEMA_VERSION,
    sites: Object.freeze(sites),
  })
  const totalMeasurement = canonicalizePageToolJson(output)
  if (!totalMeasurement.ok)
    return totalMeasurement
  if (totalMeasurement.value.bytes > PAGE_TOOLBOX_MAX_SETTINGS_BYTES)
    return fail('total-settings-bytes-limit', '$')
  return { ok: true, value: totalMeasurement.value.value as unknown as PageToolboxSettingsV1 }
}

const bindingKeys = new Set([
  'schemaVersion',
  'moduleId',
  'toolId',
  'exactOrigin',
  'tabId',
  'frameId',
  'navigationId',
  'generation',
])

export function validatePageToolRuntimeBinding(
  input: unknown,
  catalog: PageToolCatalogV1,
): PageToolValidationResult<PageToolRuntimeBindingV1> {
  if (!input || typeof input !== 'object' || !hasOnlyDataProperties(input, bindingKeys))
    return fail('invalid-binding', '$')
  const record = input as Record<string, unknown>
  const schemaVersion = readDataProperty(record, 'schemaVersion')
  const moduleId = readDataProperty(record, 'moduleId')
  const toolId = readDataProperty(record, 'toolId')
  const exactOrigin = normalizePageToolExactOrigin(readDataProperty(record, 'exactOrigin'))
  const tabId = readDataProperty(record, 'tabId')
  const frameId = readDataProperty(record, 'frameId')
  const navigationId = readDataProperty(record, 'navigationId')
  const generation = readDataProperty(record, 'generation')
  if (schemaVersion !== PAGE_TOOL_RUNTIME_BINDING_SCHEMA_VERSION
    || moduleId !== PAGE_TOOLBOX_MODULE_ID
    || typeof toolId !== 'string'
    || !catalog[toolId]
    || !exactOrigin
    || !Number.isSafeInteger(tabId)
    || (tabId as number) < 0
    || frameId !== 0
    || typeof navigationId !== 'string'
    || navigationId.length === 0
    || navigationId.length > PAGE_TOOL_NAVIGATION_ID_MAX_LENGTH
    || !Number.isSafeInteger(generation)
    || (generation as number) <= 0) {
    return fail('invalid-binding', '$')
  }
  return {
    ok: true,
    value: Object.freeze({
      schemaVersion,
      moduleId,
      toolId,
      exactOrigin,
      tabId: tabId as number,
      frameId,
      navigationId,
      generation: generation as number,
    }),
  }
}

export function createPageToolBindingKey(binding: PageToolRuntimeBindingV1): string {
  return JSON.stringify([
    binding.schemaVersion,
    binding.moduleId,
    binding.toolId,
    binding.exactOrigin,
    binding.tabId,
    binding.frameId,
    binding.navigationId,
    binding.generation,
  ])
}

export function createPageToolAuthority(binding: PageToolRuntimeBindingV1): PageToolAuthorityV1 {
  return Object.freeze({
    bindingKey: createPageToolBindingKey(binding),
    generation: binding.generation,
  })
}

export function isValidPageToolOperationId(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= PAGE_TOOL_OPERATION_ID_MAX_LENGTH
    && operationIdentifierPattern.test(value)
}
