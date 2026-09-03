import type {
  CapabilityRpcClient,
  CapabilityRpcClientPortEventType,
  CapabilityRpcClientPortListener,
  CapabilityRpcRequestEnvelope,
  CapabilityRpcResultEnvelope,
  CapabilityRpcSessionBinding,
} from '@oneweb/module-sdk'
import {
  capabilityRpcSchema,
  createCapabilityRpcClient,
  defineCapabilityRpcCatalog,
} from '@oneweb/module-sdk'
import { createModuleCapabilityDispatcher } from '../../capability-dispatcher'

export const conformanceRpcCatalog = defineCapabilityRpcCatalog({
  'conformance.echo': {
    operations: {
      echo: {
        request: capabilityRpcSchema.object({
          text: capabilityRpcSchema.string({ maximumLength: 256 }),
        }),
        result: capabilityRpcSchema.object({
          echoed: capabilityRpcSchema.string({ maximumLength: 256 }),
        }),
      },
      sum: {
        request: capabilityRpcSchema.object({
          values: capabilityRpcSchema.array(
            capabilityRpcSchema.number({ minimum: -10_000, maximum: 10_000 }),
            { maximumItems: 16 },
          ),
        }),
        result: capabilityRpcSchema.object({
          total: capabilityRpcSchema.number(),
        }),
      },
    },
  },
} as const)

export type ConformanceRpcCatalog = typeof conformanceRpcCatalog

interface HeldEcho {
  resolve: (_result: { echoed: string }) => void
  signal: AbortSignal
}

class CoupledClientPort {
  readonly clientMessages: unknown[] = []
  readonly hostMessages: unknown[] = []
  private readonly listeners = new Map<
    CapabilityRpcClientPortEventType,
    Set<CapabilityRpcClientPortListener>
  >()
  private hostDispatch: ((_value: unknown) => boolean) | null = null

  readonly hostPort = {
    postMessage: (message: unknown) => {
      const cloned = structuredClone(message)
      this.hostMessages.push(cloned)
      queueMicrotask(() => this.emit('message', cloned))
    },
  }

  addEventListener(type: CapabilityRpcClientPortEventType, listener: CapabilityRpcClientPortListener) {
    const listeners = this.listeners.get(type) || new Set()
    listeners.add(listener)
    this.listeners.set(type, listeners)
  }

  removeEventListener(type: CapabilityRpcClientPortEventType, listener: CapabilityRpcClientPortListener) {
    this.listeners.get(type)?.delete(listener)
  }

  postMessage(message: unknown) {
    const cloned = structuredClone(message)
    this.clientMessages.push(cloned)
    queueMicrotask(() => this.hostDispatch?.(cloned))
  }

  bindHost(dispatch: (_value: unknown) => boolean) {
    this.hostDispatch = dispatch
  }

  injectHost(message: unknown) {
    const cloned = structuredClone(message)
    this.hostMessages.push(cloned)
    queueMicrotask(() => this.emit('message', cloned))
  }

  fail() {
    this.emit('messageerror', null)
  }

  private emit(type: CapabilityRpcClientPortEventType, data: unknown) {
    for (const listener of [...(this.listeners.get(type) || [])])
      listener({ data })
  }
}

export interface ConformanceRpcPair {
  aborts: number
  binding: CapabilityRpcSessionBinding
  client: CapabilityRpcClient<ConformanceRpcCatalog>
  clientMessages: unknown[]
  completeHeld: (_text?: string) => void
  destroy: () => void
  dispatcher: ReturnType<typeof createModuleCapabilityDispatcher<ConformanceRpcCatalog>>
  failPort: () => void
  handlerCalls: number
  heldSignals: readonly AbortSignal[]
  hostMessages: unknown[]
  injectHost: (_message: unknown) => void
  requests: () => CapabilityRpcRequestEnvelope[]
  results: () => CapabilityRpcResultEnvelope[]
}

export function createConformanceRpcPair(
  moduleId: string,
  generation: number,
): ConformanceRpcPair {
  const binding = Object.freeze({
    moduleId,
    sessionId: `session_${moduleId.replaceAll('.', '_')}_${String(generation).padStart(8, '0')}`,
    generation,
  })
  const port = new CoupledClientPort()
  const held: HeldEcho[] = []
  let aborts = 0
  let handlerCalls = 0
  const dispatcher = createModuleCapabilityDispatcher({
    binding,
    catalog: conformanceRpcCatalog,
    manifestCapabilities: ['conformance.echo'],
    grantedCapabilities: ['conformance.echo'],
    handlers: {
      'conformance.echo': {
        echo: ({ payload, signal }) => {
          handlerCalls += 1
          if (payload.text === 'fail')
            throw new Error('test-only handler failure')
          if (payload.text === 'invalid-result')
            return { echoed: 42 } as never
          if (payload.text.startsWith('hold')) {
            return new Promise((resolve) => {
              held.push({ resolve, signal })
              signal.addEventListener('abort', () => {
                aborts += 1
              }, { once: true })
            })
          }
          return { echoed: payload.text }
        },
        sum: ({ payload }) => {
          handlerCalls += 1
          return { total: payload.values.reduce((total, value) => total + value, 0) }
        },
      },
    },
    port: port.hostPort,
  })
  port.bindHost(value => dispatcher.dispatch(value))
  const client = createCapabilityRpcClient({ binding, catalog: conformanceRpcCatalog, port })

  return {
    get aborts() {
      return aborts
    },
    binding,
    client,
    clientMessages: port.clientMessages,
    completeHeld(text = 'released') {
      held.shift()?.resolve({ echoed: text })
    },
    destroy() {
      client.destroy()
      dispatcher.destroy()
    },
    dispatcher,
    failPort() {
      dispatcher.destroy()
      port.fail()
    },
    get handlerCalls() {
      return handlerCalls
    },
    get heldSignals() {
      return held.map(item => item.signal)
    },
    hostMessages: port.hostMessages,
    injectHost(message) {
      port.injectHost(message)
    },
    requests() {
      return port.clientMessages.filter((message): message is CapabilityRpcRequestEnvelope => (
        Boolean(message && typeof message === 'object' && (message as { type?: unknown }).type === 'CAPABILITY_REQUEST')
      ))
    },
    results() {
      return port.hostMessages.filter((message): message is CapabilityRpcResultEnvelope => (
        Boolean(message && typeof message === 'object' && (message as { type?: unknown }).type === 'CAPABILITY_RESULT')
      ))
    },
  }
}

export async function settleConformanceRpc() {
  for (let index = 0; index < 8; index += 1)
    await Promise.resolve()
}
