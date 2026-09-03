import type { RemoteFrameModuleManifest } from '@oneweb/module-sdk'
import {
  createStorageModuleReadRequestEnvelope,
  createStorageModuleReplaceRequestEnvelope,
  storageModuleCapabilityCatalog,
} from '@oneweb/module-sdk'
import { createModuleCapabilityDispatcher, ModuleCapabilityHandlerError } from '../capability-dispatcher'
import { ModuleRegistry } from '../registry'
import { StorageModuleAdapter } from '../storage-module-adapter'
import { StorageModuleClient } from '../storage-module-client'
import { StorageModuleController } from '../storage-module-controller'
import {
  createStorageModuleExecuteRequest,
  createStorageModuleProtocolResponse,
  createStorageModuleSessionCloseRequest,
  createStorageModuleSessionOpenRequest,
  validateStorageModuleProtocolRequest,
  validateStorageModuleProtocolResponse,
} from '../storage-module-protocol'

class MemoryStorage {
  state: Record<string, unknown> = {}

  async get(_key: string) {
    return structuredClone(this.state)
  }

  async set(items: Record<string, unknown>) {
    this.state = { ...this.state, ...structuredClone(items) }
  }

  async remove(key: string) {
    delete this.state[key]
  }
}

class FakePort {
  readonly messages: unknown[] = []

  postMessage(message: unknown) {
    this.messages.push(structuredClone(message))
  }
}

const binding = Object.freeze({
  moduleId: 'dev.oneweb.storage.runtime',
  sessionId: 'session_storage_runtime_123456789012345678901234',
  generation: 4,
})

function manifest(): RemoteFrameModuleManifest {
  return {
    manifest_version: 1,
    runtime: 'remote-frame',
    id: binding.moduleId,
    name: 'Storage runtime fixture',
    version: '1.0.0',
    description: 'Storage runtime fixture',
    icon_url: 'https://storage-runtime.example/icon.png',
    entry_url: 'https://storage-runtime.example/embed',
    matches: ['https://storage-runtime.example/*'],
    contexts: [],
    context_fields: {},
    capabilities: ['storage.module'],
    activation: 'manual',
    min_host_version: '0.0.1',
    bridge: { protocol: 'oneweb.module', version: 1 },
  }
}

function identity(requestId: string) {
  return { ...binding, requestId }
}

function entropySequence() {
  let value = 0
  return () => new Uint8Array(24).fill(++value)
}

async function harness() {
  const storage = new MemoryStorage()
  const registry = new ModuleRegistry({
    storage,
    now: () => '2026-08-30T03:00:00.000Z',
  })
  const installed = await registry.installUserModule({
    manifest: manifest(),
    sourceUrl: 'https://storage-runtime.example/manifest.json',
    grantedContextFields: {},
    grantedCapabilities: ['storage.module'],
  })
  if (!installed.ok)
    throw new Error('Expected installed runtime fixture')
  const adapter = new StorageModuleAdapter({ registry, storage, entropy: entropySequence() })
  const controller = new StorageModuleController(adapter)
  const messages: unknown[] = []
  const client = new StorageModuleClient({
    async sendMessage(message) {
      messages.push(structuredClone(message))
      const validated = validateStorageModuleProtocolRequest(message)
      if (!validated)
        return null
      return controller.handle(validated)
    },
  })
  return { adapter, client, controller, messages, registry, storage }
}

describe('storage.module background protocol and host client', () => {
  it('accepts only exact open/execute/close envelopes without storage authority fields', () => {
    const read = createStorageModuleReadRequestEnvelope(identity('request_storage_protocol_read'))
    const requests = [
      createStorageModuleSessionOpenRequest(binding),
      createStorageModuleExecuteRequest(binding, read),
      createStorageModuleSessionCloseRequest(binding),
    ]
    for (const request of requests)
      expect(validateStorageModuleProtocolRequest(request)).toEqual(request)

    for (const field of ['key', 'prefix', 'namespace', 'storageArea', 'browserMethod', 'nextRevision']) {
      expect(validateStorageModuleProtocolRequest({ ...requests[0], [field]: 'forged' })).toBeNull()
      expect(validateStorageModuleProtocolRequest({ ...requests[1], [field]: 'forged' })).toBeNull()
    }
    expect(validateStorageModuleProtocolRequest({
      ...requests[0],
      binding: { ...binding, moduleId: 'dev.oneweb.storage.other' },
    })).toMatchObject({ binding: { moduleId: 'dev.oneweb.storage.other' } })
    expect(validateStorageModuleProtocolRequest({ ...requests[0], binding: { ...binding, generation: 0 } })).toBeNull()
  })

  it('validates response type, stable error and exact result shapes', () => {
    expect(validateStorageModuleProtocolResponse(
      createStorageModuleProtocolResponse('STORAGE_MODULE_SESSION_OPEN', { ok: true }),
      'STORAGE_MODULE_SESSION_OPEN',
    )).not.toBeNull()
    expect(validateStorageModuleProtocolResponse(
      createStorageModuleProtocolResponse('STORAGE_MODULE_EXECUTE', {
        ok: false,
        code: 'STORAGE_REVISION_CONFLICT',
      }),
      'STORAGE_MODULE_EXECUTE',
    )).not.toBeNull()
    expect(validateStorageModuleProtocolResponse({
      ...createStorageModuleProtocolResponse('STORAGE_MODULE_SESSION_OPEN', { ok: true }),
      result: { ok: true, key: 'forged' },
    }, 'STORAGE_MODULE_SESSION_OPEN')).toBeNull()
    expect(validateStorageModuleProtocolResponse(
      createStorageModuleProtocolResponse('STORAGE_MODULE_SESSION_CLOSE', { ok: true, closed: true }),
      'STORAGE_MODULE_EXECUTE',
    )).toBeNull()
  })

  it('runs a typed client through the versioned controller without exposing physical storage input', async () => {
    const { client, messages } = await harness()
    await client.open(binding)
    const handlers = client.createHandlers(binding)['storage.module']!
    const signal = new AbortController().signal
    const first = await handlers.read!({
      payload: null,
      requestId: 'request_storage_client_read',
      signal,
    })
    const replaced = await handlers.replace!({
      payload: { expectedRevision: first.revision, document: { local: 'only' } },
      requestId: 'request_storage_client_replace',
      signal,
    })
    const restored = await handlers.read!({
      payload: null,
      requestId: 'request_storage_client_read_2',
      signal,
    })
    expect(restored).toEqual({ revision: replaced.revision, document: { local: 'only' } })
    await expect(handlers.clear!({
      payload: { expectedRevision: first.revision },
      requestId: 'request_storage_client_stale_clear',
      signal,
    })).rejects.toMatchObject({
      name: 'ModuleCapabilityHandlerError',
      code: 'STORAGE_REVISION_CONFLICT',
    })
    expect(await client.close(binding)).toBe(true)
    await expect(handlers.read!({
      payload: null,
      requestId: 'request_storage_client_late_read',
      signal,
    })).rejects.toMatchObject({ code: 'SESSION_DESTROYED' })

    const serialized = JSON.stringify(messages)
    for (const forbidden of ['browserMethod', 'nextRevision', 'storageArea', 'oneweb.remote-storage.v1:'])
      expect(serialized).not.toContain(forbidden)
  })

  it('preserves stable adapter errors through the real dispatcher terminal path', async () => {
    const { client } = await harness()
    await client.open(binding)
    const port = new FakePort()
    const dispatcher = createModuleCapabilityDispatcher({
      binding,
      catalog: storageModuleCapabilityCatalog,
      manifestCapabilities: ['storage.module'],
      grantedCapabilities: ['storage.module'],
      handlers: client.createHandlers(binding),
      port,
    })
    dispatcher.dispatch(createStorageModuleReadRequestEnvelope(identity('request_storage_dispatcher_read')))
    await vi.waitFor(() => expect(port.messages).toHaveLength(1))
    const first = port.messages[0] as { result: { revision: string } }
    dispatcher.dispatch(createStorageModuleReplaceRequestEnvelope(
      identity('request_storage_dispatcher_replace'),
      first.result.revision,
      { via: 'dispatcher' },
    ))
    await vi.waitFor(() => expect(port.messages).toHaveLength(2))
    dispatcher.dispatch(createStorageModuleReplaceRequestEnvelope(
      identity('request_storage_dispatcher_conflict'),
      first.result.revision,
      { stale: true },
    ))
    await vi.waitFor(() => expect(port.messages).toHaveLength(3))
    expect(port.messages[2]).toMatchObject({
      type: 'CAPABILITY_ERROR',
      code: 'STORAGE_REVISION_CONFLICT',
      moduleId: binding.moduleId,
      sessionId: binding.sessionId,
      generation: binding.generation,
    })
    expect(JSON.stringify(port.messages[2])).not.toContain('via')
    dispatcher.destroy()
  })

  it('rejects malformed background results and does not trust a code-shaped ordinary error', async () => {
    const malformed = new StorageModuleClient({
      async sendMessage(request) {
        if (request.type === 'STORAGE_MODULE_SESSION_OPEN')
          return createStorageModuleProtocolResponse(request.type, { ok: true })
        return {
          ...createStorageModuleProtocolResponse(request.type, { ok: true, result: { revision: 'forged' } }),
          key: 'forged',
        }
      },
    })
    await malformed.open(binding)
    await expect(malformed.createHandlers(binding)['storage.module']!.read!({
      payload: null,
      requestId: 'request_storage_malformed_response',
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'OPERATION_FAILED' })

    expect(() => new ModuleCapabilityHandlerError('forged' as never)).toThrow(/invalid/)
  })

  it('makes a newer module session authoritative without allowing stale close to destroy it', async () => {
    const { client } = await harness()
    await client.open(binding)
    const replacement = {
      ...binding,
      sessionId: 'session_storage_runtime_replacement_1234567890123456',
      generation: binding.generation + 1,
    }
    await client.open(replacement)
    expect(await client.close(binding)).toBe(false)
    const result = await client.createHandlers(replacement)['storage.module']!.read!({
      payload: null,
      requestId: 'request_storage_replacement_read',
      signal: new AbortController().signal,
    })
    expect(result.document).toBeNull()
  })
})
