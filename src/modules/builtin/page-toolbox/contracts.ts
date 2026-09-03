export const PAGE_TOOLBOX_MODULE_ID = 'dev.oneweb.page-toolbox' as const
export const PAGE_TOOLBOX_ENTRY_ID = 'page-toolbox' as const
export const PAGE_TOOLBOX_LIFECYCLE_CHANNEL = 'oneweb.page-toolbox.lifecycle' as const
export const PAGE_TOOLBOX_LIFECYCLE_PROTOCOL_VERSION = 3 as const
export const PAGE_TOOLBOX_PORT_NAME = 'oneweb.page-toolbox.lifecycle.v3' as const
export const PAGE_TOOLBOX_PREPARATION_TTL_MS = 2 * 60 * 1000
export const PAGE_TOOLBOX_NONCE_BYTES = 24 as const
export const PAGE_TOOL_DESCRIPTOR_SCHEMA_VERSION = 1 as const
export const PAGE_TOOL_SETTINGS_SCHEMA_VERSION = 1 as const
export const PAGE_TOOLBOX_SETTINGS_SCHEMA_VERSION = 1 as const
export const PAGE_TOOL_RUNTIME_BINDING_SCHEMA_VERSION = 1 as const

export const PAGE_TOOLBOX_MAX_SITES = 64 as const
export const PAGE_TOOLBOX_MAX_TOOLS_PER_SITE = 16 as const
export const PAGE_TOOLBOX_MAX_TOOL_SETTINGS_BYTES = 2 * 1024
export const PAGE_TOOLBOX_MAX_SITE_SETTINGS_BYTES = 8 * 1024
export const PAGE_TOOLBOX_MAX_SETTINGS_BYTES = 64 * 1024
export const PAGE_TOOLBOX_MAX_SETTINGS_DEPTH = 8 as const
export const PAGE_TOOLBOX_MAX_SETTINGS_NODES = 1024 as const

export const PAGE_TOOL_ID_MAX_LENGTH = 64 as const
export const PAGE_TOOL_SCHEMA_ID_MAX_LENGTH = 96 as const
export const PAGE_TOOL_TITLE_MAX_LENGTH = 80 as const
export const PAGE_TOOL_DESCRIPTION_MAX_LENGTH = 240 as const
export const PAGE_TOOL_NAVIGATION_ID_MAX_LENGTH = 160 as const
export const PAGE_TOOL_OPERATION_ID_MAX_LENGTH = 160 as const

export const PAGE_TOOL_DOM_ACCESS = [
  'read',
  'attributes',
  'styles',
  'listeners',
  'observers',
  'owned-nodes',
] as const

export type PageToolDomAccess = typeof PAGE_TOOL_DOM_ACCESS[number]
export type PageToolRunAt = 'document-start' | 'document-idle'

export type PageToolJsonPrimitive = null | boolean | number | string
export type PageToolJsonValue =
  | PageToolJsonPrimitive
  | readonly PageToolJsonValue[]
  | { readonly [key: string]: PageToolJsonValue }

export interface PageToolDescriptorV1 {
  readonly schemaVersion: typeof PAGE_TOOL_DESCRIPTOR_SCHEMA_VERSION
  readonly id: string
  readonly title: string
  readonly description: string
  readonly siteScope: 'user-approved-exact-http-origin'
  readonly requiredSiteGrant: 'exact-origin'
  readonly runAt: PageToolRunAt
  readonly frames: 'top'
  readonly defaultEnabled: false
  readonly domAccess: readonly PageToolDomAccess[]
  readonly requiresMainWorld: false
  readonly settingsSchemaId: string
  readonly settingsSchemaVersion: typeof PAGE_TOOL_SETTINGS_SCHEMA_VERSION
}

export interface PageToolSettingsSchemaDefinitionV1 {
  readonly toolId: string
  readonly schemaId: string
  readonly schemaVersion: typeof PAGE_TOOL_SETTINGS_SCHEMA_VERSION
  readonly validate: (_value: PageToolJsonValue) => boolean
}

export interface PageToolCatalogEntryV1 {
  readonly descriptor: PageToolDescriptorV1
  readonly settingsSchema: PageToolSettingsSchemaDefinitionV1
}

export type PageToolCatalogV1 = Readonly<Record<string, PageToolCatalogEntryV1>>

export interface PageToolSiteSettingsV1 {
  readonly enabledToolIds: readonly string[]
  readonly toolSettings: Readonly<Record<string, PageToolJsonValue>>
}

export interface PageToolboxSettingsV1 {
  readonly schemaVersion: typeof PAGE_TOOLBOX_SETTINGS_SCHEMA_VERSION
  readonly sites: Readonly<Record<string, PageToolSiteSettingsV1>>
}

export interface PageToolRuntimeBindingV1 {
  readonly schemaVersion: typeof PAGE_TOOL_RUNTIME_BINDING_SCHEMA_VERSION
  readonly moduleId: typeof PAGE_TOOLBOX_MODULE_ID
  readonly toolId: string
  readonly exactOrigin: string
  readonly tabId: number
  readonly frameId: 0
  readonly navigationId: string
  readonly generation: number
}

export interface PageToolboxRuntimeBindingV1 {
  readonly moduleId: typeof PAGE_TOOLBOX_MODULE_ID
  readonly exactOrigin: string
  readonly tabId: number
  readonly frameId: 0
  readonly navigationId: string
  readonly generation: number
}

export interface PageToolPlanV1 {
  readonly toolId: string
  readonly settings: PageToolJsonValue
}

export interface PageToolboxSitePreparationV1 {
  readonly token: string
  readonly exactOrigin: string
  readonly originPattern: string
  readonly expiresAt: string
}

export type PageToolboxDisposeReason =
  | 'disabled'
  | 'origin-revoked'
  | 'navigation'
  | 'tab-removed'
  | 'port-loss'
  | 'worker-restart'
  | 'extension-update'
  | 'tool-update'

export interface PageToolAuthorityV1 {
  readonly bindingKey: string
  readonly generation: number
}

export type PageToolValidationErrorCode =
  | 'invalid-json-value'
  | 'settings-depth-limit'
  | 'settings-node-limit'
  | 'invalid-descriptor'
  | 'unknown-settings-schema'
  | 'duplicate-tool'
  | 'invalid-settings'
  | 'settings-schema-rejected'
  | 'site-limit'
  | 'tool-limit'
  | 'tool-settings-bytes-limit'
  | 'site-settings-bytes-limit'
  | 'total-settings-bytes-limit'
  | 'invalid-binding'

export type PageToolValidationResult<Value> =
  | { readonly ok: true, readonly value: Value }
  | {
    readonly ok: false
    readonly code: PageToolValidationErrorCode
    readonly path: string
  }
