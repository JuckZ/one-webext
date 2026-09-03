import type { ModuleInstaller, ModuleInstallSelection } from './installer'
import type { ModuleRegistry } from './registry'
import type { InstalledModuleRecord, ModuleUpdateApprovalSelection } from './types'
import {
  createModuleManagementResponse,
  type ModuleManagementRequest,
  type ModuleManagementResponse,
  type ModuleManagementResult,
} from './management-protocol'

export interface ModuleManagerLifecycle {
  onInstalledRecordChanged?: (_record: InstalledModuleRecord) => void | Promise<void>
  onInstalledRecordRemoved?: (_record: InstalledModuleRecord) => void | Promise<void>
}

export class ModuleManager {
  private readonly registry: ModuleRegistry
  private readonly installer?: ModuleInstaller
  private readonly lifecycle?: ModuleManagerLifecycle

  constructor(registry: ModuleRegistry, installer?: ModuleInstaller, lifecycle?: ModuleManagerLifecycle) {
    this.registry = registry
    this.installer = installer
    this.lifecycle = lifecycle
  }

  async list(): Promise<ModuleManagementResult> {
    return {
      ok: true,
      operation: 'list',
      modules: await this.registry.list(),
    }
  }

  async setEnabled(moduleId: string, enabled: boolean): Promise<ModuleManagementResult> {
    const result = await this.registry.setEnabled(moduleId, enabled)
    if (!result.ok) {
      return {
        operation: 'set-enabled',
        ...result,
      }
    }
    let record = result.record
    if (this.lifecycle?.onInstalledRecordChanged) {
      await this.lifecycle.onInstalledRecordChanged(record)
      record = await this.registry.get(moduleId) || record
    }
    return {
      operation: 'set-enabled',
      ...result,
      record,
    }
  }

  async remove(moduleId: string): Promise<ModuleManagementResult> {
    const result = await this.registry.removeUserModule(moduleId)
    if (result.ok) {
      await this.lifecycle?.onInstalledRecordRemoved?.(result.removed)
      await this.installer?.releaseRemovedRecord(result.removed)
    }
    return {
      operation: 'remove',
      ...result,
    }
  }

  async prepareInstall(manifestUrl: string): Promise<ModuleManagementResult> {
    const result = this.installer
      ? await this.installer.prepare(manifestUrl)
      : { ok: false, reason: 'installation-unavailable' } as const
    return {
      operation: 'install-prepare',
      ...result,
    }
  }

  async confirmInstall(
    manifestUrl: string,
    expectedDigest: string,
    selection: ModuleInstallSelection,
  ): Promise<ModuleManagementResult> {
    const result = this.installer
      ? await this.installer.confirm(manifestUrl, expectedDigest, selection)
      : { ok: false, reason: 'installation-unavailable' } as const
    return {
      operation: 'install-confirm',
      ...result,
    }
  }

  async cancelInstall(manifestUrl: string): Promise<ModuleManagementResult> {
    const releasedOrigin = await this.installer?.cancel(manifestUrl) || false
    return {
      ok: true,
      operation: 'install-cancel',
      releasedOrigin,
    }
  }

  async checkUpdate(moduleId: string): Promise<ModuleManagementResult> {
    const result = this.installer
      ? await this.installer.checkForUpdate(moduleId)
      : { ok: false, reason: 'update-check-unavailable' } as const
    return {
      operation: 'update-check',
      ...result,
    }
  }

  async approveUpdate(
    moduleId: string,
    expectedDigest: string,
    selection: ModuleUpdateApprovalSelection,
  ): Promise<ModuleManagementResult> {
    const result = await this.registry.approveModuleUpdate(moduleId, expectedDigest, selection)
    return {
      operation: 'update-approve',
      ...result,
    }
  }

  async applyUpdate(moduleId: string): Promise<ModuleManagementResult> {
    const result = this.installer
      ? await this.installer.applyUpdate(moduleId)
      : { ok: false, reason: 'update-apply-unavailable' } as const
    if (result.ok)
      await this.lifecycle?.onInstalledRecordChanged?.(result.record)
    return {
      operation: 'update-apply',
      ...result,
    }
  }

  async handle(request: ModuleManagementRequest): Promise<ModuleManagementResponse> {
    let result: ModuleManagementResult
    switch (request.type) {
      case 'MODULE_LIST':
        result = await this.list()
        break
      case 'MODULE_SET_ENABLED':
        result = await this.setEnabled(request.moduleId, request.enabled)
        break
      case 'MODULE_REMOVE':
        result = await this.remove(request.moduleId)
        break
      case 'MODULE_INSTALL_PREPARE':
        result = await this.prepareInstall(request.manifestUrl)
        break
      case 'MODULE_INSTALL_CONFIRM':
        result = await this.confirmInstall(request.manifestUrl, request.expectedDigest, {
          grantedContextFields: request.grantedContextFields,
          grantedCapabilities: request.grantedCapabilities,
        })
        break
      case 'MODULE_INSTALL_CANCEL':
        result = await this.cancelInstall(request.manifestUrl)
        break
      case 'MODULE_UPDATE_CHECK':
        result = await this.checkUpdate(request.moduleId)
        break
      case 'MODULE_UPDATE_APPROVE':
        result = await this.approveUpdate(request.moduleId, request.expectedDigest, {
          approvedContextFields: request.approvedContextFields,
          approvedCapabilities: request.approvedCapabilities,
        })
        break
      case 'MODULE_UPDATE_APPLY':
        result = await this.applyUpdate(request.moduleId)
        break
    }
    return createModuleManagementResponse(request.type, result)
  }
}
