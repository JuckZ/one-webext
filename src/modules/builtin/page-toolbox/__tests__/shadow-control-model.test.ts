import type { PageToolboxRuntimeBindingV1 } from '..'
import {
  createPageToolboxShadowControlState,
  reducePageToolboxShadowControl,
} from '..'

function binding(generation = 1, exactOrigin = 'https://alpha.example'): PageToolboxRuntimeBindingV1 {
  return {
    moduleId: 'dev.oneweb.page-toolbox',
    exactOrigin,
    tabId: generation,
    frameId: 0,
    navigationId: `document:${generation}`,
    generation,
  }
}

const password = { toolId: 'password-visibility', settings: { gesture: 'double-click' } } as const

describe('page Toolbox Shadow control pure state', () => {
  it('creates an immutable finite enabled-tool projection', () => {
    const plans = [
      { toolId: 'selection-copy-release', settings: { selection: true, copy: true, contextMenu: false } },
      password,
    ]
    const state = createPageToolboxShadowControlState(binding(), plans)
    expect(state).toMatchObject({
      phase: 'active',
      enabledToolIds: ['password-visibility', 'selection-copy-release'],
      pending: null,
    })
    expect(Object.isFrozen(state)).toBe(true)
    expect(Object.isFrozen(state?.enabledToolIds)).toBe(true)
    ;(plans[0] as { toolId: string }).toolId = 'free-page-edit'
    expect(state?.enabledToolIds).toEqual(['password-visibility', 'selection-copy-release'])
    expect(createPageToolboxShadowControlState(binding(), [{ toolId: 'unknown', settings: {} }])).toBeNull()
  })

  it('binds one pending toggle to the exact action identity and accepts its first terminal only', () => {
    const initial = createPageToolboxShadowControlState(binding(), [])!
    const pending = reducePageToolboxShadowControl(initial, {
      type: 'request-toggle',
      binding: binding(),
      actionId: 'shadow:1:alpha',
      toolId: 'password-visibility',
      enabled: true,
    })
    expect(pending).toMatchObject({
      effect: 'transitioned',
      state: { phase: 'pending', pending: { actionId: 'shadow:1:alpha' } },
    })
    expect(reducePageToolboxShadowControl(pending.state, {
      type: 'request-toggle',
      binding: binding(),
      actionId: 'shadow:1:beta',
      toolId: 'free-page-edit',
      enabled: true,
    }).effect).toBe('rejected')
    expect(reducePageToolboxShadowControl(pending.state, {
      type: 'action-accepted',
      binding: binding(),
      actionId: 'shadow:1:forged',
      toolId: 'password-visibility',
      enabled: true,
    }).effect).toBe('rejected')

    const accepted = reducePageToolboxShadowControl(pending.state, {
      type: 'action-accepted',
      binding: binding(),
      actionId: 'shadow:1:alpha',
      toolId: 'password-visibility',
      enabled: true,
    })
    expect(accepted).toMatchObject({
      effect: 'transitioned',
      state: { phase: 'active', enabledToolIds: ['password-visibility'], pending: null },
    })
    expect(reducePageToolboxShadowControl(accepted.state, {
      type: 'action-accepted',
      binding: binding(),
      actionId: 'shadow:1:alpha',
      toolId: 'password-visibility',
      enabled: true,
    }).effect).toBe('rejected')
  })

  it('accepts authenticated plan sync while pending and keeps the result terminal separate', () => {
    const initial = createPageToolboxShadowControlState(binding(), [])!
    const pending = reducePageToolboxShadowControl(initial, {
      type: 'request-toggle',
      binding: binding(),
      actionId: 'shadow:1:sync',
      toolId: 'password-visibility',
      enabled: true,
    }).state
    const synchronized = reducePageToolboxShadowControl(pending, {
      type: 'plans-updated',
      binding: binding(),
      plans: [password],
    })
    expect(synchronized).toMatchObject({
      effect: 'transitioned',
      state: { phase: 'pending', enabledToolIds: ['password-visibility'] },
    })
    const accepted = reducePageToolboxShadowControl(synchronized.state, {
      type: 'action-accepted',
      binding: binding(),
      actionId: 'shadow:1:sync',
      toolId: 'password-visibility',
      enabled: true,
    })
    expect(accepted.state.phase).toBe('active')
  })

  it('projects stable errors and rejects cross-origin, generation and malformed actions', () => {
    const initial = createPageToolboxShadowControlState(binding(), [])!
    for (const invalid of [
      { binding: binding(2), actionId: 'shadow:1:x', toolId: 'password-visibility', enabled: true },
      { binding: binding(), actionId: 'bad action id', toolId: 'password-visibility', enabled: true },
      { binding: binding(), actionId: 'shadow:1:x', toolId: 'unknown', enabled: true },
    ]) {
      expect(reducePageToolboxShadowControl(initial, { type: 'request-toggle', ...invalid }).effect).toBe('rejected')
    }
    const pending = reducePageToolboxShadowControl(initial, {
      type: 'request-toggle',
      binding: binding(),
      actionId: 'shadow:1:error',
      toolId: 'free-page-edit',
      enabled: true,
    }).state
    const failed = reducePageToolboxShadowControl(pending, {
      type: 'action-rejected',
      binding: binding(),
      actionId: 'shadow:1:error',
      toolId: 'free-page-edit',
      enabled: true,
      reason: 'permission-missing',
    })
    expect(failed.state).toMatchObject({ phase: 'error', error: 'permission-missing', pending: null })
    expect(reducePageToolboxShadowControl(failed.state, {
      type: 'clear-error',
      binding: binding(),
    }).state.phase).toBe('active')
  })

  it('makes dispose generation-bound and terminal', () => {
    const first = createPageToolboxShadowControlState(binding(), [password])!
    const peer = createPageToolboxShadowControlState(binding(2, 'https://beta.example'), [])!
    expect(reducePageToolboxShadowControl(first, { type: 'dispose', binding: binding(2) }).effect).toBe('rejected')
    const disposed = reducePageToolboxShadowControl(first, { type: 'dispose', binding: binding() })
    expect(disposed.state).toMatchObject({ phase: 'disposed', pending: null, enabledToolIds: ['password-visibility'] })
    expect(reducePageToolboxShadowControl(disposed.state, {
      type: 'plans-updated',
      binding: binding(),
      plans: [],
    }).effect).toBe('rejected')
    expect(peer.phase).toBe('active')
  })
})
