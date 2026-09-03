import type {
  PageToolboxDisposeReason,
  PageToolboxRuntimeBindingV1,
  PageToolboxSitePreparationV1,
  PageToolJsonValue,
  PageToolPlanV1,
  PageToolSiteSettingsV1,
} from './contracts'
import type { PageToolboxControlSnapshotV1 } from './product-control'
import type { PageToolboxShadowActionErrorCode } from './shadow-control-model'
import type { PageToolId } from './tool-catalog'
import {
  PAGE_TOOL_NAVIGATION_ID_MAX_LENGTH,
  PAGE_TOOLBOX_LIFECYCLE_CHANNEL,
  PAGE_TOOLBOX_LIFECYCLE_PROTOCOL_VERSION,
  PAGE_TOOLBOX_MODULE_ID,
} from './contracts'
import {
  isPageToolboxControlRevision,
  validatePageToolboxControlSiteSettings,
  validatePageToolboxControlSnapshot,
} from './product-control'
import { isPageToolId, PAGE_TOOL_CATALOG } from './tool-catalog'
import {
  isValidPageToolOperationId,
  normalizePageToolExactOrigin,
  validatePageToolPlans,
  validatePageToolSettingsValue,
} from './validation'

export const PAGE_TOOLBOX_MANAGEMENT_CHANNEL = 'oneweb.page-toolbox.management' as const
export const PAGE_TOOLBOX_MANAGEMENT_PROTOCOL_VERSION = 1 as const

export type PageToolboxLifecyclePhase = 'initializing' | 'ready'

export interface PageToolboxLifecycleSnapshot {
  readonly approvedOrigins: readonly string[]
  readonly sessions: readonly {
    readonly exactOrigin: string
    readonly tabId: number
    readonly navigationId: string
    readonly generation: number
    readonly phase: PageToolboxLifecyclePhase
    readonly planRevision: number
  }[]
}

export type PageToolboxErrorCode =
  | 'module-unavailable'
  | 'module-disabled'
  | 'active-tab-unavailable'
  | 'invalid-origin'
  | 'permission-check-failed'
  | 'permission-missing'
  | 'invalid-preparation'
  | 'settings-read-failed'
  | 'settings-invalid'
  | 'settings-write-failed'
  | 'injection-failed'
  | 'lifecycle-cancelled'
  | 'permission-remove-failed'
  | 'tool-settings-invalid'
  | 'revision-conflict'
  | 'revision-exhausted'

export type PageToolboxManagementRequest =
  | {
    readonly channel: typeof PAGE_TOOLBOX_MANAGEMENT_CHANNEL
    readonly version: typeof PAGE_TOOLBOX_MANAGEMENT_PROTOCOL_VERSION
    readonly type: 'PAGE_TOOLBOX_PREPARE_CURRENT_SITE'
  }
  | {
    readonly channel: typeof PAGE_TOOLBOX_MANAGEMENT_CHANNEL
    readonly version: typeof PAGE_TOOLBOX_MANAGEMENT_PROTOCOL_VERSION
    readonly type: 'PAGE_TOOLBOX_CONFIRM_CURRENT_SITE'
    readonly token: string
  }
  | {
    readonly channel: typeof PAGE_TOOLBOX_MANAGEMENT_CHANNEL
    readonly version: typeof PAGE_TOOLBOX_MANAGEMENT_PROTOCOL_VERSION
    readonly type: 'PAGE_TOOLBOX_SET_CURRENT_SITE_TOOL'
    readonly toolId: string
    readonly enabled: true
    readonly settings: PageToolJsonValue
  }
  | {
    readonly channel: typeof PAGE_TOOLBOX_MANAGEMENT_CHANNEL
    readonly version: typeof PAGE_TOOLBOX_MANAGEMENT_PROTOCOL_VERSION
    readonly type: 'PAGE_TOOLBOX_SET_CURRENT_SITE_TOOL'
    readonly toolId: string
    readonly enabled: false
  }
  | {
    readonly channel: typeof PAGE_TOOLBOX_MANAGEMENT_CHANNEL
    readonly version: typeof PAGE_TOOLBOX_MANAGEMENT_PROTOCOL_VERSION
    readonly type: 'PAGE_TOOLBOX_REPLACE_CURRENT_SITE_SETTINGS'
    readonly expectedRevision: number
    readonly siteSettings: PageToolSiteSettingsV1
  }
  | {
    readonly channel: typeof PAGE_TOOLBOX_MANAGEMENT_CHANNEL
    readonly version: typeof PAGE_TOOLBOX_MANAGEMENT_PROTOCOL_VERSION
    readonly type:
      | 'PAGE_TOOLBOX_CONTROL_STATUS'
      | 'PAGE_TOOLBOX_REVOKE_CURRENT_SITE'
      | 'PAGE_TOOLBOX_STATUS'
  }

export type PageToolboxManagementRequestType = PageToolboxManagementRequest['type']

export type PageToolboxManagementResult =
  | { readonly ok: true, readonly operation: 'prepare', readonly preparation: PageToolboxSitePreparationV1 }
  | { readonly ok: false, readonly operation: 'prepare', readonly reason: PageToolboxErrorCode }
  | {
    readonly ok: true
    readonly operation: 'confirm'
    readonly changed: boolean
    readonly injected: boolean
    readonly preparation: PageToolboxSitePreparationV1
  }
  | { readonly ok: false, readonly operation: 'confirm', readonly reason: PageToolboxErrorCode }
  | {
    readonly ok: true
    readonly operation: 'revoke'
    readonly changed: boolean
    readonly releasedOrigin: boolean
  }
  | { readonly ok: false, readonly operation: 'revoke', readonly reason: PageToolboxErrorCode }
  | {
    readonly ok: true
    readonly operation: 'set-tool'
    readonly toolId: string
    readonly enabled: boolean
    readonly changed: boolean
    readonly synchronized: number
  }
  | { readonly ok: false, readonly operation: 'set-tool', readonly reason: PageToolboxErrorCode }
  | {
    readonly ok: true
    readonly operation: 'control-status'
    readonly snapshot: PageToolboxControlSnapshotV1
  }
  | { readonly ok: false, readonly operation: 'control-status', readonly reason: PageToolboxErrorCode }
  | {
    readonly ok: true
    readonly operation: 'replace-site-settings'
    readonly changed: boolean
    readonly synchronized: number
    readonly snapshot: PageToolboxControlSnapshotV1
  }
  | {
    readonly ok: false
    readonly operation: 'replace-site-settings'
    readonly reason: 'revision-conflict'
    readonly snapshot: PageToolboxControlSnapshotV1
  }
  | {
    readonly ok: false
    readonly operation: 'replace-site-settings'
    readonly reason: Exclude<PageToolboxErrorCode, 'revision-conflict'>
  }
  | { readonly ok: true, readonly operation: 'status', readonly snapshot: PageToolboxLifecycleSnapshot }
  | { readonly ok: false, readonly operation: 'status', readonly reason: PageToolboxErrorCode }

export interface PageToolboxManagementResponse {
  readonly channel: typeof PAGE_TOOLBOX_MANAGEMENT_CHANNEL
  readonly version: typeof PAGE_TOOLBOX_MANAGEMENT_PROTOCOL_VERSION
  readonly type: 'PAGE_TOOLBOX_RESPONSE'
  readonly requestType: PageToolboxManagementRequestType
  readonly result: PageToolboxManagementResult
}

interface PageToolboxLifecycleBase {
  readonly channel: typeof PAGE_TOOLBOX_LIFECYCLE_CHANNEL
  readonly version: typeof PAGE_TOOLBOX_LIFECYCLE_PROTOCOL_VERSION
  readonly moduleId: typeof PAGE_TOOLBOX_MODULE_ID
}

export type PageToolboxContentMessage =
  | PageToolboxLifecycleBase & {
    readonly type: 'PAGE_TOOLBOX_HELLO'
    readonly challenge: string
  }
  | PageToolboxLifecycleBase & {
    readonly type: 'PAGE_TOOLBOX_READY'
    readonly sessionNonce: string
    readonly binding: PageToolboxRuntimeBindingV1
    readonly planRevision: number
  }
  | PageToolboxLifecycleBase & {
    readonly type: 'PAGE_TOOLBOX_SYNCED'
    readonly sessionNonce: string
    readonly binding: PageToolboxRuntimeBindingV1
    readonly planRevision: number
  }
  | PageToolboxLifecycleBase & {
    readonly type: 'PAGE_TOOLBOX_DISPOSED'
    readonly sessionNonce: string
    readonly binding: PageToolboxRuntimeBindingV1
  }
  | PageToolboxLifecycleBase & {
    readonly type: 'PAGE_TOOLBOX_CONTROL_TOGGLE'
    readonly sessionNonce: string
    readonly binding: PageToolboxRuntimeBindingV1
    readonly actionId: string
    readonly toolId: PageToolId
    readonly enabled: boolean
  }

export type PageToolboxHostMessage =
  | PageToolboxLifecycleBase & {
    readonly type: 'PAGE_TOOLBOX_INIT'
    readonly challenge: string
    readonly sessionNonce: string
    readonly binding: PageToolboxRuntimeBindingV1
    readonly planRevision: number
    readonly tools: readonly PageToolPlanV1[]
  }
  | PageToolboxLifecycleBase & {
    readonly type: 'PAGE_TOOLBOX_SYNC'
    readonly sessionNonce: string
    readonly binding: PageToolboxRuntimeBindingV1
    readonly planRevision: number
    readonly tools: readonly PageToolPlanV1[]
  }
  | PageToolboxLifecycleBase & {
    readonly type: 'PAGE_TOOLBOX_DISPOSE'
    readonly sessionNonce: string
    readonly binding: PageToolboxRuntimeBindingV1
    readonly reason: PageToolboxDisposeReason
  }
  | PageToolboxLifecycleBase & {
    readonly type: 'PAGE_TOOLBOX_CONTROL_RESULT'
    readonly sessionNonce: string
    readonly binding: PageToolboxRuntimeBindingV1
    readonly actionId: string
    readonly toolId: PageToolId
    readonly enabled: boolean
    readonly ok: true
    readonly changed: boolean
  }
  | PageToolboxLifecycleBase & {
    readonly type: 'PAGE_TOOLBOX_CONTROL_RESULT'
    readonly sessionNonce: string
    readonly binding: PageToolboxRuntimeBindingV1
    readonly actionId: string
    readonly toolId: PageToolId
    readonly enabled: boolean
    readonly ok: false
    readonly reason: PageToolboxShadowActionErrorCode
  }

function exactRecord(value: unknown, expectedKeys?: readonly string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return null
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null)
    return null
  const keys = Reflect.ownKeys(value)
  if ((expectedKeys && keys.length !== expectedKeys.length)
    || keys.some(key => typeof key !== 'string' || (expectedKeys && !expectedKeys.includes(key)))) {
    return null
  }
  const record: Record<string, unknown> = {}
  for (const key of keys as string[]) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor))
      return null
    record[key] = descriptor.value
  }
  return record
}

function isToken(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 16 && value.length <= 128
}

function isNonce(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{48}$/.test(value)
}

function isPlanRevision(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0
}

function canonicalPlans(value: unknown): readonly PageToolPlanV1[] | null {
  const validated = validatePageToolPlans(value, PAGE_TOOL_CATALOG)
  return validated.ok ? validated.value : null
}

function canonicalBinding(value: unknown): PageToolboxRuntimeBindingV1 | null {
  const record = exactRecord(value, [
    'moduleId',
    'exactOrigin',
    'tabId',
    'frameId',
    'navigationId',
    'generation',
  ])
  if (!record)
    return null
  const exactOrigin = normalizePageToolExactOrigin(record.exactOrigin)
  if (record.moduleId !== PAGE_TOOLBOX_MODULE_ID
    || !exactOrigin
    || !Number.isSafeInteger(record.tabId)
    || (record.tabId as number) < 0
    || record.frameId !== 0
    || typeof record.navigationId !== 'string'
    || record.navigationId.length === 0
    || record.navigationId.length > PAGE_TOOL_NAVIGATION_ID_MAX_LENGTH
    || !Number.isSafeInteger(record.generation)
    || (record.generation as number) <= 0) {
    return null
  }
  return Object.freeze({
    moduleId: PAGE_TOOLBOX_MODULE_ID,
    exactOrigin,
    tabId: record.tabId as number,
    frameId: 0,
    navigationId: record.navigationId,
    generation: record.generation as number,
  })
}

function lifecycleBase(value: unknown, keys: readonly string[]) {
  const record = exactRecord(value, keys)
  if (!record
    || record.channel !== PAGE_TOOLBOX_LIFECYCLE_CHANNEL
    || record.version !== PAGE_TOOLBOX_LIFECYCLE_PROTOCOL_VERSION
    || record.moduleId !== PAGE_TOOLBOX_MODULE_ID) {
    return null
  }
  return record
}

export function createPageToolboxHello(
  challenge: string,
): Extract<PageToolboxContentMessage, { type: 'PAGE_TOOLBOX_HELLO' }> {
  if (!isNonce(challenge))
    throw new TypeError('Page Toolbox challenge must contain 24 bytes of hexadecimal entropy')
  return Object.freeze({
    channel: PAGE_TOOLBOX_LIFECYCLE_CHANNEL,
    version: PAGE_TOOLBOX_LIFECYCLE_PROTOCOL_VERSION,
    moduleId: PAGE_TOOLBOX_MODULE_ID,
    type: 'PAGE_TOOLBOX_HELLO',
    challenge,
  })
}

export function createPageToolboxInit(
  challenge: string,
  sessionNonce: string,
  binding: PageToolboxRuntimeBindingV1,
  planRevision = 1,
  tools: readonly PageToolPlanV1[] = [],
): Extract<PageToolboxHostMessage, { type: 'PAGE_TOOLBOX_INIT' }> {
  if (!isNonce(challenge) || !isNonce(sessionNonce))
    throw new TypeError('Page Toolbox lifecycle entropy is invalid')
  const canonical = canonicalBinding(binding)
  if (!canonical)
    throw new TypeError('Page Toolbox runtime binding is invalid')
  const plans = canonicalPlans(tools)
  if (!isPlanRevision(planRevision) || !plans)
    throw new TypeError('Page Toolbox tool plan is invalid')
  return Object.freeze({
    channel: PAGE_TOOLBOX_LIFECYCLE_CHANNEL,
    version: PAGE_TOOLBOX_LIFECYCLE_PROTOCOL_VERSION,
    moduleId: PAGE_TOOLBOX_MODULE_ID,
    type: 'PAGE_TOOLBOX_INIT',
    challenge,
    sessionNonce,
    binding: canonical,
    planRevision,
    tools: plans,
  })
}

export function createPageToolboxReady(
  sessionNonce: string,
  binding: PageToolboxRuntimeBindingV1,
  planRevision = 1,
): Extract<PageToolboxContentMessage, { type: 'PAGE_TOOLBOX_READY' }> {
  if (!isNonce(sessionNonce))
    throw new TypeError('Page Toolbox session nonce is invalid')
  const canonical = canonicalBinding(binding)
  if (!canonical)
    throw new TypeError('Page Toolbox runtime binding is invalid')
  if (!isPlanRevision(planRevision))
    throw new TypeError('Page Toolbox plan revision is invalid')
  return Object.freeze({
    channel: PAGE_TOOLBOX_LIFECYCLE_CHANNEL,
    version: PAGE_TOOLBOX_LIFECYCLE_PROTOCOL_VERSION,
    moduleId: PAGE_TOOLBOX_MODULE_ID,
    type: 'PAGE_TOOLBOX_READY',
    sessionNonce,
    binding: canonical,
    planRevision,
  })
}

export function createPageToolboxSync(
  sessionNonce: string,
  binding: PageToolboxRuntimeBindingV1,
  planRevision: number,
  tools: readonly PageToolPlanV1[],
): Extract<PageToolboxHostMessage, { type: 'PAGE_TOOLBOX_SYNC' }> {
  const ready = createPageToolboxReady(sessionNonce, binding, planRevision)
  const plans = canonicalPlans(tools)
  if (!plans)
    throw new TypeError('Page Toolbox tool plan is invalid')
  return Object.freeze({
    channel: ready.channel,
    version: ready.version,
    moduleId: ready.moduleId,
    type: 'PAGE_TOOLBOX_SYNC',
    sessionNonce: ready.sessionNonce,
    binding: ready.binding,
    planRevision,
    tools: plans,
  })
}

export function createPageToolboxSynced(
  sessionNonce: string,
  binding: PageToolboxRuntimeBindingV1,
  planRevision: number,
): Extract<PageToolboxContentMessage, { type: 'PAGE_TOOLBOX_SYNCED' }> {
  return Object.freeze({ ...createPageToolboxReady(sessionNonce, binding, planRevision), type: 'PAGE_TOOLBOX_SYNCED' })
}

export function createPageToolboxControlToggle(
  sessionNonce: string,
  binding: PageToolboxRuntimeBindingV1,
  actionId: string,
  toolId: PageToolId,
  enabled: boolean,
): Extract<PageToolboxContentMessage, { type: 'PAGE_TOOLBOX_CONTROL_TOGGLE' }> {
  if (!isNonce(sessionNonce)
    || !isValidPageToolOperationId(actionId)
    || !isPageToolId(toolId)
    || typeof enabled !== 'boolean') {
    throw new TypeError('Page Toolbox Shadow control toggle is invalid')
  }
  const canonical = canonicalBinding(binding)
  if (!canonical)
    throw new TypeError('Page Toolbox runtime binding is invalid')
  return Object.freeze({
    channel: PAGE_TOOLBOX_LIFECYCLE_CHANNEL,
    version: PAGE_TOOLBOX_LIFECYCLE_PROTOCOL_VERSION,
    moduleId: PAGE_TOOLBOX_MODULE_ID,
    type: 'PAGE_TOOLBOX_CONTROL_TOGGLE',
    sessionNonce,
    binding: canonical,
    actionId,
    toolId,
    enabled,
  })
}

const shadowActionErrors = new Set<PageToolboxShadowActionErrorCode>([
  'action-active',
  'action-limit',
  'action-replayed',
  'lifecycle-cancelled',
  'module-disabled',
  'permission-check-failed',
  'permission-missing',
  'revision-exhausted',
  'settings-write-failed',
  'tool-settings-invalid',
])

function isPageToolboxShadowActionError(value: unknown): value is PageToolboxShadowActionErrorCode {
  return typeof value === 'string' && shadowActionErrors.has(value as PageToolboxShadowActionErrorCode)
}

export function createPageToolboxControlResult(
  sessionNonce: string,
  binding: PageToolboxRuntimeBindingV1,
  actionId: string,
  toolId: PageToolId,
  enabled: boolean,
  result:
    | { readonly ok: true, readonly changed: boolean }
    | { readonly ok: false, readonly reason: PageToolboxShadowActionErrorCode },
): Extract<PageToolboxHostMessage, { type: 'PAGE_TOOLBOX_CONTROL_RESULT' }> {
  const toggle = createPageToolboxControlToggle(sessionNonce, binding, actionId, toolId, enabled)
  if (result.ok) {
    if (typeof result.changed !== 'boolean')
      throw new TypeError('Page Toolbox Shadow control result is invalid')
    return Object.freeze({
      channel: toggle.channel,
      version: toggle.version,
      moduleId: toggle.moduleId,
      type: 'PAGE_TOOLBOX_CONTROL_RESULT',
      sessionNonce: toggle.sessionNonce,
      binding: toggle.binding,
      actionId: toggle.actionId,
      toolId: toggle.toolId,
      enabled: toggle.enabled,
      ok: true,
      changed: result.changed,
    })
  }
  if (!isPageToolboxShadowActionError(result.reason))
    throw new TypeError('Page Toolbox Shadow control error is invalid')
  return Object.freeze({
    channel: toggle.channel,
    version: toggle.version,
    moduleId: toggle.moduleId,
    type: 'PAGE_TOOLBOX_CONTROL_RESULT',
    sessionNonce: toggle.sessionNonce,
    binding: toggle.binding,
    actionId: toggle.actionId,
    toolId: toggle.toolId,
    enabled: toggle.enabled,
    ok: false,
    reason: result.reason,
  })
}

export function createPageToolboxDispose(
  sessionNonce: string,
  binding: PageToolboxRuntimeBindingV1,
  reason: PageToolboxDisposeReason,
): Extract<PageToolboxHostMessage, { type: 'PAGE_TOOLBOX_DISPOSE' }> {
  const ready = createPageToolboxReady(sessionNonce, binding)
  return Object.freeze({
    channel: ready.channel,
    version: ready.version,
    moduleId: ready.moduleId,
    type: 'PAGE_TOOLBOX_DISPOSE',
    sessionNonce: ready.sessionNonce,
    binding: ready.binding,
    reason,
  })
}

export function createPageToolboxDisposed(
  sessionNonce: string,
  binding: PageToolboxRuntimeBindingV1,
): Extract<PageToolboxContentMessage, { type: 'PAGE_TOOLBOX_DISPOSED' }> {
  if (!isNonce(sessionNonce))
    throw new TypeError('Page Toolbox session nonce is invalid')
  const canonical = canonicalBinding(binding)
  if (!canonical)
    throw new TypeError('Page Toolbox runtime binding is invalid')
  return Object.freeze({
    channel: PAGE_TOOLBOX_LIFECYCLE_CHANNEL,
    version: PAGE_TOOLBOX_LIFECYCLE_PROTOCOL_VERSION,
    moduleId: PAGE_TOOLBOX_MODULE_ID,
    type: 'PAGE_TOOLBOX_DISPOSED',
    sessionNonce,
    binding: canonical,
  })
}

export function validatePageToolboxContentMessage(value: unknown): PageToolboxContentMessage | null {
  const hello = lifecycleBase(value, ['channel', 'version', 'moduleId', 'type', 'challenge'])
  if (hello?.type === 'PAGE_TOOLBOX_HELLO' && isNonce(hello.challenge))
    return createPageToolboxHello(hello.challenge)
  const ready = lifecycleBase(value, [
    'channel',
    'version',
    'moduleId',
    'type',
    'sessionNonce',
    'binding',
    'planRevision',
  ])
  if (ready
    && (ready.type === 'PAGE_TOOLBOX_READY' || ready.type === 'PAGE_TOOLBOX_SYNCED')
    && isNonce(ready.sessionNonce)
    && isPlanRevision(ready.planRevision)) {
    const binding = canonicalBinding(ready.binding)
    if (!binding)
      return null
    return ready.type === 'PAGE_TOOLBOX_READY'
      ? createPageToolboxReady(ready.sessionNonce, binding, ready.planRevision)
      : createPageToolboxSynced(ready.sessionNonce, binding, ready.planRevision)
  }
  const toggle = lifecycleBase(value, [
    'channel',
    'version',
    'moduleId',
    'type',
    'sessionNonce',
    'binding',
    'actionId',
    'toolId',
    'enabled',
  ])
  if (toggle?.type === 'PAGE_TOOLBOX_CONTROL_TOGGLE'
    && isNonce(toggle.sessionNonce)
    && isValidPageToolOperationId(toggle.actionId)
    && isPageToolId(toggle.toolId)
    && typeof toggle.enabled === 'boolean') {
    const binding = canonicalBinding(toggle.binding)
    return binding
      ? createPageToolboxControlToggle(
        toggle.sessionNonce,
        binding,
        toggle.actionId,
        toggle.toolId,
        toggle.enabled,
      )
      : null
  }
  const disposed = lifecycleBase(value, ['channel', 'version', 'moduleId', 'type', 'sessionNonce', 'binding'])
  if (disposed?.type !== 'PAGE_TOOLBOX_DISPOSED' || !isNonce(disposed.sessionNonce))
    return null
  const binding = canonicalBinding(disposed.binding)
  return binding ? createPageToolboxDisposed(disposed.sessionNonce, binding) : null
}

export function validatePageToolboxHostMessage(value: unknown): PageToolboxHostMessage | null {
  const init = lifecycleBase(value, [
    'channel',
    'version',
    'moduleId',
    'type',
    'challenge',
    'sessionNonce',
    'binding',
    'planRevision',
    'tools',
  ])
  if (init?.type === 'PAGE_TOOLBOX_INIT'
    && isNonce(init.challenge)
    && isNonce(init.sessionNonce)
    && isPlanRevision(init.planRevision)) {
    const binding = canonicalBinding(init.binding)
    const tools = canonicalPlans(init.tools)
    return binding && tools
      ? createPageToolboxInit(init.challenge, init.sessionNonce, binding, init.planRevision, tools)
      : null
  }
  const sync = lifecycleBase(value, [
    'channel',
    'version',
    'moduleId',
    'type',
    'sessionNonce',
    'binding',
    'planRevision',
    'tools',
  ])
  if (sync?.type === 'PAGE_TOOLBOX_SYNC'
    && isNonce(sync.sessionNonce)
    && isPlanRevision(sync.planRevision)) {
    const binding = canonicalBinding(sync.binding)
    const tools = canonicalPlans(sync.tools)
    return binding && tools
      ? createPageToolboxSync(sync.sessionNonce, binding, sync.planRevision, tools)
      : null
  }
  const successfulControl = lifecycleBase(value, [
    'channel',
    'version',
    'moduleId',
    'type',
    'sessionNonce',
    'binding',
    'actionId',
    'toolId',
    'enabled',
    'ok',
    'changed',
  ])
  if (successfulControl?.type === 'PAGE_TOOLBOX_CONTROL_RESULT'
    && successfulControl.ok === true
    && isNonce(successfulControl.sessionNonce)
    && isValidPageToolOperationId(successfulControl.actionId)
    && isPageToolId(successfulControl.toolId)
    && typeof successfulControl.enabled === 'boolean'
    && typeof successfulControl.changed === 'boolean') {
    const binding = canonicalBinding(successfulControl.binding)
    return binding
      ? createPageToolboxControlResult(
        successfulControl.sessionNonce,
        binding,
        successfulControl.actionId,
        successfulControl.toolId,
        successfulControl.enabled,
        { ok: true, changed: successfulControl.changed },
      )
      : null
  }
  const failedControl = lifecycleBase(value, [
    'channel',
    'version',
    'moduleId',
    'type',
    'sessionNonce',
    'binding',
    'actionId',
    'toolId',
    'enabled',
    'ok',
    'reason',
  ])
  if (failedControl?.type === 'PAGE_TOOLBOX_CONTROL_RESULT'
    && failedControl.ok === false
    && isNonce(failedControl.sessionNonce)
    && isValidPageToolOperationId(failedControl.actionId)
    && isPageToolId(failedControl.toolId)
    && typeof failedControl.enabled === 'boolean'
    && isPageToolboxShadowActionError(failedControl.reason)) {
    const binding = canonicalBinding(failedControl.binding)
    return binding
      ? createPageToolboxControlResult(
        failedControl.sessionNonce,
        binding,
        failedControl.actionId,
        failedControl.toolId,
        failedControl.enabled,
        { ok: false, reason: failedControl.reason },
      )
      : null
  }
  const dispose = lifecycleBase(value, [
    'channel',
    'version',
    'moduleId',
    'type',
    'sessionNonce',
    'binding',
    'reason',
  ])
  if (dispose?.type !== 'PAGE_TOOLBOX_DISPOSE' || !isNonce(dispose.sessionNonce))
    return null
  const reasons: readonly PageToolboxDisposeReason[] = [
    'disabled',
    'origin-revoked',
    'navigation',
    'tab-removed',
    'port-loss',
    'worker-restart',
    'extension-update',
    'tool-update',
  ]
  if (!reasons.includes(dispose.reason as PageToolboxDisposeReason))
    return null
  const binding = canonicalBinding(dispose.binding)
  return binding
    ? createPageToolboxDispose(dispose.sessionNonce, binding, dispose.reason as PageToolboxDisposeReason)
    : null
}

export function isPageToolboxManagementRequest(value: unknown): value is PageToolboxManagementRequest {
  const base = exactRecord(value, ['channel', 'version', 'type'])
    || exactRecord(value, ['channel', 'version', 'type', 'token'])
    || exactRecord(value, ['channel', 'version', 'type', 'toolId', 'enabled'])
    || exactRecord(value, ['channel', 'version', 'type', 'toolId', 'enabled', 'settings'])
    || exactRecord(value, ['channel', 'version', 'type', 'expectedRevision', 'siteSettings'])
  if (!base
    || base.channel !== PAGE_TOOLBOX_MANAGEMENT_CHANNEL
    || base.version !== PAGE_TOOLBOX_MANAGEMENT_PROTOCOL_VERSION) {
    return false
  }
  if (base.type === 'PAGE_TOOLBOX_CONFIRM_CURRENT_SITE')
    return Object.hasOwn(base, 'token') && isToken(base.token)
  if (base.type === 'PAGE_TOOLBOX_SET_CURRENT_SITE_TOOL') {
    if (!isPageToolId(base.toolId) || typeof base.enabled !== 'boolean')
      return false
    if (base.enabled !== Object.hasOwn(base, 'settings'))
      return false
    return !base.enabled || validatePageToolSettingsValue(base.toolId, base.settings, PAGE_TOOL_CATALOG).ok
  }
  if (base.type === 'PAGE_TOOLBOX_REPLACE_CURRENT_SITE_SETTINGS') {
    return isPageToolboxControlRevision(base.expectedRevision)
      && validatePageToolboxControlSiteSettings('https://control.invalid', base.siteSettings).ok
  }
  return !Object.hasOwn(base, 'token')
    && !Object.hasOwn(base, 'toolId')
    && (base.type === 'PAGE_TOOLBOX_PREPARE_CURRENT_SITE'
      || base.type === 'PAGE_TOOLBOX_CONTROL_STATUS'
      || base.type === 'PAGE_TOOLBOX_REVOKE_CURRENT_SITE'
      || base.type === 'PAGE_TOOLBOX_STATUS')
}

const pageToolboxErrorCodes = new Set<PageToolboxErrorCode>([
  'module-unavailable',
  'module-disabled',
  'active-tab-unavailable',
  'invalid-origin',
  'permission-check-failed',
  'permission-missing',
  'invalid-preparation',
  'settings-read-failed',
  'settings-invalid',
  'settings-write-failed',
  'injection-failed',
  'lifecycle-cancelled',
  'permission-remove-failed',
  'tool-settings-invalid',
  'revision-conflict',
  'revision-exhausted',
])

function isPageToolboxErrorCode(value: unknown): value is PageToolboxErrorCode {
  return typeof value === 'string' && pageToolboxErrorCodes.has(value as PageToolboxErrorCode)
}

export function isPageToolboxSitePreparation(value: unknown): value is PageToolboxSitePreparationV1 {
  const record = exactRecord(value, ['token', 'exactOrigin', 'originPattern', 'expiresAt'])
  const origin = normalizePageToolExactOrigin(record?.exactOrigin)
  return Boolean(record
    && isToken(record.token)
    && origin
    && record.originPattern === `${origin}/*`
    && typeof record.expiresAt === 'string'
    && Number.isFinite(Date.parse(record.expiresAt)))
}

function isLifecycleSnapshot(value: unknown): value is PageToolboxLifecycleSnapshot {
  const record = exactRecord(value, ['approvedOrigins', 'sessions'])
  if (!record || !Array.isArray(record.approvedOrigins) || !Array.isArray(record.sessions))
    return false
  return record.approvedOrigins.every(origin => normalizePageToolExactOrigin(origin) === origin)
    && record.sessions.every((session) => {
      const item = exactRecord(session, [
        'exactOrigin',
        'tabId',
        'navigationId',
        'generation',
        'phase',
        'planRevision',
      ])
      return Boolean(item
        && normalizePageToolExactOrigin(item.exactOrigin) === item.exactOrigin
        && Number.isSafeInteger(item.tabId)
        && (item.tabId as number) >= 0
        && typeof item.navigationId === 'string'
        && item.navigationId.length > 0
        && (item.phase === 'initializing' || item.phase === 'ready')
        && Number.isSafeInteger(item.generation)
        && (item.generation as number) > 0
        && isPlanRevision(item.planRevision))
    })
}

export function isPageToolboxManagementResponse(value: unknown): value is PageToolboxManagementResponse {
  const response = exactRecord(value, ['channel', 'version', 'type', 'requestType', 'result'])
  const result = exactRecord(response?.result)
  if (!response
    || response.channel !== PAGE_TOOLBOX_MANAGEMENT_CHANNEL
    || response.version !== PAGE_TOOLBOX_MANAGEMENT_PROTOCOL_VERSION
    || response.type !== 'PAGE_TOOLBOX_RESPONSE'
    || !result
    || typeof result.ok !== 'boolean') {
    return false
  }
  if (response.requestType === 'PAGE_TOOLBOX_PREPARE_CURRENT_SITE' && result.operation === 'prepare')
    return result.ok ? isPageToolboxSitePreparation(result.preparation) : isPageToolboxErrorCode(result.reason)
  if (response.requestType === 'PAGE_TOOLBOX_CONFIRM_CURRENT_SITE' && result.operation === 'confirm') {
    return result.ok
      ? typeof result.changed === 'boolean' && typeof result.injected === 'boolean' && isPageToolboxSitePreparation(result.preparation)
      : isPageToolboxErrorCode(result.reason)
  }
  if (response.requestType === 'PAGE_TOOLBOX_REVOKE_CURRENT_SITE' && result.operation === 'revoke') {
    return result.ok
      ? typeof result.changed === 'boolean' && typeof result.releasedOrigin === 'boolean'
      : isPageToolboxErrorCode(result.reason)
  }
  if (response.requestType === 'PAGE_TOOLBOX_SET_CURRENT_SITE_TOOL' && result.operation === 'set-tool') {
    return result.ok
      ? isPageToolId(result.toolId)
      && typeof result.enabled === 'boolean'
      && typeof result.changed === 'boolean'
      && Number.isSafeInteger(result.synchronized)
      && (result.synchronized as number) >= 0
      : isPageToolboxErrorCode(result.reason)
  }
  if (response.requestType === 'PAGE_TOOLBOX_CONTROL_STATUS' && result.operation === 'control-status') {
    return result.ok
      ? validatePageToolboxControlSnapshot(result.snapshot).ok
      : isPageToolboxErrorCode(result.reason)
  }
  if (response.requestType === 'PAGE_TOOLBOX_REPLACE_CURRENT_SITE_SETTINGS'
    && result.operation === 'replace-site-settings') {
    if (result.ok) {
      return typeof result.changed === 'boolean'
        && Number.isSafeInteger(result.synchronized)
        && (result.synchronized as number) >= 0
        && validatePageToolboxControlSnapshot(result.snapshot).ok
    }
    return isPageToolboxErrorCode(result.reason)
      && (result.reason !== 'revision-conflict' || validatePageToolboxControlSnapshot(result.snapshot).ok)
  }
  if (response.requestType === 'PAGE_TOOLBOX_STATUS' && result.operation === 'status')
    return result.ok ? isLifecycleSnapshot(result.snapshot) : isPageToolboxErrorCode(result.reason)
  return false
}

export function createPageToolboxManagementResponse(
  requestType: PageToolboxManagementRequestType,
  result: PageToolboxManagementResult,
): PageToolboxManagementResponse {
  return Object.freeze({
    channel: PAGE_TOOLBOX_MANAGEMENT_CHANNEL,
    version: PAGE_TOOLBOX_MANAGEMENT_PROTOCOL_VERSION,
    type: 'PAGE_TOOLBOX_RESPONSE',
    requestType,
    result: structuredClone(result),
  })
}

export function samePageToolboxBinding(
  left: PageToolboxRuntimeBindingV1,
  right: PageToolboxRuntimeBindingV1,
) {
  return left.moduleId === right.moduleId
    && left.exactOrigin === right.exactOrigin
    && left.tabId === right.tabId
    && left.frameId === right.frameId
    && left.navigationId === right.navigationId
    && left.generation === right.generation
}
