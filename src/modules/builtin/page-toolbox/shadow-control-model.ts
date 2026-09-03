import type { PageToolboxRuntimeBindingV1, PageToolPlanV1 } from './contracts'
import type { PageToolId } from './tool-catalog'
import { isPageToolId, PAGE_TOOL_CATALOG } from './tool-catalog'
import { isValidPageToolOperationId, validatePageToolPlans } from './validation'

export const PAGE_TOOLBOX_SHADOW_MAX_ACTIONS_PER_SESSION = 128 as const

export type PageToolboxShadowActionErrorCode =
  | 'action-active'
  | 'action-limit'
  | 'action-replayed'
  | 'lifecycle-cancelled'
  | 'module-disabled'
  | 'permission-check-failed'
  | 'permission-missing'
  | 'revision-exhausted'
  | 'settings-write-failed'
  | 'tool-settings-invalid'

export type PageToolboxShadowControlPhase = 'active' | 'pending' | 'error' | 'disposed'

export interface PageToolboxShadowPendingAction {
  readonly actionId: string
  readonly toolId: PageToolId
  readonly enabled: boolean
}

export interface PageToolboxShadowControlState {
  readonly phase: PageToolboxShadowControlPhase
  readonly binding: PageToolboxRuntimeBindingV1
  readonly enabledToolIds: readonly PageToolId[]
  readonly pending: PageToolboxShadowPendingAction | null
  readonly error: PageToolboxShadowActionErrorCode | null
}

export type PageToolboxShadowControlEvent =
  | {
    readonly type: 'request-toggle'
    readonly binding: PageToolboxRuntimeBindingV1
    readonly actionId: string
    readonly toolId: string
    readonly enabled: boolean
  }
  | {
    readonly type: 'plans-updated'
    readonly binding: PageToolboxRuntimeBindingV1
    readonly plans: unknown
  }
  | {
    readonly type: 'action-accepted'
    readonly binding: PageToolboxRuntimeBindingV1
    readonly actionId: string
    readonly toolId: string
    readonly enabled: boolean
  }
  | {
    readonly type: 'action-rejected'
    readonly binding: PageToolboxRuntimeBindingV1
    readonly actionId: string
    readonly toolId: string
    readonly enabled: boolean
    readonly reason: PageToolboxShadowActionErrorCode
  }
  | { readonly type: 'clear-error', readonly binding: PageToolboxRuntimeBindingV1 }
  | { readonly type: 'dispose', readonly binding: PageToolboxRuntimeBindingV1 }

export type PageToolboxShadowControlReduction = Readonly<{
  state: PageToolboxShadowControlState
  effect: 'transitioned' | 'idempotent' | 'rejected'
}>

function sameBinding(left: PageToolboxRuntimeBindingV1, right: PageToolboxRuntimeBindingV1) {
  return left.moduleId === right.moduleId
    && left.exactOrigin === right.exactOrigin
    && left.tabId === right.tabId
    && left.frameId === right.frameId
    && left.navigationId === right.navigationId
    && left.generation === right.generation
}

function enabledIds(plans: readonly PageToolPlanV1[]) {
  return Object.freeze(plans.map(plan => plan.toolId as PageToolId).sort())
}

function freezeState(state: PageToolboxShadowControlState): PageToolboxShadowControlState {
  return Object.freeze({
    ...state,
    binding: Object.freeze(structuredClone(state.binding)),
    enabledToolIds: Object.freeze([...state.enabledToolIds]),
    pending: state.pending ? Object.freeze({ ...state.pending }) : null,
  })
}

function reduction(
  state: PageToolboxShadowControlState,
  effect: PageToolboxShadowControlReduction['effect'],
): PageToolboxShadowControlReduction {
  return Object.freeze({ state, effect })
}

function validResultIdentity(
  state: PageToolboxShadowControlState,
  event: Extract<PageToolboxShadowControlEvent, { type: 'action-accepted' | 'action-rejected' }>,
) {
  return Boolean(state.pending
    && state.pending.actionId === event.actionId
    && state.pending.toolId === event.toolId
    && state.pending.enabled === event.enabled)
}

export function createPageToolboxShadowControlState(
  binding: PageToolboxRuntimeBindingV1,
  plans: unknown,
): PageToolboxShadowControlState | null {
  const validated = validatePageToolPlans(plans, PAGE_TOOL_CATALOG)
  if (!validated.ok)
    return null
  return freezeState({
    phase: 'active',
    binding,
    enabledToolIds: enabledIds(validated.value),
    pending: null,
    error: null,
  })
}

export function reducePageToolboxShadowControl(
  state: PageToolboxShadowControlState,
  event: PageToolboxShadowControlEvent,
): PageToolboxShadowControlReduction {
  if (!sameBinding(state.binding, event.binding) || state.phase === 'disposed')
    return reduction(state, 'rejected')

  if (event.type === 'dispose') {
    return reduction(freezeState({
      ...state,
      phase: 'disposed',
      pending: null,
      error: null,
    }), 'transitioned')
  }

  if (event.type === 'plans-updated') {
    const plans = validatePageToolPlans(event.plans, PAGE_TOOL_CATALOG)
    if (!plans.ok)
      return reduction(state, 'rejected')
    const next = enabledIds(plans.value)
    if (JSON.stringify(next) === JSON.stringify(state.enabledToolIds))
      return reduction(state, 'idempotent')
    return reduction(freezeState({ ...state, enabledToolIds: next }), 'transitioned')
  }

  if (event.type === 'clear-error') {
    if (state.phase !== 'error')
      return reduction(state, 'idempotent')
    return reduction(freezeState({ ...state, phase: 'active', error: null }), 'transitioned')
  }

  if (event.type === 'request-toggle') {
    if (state.phase !== 'active'
      || state.pending
      || !isValidPageToolOperationId(event.actionId)
      || !isPageToolId(event.toolId)
      || typeof event.enabled !== 'boolean') {
      return reduction(state, 'rejected')
    }
    if (state.enabledToolIds.includes(event.toolId) === event.enabled)
      return reduction(state, 'idempotent')
    return reduction(freezeState({
      ...state,
      phase: 'pending',
      pending: { actionId: event.actionId, toolId: event.toolId, enabled: event.enabled },
      error: null,
    }), 'transitioned')
  }

  if (!validResultIdentity(state, event) || state.phase !== 'pending')
    return reduction(state, 'rejected')
  if (event.type === 'action-rejected') {
    return reduction(freezeState({
      ...state,
      phase: 'error',
      pending: null,
      error: event.reason,
    }), 'transitioned')
  }
  const enabled = new Set(state.enabledToolIds)
  if (event.enabled)
    enabled.add(event.toolId as PageToolId)
  else
    enabled.delete(event.toolId as PageToolId)
  return reduction(freezeState({
    ...state,
    phase: 'active',
    enabledToolIds: [...enabled].sort(),
    pending: null,
    error: null,
  }), 'transitioned')
}
