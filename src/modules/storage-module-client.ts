import type {
  CapabilityRpcRequestIdentity,
  CapabilityRpcResultPayload,
  CapabilityRpcSessionBinding,
  StorageModuleCatalog,
  StorageModuleOperation,
  StorageModuleRequest,
  StorageModuleRequestEnvelope,
} from '@oneweb/module-sdk'
import type { ModuleCapabilityHandlers } from './capability-dispatcher'
import {
  createCapabilityRpcResultEnvelope,
  createStorageModuleClearRequestEnvelope,
  createStorageModuleReadRequestEnvelope,
  createStorageModuleReplaceRequestEnvelope,
  storageModuleCapabilityCatalog,
} from '@oneweb/module-sdk'
import { ModuleCapabilityHandlerError } from './capability-dispatcher'
import {
  createStorageModuleExecuteRequest,
  createStorageModuleSessionCloseRequest,
  createStorageModuleSessionOpenRequest,
  type StorageModuleProtocolRequest,
  validateStorageModuleProtocolResponse,
} from './storage-module-protocol'

export interface StorageModuleClientTransport {
  sendMessage: (_message: StorageModuleProtocolRequest) => Promise<unknown>
}

function identity(binding: CapabilityRpcSessionBinding, requestId: string): CapabilityRpcRequestIdentity {
  return { ...binding, requestId }
}

export class StorageModuleClient {
  private readonly transport: StorageModuleClientTransport

  constructor(transport: StorageModuleClientTransport) {
    this.transport = transport
  }

  async open(binding: CapabilityRpcSessionBinding) {
    const request = createStorageModuleSessionOpenRequest(binding)
    const response = validateStorageModuleProtocolResponse(
      await this.transport.sendMessage(request),
      request.type,
    )
    if (!response || !response.result.ok)
      throw new ModuleCapabilityHandlerError(response?.result.ok === false ? response.result.code : 'OPERATION_FAILED')
  }

  async close(binding: CapabilityRpcSessionBinding) {
    const request = createStorageModuleSessionCloseRequest(binding)
    const response = validateStorageModuleProtocolResponse(
      await this.transport.sendMessage(request).catch(() => null),
      request.type,
    )
    return Boolean(response?.result.ok && 'closed' in response.result && response.result.closed)
  }

  createHandlers(binding: CapabilityRpcSessionBinding): ModuleCapabilityHandlers<StorageModuleCatalog> {
    return {
      'storage.module': {
        read: ({ requestId }) => this.execute(
          binding,
          createStorageModuleReadRequestEnvelope(identity(binding, requestId)),
        ),
        replace: ({ payload, requestId }) => this.execute(
          binding,
          createStorageModuleReplaceRequestEnvelope(
            identity(binding, requestId),
            payload.expectedRevision,
            payload.document,
          ),
        ),
        clear: ({ payload, requestId }) => this.execute(
          binding,
          createStorageModuleClearRequestEnvelope(
            identity(binding, requestId),
            payload.expectedRevision,
          ),
        ),
      },
    }
  }

  private async execute<Operation extends StorageModuleOperation>(
    binding: CapabilityRpcSessionBinding,
    storageRequest: StorageModuleRequest<Operation>,
  ): Promise<CapabilityRpcResultPayload<StorageModuleCatalog, 'storage.module', Operation>> {
    const request = createStorageModuleExecuteRequest(
      binding,
      storageRequest as StorageModuleRequestEnvelope,
    )
    const response = validateStorageModuleProtocolResponse(
      await this.transport.sendMessage(request),
      request.type,
    )
    if (!response)
      throw new ModuleCapabilityHandlerError('OPERATION_FAILED')
    if (!response.result.ok)
      throw new ModuleCapabilityHandlerError(response.result.code)
    if (!('result' in response.result))
      throw new ModuleCapabilityHandlerError('OPERATION_FAILED')
    try {
      return createCapabilityRpcResultEnvelope(
        storageModuleCapabilityCatalog,
        storageRequest as StorageModuleRequestEnvelope,
        response.result.result as never,
      ).result as CapabilityRpcResultPayload<StorageModuleCatalog, 'storage.module', Operation>
    }
    catch {
      throw new ModuleCapabilityHandlerError('OPERATION_FAILED')
    }
  }
}
