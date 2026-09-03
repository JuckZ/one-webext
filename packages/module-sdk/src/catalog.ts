export const ONEWEB_MODULE_MANIFEST_VERSION = 1 as const
export const ONEWEB_MODULE_PROTOCOL = 'oneweb.module' as const
export const ONEWEB_MODULE_PROTOCOL_VERSION = 1 as const
export const REMOTE_FRAME_RUNTIME = 'remote-frame' as const

export const moduleActivationModes = Object.freeze(['manual', 'suggest'] as const)
export const moduleContextIds = Object.freeze([
  'tab.basic',
  'github.repository',
  'page.selection',
  'page.metadata',
] as const)
export const remoteModuleCapabilityIds = Object.freeze([
  'tabs.open',
  'storage.module',
  'clipboard.write',
  'downloads.create',
  'notifications.show',
  'auth.start',
] as const)

export type ModuleActivationMode = typeof moduleActivationModes[number]
export type ModuleContextId = typeof moduleContextIds[number]
export type RemoteModuleCapabilityId = typeof remoteModuleCapabilityIds[number]
export type ModuleContextFieldGrants = Partial<Record<ModuleContextId, string[]>>

export const moduleContextFieldIds = Object.freeze({
  'tab.basic': Object.freeze(['url', 'title', 'faviconUrl', 'navigationId'] as const),
  'github.repository': Object.freeze(['repo', 'url', 'pageType'] as const),
  'page.selection': Object.freeze(['text'] as const),
  'page.metadata': Object.freeze(['language', 'title', 'description', 'imageUrl'] as const),
}) satisfies Readonly<Record<ModuleContextId, readonly string[]>>

export function isModuleContextField(contextId: ModuleContextId, field: string) {
  return (moduleContextFieldIds[contextId] as readonly string[]).includes(field)
}
