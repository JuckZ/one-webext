import type {
  ModuleInstallErrorCode,
  ModuleInstallReview,
  ModuleUpdateApplyErrorCode,
  ModuleUpdateCheckErrorCode,
} from './installer'
import type { ModuleUpdateApprovalErrorCode } from './registry'
import type { InstalledModuleRecord } from './types'
import { moduleCapabilityIds, moduleContextIds } from './types'

export const ONEWEB_MODULE_MANAGEMENT_CHANNEL = 'oneweb.module-management' as const
export const ONEWEB_MODULE_MANAGEMENT_VERSION = 1 as const

export interface ModuleListRequest {
  channel: typeof ONEWEB_MODULE_MANAGEMENT_CHANNEL
  version: typeof ONEWEB_MODULE_MANAGEMENT_VERSION
  type: 'MODULE_LIST'
}

export interface ModuleSetEnabledRequest {
  channel: typeof ONEWEB_MODULE_MANAGEMENT_CHANNEL
  version: typeof ONEWEB_MODULE_MANAGEMENT_VERSION
  type: 'MODULE_SET_ENABLED'
  moduleId: string
  enabled: boolean
}

export interface ModuleRemoveRequest {
  channel: typeof ONEWEB_MODULE_MANAGEMENT_CHANNEL
  version: typeof ONEWEB_MODULE_MANAGEMENT_VERSION
  type: 'MODULE_REMOVE'
  moduleId: string
}

export interface ModuleInstallPrepareRequest {
  channel: typeof ONEWEB_MODULE_MANAGEMENT_CHANNEL
  version: typeof ONEWEB_MODULE_MANAGEMENT_VERSION
  type: 'MODULE_INSTALL_PREPARE'
  manifestUrl: string
}

export interface ModuleInstallConfirmRequest {
  channel: typeof ONEWEB_MODULE_MANAGEMENT_CHANNEL
  version: typeof ONEWEB_MODULE_MANAGEMENT_VERSION
  type: 'MODULE_INSTALL_CONFIRM'
  manifestUrl: string
  expectedDigest: string
  grantedContextFields: Partial<Record<typeof moduleContextIds[number], string[]>>
  grantedCapabilities: Array<typeof moduleCapabilityIds[number]>
}

export interface ModuleInstallCancelRequest {
  channel: typeof ONEWEB_MODULE_MANAGEMENT_CHANNEL
  version: typeof ONEWEB_MODULE_MANAGEMENT_VERSION
  type: 'MODULE_INSTALL_CANCEL'
  manifestUrl: string
}

export interface ModuleUpdateCheckRequest {
  channel: typeof ONEWEB_MODULE_MANAGEMENT_CHANNEL
  version: typeof ONEWEB_MODULE_MANAGEMENT_VERSION
  type: 'MODULE_UPDATE_CHECK'
  moduleId: string
}

export interface ModuleUpdateApproveRequest {
  channel: typeof ONEWEB_MODULE_MANAGEMENT_CHANNEL
  version: typeof ONEWEB_MODULE_MANAGEMENT_VERSION
  type: 'MODULE_UPDATE_APPROVE'
  moduleId: string
  expectedDigest: string
  approvedContextFields: Partial<Record<typeof moduleContextIds[number], string[]>>
  approvedCapabilities: Array<typeof moduleCapabilityIds[number]>
}

export interface ModuleUpdateApplyRequest {
  channel: typeof ONEWEB_MODULE_MANAGEMENT_CHANNEL
  version: typeof ONEWEB_MODULE_MANAGEMENT_VERSION
  type: 'MODULE_UPDATE_APPLY'
  moduleId: string
}

export type ModuleManagementRequest =
  | ModuleListRequest
  | ModuleSetEnabledRequest
  | ModuleRemoveRequest
  | ModuleInstallPrepareRequest
  | ModuleInstallConfirmRequest
  | ModuleInstallCancelRequest
  | ModuleUpdateCheckRequest
  | ModuleUpdateApproveRequest
  | ModuleUpdateApplyRequest
export type ModuleManagementRequestType = ModuleManagementRequest['type']

export type ModuleManagementResult =
  | {
    ok: true
    operation: 'list'
    modules: InstalledModuleRecord[]
  }
  | {
    ok: true
    operation: 'set-enabled'
    changed: boolean
    record: InstalledModuleRecord
  }
  | {
    ok: false
    operation: 'set-enabled'
    changed: false
    reason: 'not-found'
  }
  | {
    ok: true
    operation: 'remove'
    changed: true
    removed: InstalledModuleRecord
  }
  | {
    ok: false
    operation: 'remove'
    changed: false
    reason: 'not-found' | 'protected-seed'
  }
  | {
    ok: true
    operation: 'install-prepare'
    review: ModuleInstallReview
  }
  | {
    ok: false
    operation: 'install-prepare'
    reason: ModuleInstallErrorCode
  }
  | {
    ok: true
    operation: 'install-confirm'
    record: InstalledModuleRecord
  }
  | {
    ok: false
    operation: 'install-confirm'
    reason: ModuleInstallErrorCode
  }
  | {
    ok: true
    operation: 'install-cancel'
    releasedOrigin: boolean
  }
  | {
    ok: true
    operation: 'update-check'
    record: InstalledModuleRecord
  }
  | {
    ok: false
    operation: 'update-check'
    reason: ModuleUpdateCheckErrorCode
  }
  | {
    ok: true
    operation: 'update-approve'
    changed: true
    record: InstalledModuleRecord
  }
  | {
    ok: false
    operation: 'update-approve'
    changed: false
    reason: ModuleUpdateApprovalErrorCode
  }
  | {
    ok: true
    operation: 'update-apply'
    record: InstalledModuleRecord
  }
  | {
    ok: false
    operation: 'update-apply'
    reason: ModuleUpdateApplyErrorCode
  }

export interface ModuleManagementResponse {
  channel: typeof ONEWEB_MODULE_MANAGEMENT_CHANNEL
  version: typeof ONEWEB_MODULE_MANAGEMENT_VERSION
  type: 'MODULE_MANAGEMENT_RESPONSE'
  requestType: ModuleManagementRequestType
  result: ModuleManagementResult
}

export interface ModuleManagementSender {
  tab?: unknown
  id?: string
  url?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function isModuleId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 128
}

const contextIdSet = new Set<string>(moduleContextIds)
const capabilityIdSet = new Set<string>(moduleCapabilityIds)
const installErrorSet = new Set<string>([
  'invalid-manifest-url',
  'installation-unavailable',
  'missing-origin-permission',
  'fetch-failed',
  'manifest-too-large',
  'manifest-invalid',
  'manifest-origin-mismatch',
  'host-incompatible',
  'already-installed',
  'manifest-changed',
] satisfies ModuleInstallErrorCode[])
const updateCheckErrorSet = new Set<string>([
  ...installErrorSet,
  'update-check-unavailable',
  'not-found',
  'not-updateable',
  'installed-record-changed',
])
const updateApprovalErrorSet = new Set<string>([
  'not-found',
  'no-update-candidate',
  'update-candidate-changed',
  'update-approval-not-required',
  'update-rejected',
  'invalid-update-approval',
] satisfies ModuleUpdateApprovalErrorCode[])
const updateApplyErrorSet = new Set<string>([
  ...installErrorSet,
  'update-apply-unavailable',
  'not-updateable',
  'not-found',
  'installed-record-changed',
  'no-update-candidate',
  'update-candidate-changed',
  'update-approval-required',
  'update-rejected',
  'invalid-candidate',
])

function isManifestUrl(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 2048
}

function isContextFieldGrants(value: unknown) {
  return isRecord(value) && Object.entries(value).every(([contextId, fields]) => (
    contextIdSet.has(contextId)
    && Array.isArray(fields)
    && fields.every(field => typeof field === 'string' && field.length > 0 && field.length <= 64)
  ))
}

function isCapabilityGrants(value: unknown) {
  return Array.isArray(value)
    && value.every(capability => typeof capability === 'string' && capabilityIdSet.has(capability))
}

function isInstallError(value: unknown): value is ModuleInstallErrorCode {
  return typeof value === 'string' && installErrorSet.has(value)
}

function isUpdateCheckError(value: unknown): value is ModuleUpdateCheckErrorCode {
  return typeof value === 'string' && updateCheckErrorSet.has(value)
}

function isUpdateApprovalError(value: unknown): value is ModuleUpdateApprovalErrorCode {
  return typeof value === 'string' && updateApprovalErrorSet.has(value)
}

function isUpdateApplyError(value: unknown): value is ModuleUpdateApplyErrorCode {
  return typeof value === 'string' && updateApplyErrorSet.has(value)
}

function isInstallReview(value: unknown): value is ModuleInstallReview {
  return isRecord(value)
    && isRecord(value.manifest)
    && isManifestUrl(value.manifestUrl)
    && typeof value.manifestDigest === 'string'
    && /^[a-f0-9]{64}$/.test(value.manifestDigest)
    && typeof value.originPattern === 'string'
}

export function isModuleManagementRequest(value: unknown): value is ModuleManagementRequest {
  if (!isRecord(value)
    || value.channel !== ONEWEB_MODULE_MANAGEMENT_CHANNEL
    || value.version !== ONEWEB_MODULE_MANAGEMENT_VERSION) {
    return false
  }

  if (value.type === 'MODULE_LIST')
    return true
  if (value.type === 'MODULE_SET_ENABLED')
    return isModuleId(value.moduleId) && typeof value.enabled === 'boolean'
  if (value.type === 'MODULE_REMOVE')
    return isModuleId(value.moduleId)
  if (value.type === 'MODULE_UPDATE_CHECK')
    return isModuleId(value.moduleId)
  if (value.type === 'MODULE_UPDATE_APPLY')
    return isModuleId(value.moduleId)
  if (value.type === 'MODULE_UPDATE_APPROVE') {
    return isModuleId(value.moduleId)
      && typeof value.expectedDigest === 'string'
      && /^[a-f0-9]{64}$/.test(value.expectedDigest)
      && isContextFieldGrants(value.approvedContextFields)
      && isCapabilityGrants(value.approvedCapabilities)
  }
  if (value.type === 'MODULE_INSTALL_PREPARE' || value.type === 'MODULE_INSTALL_CANCEL')
    return isManifestUrl(value.manifestUrl)
  if (value.type === 'MODULE_INSTALL_CONFIRM') {
    return isManifestUrl(value.manifestUrl)
      && typeof value.expectedDigest === 'string'
      && /^[a-f0-9]{64}$/.test(value.expectedDigest)
      && isContextFieldGrants(value.grantedContextFields)
      && isCapabilityGrants(value.grantedCapabilities)
  }
  return false
}

export function isModuleManagementResponse(value: unknown): value is ModuleManagementResponse {
  if (!isRecord(value)
    || value.channel !== ONEWEB_MODULE_MANAGEMENT_CHANNEL
    || value.version !== ONEWEB_MODULE_MANAGEMENT_VERSION
    || value.type !== 'MODULE_MANAGEMENT_RESPONSE'
    || !isRecord(value.result)) {
    return false
  }

  const result = value.result
  if (value.requestType === 'MODULE_LIST') {
    return result.ok === true
      && result.operation === 'list'
      && Array.isArray(result.modules)
  }
  if (value.requestType === 'MODULE_SET_ENABLED') {
    if (result.operation !== 'set-enabled' || typeof result.changed !== 'boolean')
      return false
    return result.ok === true
      ? isRecord(result.record)
      : result.ok === false && result.changed === false && result.reason === 'not-found'
  }
  if (value.requestType === 'MODULE_REMOVE') {
    if (result.operation !== 'remove' || typeof result.changed !== 'boolean')
      return false
    return result.ok === true
      ? result.changed === true && isRecord(result.removed)
      : result.ok === false
        && result.changed === false
        && (result.reason === 'not-found' || result.reason === 'protected-seed')
  }
  if (value.requestType === 'MODULE_INSTALL_PREPARE') {
    if (result.operation !== 'install-prepare')
      return false
    return result.ok === true
      ? isInstallReview(result.review)
      : result.ok === false && isInstallError(result.reason)
  }
  if (value.requestType === 'MODULE_INSTALL_CONFIRM') {
    if (result.operation !== 'install-confirm')
      return false
    return result.ok === true
      ? isRecord(result.record)
      : result.ok === false && isInstallError(result.reason)
  }
  if (value.requestType === 'MODULE_INSTALL_CANCEL') {
    return result.ok === true
      && result.operation === 'install-cancel'
      && typeof result.releasedOrigin === 'boolean'
  }
  if (value.requestType === 'MODULE_UPDATE_CHECK') {
    if (result.operation !== 'update-check')
      return false
    return result.ok === true
      ? isRecord(result.record)
      : result.ok === false && isUpdateCheckError(result.reason)
  }
  if (value.requestType === 'MODULE_UPDATE_APPROVE') {
    if (result.operation !== 'update-approve' || typeof result.changed !== 'boolean')
      return false
    return result.ok === true
      ? result.changed === true && isRecord(result.record)
      : result.ok === false && result.changed === false && isUpdateApprovalError(result.reason)
  }
  if (value.requestType === 'MODULE_UPDATE_APPLY') {
    if (result.operation !== 'update-apply')
      return false
    return result.ok === true
      ? isRecord(result.record)
      : result.ok === false && isUpdateApplyError(result.reason)
  }
  return false
}

export function isTrustedModuleManagementSender(
  sender: ModuleManagementSender,
  extensionId: string,
  extensionBaseUrl: string,
) {
  if (sender.id !== extensionId || !sender.url)
    return false
  try {
    const candidate = new URL(sender.url)
    const expected = new URL(extensionBaseUrl)
    return candidate.protocol === expected.protocol && candidate.host === expected.host
  }
  catch {
    return false
  }
}

export function createModuleManagementResponse(
  requestType: ModuleManagementRequestType,
  result: ModuleManagementResult,
): ModuleManagementResponse {
  return {
    channel: ONEWEB_MODULE_MANAGEMENT_CHANNEL,
    version: ONEWEB_MODULE_MANAGEMENT_VERSION,
    type: 'MODULE_MANAGEMENT_RESPONSE',
    requestType,
    result,
  }
}
