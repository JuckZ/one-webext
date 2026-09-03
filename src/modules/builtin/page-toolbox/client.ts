import type {
  PageToolboxSitePreparationV1,
  PageToolSiteSettingsV1,
} from './contracts'
import type {
  PageToolboxManagementRequest,
  PageToolboxManagementResult,
} from './protocol'
import {
  isPageToolboxManagementResponse,
  isPageToolboxSitePreparation,
  PAGE_TOOLBOX_MANAGEMENT_CHANNEL,
  PAGE_TOOLBOX_MANAGEMENT_PROTOCOL_VERSION,
} from './protocol'

export interface PageToolboxTransport {
  sendMessage: (_message: PageToolboxManagementRequest) => Promise<unknown>
}

export interface PageToolboxPermissionRequester {
  request: (_permissions: { origins: string[] }) => Promise<boolean>
}

export class PageToolboxClientError extends Error {
  constructor(readonly code: 'transport-error' | 'invalid-response' | 'permission-denied') {
    super(code)
    this.name = 'PageToolboxClientError'
  }
}

export class PageToolboxClient {
  constructor(
    private readonly _transport: PageToolboxTransport,
    private readonly _permissions: PageToolboxPermissionRequester,
  ) {}

  private async request(message: PageToolboxManagementRequest): Promise<PageToolboxManagementResult> {
    let response: unknown
    try {
      response = await this._transport.sendMessage(message)
    }
    catch {
      throw new PageToolboxClientError('transport-error')
    }
    if (!isPageToolboxManagementResponse(response) || response.requestType !== message.type)
      throw new PageToolboxClientError('invalid-response')
    return response.result
  }

  status() {
    return this.request({
      channel: PAGE_TOOLBOX_MANAGEMENT_CHANNEL,
      version: PAGE_TOOLBOX_MANAGEMENT_PROTOCOL_VERSION,
      type: 'PAGE_TOOLBOX_CONTROL_STATUS',
    })
  }

  prepare() {
    return this.request({
      channel: PAGE_TOOLBOX_MANAGEMENT_CHANNEL,
      version: PAGE_TOOLBOX_MANAGEMENT_PROTOCOL_VERSION,
      type: 'PAGE_TOOLBOX_PREPARE_CURRENT_SITE',
    })
  }

  async confirm(preparation: PageToolboxSitePreparationV1) {
    if (!isPageToolboxSitePreparation(preparation))
      throw new PageToolboxClientError('invalid-response')
    let granted = false
    try {
      granted = await this._permissions.request({ origins: [`${preparation.exactOrigin}/*`] })
    }
    catch {}
    if (!granted)
      throw new PageToolboxClientError('permission-denied')
    return this.request({
      channel: PAGE_TOOLBOX_MANAGEMENT_CHANNEL,
      version: PAGE_TOOLBOX_MANAGEMENT_PROTOCOL_VERSION,
      type: 'PAGE_TOOLBOX_CONFIRM_CURRENT_SITE',
      token: preparation.token,
    })
  }

  replace(expectedRevision: number, siteSettings: PageToolSiteSettingsV1) {
    return this.request({
      channel: PAGE_TOOLBOX_MANAGEMENT_CHANNEL,
      version: PAGE_TOOLBOX_MANAGEMENT_PROTOCOL_VERSION,
      type: 'PAGE_TOOLBOX_REPLACE_CURRENT_SITE_SETTINGS',
      expectedRevision,
      siteSettings,
    })
  }

  revoke() {
    return this.request({
      channel: PAGE_TOOLBOX_MANAGEMENT_CHANNEL,
      version: PAGE_TOOLBOX_MANAGEMENT_PROTOCOL_VERSION,
      type: 'PAGE_TOOLBOX_REVOKE_CURRENT_SITE',
    })
  }
}
