import type { StorageModuleAdapter } from './storage-module-adapter'
import type { StorageModuleProtocolRequest } from './storage-module-protocol'
import { createStorageModuleProtocolResponse } from './storage-module-protocol'

export class StorageModuleController {
  private readonly adapter: StorageModuleAdapter

  constructor(adapter: StorageModuleAdapter) {
    this.adapter = adapter
  }

  async handle(request: StorageModuleProtocolRequest) {
    if (request.type === 'STORAGE_MODULE_SESSION_OPEN') {
      const result = await this.adapter.openSession(request.binding)
      return createStorageModuleProtocolResponse(request.type, result.ok ? { ok: true } : result)
    }
    if (request.type === 'STORAGE_MODULE_SESSION_CLOSE') {
      const closed = await this.adapter.closeSession(request.binding)
      return createStorageModuleProtocolResponse(request.type, { ok: true, closed })
    }
    const result = await this.adapter.execute(request.binding, request.request)
    return createStorageModuleProtocolResponse(request.type, result)
  }
}
