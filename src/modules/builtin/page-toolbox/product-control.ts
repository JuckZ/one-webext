import type { PageToolSiteSettingsV1 } from './contracts'
import {
  PAGE_TOOLBOX_SETTINGS_SCHEMA_VERSION,
} from './contracts'
import { PAGE_TOOL_CATALOG } from './tool-catalog'
import {
  normalizePageToolExactOrigin,
  validatePageToolboxSettings,
} from './validation'

export const PAGE_TOOLBOX_CONTROL_SNAPSHOT_VERSION = 1 as const
export const PAGE_TOOLBOX_CONTROL_TITLE_MAX_LENGTH = 160 as const

export type PageToolboxSiteAccess =
  | 'unsupported'
  | 'module-disabled'
  | 'site-unapproved'
  | 'ready'

export interface PageToolboxControlSnapshotV1 {
  readonly schemaVersion: typeof PAGE_TOOLBOX_CONTROL_SNAPSHOT_VERSION
  readonly revision: number
  readonly pageTitle: string
  readonly exactOrigin: string | null
  readonly access: PageToolboxSiteAccess
  readonly siteSettings: PageToolSiteSettingsV1 | null
}

export type PageToolboxControlValidationResult<Value> =
  | { readonly ok: true, readonly value: Value }
  | {
    readonly ok: false
    readonly code: 'invalid-snapshot'
    readonly path: string
  }

const snapshotKeys = new Set(['schemaVersion', 'revision', 'pageTitle', 'exactOrigin', 'access', 'siteSettings'])

function readDataProperty(value: Record<string, unknown>, key: string): unknown {
  return Object.getOwnPropertyDescriptor(value, key)?.value
}

function hasOnlyDataProperties(value: object, expectedKeys: ReadonlySet<string>): value is Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null)
    return false
  const keys = Reflect.ownKeys(value)
  if (keys.length !== expectedKeys.size || keys.some(key => typeof key !== 'string' || !expectedKeys.has(key)))
    return false
  return keys.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    return Boolean(descriptor && 'value' in descriptor && descriptor.enumerable)
  })
}

function invalidSnapshot(path: string): PageToolboxControlValidationResult<never> {
  return { ok: false, code: 'invalid-snapshot', path }
}

function isSiteAccess(value: unknown): value is PageToolboxSiteAccess {
  return value === 'unsupported'
    || value === 'module-disabled'
    || value === 'site-unapproved'
    || value === 'ready'
}

export function isPageToolboxControlRevision(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

export function normalizePageToolboxDisplayText(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 4096)
    return null
  const normalized = Array.from(value, (character) => {
    const codePoint = character.codePointAt(0)!
    return codePoint <= 0x1F || (codePoint >= 0x7F && codePoint <= 0x9F) ? ' ' : character
  }).join('').replace(/\s+/g, ' ').trim()
  const bounded = Array.from(normalized).slice(0, PAGE_TOOLBOX_CONTROL_TITLE_MAX_LENGTH).join('')
  return bounded || '无标题页面'
}

export function validatePageToolboxControlSiteSettings(
  exactOrigin: string,
  input: unknown,
): PageToolboxControlValidationResult<PageToolSiteSettingsV1> {
  const validated = validatePageToolboxSettings({
    schemaVersion: PAGE_TOOLBOX_SETTINGS_SCHEMA_VERSION,
    sites: { [exactOrigin]: input },
  }, PAGE_TOOL_CATALOG)
  if (!validated.ok)
    return invalidSnapshot(`$.siteSettings${validated.path.replace(`$.sites.${exactOrigin}`, '')}`)
  return { ok: true, value: validated.value.sites[exactOrigin]! }
}

export function validatePageToolboxControlSnapshot(
  input: unknown,
): PageToolboxControlValidationResult<PageToolboxControlSnapshotV1> {
  if (!input || typeof input !== 'object' || !hasOnlyDataProperties(input, snapshotKeys))
    return invalidSnapshot('$')
  const record = input as Record<string, unknown>
  const schemaVersion = readDataProperty(record, 'schemaVersion')
  const revision = readDataProperty(record, 'revision')
  const pageTitle = normalizePageToolboxDisplayText(readDataProperty(record, 'pageTitle'))
  const access = readDataProperty(record, 'access')
  const originInput = readDataProperty(record, 'exactOrigin')
  const siteSettingsInput = readDataProperty(record, 'siteSettings')
  if (schemaVersion !== PAGE_TOOLBOX_CONTROL_SNAPSHOT_VERSION)
    return invalidSnapshot('$.schemaVersion')
  if (!isPageToolboxControlRevision(revision))
    return invalidSnapshot('$.revision')
  if (pageTitle === null)
    return invalidSnapshot('$.pageTitle')
  if (!isSiteAccess(access))
    return invalidSnapshot('$.access')

  if (access === 'unsupported') {
    if (originInput !== null)
      return invalidSnapshot('$.exactOrigin')
    if (siteSettingsInput !== null)
      return invalidSnapshot('$.siteSettings')
    return {
      ok: true,
      value: Object.freeze({
        schemaVersion: PAGE_TOOLBOX_CONTROL_SNAPSHOT_VERSION,
        revision,
        pageTitle,
        exactOrigin: null,
        access,
        siteSettings: null,
      }),
    }
  }

  const exactOrigin = normalizePageToolExactOrigin(originInput)
  if (!exactOrigin)
    return invalidSnapshot('$.exactOrigin')
  if (access !== 'ready') {
    if (siteSettingsInput !== null)
      return invalidSnapshot('$.siteSettings')
    return {
      ok: true,
      value: Object.freeze({
        schemaVersion: PAGE_TOOLBOX_CONTROL_SNAPSHOT_VERSION,
        revision,
        pageTitle,
        exactOrigin,
        access,
        siteSettings: null,
      }),
    }
  }

  const siteSettings = validatePageToolboxControlSiteSettings(exactOrigin, siteSettingsInput)
  if (!siteSettings.ok)
    return siteSettings
  return {
    ok: true,
    value: Object.freeze({
      schemaVersion: PAGE_TOOLBOX_CONTROL_SNAPSHOT_VERSION,
      revision,
      pageTitle,
      exactOrigin,
      access,
      siteSettings: siteSettings.value,
    }),
  }
}
