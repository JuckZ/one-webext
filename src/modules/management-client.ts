import type { ModuleInstallSelection } from './installer'
import type { InstalledModuleRecord, ModuleUpdateApprovalSelection } from './types'
import {
  isModuleManagementResponse,
  type ModuleManagementRequest,
  type ModuleManagementResult,
  ONEWEB_MODULE_MANAGEMENT_CHANNEL,
  ONEWEB_MODULE_MANAGEMENT_VERSION,
} from './management-protocol'
import { getModuleOriginPattern } from './module-origin'

export type ModuleSetEnabledManagementResult = Extract<ModuleManagementResult, { operation: 'set-enabled' }>
export type ModuleRemoveManagementResult = Extract<ModuleManagementResult, { operation: 'remove' }>
export type ModuleInstallPrepareManagementResult = Extract<ModuleManagementResult, { operation: 'install-prepare' }>
export type ModuleInstallConfirmManagementResult = Extract<ModuleManagementResult, { operation: 'install-confirm' }>
export type ModuleInstallCancelManagementResult = Extract<ModuleManagementResult, { operation: 'install-cancel' }>
export type ModuleUpdateCheckManagementResult = Extract<ModuleManagementResult, { operation: 'update-check' }>
export type ModuleUpdateApproveManagementResult = Extract<ModuleManagementResult, { operation: 'update-approve' }>
export type ModuleUpdateApplyManagementResult = Extract<ModuleManagementResult, { operation: 'update-apply' }>

export interface ModuleManagementTransport {
  sendMessage: (_message: ModuleManagementRequest) => Promise<unknown>
}

export interface ModuleOriginPermissionRequester {
  request: (_permissions: { origins: string[] }) => Promise<boolean>
}

export interface ModuleManagementClientOptions extends ModuleManagementTransport {
  permissions?: ModuleOriginPermissionRequester
}

export class ModuleManagementClientError extends Error {
  constructor(public readonly code: 'transport-error' | 'invalid-response' | 'invalid-manifest-url' | 'permission-denied') {
    const messages = {
      'transport-error': 'Module management request failed',
      'invalid-response': 'Invalid module management response',
      'invalid-manifest-url': 'Invalid module manifest URL',
      'permission-denied': 'Module origin permission denied',
    }
    super(messages[code])
    this.name = 'ModuleManagementClientError'
  }
}

export class ModuleManagementClient {
  private readonly transport: ModuleManagementTransport
  private readonly permissions?: ModuleOriginPermissionRequester

  constructor({ sendMessage, permissions }: ModuleManagementClientOptions) {
    this.transport = { sendMessage }
    this.permissions = permissions
  }

  private async request(message: ModuleManagementRequest) {
    let response: unknown
    try {
      response = await this.transport.sendMessage(message)
    }
    catch {
      throw new ModuleManagementClientError('transport-error')
    }
    if (!isModuleManagementResponse(response) || response.requestType !== message.type)
      throw new ModuleManagementClientError('invalid-response')
    return response.result
  }

  async list(): Promise<InstalledModuleRecord[]> {
    const result = await this.request({
      channel: ONEWEB_MODULE_MANAGEMENT_CHANNEL,
      version: ONEWEB_MODULE_MANAGEMENT_VERSION,
      type: 'MODULE_LIST',
    })
    if (result.operation !== 'list')
      throw new ModuleManagementClientError('invalid-response')
    return result.modules
  }

  async setEnabled(moduleId: string, enabled: boolean): Promise<ModuleSetEnabledManagementResult> {
    const result = await this.request({
      channel: ONEWEB_MODULE_MANAGEMENT_CHANNEL,
      version: ONEWEB_MODULE_MANAGEMENT_VERSION,
      type: 'MODULE_SET_ENABLED',
      moduleId,
      enabled,
    })
    if (result.operation !== 'set-enabled')
      throw new ModuleManagementClientError('invalid-response')
    return result
  }

  async remove(moduleId: string): Promise<ModuleRemoveManagementResult> {
    const result = await this.request({
      channel: ONEWEB_MODULE_MANAGEMENT_CHANNEL,
      version: ONEWEB_MODULE_MANAGEMENT_VERSION,
      type: 'MODULE_REMOVE',
      moduleId,
    })
    if (result.operation !== 'remove')
      throw new ModuleManagementClientError('invalid-response')
    return result
  }

  async prepareInstall(manifestUrl: string): Promise<ModuleInstallPrepareManagementResult> {
    const originPattern = getModuleOriginPattern(manifestUrl)
    if (!originPattern)
      throw new ModuleManagementClientError('invalid-manifest-url')
    if (!this.permissions)
      throw new ModuleManagementClientError('permission-denied')

    let granted = false
    try {
      // Keep this request before the first await so Chromium and Firefox retain
      // the trusted click's user-activation token.
      granted = await this.permissions.request({ origins: [originPattern] })
    }
    catch {}
    if (!granted)
      throw new ModuleManagementClientError('permission-denied')

    const result = await this.request({
      channel: ONEWEB_MODULE_MANAGEMENT_CHANNEL,
      version: ONEWEB_MODULE_MANAGEMENT_VERSION,
      type: 'MODULE_INSTALL_PREPARE',
      manifestUrl,
    })
    if (result.operation !== 'install-prepare')
      throw new ModuleManagementClientError('invalid-response')
    return result
  }

  async confirmInstall(
    manifestUrl: string,
    expectedDigest: string,
    selection: ModuleInstallSelection,
  ): Promise<ModuleInstallConfirmManagementResult> {
    const result = await this.request({
      channel: ONEWEB_MODULE_MANAGEMENT_CHANNEL,
      version: ONEWEB_MODULE_MANAGEMENT_VERSION,
      type: 'MODULE_INSTALL_CONFIRM',
      manifestUrl,
      expectedDigest,
      grantedContextFields: selection.grantedContextFields,
      grantedCapabilities: selection.grantedCapabilities,
    })
    if (result.operation !== 'install-confirm')
      throw new ModuleManagementClientError('invalid-response')
    return result
  }

  async cancelInstall(manifestUrl: string): Promise<ModuleInstallCancelManagementResult> {
    const result = await this.request({
      channel: ONEWEB_MODULE_MANAGEMENT_CHANNEL,
      version: ONEWEB_MODULE_MANAGEMENT_VERSION,
      type: 'MODULE_INSTALL_CANCEL',
      manifestUrl,
    })
    if (result.operation !== 'install-cancel')
      throw new ModuleManagementClientError('invalid-response')
    return result
  }

  async checkUpdate(moduleId: string): Promise<ModuleUpdateCheckManagementResult> {
    const result = await this.request({
      channel: ONEWEB_MODULE_MANAGEMENT_CHANNEL,
      version: ONEWEB_MODULE_MANAGEMENT_VERSION,
      type: 'MODULE_UPDATE_CHECK',
      moduleId,
    })
    if (result.operation !== 'update-check')
      throw new ModuleManagementClientError('invalid-response')
    return result
  }

  async approveUpdate(
    moduleId: string,
    expectedDigest: string,
    selection: ModuleUpdateApprovalSelection,
  ): Promise<ModuleUpdateApproveManagementResult> {
    const result = await this.request({
      channel: ONEWEB_MODULE_MANAGEMENT_CHANNEL,
      version: ONEWEB_MODULE_MANAGEMENT_VERSION,
      type: 'MODULE_UPDATE_APPROVE',
      moduleId,
      expectedDigest,
      approvedContextFields: selection.approvedContextFields,
      approvedCapabilities: selection.approvedCapabilities,
    })
    if (result.operation !== 'update-approve')
      throw new ModuleManagementClientError('invalid-response')
    return result
  }

  async applyUpdate(moduleId: string): Promise<ModuleUpdateApplyManagementResult> {
    const result = await this.request({
      channel: ONEWEB_MODULE_MANAGEMENT_CHANNEL,
      version: ONEWEB_MODULE_MANAGEMENT_VERSION,
      type: 'MODULE_UPDATE_APPLY',
      moduleId,
    })
    if (result.operation !== 'update-apply')
      throw new ModuleManagementClientError('invalid-response')
    return result
  }
}
