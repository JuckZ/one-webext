import type {
  PageToolboxContentPort,
  PageToolboxRuntimeBindingV1,
} from '..'
import {
  createPageToolboxControlResult,
  createPageToolboxDispose,
  createPageToolboxInit,
  createPageToolboxSync,
  PageToolboxContentRuntime,
} from '..'

class ListenerEvent<Listener extends (..._args: any[]) => void> {
  readonly listeners = new Set<Listener>()
  addListener = (listener: Listener) => this.listeners.add(listener)
  removeListener = (listener: Listener) => this.listeners.delete(listener)
  emit(...args: Parameters<Listener>) {
    for (const listener of [...this.listeners])
      listener(...args)
  }
}

function runtimeHarness(entropyByte = 1) {
  const messages: unknown[] = []
  const onMessage = new ListenerEvent<(_message: unknown) => void>()
  const onDisconnect = new ListenerEvent<() => void>()
  const port: PageToolboxContentPort = {
    onMessage,
    onDisconnect,
    postMessage: vi.fn(message => messages.push(structuredClone(message))),
    disconnect: vi.fn(() => onDisconnect.emit()),
  }
  const disposed = vi.fn()
  const connected = vi.fn()
  const tools = vi.fn()
  const controlResults = vi.fn()
  const runtime = new PageToolboxContentRuntime({
    connect: vi.fn(() => port),
    entropy: () => new Uint8Array(24).fill(entropyByte),
    onConnected: connected,
    onTools: tools,
    onControlResult: controlResults,
    onDispose: disposed,
  })
  return { connected, controlResults, disposed, messages, onDisconnect, onMessage, port, runtime, tools }
}

function binding(generation = 1): PageToolboxRuntimeBindingV1 {
  return {
    moduleId: 'dev.oneweb.page-toolbox',
    exactOrigin: 'https://example.com',
    tabId: 1,
    frameId: 0,
    navigationId: `navigation:${generation}`,
    generation,
  }
}

describe('page Toolbox packaged content lifecycle runtime', () => {
  it('performs one challenge-bound init and ready handshake', () => {
    const harness = runtimeHarness()
    expect(harness.runtime.start()).toBe(true)
    expect(harness.runtime.start()).toBe(false)
    expect(harness.runtime.status).toBe('hello-sent')
    const hello = harness.messages[0] as { challenge: string }
    expect(hello.challenge).toBe('01'.repeat(24))

    harness.onMessage.emit(createPageToolboxInit(hello.challenge, '02'.repeat(24), binding()))
    expect(harness.runtime.status).toBe('connected')
    expect(harness.runtime.currentBinding).toEqual(binding())
    expect(harness.connected).toHaveBeenCalledWith(binding(), [])
    expect(harness.messages[1]).toMatchObject({
      type: 'PAGE_TOOLBOX_READY',
      sessionNonce: '02'.repeat(24),
      binding: binding(),
    })
  })

  it('fails closed on forged or duplicate init and clears callback authority', () => {
    const forged = runtimeHarness()
    forged.runtime.start()
    forged.onMessage.emit(createPageToolboxInit('09'.repeat(24), '02'.repeat(24), binding()))
    expect(forged.runtime.status).toBe('destroyed')
    expect(forged.port.disconnect).toHaveBeenCalledOnce()
    expect(forged.connected).not.toHaveBeenCalled()

    const duplicate = runtimeHarness()
    duplicate.runtime.start()
    const challenge = (duplicate.messages[0] as { challenge: string }).challenge
    duplicate.onMessage.emit(createPageToolboxInit(challenge, '02'.repeat(24), binding()))
    duplicate.onMessage.emit(createPageToolboxInit(challenge, '03'.repeat(24), binding(2)))
    expect(duplicate.runtime.status).toBe('destroyed')
    expect(duplicate.disposed).toHaveBeenLastCalledWith('port-loss')
  })

  it('accepts only the current session dispose and acknowledges before disconnect', () => {
    const harness = runtimeHarness()
    harness.runtime.start()
    const challenge = (harness.messages[0] as { challenge: string }).challenge
    harness.onMessage.emit(createPageToolboxInit(challenge, '02'.repeat(24), binding()))
    harness.onMessage.emit(createPageToolboxDispose('03'.repeat(24), binding(), 'navigation'))
    expect(harness.runtime.status).toBe('connected')

    harness.onMessage.emit(createPageToolboxDispose('02'.repeat(24), binding(), 'navigation'))
    expect(harness.runtime.status).toBe('destroyed')
    expect(harness.messages.at(-1)).toMatchObject({ type: 'PAGE_TOOLBOX_DISPOSED' })
    expect(harness.disposed).toHaveBeenCalledWith('navigation')
    expect(harness.port.disconnect).toHaveBeenCalledOnce()
  })

  it('accepts only increasing canonical plan revisions for the authenticated session', () => {
    const harness = runtimeHarness()
    harness.runtime.start()
    const challenge = (harness.messages[0] as { challenge: string }).challenge
    const plans = [{ toolId: 'password-visibility', settings: { gesture: 'double-click' } }] as const
    harness.onMessage.emit(createPageToolboxInit(challenge, '02'.repeat(24), binding(), 3, plans))
    harness.onMessage.emit(createPageToolboxSync('02'.repeat(24), binding(), 3, plans))
    expect(harness.tools).not.toHaveBeenCalled()

    const updated = [{ toolId: 'password-visibility', settings: { gesture: 'triple-click' } }] as const
    harness.onMessage.emit(createPageToolboxSync('02'.repeat(24), binding(), 4, updated))
    expect(harness.tools).toHaveBeenCalledWith(updated, binding())
    expect(harness.messages.at(-1)).toMatchObject({ type: 'PAGE_TOOLBOX_SYNCED', planRevision: 4 })

    harness.onMessage.emit(createPageToolboxSync('03'.repeat(24), binding(), 5, plans))
    expect(harness.tools).toHaveBeenCalledOnce()
  })

  it('binds one pending control action to the current session and accepts its first exact result', () => {
    const harness = runtimeHarness()
    harness.runtime.start()
    const challenge = (harness.messages[0] as { challenge: string }).challenge
    harness.onMessage.emit(createPageToolboxInit(challenge, '02'.repeat(24), binding()))
    const actionId = harness.runtime.requestToolToggle('password-visibility', true)
    expect(actionId).toMatch(/^shadow:1:1:/)
    expect(harness.messages.at(-1)).toEqual(expect.objectContaining({
      type: 'PAGE_TOOLBOX_CONTROL_TOGGLE',
      sessionNonce: '02'.repeat(24),
      binding: binding(),
      actionId,
      toolId: 'password-visibility',
      enabled: true,
    }))
    expect(JSON.stringify(harness.messages.at(-1))).not.toContain('settings')
    expect(harness.runtime.requestToolToggle('free-page-edit', true)).toBeNull()

    harness.onMessage.emit(createPageToolboxControlResult(
      '02'.repeat(24),
      binding(),
      'shadow:1:forged',
      'password-visibility',
      true,
      { ok: true, changed: true },
    ))
    expect(harness.controlResults).not.toHaveBeenCalled()
    harness.onMessage.emit(createPageToolboxControlResult(
      '02'.repeat(24),
      binding(),
      actionId!,
      'password-visibility',
      true,
      { ok: true, changed: true },
    ))
    expect(harness.controlResults).toHaveBeenCalledOnce()
    expect(harness.controlResults).toHaveBeenCalledWith(expect.objectContaining({ actionId, ok: true }))
    harness.onMessage.emit(createPageToolboxControlResult(
      '02'.repeat(24),
      binding(),
      actionId!,
      'password-visibility',
      true,
      { ok: true, changed: true },
    ))
    expect(harness.controlResults).toHaveBeenCalledOnce()
  })

  it('drops pending action authority on destroy and rejects old protocol generations', () => {
    const harness = runtimeHarness()
    harness.runtime.start()
    const challenge = (harness.messages[0] as { challenge: string }).challenge
    const legacyInit = { ...createPageToolboxInit(challenge, '02'.repeat(24), binding()), version: 2 }
    harness.onMessage.emit(legacyInit)
    expect(harness.runtime.status).toBe('hello-sent')
    harness.onMessage.emit(createPageToolboxInit(challenge, '02'.repeat(24), binding()))
    const actionId = harness.runtime.requestToolToggle('free-page-edit', true)!
    expect(harness.runtime.destroy('worker-restart')).toBe(true)
    harness.onMessage.emit(createPageToolboxControlResult(
      '02'.repeat(24),
      binding(),
      actionId,
      'free-page-edit',
      true,
      { ok: false, reason: 'lifecycle-cancelled' },
    ))
    expect(harness.controlResults).not.toHaveBeenCalled()
    expect(harness.runtime.requestToolToggle('free-page-edit', false)).toBeNull()
  })

  it('handles port loss and destroy idempotently while ignoring late messages', () => {
    const harness = runtimeHarness()
    harness.runtime.start()
    harness.onDisconnect.emit()
    expect(harness.runtime.status).toBe('destroyed')
    expect(harness.disposed).toHaveBeenCalledOnce()
    expect(harness.disposed).toHaveBeenCalledWith('port-loss')
    expect(harness.runtime.destroy()).toBe(false)
    harness.onMessage.emit(createPageToolboxInit('01'.repeat(24), '02'.repeat(24), binding()))
    expect(harness.connected).not.toHaveBeenCalled()
  })

  it('keeps concurrent runtime instances and port cleanup isolated', () => {
    const first = runtimeHarness(1)
    const second = runtimeHarness(2)
    first.runtime.start()
    second.runtime.start()
    first.runtime.destroy('disabled')
    expect(first.runtime.status).toBe('destroyed')
    expect(second.runtime.status).toBe('hello-sent')
    expect(first.disposed).toHaveBeenCalledWith('disabled')
    expect(second.disposed).not.toHaveBeenCalled()
  })
})
