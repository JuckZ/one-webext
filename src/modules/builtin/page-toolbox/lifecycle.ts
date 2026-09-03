import type {
  PageToolAuthorityV1,
  PageToolCatalogV1,
  PageToolJsonValue,
  PageToolRuntimeBindingV1,
} from './contracts'
import {
  createPageToolAuthority,
  isValidPageToolOperationId,
  validatePageToolSettingsValue,
} from './validation'

export type PageToolLifecyclePhase =
  | 'inactive'
  | 'applying'
  | 'active'
  | 'updating'
  | 'disposing'
  | 'disposed'
  | 'failed'

export type PageToolDisposeReason =
  | 'manual'
  | 'disabled'
  | 'origin-revoked'
  | 'navigation'
  | 'frame-teardown'
  | 'port-loss'
  | 'worker-restart'
  | 'extension-update'
  | 'tool-update'
  | 'failure'

export type PageToolLifecycleFailureCode =
  | 'apply-failed'
  | 'update-rollback'
  | 'update-failed'
  | 'cleanup-failed'

export type PageToolLifecycleOperation =
  | {
    readonly kind: 'apply'
    readonly operationId: string
    readonly candidateSettings: PageToolJsonValue
  }
  | {
    readonly kind: 'update'
    readonly operationId: string
    readonly candidateSettings: PageToolJsonValue
  }
  | {
    readonly kind: 'dispose'
    readonly operationId: string
    readonly reason: PageToolDisposeReason
  }

export interface PageToolLifecycleState {
  readonly binding: PageToolRuntimeBindingV1
  readonly authority: PageToolAuthorityV1
  readonly phase: PageToolLifecyclePhase
  readonly currentSettings: PageToolJsonValue | null
  readonly operation: PageToolLifecycleOperation | null
  readonly terminalCause: PageToolDisposeReason | null
  readonly lastFailure: PageToolLifecycleFailureCode | null
}

export type PageToolLifecycleEvent =
  | {
    readonly type: 'APPLY'
    readonly authority: PageToolAuthorityV1
    readonly operationId: string
    readonly settings: unknown
  }
  | {
    readonly type: 'APPLY_SUCCEEDED'
    readonly authority: PageToolAuthorityV1
    readonly operationId: string
  }
  | {
    readonly type: 'APPLY_FAILED'
    readonly authority: PageToolAuthorityV1
    readonly operationId: string
  }
  | {
    readonly type: 'UPDATE'
    readonly authority: PageToolAuthorityV1
    readonly operationId: string
    readonly settings: unknown
  }
  | {
    readonly type: 'UPDATE_SUCCEEDED'
    readonly authority: PageToolAuthorityV1
    readonly operationId: string
  }
  | {
    readonly type: 'UPDATE_ROLLED_BACK'
    readonly authority: PageToolAuthorityV1
    readonly operationId: string
  }
  | {
    readonly type: 'UPDATE_FAILED'
    readonly authority: PageToolAuthorityV1
    readonly operationId: string
  }
  | {
    readonly type: 'DISPOSE'
    readonly authority: PageToolAuthorityV1
    readonly operationId: string
    readonly reason: PageToolDisposeReason
  }
  | {
    readonly type: 'DISPOSE_SUCCEEDED'
    readonly authority: PageToolAuthorityV1
    readonly operationId: string
  }
  | {
    readonly type: 'DISPOSE_FAILED'
    readonly authority: PageToolAuthorityV1
    readonly operationId: string
  }

export type PageToolLifecycleRejection =
  | 'authority-mismatch'
  | 'invalid-operation-id'
  | 'invalid-settings'
  | 'invalid-transition'
  | 'operation-mismatch'
  | 'operation-active'
  | 'terminal'

export type PageToolLifecycleReduction =
  | {
    readonly effect: 'transitioned'
    readonly state: PageToolLifecycleState
  }
  | {
    readonly effect: 'idempotent'
    readonly state: PageToolLifecycleState
  }
  | {
    readonly effect: 'rejected'
    readonly reason: PageToolLifecycleRejection
    readonly state: PageToolLifecycleState
  }

function freezeOperation(operation: PageToolLifecycleOperation | null): PageToolLifecycleOperation | null {
  return operation ? Object.freeze(operation) : null
}

function createState(
  state: PageToolLifecycleState,
  update: Partial<Omit<PageToolLifecycleState, 'binding' | 'authority'>>,
): PageToolLifecycleState {
  return Object.freeze({
    binding: state.binding,
    authority: state.authority,
    phase: update.phase ?? state.phase,
    currentSettings: Object.hasOwn(update, 'currentSettings') ? update.currentSettings! : state.currentSettings,
    operation: Object.hasOwn(update, 'operation') ? freezeOperation(update.operation!) : state.operation,
    terminalCause: Object.hasOwn(update, 'terminalCause') ? update.terminalCause! : state.terminalCause,
    lastFailure: Object.hasOwn(update, 'lastFailure') ? update.lastFailure! : state.lastFailure,
  })
}

function reject(
  state: PageToolLifecycleState,
  reason: PageToolLifecycleRejection,
): PageToolLifecycleReduction {
  return { effect: 'rejected', reason, state }
}

function transitioned(state: PageToolLifecycleState): PageToolLifecycleReduction {
  return { effect: 'transitioned', state }
}

function idempotent(state: PageToolLifecycleState): PageToolLifecycleReduction {
  return { effect: 'idempotent', state }
}

function authorityMatches(state: PageToolLifecycleState, authority: PageToolAuthorityV1): boolean {
  return authority.bindingKey === state.authority.bindingKey
    && authority.generation === state.authority.generation
}

function settingsEqual(left: PageToolJsonValue | null, right: PageToolJsonValue): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function operationMatches(
  state: PageToolLifecycleState,
  kind: PageToolLifecycleOperation['kind'],
  operationId: string,
): boolean {
  return state.operation?.kind === kind && state.operation.operationId === operationId
}

export function createPageToolLifecycleState(
  binding: PageToolRuntimeBindingV1,
): PageToolLifecycleState {
  const bindingSnapshot = Object.freeze({ ...binding })
  return Object.freeze({
    binding: bindingSnapshot,
    authority: createPageToolAuthority(bindingSnapshot),
    phase: 'inactive',
    currentSettings: null,
    operation: null,
    terminalCause: null,
    lastFailure: null,
  })
}

export function reducePageToolLifecycle(
  state: PageToolLifecycleState,
  event: PageToolLifecycleEvent,
  catalog: PageToolCatalogV1,
): PageToolLifecycleReduction {
  if (!authorityMatches(state, event.authority))
    return reject(state, 'authority-mismatch')
  if (!isValidPageToolOperationId(event.operationId))
    return reject(state, 'invalid-operation-id')

  if (event.type === 'DISPOSE') {
    if (state.phase === 'disposing' || state.phase === 'disposed' || state.phase === 'failed')
      return idempotent(state)
    return transitioned(createState(state, {
      phase: 'disposing',
      operation: {
        kind: 'dispose',
        operationId: event.operationId,
        reason: event.reason,
      },
      terminalCause: event.reason,
    }))
  }

  if (state.phase === 'disposed' || state.phase === 'failed')
    return reject(state, 'terminal')

  if (event.type === 'APPLY') {
    const settings = validatePageToolSettingsValue(state.binding.toolId, event.settings, catalog)
    if (!settings.ok)
      return reject(state, 'invalid-settings')
    if (state.phase === 'applying') {
      return operationMatches(state, 'apply', event.operationId)
        && state.operation?.kind === 'apply'
        && settingsEqual(state.operation.candidateSettings, settings.value)
        ? idempotent(state)
        : reject(state, 'operation-active')
    }
    if (state.phase === 'active') {
      return settingsEqual(state.currentSettings, settings.value)
        ? idempotent(state)
        : reject(state, 'invalid-transition')
    }
    if (state.phase !== 'inactive')
      return reject(state, state.operation ? 'operation-active' : 'invalid-transition')
    return transitioned(createState(state, {
      phase: 'applying',
      operation: {
        kind: 'apply',
        operationId: event.operationId,
        candidateSettings: settings.value,
      },
      lastFailure: null,
    }))
  }

  if (event.type === 'APPLY_SUCCEEDED') {
    if (!operationMatches(state, 'apply', event.operationId) || state.operation?.kind !== 'apply')
      return reject(state, 'operation-mismatch')
    return transitioned(createState(state, {
      phase: 'active',
      currentSettings: state.operation.candidateSettings,
      operation: null,
      lastFailure: null,
    }))
  }

  if (event.type === 'APPLY_FAILED') {
    if (!operationMatches(state, 'apply', event.operationId))
      return reject(state, 'operation-mismatch')
    return transitioned(createState(state, {
      phase: 'failed',
      operation: null,
      terminalCause: 'failure',
      lastFailure: 'apply-failed',
    }))
  }

  if (event.type === 'UPDATE') {
    const settings = validatePageToolSettingsValue(state.binding.toolId, event.settings, catalog)
    if (!settings.ok)
      return reject(state, 'invalid-settings')
    if (state.phase === 'updating') {
      return operationMatches(state, 'update', event.operationId)
        && state.operation?.kind === 'update'
        && settingsEqual(state.operation.candidateSettings, settings.value)
        ? idempotent(state)
        : reject(state, 'operation-active')
    }
    if (state.phase !== 'active')
      return reject(state, state.operation ? 'operation-active' : 'invalid-transition')
    if (settingsEqual(state.currentSettings, settings.value))
      return idempotent(state)
    return transitioned(createState(state, {
      phase: 'updating',
      operation: {
        kind: 'update',
        operationId: event.operationId,
        candidateSettings: settings.value,
      },
    }))
  }

  if (event.type === 'UPDATE_SUCCEEDED') {
    if (!operationMatches(state, 'update', event.operationId) || state.operation?.kind !== 'update')
      return reject(state, 'operation-mismatch')
    return transitioned(createState(state, {
      phase: 'active',
      currentSettings: state.operation.candidateSettings,
      operation: null,
      lastFailure: null,
    }))
  }

  if (event.type === 'UPDATE_ROLLED_BACK') {
    if (!operationMatches(state, 'update', event.operationId))
      return reject(state, 'operation-mismatch')
    return transitioned(createState(state, {
      phase: 'active',
      operation: null,
      lastFailure: 'update-rollback',
    }))
  }

  if (event.type === 'UPDATE_FAILED') {
    if (!operationMatches(state, 'update', event.operationId))
      return reject(state, 'operation-mismatch')
    return transitioned(createState(state, {
      phase: 'failed',
      operation: null,
      terminalCause: 'failure',
      lastFailure: 'update-failed',
    }))
  }

  if (event.type === 'DISPOSE_SUCCEEDED') {
    if (!operationMatches(state, 'dispose', event.operationId))
      return reject(state, 'operation-mismatch')
    return transitioned(createState(state, {
      phase: 'disposed',
      currentSettings: null,
      operation: null,
      lastFailure: null,
    }))
  }

  if (!operationMatches(state, 'dispose', event.operationId))
    return reject(state, 'operation-mismatch')
  return transitioned(createState(state, {
    phase: 'failed',
    operation: null,
    lastFailure: 'cleanup-failed',
  }))
}
