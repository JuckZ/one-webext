import type {
  PageToolCatalogV1,
  PageToolDescriptorV1,
  PageToolJsonValue,
  PageToolRuntimeBindingV1,
  PageToolSettingsSchemaDefinitionV1,
  PageToolValidationResult,
} from '../contracts'
import {
  PAGE_TOOL_DESCRIPTOR_SCHEMA_VERSION,
  PAGE_TOOL_RUNTIME_BINDING_SCHEMA_VERSION,
  PAGE_TOOL_SETTINGS_SCHEMA_VERSION,
  PAGE_TOOLBOX_MODULE_ID,
} from '../contracts'
import { createPageToolCatalog, validatePageToolRuntimeBinding } from '../validation'

export function unwrap<Value>(result: PageToolValidationResult<Value>): Value {
  if (!result.ok)
    throw new Error(`${result.code}:${result.path}`)
  return result.value
}

export function createRawPageToolDescriptor(
  id: string,
  overrides: Partial<PageToolDescriptorV1> = {},
): PageToolDescriptorV1 {
  return {
    schemaVersion: PAGE_TOOL_DESCRIPTOR_SCHEMA_VERSION,
    id,
    title: `Tool ${id}`,
    description: `Safe packaged tool ${id}`,
    siteScope: 'user-approved-exact-http-origin',
    requiredSiteGrant: 'exact-origin',
    runAt: 'document-idle',
    frames: 'top',
    defaultEnabled: false,
    domAccess: ['read', 'attributes', 'listeners'],
    requiresMainWorld: false,
    settingsSchemaId: `settings.${id}`,
    settingsSchemaVersion: PAGE_TOOL_SETTINGS_SCHEMA_VERSION,
    ...overrides,
  }
}

function acceptsFixtureSettings(value: PageToolJsonValue): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return false
  const record = value as Readonly<Record<string, PageToolJsonValue>>
  return typeof record.mode === 'string'
}

export function createPageToolFixtureCatalog(count = 2): PageToolCatalogV1 {
  const descriptors: PageToolDescriptorV1[] = []
  const schemas: PageToolSettingsSchemaDefinitionV1[] = []
  for (let index = 0; index < count; index += 1) {
    const id = `tool-${index}`
    const descriptor = createRawPageToolDescriptor(id)
    descriptors.push(descriptor)
    schemas.push({
      toolId: id,
      schemaId: descriptor.settingsSchemaId,
      schemaVersion: PAGE_TOOL_SETTINGS_SCHEMA_VERSION,
      validate: acceptsFixtureSettings,
    })
  }
  return unwrap(createPageToolCatalog(descriptors, schemas))
}

export function createPageToolFixtureBinding(
  catalog: PageToolCatalogV1,
  overrides: Partial<PageToolRuntimeBindingV1> = {},
): PageToolRuntimeBindingV1 {
  return unwrap(validatePageToolRuntimeBinding({
    schemaVersion: PAGE_TOOL_RUNTIME_BINDING_SCHEMA_VERSION,
    moduleId: PAGE_TOOLBOX_MODULE_ID,
    toolId: 'tool-0',
    exactOrigin: 'https://example.test',
    tabId: 7,
    frameId: 0,
    navigationId: 'navigation-1',
    generation: 1,
    ...overrides,
  }, catalog))
}
