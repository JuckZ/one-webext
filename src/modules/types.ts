import {
  type ModuleActivationMode,
  type ModuleContextFieldGrants,
  type ModuleContextId,
  type ONEWEB_MODULE_MANIFEST_VERSION,
  type RemoteFrameModuleManifest,
  type RemoteModuleCapabilityId,
  remoteModuleCapabilityIds,
} from '@oneweb/module-sdk'

export {
  moduleActivationModes,
  moduleContextIds,
  ONEWEB_MODULE_MANIFEST_VERSION,
  ONEWEB_MODULE_PROTOCOL,
  ONEWEB_MODULE_PROTOCOL_VERSION,
  remoteModuleCapabilityIds,
} from '@oneweb/module-sdk'
export type {
  ModuleActivationMode,
  ModuleBridgeDescriptor,
  ModuleContextFieldGrants,
  ModuleContextId,
  RemoteFrameModuleManifest,
  RemoteModuleCapabilityId,
} from '@oneweb/module-sdk'

export const moduleRuntimeTypes = ['remote-frame', 'builtin'] as const
export const builtinModuleCapabilityIds = [
  'bookmarks.read',
  'bookmarks.write',
  'clash.status.read',
] as const
export const moduleCapabilityIds = [
  ...remoteModuleCapabilityIds,
  ...builtinModuleCapabilityIds,
] as const

export type ModuleRuntimeType = typeof moduleRuntimeTypes[number]
export type BuiltinModuleCapabilityId = typeof builtinModuleCapabilityIds[number]
export type ModuleCapabilityId = RemoteModuleCapabilityId | BuiltinModuleCapabilityId

interface ModuleManifestBase {
  manifest_version: typeof ONEWEB_MODULE_MANIFEST_VERSION
  runtime: ModuleRuntimeType
  id: string
  name: string
  version: string
  description: string
  matches: string[]
  contexts: ModuleContextId[]
  context_fields: ModuleContextFieldGrants
  capabilities: ModuleCapabilityId[]
  activation: ModuleActivationMode
  min_host_version: string
}

export interface BuiltinModuleManifest extends ModuleManifestBase {
  runtime: 'builtin'
  icon_path: string
  entry_id: string
}

export type OneWebModuleManifest = RemoteFrameModuleManifest | BuiltinModuleManifest

export const moduleUpdateApprovalStatuses = [
  'not-required',
  'pending',
  'approved',
  'rejected',
] as const

export type ModuleUpdateApprovalStatus = typeof moduleUpdateApprovalStatuses[number]

export interface ModuleUpdateCandidate {
  candidateManifest: OneWebModuleManifest
  candidateSourceUrl: string | null
  normalizedManifestDigest: string
  checkedAt: string
}

export interface ModuleUpdateApprovalSelection {
  approvedContextFields: ModuleContextFieldGrants
  approvedCapabilities: ModuleCapabilityId[]
}

export interface ModuleUpdateApprovalSnapshot extends ModuleUpdateApprovalSelection {
  approvedManifestDigest: string
  approvedMatches: string[]
  approvedActivation: ModuleActivationMode
  approvedAt: string
}

export interface ModuleUpdateMetadata extends ModuleUpdateCandidate {
  approvalStatus: ModuleUpdateApprovalStatus
  approvedManifestDigest: string | null
  approvalSnapshot: ModuleUpdateApprovalSnapshot | null
}

export interface InstalledModuleRecord {
  manifest: OneWebModuleManifest
  enabled: boolean
  source: 'seeded' | 'user'
  sourceUrl?: string
  grantedContexts: ModuleContextId[]
  grantedContextFields: ModuleContextFieldGrants
  grantedCapabilities: ModuleCapabilityId[]
  update: ModuleUpdateMetadata | null
  installedAt: string
  updatedAt: string
}

export interface SeededModuleDefinition {
  manifest: OneWebModuleManifest
  enabled?: boolean
  grantedContexts: ModuleContextId[]
  grantedContextFields: ModuleContextFieldGrants
  grantedCapabilities: ModuleCapabilityId[]
}
