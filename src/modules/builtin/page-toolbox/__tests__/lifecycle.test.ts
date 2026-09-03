import type {
  PageToolCatalogV1,
  PageToolLifecycleEvent,
  PageToolLifecycleReduction,
  PageToolLifecycleState,
} from '../index'
import {
  createPageToolAuthority,
  createPageToolLifecycleState,
  reducePageToolLifecycle,
} from '../index'
import {
  createPageToolFixtureBinding,
  createPageToolFixtureCatalog,
} from './fixtures'

function reduceAccepted(
  state: PageToolLifecycleState,
  event: PageToolLifecycleEvent,
  catalog: PageToolCatalogV1,
): PageToolLifecycleState {
  const result = reducePageToolLifecycle(state, event, catalog)
  if (result.effect === 'rejected')
    throw new Error(result.reason)
  return result.state
}

function createActiveState(catalog: PageToolCatalogV1, mode = 'initial'): PageToolLifecycleState {
  let state = createPageToolLifecycleState(createPageToolFixtureBinding(catalog))
  state = reduceAccepted(state, {
    type: 'APPLY',
    authority: state.authority,
    operationId: 'apply-1',
    settings: { mode },
  }, catalog)
  return reduceAccepted(state, {
    type: 'APPLY_SUCCEEDED',
    authority: state.authority,
    operationId: 'apply-1',
  }, catalog)
}

function expectRejected(result: PageToolLifecycleReduction, reason: string) {
  expect(result).toMatchObject({ effect: 'rejected', reason })
}

describe('page Toolbox seven-state lifecycle reducer', () => {
  it('applies once and treats duplicate apply commands as idempotent', () => {
    const catalog = createPageToolFixtureCatalog()
    const initial = createPageToolLifecycleState(createPageToolFixtureBinding(catalog))
    const callerSettings = { mode: 'temporary' }
    const applying = reducePageToolLifecycle(initial, {
      type: 'APPLY',
      authority: initial.authority,
      operationId: 'apply-1',
      settings: callerSettings,
    }, catalog)
    expect(applying).toMatchObject({ effect: 'transitioned', state: { phase: 'applying' } })
    expect(initial.phase).toBe('inactive')
    callerSettings.mode = 'caller-mutated'
    expect(applying.state.operation).toMatchObject({ candidateSettings: { mode: 'temporary' } })

    const duplicate = reducePageToolLifecycle(applying.state, {
      type: 'APPLY',
      authority: applying.state.authority,
      operationId: 'apply-1',
      settings: { mode: 'temporary' },
    }, catalog)
    expect(duplicate).toEqual({ effect: 'idempotent', state: applying.state })

    const active = reducePageToolLifecycle(applying.state, {
      type: 'APPLY_SUCCEEDED',
      authority: applying.state.authority,
      operationId: 'apply-1',
    }, catalog)
    expect(active).toMatchObject({
      effect: 'transitioned',
      state: { phase: 'active', currentSettings: { mode: 'temporary' }, operation: null },
    })
    expect(reducePageToolLifecycle(active.state, {
      type: 'APPLY',
      authority: active.state.authority,
      operationId: 'apply-again',
      settings: { mode: 'temporary' },
    }, catalog)).toEqual({ effect: 'idempotent', state: active.state })
  })

  it('rejects malformed settings without changing lifecycle authority', () => {
    const catalog = createPageToolFixtureCatalog()
    const initial = createPageToolLifecycleState(createPageToolFixtureBinding(catalog))
    const result = reducePageToolLifecycle(initial, {
      type: 'APPLY',
      authority: initial.authority,
      operationId: 'apply-invalid',
      settings: { mode: () => 'code' },
    }, catalog)
    expectRejected(result, 'invalid-settings')
    expect(result.state).toBe(initial)
  })

  it('publishes updates atomically only after matching completion', () => {
    const catalog = createPageToolFixtureCatalog()
    const active = createActiveState(catalog)
    const updating = reduceAccepted(active, {
      type: 'UPDATE',
      authority: active.authority,
      operationId: 'update-1',
      settings: { mode: 'candidate' },
    }, catalog)
    expect(updating).toMatchObject({
      phase: 'updating',
      currentSettings: { mode: 'initial' },
      operation: { kind: 'update', candidateSettings: { mode: 'candidate' } },
    })
    const completed = reduceAccepted(updating, {
      type: 'UPDATE_SUCCEEDED',
      authority: updating.authority,
      operationId: 'update-1',
    }, catalog)
    expect(completed).toMatchObject({
      phase: 'active',
      currentSettings: { mode: 'candidate' },
      operation: null,
    })
    expect(active.currentSettings).toEqual({ mode: 'initial' })
  })

  it('rolls failed updates back without publishing candidates', () => {
    const catalog = createPageToolFixtureCatalog()
    const active = createActiveState(catalog)
    const updating = reduceAccepted(active, {
      type: 'UPDATE',
      authority: active.authority,
      operationId: 'update-rollback',
      settings: { mode: 'candidate' },
    }, catalog)
    const rolledBack = reduceAccepted(updating, {
      type: 'UPDATE_ROLLED_BACK',
      authority: updating.authority,
      operationId: 'update-rollback',
    }, catalog)
    expect(rolledBack).toMatchObject({
      phase: 'active',
      currentSettings: { mode: 'initial' },
      lastFailure: 'update-rollback',
    })
  })

  it('makes unrecoverable failure terminal and rejects late completion', () => {
    const catalog = createPageToolFixtureCatalog()
    const active = createActiveState(catalog)
    const updating = reduceAccepted(active, {
      type: 'UPDATE',
      authority: active.authority,
      operationId: 'update-fail',
      settings: { mode: 'candidate' },
    }, catalog)
    const failed = reduceAccepted(updating, {
      type: 'UPDATE_FAILED',
      authority: updating.authority,
      operationId: 'update-fail',
    }, catalog)
    expect(failed).toMatchObject({
      phase: 'failed',
      terminalCause: 'failure',
      lastFailure: 'update-failed',
      currentSettings: { mode: 'initial' },
    })
    expectRejected(reducePageToolLifecycle(failed, {
      type: 'UPDATE_SUCCEEDED',
      authority: failed.authority,
      operationId: 'update-fail',
    }, catalog), 'terminal')
  })

  it('uses first-terminal-wins disposal and invalidates superseded completions', () => {
    const catalog = createPageToolFixtureCatalog()
    const initial = createPageToolLifecycleState(createPageToolFixtureBinding(catalog))
    const applying = reduceAccepted(initial, {
      type: 'APPLY',
      authority: initial.authority,
      operationId: 'apply-pending',
      settings: { mode: 'pending' },
    }, catalog)
    const disposing = reduceAccepted(applying, {
      type: 'DISPOSE',
      authority: applying.authority,
      operationId: 'dispose-first',
      reason: 'disabled',
    }, catalog)
    expect(disposing).toMatchObject({
      phase: 'disposing',
      terminalCause: 'disabled',
      operation: { operationId: 'dispose-first', reason: 'disabled' },
    })
    expect(reducePageToolLifecycle(disposing, {
      type: 'DISPOSE',
      authority: disposing.authority,
      operationId: 'dispose-late',
      reason: 'origin-revoked',
    }, catalog)).toEqual({ effect: 'idempotent', state: disposing })
    expectRejected(reducePageToolLifecycle(disposing, {
      type: 'APPLY_SUCCEEDED',
      authority: disposing.authority,
      operationId: 'apply-pending',
    }, catalog), 'operation-mismatch')
    const disposed = reduceAccepted(disposing, {
      type: 'DISPOSE_SUCCEEDED',
      authority: disposing.authority,
      operationId: 'dispose-first',
    }, catalog)
    expect(disposed).toMatchObject({ phase: 'disposed', terminalCause: 'disabled', currentSettings: null })
  })

  it('rejects duplicate and concurrent operation substitution', () => {
    const catalog = createPageToolFixtureCatalog()
    const active = createActiveState(catalog)
    const updating = reduceAccepted(active, {
      type: 'UPDATE',
      authority: active.authority,
      operationId: 'update-current',
      settings: { mode: 'candidate' },
    }, catalog)
    expect(reducePageToolLifecycle(updating, {
      type: 'UPDATE',
      authority: updating.authority,
      operationId: 'update-current',
      settings: { mode: 'candidate' },
    }, catalog)).toEqual({ effect: 'idempotent', state: updating })
    expectRejected(reducePageToolLifecycle(updating, {
      type: 'UPDATE',
      authority: updating.authority,
      operationId: 'update-replacement',
      settings: { mode: 'replacement' },
    }, catalog), 'operation-active')
    expectRejected(reducePageToolLifecycle(updating, {
      type: 'UPDATE_SUCCEEDED',
      authority: updating.authority,
      operationId: 'update-replacement',
    }, catalog), 'operation-mismatch')
    const complete = reduceAccepted(updating, {
      type: 'UPDATE_SUCCEEDED',
      authority: updating.authority,
      operationId: 'update-current',
    }, catalog)
    expectRejected(reducePageToolLifecycle(complete, {
      type: 'UPDATE_SUCCEEDED',
      authority: complete.authority,
      operationId: 'update-current',
    }, catalog), 'operation-mismatch')
  })

  it('rejects cross-origin, cross-tool and stale-generation authority', () => {
    const catalog = createPageToolFixtureCatalog()
    const binding = createPageToolFixtureBinding(catalog)
    const state = createPageToolLifecycleState(binding)
    const foreignAuthorities = [
      createPageToolAuthority(createPageToolFixtureBinding(catalog, { exactOrigin: 'https://other.test' })),
      createPageToolAuthority(createPageToolFixtureBinding(catalog, { toolId: 'tool-1' })),
      createPageToolAuthority(createPageToolFixtureBinding(catalog, { generation: 2 })),
    ]
    for (const authority of foreignAuthorities) {
      expectRejected(reducePageToolLifecycle(state, {
        type: 'APPLY',
        authority,
        operationId: 'foreign-apply',
        settings: { mode: 'foreign' },
      }, catalog), 'authority-mismatch')
    }
    expect(state.phase).toBe('inactive')
  })

  it('keeps concurrent lifecycle instances isolated even with matching operation IDs', () => {
    const catalog = createPageToolFixtureCatalog()
    const first = createPageToolLifecycleState(createPageToolFixtureBinding(catalog))
    const second = createPageToolLifecycleState(createPageToolFixtureBinding(catalog, {
      exactOrigin: 'https://second.test',
      generation: 7,
    }))
    const firstApplying = reduceAccepted(first, {
      type: 'APPLY',
      authority: first.authority,
      operationId: 'same-operation',
      settings: { mode: 'first' },
    }, catalog)
    expectRejected(reducePageToolLifecycle(second, {
      type: 'APPLY_SUCCEEDED',
      authority: first.authority,
      operationId: 'same-operation',
    }, catalog), 'authority-mismatch')
    expect(second.phase).toBe('inactive')
    expect(firstApplying.phase).toBe('applying')
  })

  it('keeps lifecycle state and canonical settings immutable', () => {
    const catalog = createPageToolFixtureCatalog()
    const active = createActiveState(catalog)
    expect(Object.isFrozen(active)).toBe(true)
    expect(Object.isFrozen(active.authority)).toBe(true)
    expect(Object.isFrozen(active.currentSettings)).toBe(true)
    expect(() => {
      ;(active.currentSettings as { mode: string }).mode = 'mutated'
    }).toThrow()
  })
})
