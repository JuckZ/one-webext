import type { CapabilityRpcSessionBinding } from '@oneweb/module-sdk'
import {
  capabilityRpcSchema,
  createCapabilityRpcRequestEnvelope,
  defineCapabilityRpcCatalog,
} from '@oneweb/module-sdk'
import { ModuleFrameHost, selectGrantedModuleContexts } from '../frame-host'
import { createRepoLensSeed } from '../seeds/repolens'

const frameCapabilityCatalog = defineCapabilityRpcCatalog({
  'conformance.echo': {
    operations: {
      conformance: {
        request: capabilityRpcSchema.object({
          marker: capabilityRpcSchema.string({ maximumLength: 32 }),
        }),
        result: capabilityRpcSchema.object({
          accepted: capabilityRpcSchema.boolean,
        }),
      },
    },
  },
} as const)

function repoLensRecord() {
  const seed = createRepoLensSeed()
  return {
    manifest: seed.manifest,
    enabled: true,
    source: 'seeded' as const,
    grantedContexts: seed.grantedContexts,
    grantedContextFields: seed.grantedContextFields,
    grantedCapabilities: seed.grantedCapabilities,
    update: null,
    installedAt: '2026-08-26T00:00:00.000Z',
    updatedAt: '2026-08-26T00:00:00.000Z',
  }
}

function conformanceFrameRecord(moduleId: string, origin: string) {
  const record = repoLensRecord()
  if (record.manifest.runtime !== 'remote-frame')
    throw new Error('test record must use remote-frame runtime')
  record.manifest = {
    ...record.manifest,
    id: moduleId,
    name: moduleId,
    entry_url: `${origin}/rpc-frame`,
    icon_url: `${origin}/icon.svg`,
    capabilities: ['conformance.echo' as never],
  }
  record.grantedCapabilities = ['conformance.echo' as never]
  return record
}

function dispatchFrameHello(
  hostWindow: Window,
  frame: HTMLIFrameElement,
  origin: string,
  moduleId: string,
  challenge: string,
) {
  const hello = new Event('message')
  Object.defineProperties(hello, {
    origin: { value: origin },
    source: { value: frame.contentWindow },
    data: {
      value: {
        protocol: 'oneweb.module',
        version: 1,
        moduleId,
        type: 'MODULE_HELLO',
        challenge,
      },
    },
  })
  hostWindow.dispatchEvent(hello)
}

describe('module frame host', () => {
  it('delivers only fields declared by the manifest and present in installed grants', () => {
    const record = repoLensRecord()
    record.grantedContextFields = { 'github.repository': ['repo'] }
    expect(selectGrantedModuleContexts(record, {
      'github.repository': {
        repo: 'vuejs/core',
        url: 'https://github.com/vuejs/core',
        pageType: 'repository',
        privateBody: 'must-not-pass',
      },
      'page.metadata': { title: 'must-not-pass' },
    })).toEqual({
      'github.repository': { repo: 'vuejs/core' },
    })
  })

  it('keeps a hello received before the initial frame load alive across async init fields', async () => {
    const frame = document.createElement('iframe')
    document.body.appendChild(frame)
    const hostWindow = new EventTarget() as Window
    let finishInit: (_fields: Record<string, unknown>) => void = () => {}
    const initFields = new Promise<Record<string, unknown>>((resolve) => {
      finishInit = resolve
    })
    const host = new ModuleFrameHost({
      frame,
      record: repoLensRecord(),
      extensionOrigin: 'chrome-extension://oneweb',
      window: hostWindow,
      resolveInitFields: () => initFields,
    })

    host.start()
    const postMessage = vi.spyOn(frame.contentWindow!, 'postMessage')
    const hello = new Event('message')
    Object.defineProperties(hello, {
      origin: { value: 'http://127.0.0.1:4747' },
      source: { value: frame.contentWindow },
      data: {
        value: {
          protocol: 'oneweb.module',
          version: 1,
          moduleId: 'dev.juck.repolens',
          type: 'MODULE_HELLO',
          challenge: 'challenge-123',
        },
      },
    })
    hostWindow.dispatchEvent(hello)
    frame.dispatchEvent(new Event('load'))
    finishInit({
      authorizationCode: 'one-time-code',
      capabilityGeneration: 999,
      grantedCapabilities: ['auth.start'],
      sessionNonce: 'attacker-controlled-session',
    })
    await initFields
    await Promise.resolve()

    expect(postMessage).toHaveBeenCalledOnce()
    expect(postMessage.mock.calls[0][0]).toMatchObject({
      type: 'MODULE_INIT',
      challenge: 'challenge-123',
      authorizationCode: 'one-time-code',
      grantedCapabilities: [],
      grantedContextFields: {
        'github.repository': ['repo', 'url', 'pageType'],
      },
    })
    expect(postMessage.mock.calls[0][0]).not.toMatchObject({
      capabilityGeneration: 999,
      sessionNonce: 'attacker-controlled-session',
    })
    const postCalls = postMessage.mock.calls as unknown[][]
    expect(postCalls[0][2]).toHaveLength(1)

    host.destroy()
    frame.remove()
  })

  it('waits for a subsequent frame load before replacing an established session', async () => {
    const frame = document.createElement('iframe')
    document.body.appendChild(frame)
    const hostWindow = new EventTarget() as Window
    const host = new ModuleFrameHost({
      frame,
      record: repoLensRecord(),
      extensionOrigin: 'chrome-extension://oneweb',
      window: hostWindow,
    })
    host.start()
    const postMessage = vi.spyOn(frame.contentWindow!, 'postMessage')

    function dispatchHello(challenge: string) {
      const hello = new Event('message')
      Object.defineProperties(hello, {
        origin: { value: 'http://127.0.0.1:4747' },
        source: { value: frame.contentWindow },
        data: {
          value: {
            protocol: 'oneweb.module',
            version: 1,
            moduleId: 'dev.juck.repolens',
            type: 'MODULE_HELLO',
            challenge,
          },
        },
      })
      hostWindow.dispatchEvent(hello)
    }

    dispatchHello('challenge-first')
    frame.dispatchEvent(new Event('load'))
    await Promise.resolve()
    await Promise.resolve()
    expect(postMessage).toHaveBeenCalledOnce()

    dispatchHello('challenge-after-reload')
    await Promise.resolve()
    expect(postMessage).toHaveBeenCalledOnce()
    frame.dispatchEvent(new Event('load'))
    await Promise.resolve()
    await Promise.resolve()

    expect(postMessage).toHaveBeenCalledTimes(2)
    expect(postMessage.mock.calls[1][0]).toMatchObject({
      type: 'MODULE_INIT',
      challenge: 'challenge-after-reload',
    })

    host.destroy()
    frame.remove()
  })

  it('binds the dispatcher to the authenticated port generation and returns stable unavailable', async () => {
    const frame = document.createElement('iframe')
    document.body.appendChild(frame)
    const hostWindow = new EventTarget() as Window
    const record = repoLensRecord()
    record.manifest.capabilities = ['conformance.echo' as never]
    record.grantedCapabilities = ['conformance.echo' as never]
    let resolveReady: (() => void) | undefined
    const ready = new Promise<void>((resolve) => {
      resolveReady = resolve
    })
    const host = new ModuleFrameHost({
      frame,
      record,
      extensionOrigin: 'chrome-extension://oneweb',
      window: hostWindow,
      capabilityRpc: { catalog: frameCapabilityCatalog },
      onReady: () => resolveReady?.(),
    })
    host.start()
    const postMessage = vi.spyOn(frame.contentWindow!, 'postMessage').mockImplementation(() => {})
    const hello = new Event('message')
    Object.defineProperties(hello, {
      origin: { value: 'http://127.0.0.1:4747' },
      source: { value: frame.contentWindow },
      data: {
        value: {
          protocol: 'oneweb.module',
          version: 1,
          moduleId: 'dev.juck.repolens',
          type: 'MODULE_HELLO',
          challenge: 'challenge-capability',
        },
      },
    })
    hostWindow.dispatchEvent(hello)
    frame.dispatchEvent(new Event('load'))
    await Promise.resolve()
    await Promise.resolve()

    const init = postMessage.mock.calls[0][0] as {
      capabilityGeneration: number
      sessionNonce: string
    }
    expect(init.capabilityGeneration).toBe(1)
    const transferred = (postMessage.mock.calls as unknown[][])[0][2] as MessagePort[]
    const modulePort = transferred[0]
    const responses: unknown[] = []
    modulePort.addEventListener('message', event => responses.push(event.data))
    modulePort.start()
    modulePort.postMessage({
      protocol: 'oneweb.module',
      version: 1,
      moduleId: 'dev.juck.repolens',
      type: 'MODULE_READY',
      sessionNonce: init.sessionNonce,
    })
    await ready
    modulePort.postMessage(createCapabilityRpcRequestEnvelope(
      frameCapabilityCatalog,
      {
        moduleId: 'dev.juck.repolens',
        sessionId: init.sessionNonce,
        generation: init.capabilityGeneration,
        requestId: 'request_frame_12345678',
      },
      'conformance.echo',
      'conformance',
      { marker: 'permission-free' },
    ))
    await vi.waitFor(() => expect(responses).toHaveLength(1))
    expect(responses).toEqual([expect.objectContaining({
      type: 'CAPABILITY_ERROR',
      code: 'CAPABILITY_UNAVAILABLE',
      generation: 1,
    })])

    host.destroy()
    modulePort.close()
    frame.remove()
  })

  it('opens and closes only the authenticated capability binding and closes a late preparation', async () => {
    const origin = 'http://127.0.0.1:4747'
    const moduleId = 'dev.oneweb.conformance.session-lifecycle'
    const frame = document.createElement('iframe')
    document.body.appendChild(frame)
    const hostWindow = new EventTarget() as Window
    let releaseOpen!: () => void
    const openSession = vi.fn((_binding: CapabilityRpcSessionBinding) => new Promise<void>((resolve) => {
      releaseOpen = resolve
    }))
    const closeSession = vi.fn(async () => {})
    const host = new ModuleFrameHost({
      frame,
      record: conformanceFrameRecord(moduleId, origin),
      extensionOrigin: 'chrome-extension://oneweb',
      window: hostWindow,
      capabilityRpc: {
        catalog: frameCapabilityCatalog,
        openSession,
        createHandlers: () => ({
          'conformance.echo': {
            conformance: () => ({ accepted: true }),
          },
        }),
        closeSession,
      },
    })
    host.start()
    const postMessage = vi.spyOn(frame.contentWindow!, 'postMessage').mockImplementation(() => {})
    dispatchFrameHello(hostWindow, frame, origin, moduleId, 'challenge-session-lifecycle')
    frame.dispatchEvent(new Event('load'))
    await vi.waitFor(() => expect(openSession).toHaveBeenCalledOnce())
    const openedBinding = openSession.mock.calls[0][0]
    expect(openedBinding).toMatchObject({ moduleId, generation: 1 })
    expect(openedBinding.sessionId).toHaveLength(32)

    host.destroy()
    releaseOpen()
    await vi.waitFor(() => expect(closeSession).toHaveBeenCalledWith(openedBinding))
    expect(postMessage).not.toHaveBeenCalled()

    frame.remove()
  })

  it('uses session-specific handlers and closes the exact binding on normal teardown', async () => {
    const origin = 'http://127.0.0.1:4747'
    const moduleId = 'dev.oneweb.conformance.session-handlers'
    const frame = document.createElement('iframe')
    document.body.appendChild(frame)
    const hostWindow = new EventTarget() as Window
    const openSession = vi.fn(async (_binding: CapabilityRpcSessionBinding) => {})
    const createHandlers = vi.fn((_binding: CapabilityRpcSessionBinding) => ({
      'conformance.echo': {
        conformance: () => ({ accepted: true }),
      },
    }))
    const closeSession = vi.fn(async () => {})
    const host = new ModuleFrameHost({
      frame,
      record: conformanceFrameRecord(moduleId, origin),
      extensionOrigin: 'chrome-extension://oneweb',
      window: hostWindow,
      capabilityRpc: {
        catalog: frameCapabilityCatalog,
        openSession,
        createHandlers,
        closeSession,
      },
    })
    host.start()
    const postMessage = vi.spyOn(frame.contentWindow!, 'postMessage').mockImplementation(() => {})
    dispatchFrameHello(hostWindow, frame, origin, moduleId, 'challenge-session-handlers')
    frame.dispatchEvent(new Event('load'))
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledOnce())
    const binding = openSession.mock.calls[0][0]
    expect(createHandlers).toHaveBeenCalledWith(binding)
    expect(postMessage.mock.calls[0][0]).toMatchObject({
      capabilityGeneration: binding.generation,
      sessionNonce: binding.sessionId,
    })

    host.destroy()
    await vi.waitFor(() => expect(closeSession).toHaveBeenCalledWith(binding))
    frame.remove()
  })

  it('isolates two authenticated frame dispatchers across reload and stale-port traffic', async () => {
    const alphaId = 'dev.oneweb.conformance.frame-alpha'
    const betaId = 'dev.oneweb.conformance.frame-beta'
    const alphaOrigin = 'http://127.0.0.1:4747'
    const betaOrigin = 'http://127.0.0.1:4848'
    const hostWindow = new EventTarget() as Window
    const alphaFrame = document.createElement('iframe')
    const betaFrame = document.createElement('iframe')
    document.body.append(alphaFrame, betaFrame)
    let alphaAborts = 0
    let alphaCalls = 0
    let betaCalls = 0
    const alphaHost = new ModuleFrameHost({
      frame: alphaFrame,
      record: conformanceFrameRecord(alphaId, alphaOrigin),
      extensionOrigin: 'chrome-extension://oneweb',
      window: hostWindow,
      capabilityRpc: {
        catalog: frameCapabilityCatalog,
        handlers: {
          'conformance.echo': {
            conformance: ({ signal }) => {
              alphaCalls += 1
              signal.addEventListener('abort', () => {
                alphaAborts += 1
              }, { once: true })
              return new Promise(() => {})
            },
          },
        },
      },
    })
    const betaHost = new ModuleFrameHost({
      frame: betaFrame,
      record: conformanceFrameRecord(betaId, betaOrigin),
      extensionOrigin: 'chrome-extension://oneweb',
      window: hostWindow,
      capabilityRpc: {
        catalog: frameCapabilityCatalog,
        handlers: {
          'conformance.echo': {
            conformance: () => {
              betaCalls += 1
              return { accepted: true }
            },
          },
        },
      },
    })
    alphaHost.start()
    betaHost.start()
    const alphaPost = vi.spyOn(alphaFrame.contentWindow!, 'postMessage').mockImplementation(() => {})
    const betaPost = vi.spyOn(betaFrame.contentWindow!, 'postMessage').mockImplementation(() => {})
    dispatchFrameHello(hostWindow, alphaFrame, alphaOrigin, alphaId, 'challenge-alpha-frame')
    dispatchFrameHello(hostWindow, betaFrame, betaOrigin, betaId, 'challenge-beta-frame')
    alphaFrame.dispatchEvent(new Event('load'))
    betaFrame.dispatchEvent(new Event('load'))
    await vi.waitFor(() => {
      expect(alphaPost).toHaveBeenCalledOnce()
      expect(betaPost).toHaveBeenCalledOnce()
    })

    const alphaInit = alphaPost.mock.calls[0][0] as {
      capabilityGeneration: number
      sessionNonce: string
    }
    const betaInit = betaPost.mock.calls[0][0] as {
      capabilityGeneration: number
      sessionNonce: string
    }
    const alphaPort = (alphaPost.mock.calls as unknown[][])[0][2] as MessagePort[]
    const betaPort = (betaPost.mock.calls as unknown[][])[0][2] as MessagePort[]
    const alphaModulePort = alphaPort[0]
    const betaModulePort = betaPort[0]
    const betaResponses: unknown[] = []
    betaModulePort.addEventListener('message', event => betaResponses.push(event.data))
    alphaModulePort.start()
    betaModulePort.start()
    for (const [port, moduleId, init] of [
      [alphaModulePort, alphaId, alphaInit],
      [betaModulePort, betaId, betaInit],
    ] as const) {
      port.postMessage({
        protocol: 'oneweb.module',
        version: 1,
        moduleId,
        type: 'MODULE_READY',
        sessionNonce: init.sessionNonce,
      })
    }
    alphaModulePort.postMessage(createCapabilityRpcRequestEnvelope(
      frameCapabilityCatalog,
      {
        moduleId: alphaId,
        sessionId: alphaInit.sessionNonce,
        generation: alphaInit.capabilityGeneration,
        requestId: 'request_alpha_frame_12345678',
      },
      'conformance.echo',
      'conformance',
      { marker: 'hold-alpha' },
    ))
    betaModulePort.postMessage(createCapabilityRpcRequestEnvelope(
      frameCapabilityCatalog,
      {
        moduleId: betaId,
        sessionId: betaInit.sessionNonce,
        generation: betaInit.capabilityGeneration,
        requestId: 'request_beta_frame_12345678',
      },
      'conformance.echo',
      'conformance',
      { marker: 'beta-success' },
    ))
    await vi.waitFor(() => {
      expect(alphaCalls).toBe(1)
      expect(betaResponses).toHaveLength(1)
    })

    alphaFrame.dispatchEvent(new Event('load'))
    await vi.waitFor(() => expect(alphaAborts).toBe(1))
    alphaModulePort.postMessage(createCapabilityRpcRequestEnvelope(
      frameCapabilityCatalog,
      {
        moduleId: alphaId,
        sessionId: alphaInit.sessionNonce,
        generation: alphaInit.capabilityGeneration,
        requestId: 'request_alpha_stale_12345678',
      },
      'conformance.echo',
      'conformance',
      { marker: 'stale-alpha' },
    ))
    betaModulePort.postMessage(createCapabilityRpcRequestEnvelope(
      frameCapabilityCatalog,
      {
        moduleId: betaId,
        sessionId: betaInit.sessionNonce,
        generation: betaInit.capabilityGeneration,
        requestId: 'request_beta_frame_87654321',
      },
      'conformance.echo',
      'conformance',
      { marker: 'beta-after-alpha-reload' },
    ))
    await vi.waitFor(() => expect(betaResponses).toHaveLength(2))
    expect(alphaCalls).toBe(1)
    expect(betaCalls).toBe(2)
    expect(betaResponses).toEqual([
      expect.objectContaining({
        type: 'CAPABILITY_RESULT',
        moduleId: betaId,
        requestId: 'request_beta_frame_12345678',
      }),
      expect.objectContaining({
        type: 'CAPABILITY_RESULT',
        moduleId: betaId,
        requestId: 'request_beta_frame_87654321',
      }),
    ])

    alphaHost.destroy()
    betaHost.destroy()
    alphaModulePort.close()
    betaModulePort.close()
    alphaFrame.remove()
    betaFrame.remove()
  })
})
