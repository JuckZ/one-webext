import type { ModuleLocalStateStorageArea } from '../../module-state'
import type {
  PageToolboxSettingsV1,
  PageToolCatalogV1,
  PageToolSiteSettingsV1,
} from './contracts'
import { ModuleLocalStateStore } from '../../module-state'
import { PAGE_TOOLBOX_MODULE_ID, PAGE_TOOLBOX_SETTINGS_SCHEMA_VERSION } from './contracts'
import {
  isPageToolboxControlRevision,
  validatePageToolboxControlSiteSettings,
} from './product-control'
import { PAGE_TOOL_CATALOG } from './tool-catalog'
import {
  createDefaultPageToolboxSettings,
  normalizePageToolExactOrigin,
  validatePageToolboxSettings,
  validatePageToolSettingsValue,
} from './validation'

export interface PageToolboxStateStore {
  read: () => Promise<unknown>
  write: (_state: PageToolboxStateDocumentV2) => Promise<void>
}

export const PAGE_TOOLBOX_STATE_DOCUMENT_SCHEMA_VERSION = 2 as const

export interface PageToolboxStateDocumentV2 {
  readonly schemaVersion: typeof PAGE_TOOLBOX_STATE_DOCUMENT_SCHEMA_VERSION
  readonly settings: PageToolboxSettingsV1
  readonly siteRevisions: Readonly<Record<string, number>>
}

export type PageToolboxStateMutationResult =
  | {
    readonly ok: true
    readonly changed: boolean
    readonly revision: number
    readonly state: PageToolboxStateDocumentV2
  }
  | {
    readonly ok: false
    readonly reason: 'invalid-state' | 'revision-conflict' | 'revision-exhausted'
    readonly revision: number | null
  }

export function createPageToolboxStateStore(storage: ModuleLocalStateStorageArea): PageToolboxStateStore {
  const store = new ModuleLocalStateStore<unknown>(storage, PAGE_TOOLBOX_MODULE_ID)
  return {
    read: () => store.read(),
    write: state => store.write(state),
  }
}

function cloneSites(settings: PageToolboxSettingsV1) {
  return Object.fromEntries(Object.entries(settings.sites).map(([origin, site]) => [
    origin,
    {
      enabledToolIds: [...site.enabledToolIds],
      toolSettings: structuredClone(site.toolSettings),
    },
  ])) as Record<string, PageToolSiteSettingsV1>
}

export function normalizeStoredPageToolboxSettings(
  value: unknown,
  catalog: PageToolCatalogV1,
): PageToolboxSettingsV1 | null {
  return normalizeStoredPageToolboxState(value, catalog)?.settings ?? null
}

function exactDataRecord(value: unknown, expectedKeys?: ReadonlySet<string>): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return null
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null)
    return null
  const keys = Reflect.ownKeys(value)
  if (keys.some(key => typeof key !== 'string'))
    return null
  if (expectedKeys && (keys.length !== expectedKeys.size || keys.some(key => !expectedKeys.has(key as string))))
    return null
  const output: Record<string, unknown> = {}
  for (const key of keys as string[]) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor))
      return null
    output[key] = descriptor.value
  }
  return output
}

function createStateDocument(
  settingsInput: unknown,
  revisionsInput: unknown,
  catalog: PageToolCatalogV1,
): PageToolboxStateDocumentV2 | null {
  const settings = validatePageToolboxSettings(settingsInput, catalog)
  const revisions = exactDataRecord(revisionsInput)
  if (!settings.ok || !revisions)
    return null
  const siteKeys = Object.keys(settings.value.sites).sort()
  if (siteKeys.length !== Object.keys(revisions).length
    || siteKeys.some(origin => !Object.hasOwn(revisions, origin))) {
    return null
  }
  const siteRevisions = Object.create(null) as Record<string, number>
  for (const origin of siteKeys) {
    const revision = revisions[origin]
    if (!isPageToolboxControlRevision(revision))
      return null
    Object.defineProperty(siteRevisions, origin, {
      configurable: false,
      enumerable: true,
      value: revision,
      writable: false,
    })
  }
  return Object.freeze({
    schemaVersion: PAGE_TOOLBOX_STATE_DOCUMENT_SCHEMA_VERSION,
    settings: settings.value,
    siteRevisions: Object.freeze(siteRevisions),
  })
}

export function createDefaultPageToolboxState(): PageToolboxStateDocumentV2 {
  return createStateDocument(createDefaultPageToolboxSettings(), {}, PAGE_TOOL_CATALOG)!
}

export function normalizeStoredPageToolboxState(
  value: unknown,
  catalog: PageToolCatalogV1,
): PageToolboxStateDocumentV2 | null {
  if (value === null || value === undefined)
    return createStateDocument(createDefaultPageToolboxSettings(), {}, catalog)
  const legacy = validatePageToolboxSettings(value, catalog)
  if (legacy.ok) {
    return createStateDocument(
      legacy.value,
      Object.fromEntries(Object.keys(legacy.value.sites).map(origin => [origin, 0])),
      catalog,
    )
  }
  const record = exactDataRecord(value, new Set(['schemaVersion', 'settings', 'siteRevisions']))
  if (!record || record.schemaVersion !== PAGE_TOOLBOX_STATE_DOCUMENT_SCHEMA_VERSION)
    return null
  return createStateDocument(record.settings, record.siteRevisions, catalog)
}

function revisionsWith(
  state: PageToolboxStateDocumentV2,
  origin: string,
  revision: number | null,
) {
  const revisions = { ...state.siteRevisions }
  if (revision === null)
    delete revisions[origin]
  else
    revisions[origin] = revision
  return revisions
}

export function addPageToolboxStateSite(
  state: PageToolboxStateDocumentV2,
  exactOrigin: unknown,
  catalog: PageToolCatalogV1,
): PageToolboxStateDocumentV2 | null {
  const nextSettings = addPageToolboxSite(state.settings, exactOrigin, catalog)
  const origin = normalizePageToolExactOrigin(exactOrigin)
  if (!nextSettings || !origin)
    return null
  return createStateDocument(
    nextSettings,
    revisionsWith(state, origin, state.siteRevisions[origin] ?? 0),
    catalog,
  )
}

export function removePageToolboxStateSite(
  state: PageToolboxStateDocumentV2,
  exactOrigin: unknown,
  catalog: PageToolCatalogV1,
): PageToolboxStateDocumentV2 | null {
  const nextSettings = removePageToolboxSite(state.settings, exactOrigin, catalog)
  const origin = normalizePageToolExactOrigin(exactOrigin)
  if (!nextSettings || !origin)
    return null
  return createStateDocument(nextSettings, revisionsWith(state, origin, null), catalog)
}

function nextRevision(revision: number) {
  return revision < Number.MAX_SAFE_INTEGER ? revision + 1 : null
}

export function setPageToolboxStateSiteTool(
  state: PageToolboxStateDocumentV2,
  exactOrigin: unknown,
  toolId: unknown,
  enabled: boolean,
  toolSettings: unknown,
  catalog: PageToolCatalogV1,
): PageToolboxStateMutationResult {
  const origin = normalizePageToolExactOrigin(exactOrigin)
  if (!origin || !Object.hasOwn(state.siteRevisions, origin))
    return { ok: false, reason: 'invalid-state', revision: null }
  const settings = setPageToolboxSiteTool(state.settings, origin, toolId, enabled, toolSettings, catalog)
  if (!settings)
    return { ok: false, reason: 'invalid-state', revision: state.siteRevisions[origin]! }
  const changed = JSON.stringify(settings) !== JSON.stringify(state.settings)
  if (!changed) {
    return {
      ok: true,
      changed: false,
      revision: state.siteRevisions[origin]!,
      state,
    }
  }
  const revision = nextRevision(state.siteRevisions[origin]!)
  if (revision === null)
    return { ok: false, reason: 'revision-exhausted', revision: state.siteRevisions[origin]! }
  const next = createStateDocument(settings, revisionsWith(state, origin, revision), catalog)
  return next
    ? { ok: true, changed: true, revision, state: next }
    : { ok: false, reason: 'invalid-state', revision: state.siteRevisions[origin]! }
}

export function replacePageToolboxStateSite(
  state: PageToolboxStateDocumentV2,
  exactOrigin: unknown,
  expectedRevision: unknown,
  siteSettingsInput: unknown,
  catalog: PageToolCatalogV1,
): PageToolboxStateMutationResult {
  const origin = normalizePageToolExactOrigin(exactOrigin)
  if (!origin || !Object.hasOwn(state.siteRevisions, origin))
    return { ok: false, reason: 'invalid-state', revision: null }
  const currentRevision = state.siteRevisions[origin]!
  if (!isPageToolboxControlRevision(expectedRevision) || expectedRevision !== currentRevision)
    return { ok: false, reason: 'revision-conflict', revision: currentRevision }
  const siteSettings = validatePageToolboxControlSiteSettings(origin, siteSettingsInput)
  if (!siteSettings.ok)
    return { ok: false, reason: 'invalid-state', revision: currentRevision }
  const revision = nextRevision(currentRevision)
  if (revision === null)
    return { ok: false, reason: 'revision-exhausted', revision: currentRevision }
  const settings = validatePageToolboxSettings({
    schemaVersion: PAGE_TOOLBOX_SETTINGS_SCHEMA_VERSION,
    sites: {
      ...state.settings.sites,
      [origin]: siteSettings.value,
    },
  }, catalog)
  if (!settings.ok)
    return { ok: false, reason: 'invalid-state', revision: currentRevision }
  const next = createStateDocument(settings.value, revisionsWith(state, origin, revision), catalog)
  if (!next)
    return { ok: false, reason: 'invalid-state', revision: currentRevision }
  return {
    ok: true,
    changed: JSON.stringify(state.settings.sites[origin]) !== JSON.stringify(siteSettings.value),
    revision,
    state: next,
  }
}

export function addPageToolboxSite(
  settings: PageToolboxSettingsV1,
  exactOrigin: unknown,
  catalog: PageToolCatalogV1,
): PageToolboxSettingsV1 | null {
  const origin = normalizePageToolExactOrigin(exactOrigin)
  if (!origin)
    return null
  const sites = cloneSites(settings)
  sites[origin] ||= { enabledToolIds: [], toolSettings: {} }
  const validated = validatePageToolboxSettings({
    schemaVersion: PAGE_TOOLBOX_SETTINGS_SCHEMA_VERSION,
    sites,
  }, catalog)
  return validated.ok ? validated.value : null
}

export function removePageToolboxSite(
  settings: PageToolboxSettingsV1,
  exactOrigin: unknown,
  catalog: PageToolCatalogV1,
): PageToolboxSettingsV1 | null {
  const origin = normalizePageToolExactOrigin(exactOrigin)
  if (!origin)
    return null
  const sites = cloneSites(settings)
  delete sites[origin]
  const validated = validatePageToolboxSettings({
    schemaVersion: PAGE_TOOLBOX_SETTINGS_SCHEMA_VERSION,
    sites,
  }, catalog)
  return validated.ok ? validated.value : null
}

export function setPageToolboxSiteTool(
  settings: PageToolboxSettingsV1,
  exactOrigin: unknown,
  toolId: unknown,
  enabled: boolean,
  toolSettings: unknown,
  catalog: PageToolCatalogV1,
): PageToolboxSettingsV1 | null {
  const origin = normalizePageToolExactOrigin(exactOrigin)
  if (!origin || typeof toolId !== 'string' || !catalog[toolId] || !settings.sites[origin])
    return null
  const sites = cloneSites(settings)
  const site = sites[origin]
  const enabledToolIds = new Set(site.enabledToolIds)
  const nextToolSettings = structuredClone(site.toolSettings) as Record<string, import('./contracts').PageToolJsonValue>
  if (enabled) {
    const validated = validatePageToolSettingsValue(toolId, toolSettings, catalog)
    if (!validated.ok)
      return null
    enabledToolIds.add(toolId)
    nextToolSettings[toolId] = validated.value
  }
  else {
    enabledToolIds.delete(toolId)
  }
  sites[origin] = {
    enabledToolIds: [...enabledToolIds],
    toolSettings: nextToolSettings,
  }
  const validated = validatePageToolboxSettings({
    schemaVersion: PAGE_TOOLBOX_SETTINGS_SCHEMA_VERSION,
    sites,
  }, catalog)
  return validated.ok ? validated.value : null
}
