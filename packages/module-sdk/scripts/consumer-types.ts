import type {
  RemoteFrameRuntimeAdapter,
  RemoteFrameRuntimeWindowListener,
} from '@oneweb/module-sdk'
import type {
  CapabilityRpcOperationId,
  CapabilityRpcRequestPayload,
  CapabilityRpcResultPayload,
} from '@oneweb/module-sdk/capability-rpc'
// @ts-expect-error runtime state is deliberately not a public package subpath
import type { RemoteFrameRuntimeState } from '@oneweb/module-sdk/runtime-state'
import { createRemoteFrameRuntimeClient } from '@oneweb/module-sdk'
import {
  capabilityRpcSchema,
  createCapabilityRpcRequestEnvelope,
  createCapabilityRpcResultEnvelope,
  defineCapabilityRpcCatalog,
} from '@oneweb/module-sdk/capability-rpc'
import { createRemoteFrameRuntimeClient as createRuntimeSubpathClient } from '@oneweb/module-sdk/runtime'
import {
  createStorageModuleReadRequestEnvelope,
  createStorageModuleRevision,
  storageModuleCapabilityCatalog,
} from '@oneweb/module-sdk/storage-module'

const parent = {}
const listeners = new Set<RemoteFrameRuntimeWindowListener>()
const adapter: RemoteFrameRuntimeAdapter = {
  parent,
  addMessageListener(listener) {
    listeners.add(listener)
  },
  removeMessageListener(listener) {
    listeners.delete(listener)
  },
  postToParent(_message, _targetOrigin) {},
}

const client = createRemoteFrameRuntimeClient({
  adapter,
  moduleId: 'dev.oneweb.consumer.fixture',
  parentOrigin: 'https://parent.example',
  async onConnected(initFields) {
    void initFields.authorizationCode
  },
  onContextUpdate(update) {
    void update.contexts
  },
})
const runtimeClient = createRuntimeSubpathClient({
  adapter,
  moduleId: 'dev.oneweb.consumer.fixture',
  parentOrigin: 'https://parent.example',
  onContextUpdate() {},
})

void (null as RemoteFrameRuntimeState | null)
void client.status
void runtimeClient

const conformanceCatalog = defineCapabilityRpcCatalog({
  'conformance.echo': {
    operations: {
      echo: {
        request: capabilityRpcSchema.object({
          text: capabilityRpcSchema.string({ maximumLength: 128 }),
        }),
        result: capabilityRpcSchema.object({
          echoed: capabilityRpcSchema.string({ maximumLength: 128 }),
        }),
      },
      sum: {
        request: capabilityRpcSchema.object({
          values: capabilityRpcSchema.array(
            capabilityRpcSchema.number(),
            { maximumItems: 8 },
          ),
        }),
        result: capabilityRpcSchema.object({
          total: capabilityRpcSchema.number(),
        }),
      },
    },
  },
} as const)

const typedRuntimeClient = createRemoteFrameRuntimeClient({
  adapter,
  capabilityRpcCatalog: conformanceCatalog,
  moduleId: 'dev.oneweb.consumer.fixture',
  parentOrigin: 'https://parent.example',
  onContextUpdate() {},
})

type EchoOperation = CapabilityRpcOperationId<typeof conformanceCatalog, 'conformance.echo'>
type EchoPayload = CapabilityRpcRequestPayload<
  typeof conformanceCatalog,
  'conformance.echo',
  'echo'
>
type EchoResult = CapabilityRpcResultPayload<
  typeof conformanceCatalog,
  'conformance.echo',
  'echo'
>

const operation: EchoOperation = 'echo'
const payload: EchoPayload = { text: 'typed' }
const expectedResult: EchoResult = { echoed: 'typed' }
const runtimeHandle = typedRuntimeClient.request('conformance.echo', 'echo', payload)
const typedRuntimeResult: Promise<EchoResult> = runtimeHandle.result
typedRuntimeClient.cancel(runtimeHandle.requestId)
// @ts-expect-error runtime capability must exist in the supplied finite catalog
typedRuntimeClient.request('arbitrary.browser', 'call', {})
// @ts-expect-error runtime operation must belong to the selected capability
typedRuntimeClient.request('conformance.echo', 'fetch', {})
// @ts-expect-error runtime payload is capability-operation specific
typedRuntimeClient.request('conformance.echo', 'echo', { values: [1] })
const rpcRequest = createCapabilityRpcRequestEnvelope(
  conformanceCatalog,
  {
    moduleId: 'dev.oneweb.consumer.fixture',
    sessionId: 'session_123456789012345678901234',
    generation: 1,
    requestId: 'request_12345678',
  },
  'conformance.echo',
  operation,
  payload,
)
const rpcResult = createCapabilityRpcResultEnvelope(conformanceCatalog, rpcRequest, expectedResult)

// @ts-expect-error capability must exist in the finite catalog
createCapabilityRpcRequestEnvelope(conformanceCatalog, rpcRequest, 'arbitrary.browser', 'call', {})
// @ts-expect-error operation must belong to the selected capability
createCapabilityRpcRequestEnvelope(conformanceCatalog, rpcRequest, 'conformance.echo', 'fetch', {})
// @ts-expect-error payload is capability-operation specific
createCapabilityRpcRequestEnvelope(conformanceCatalog, rpcRequest, 'conformance.echo', 'echo', { values: [1] })
// @ts-expect-error result is capability-operation specific
createCapabilityRpcResultEnvelope(conformanceCatalog, rpcRequest, { total: 1 })

void rpcResult
void typedRuntimeResult

const storageRevision = createStorageModuleRevision(new Uint8Array(24))
const storageRead = createStorageModuleReadRequestEnvelope({
  moduleId: 'dev.oneweb.consumer.fixture',
  sessionId: 'session_123456789012345678901234',
  generation: 1,
  requestId: 'request_storage_12345678',
})
type StorageReplacePayload = CapabilityRpcRequestPayload<
  typeof storageModuleCapabilityCatalog,
  'storage.module',
  'replace'
>
type StorageReadResult = CapabilityRpcResultPayload<
  typeof storageModuleCapabilityCatalog,
  'storage.module',
  'read'
>
const storageReplacePayload: StorageReplacePayload = {
  expectedRevision: storageRevision,
  document: { enabled: true, values: [1, 'two', null] },
}
const storageReadResult: StorageReadResult = {
  revision: storageRevision,
  document: { enabled: true },
}
createCapabilityRpcRequestEnvelope(
  storageModuleCapabilityCatalog,
  storageRead,
  'storage.module',
  'replace',
  storageReplacePayload,
)
// @ts-expect-error storage operation must be one of read, replace or clear
createCapabilityRpcRequestEnvelope(storageModuleCapabilityCatalog, storageRead, 'storage.module', 'get', null)
// @ts-expect-error read has no caller-controlled payload fields
createCapabilityRpcRequestEnvelope(storageModuleCapabilityCatalog, storageRead, 'storage.module', 'read', {})
// @ts-expect-error replace payload cannot name physical storage authority
const forgedStoragePayload: StorageReplacePayload = { ...storageReplacePayload, key: 'global-key' }

void storageReadResult
void forgedStoragePayload
