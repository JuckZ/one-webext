import type { ClashConnectionPreparation } from './contracts'
import type { ClashControlRequest } from './protocol'
import {
  CLASH_CONTROL_CHANNEL,
  CLASH_CONTROL_PROTOCOL_VERSION,
  isClashControlResponse,
} from './protocol'

export interface ClashControlTransport {
  sendMessage: (_message: ClashControlRequest) => Promise<unknown>
}

export interface ClashControlPermissionRequester {
  request: (_permissions: { origins: string[] }) => Promise<boolean>
}

export class ClashControlClientError extends Error {
  constructor(readonly code: 'transport-error' | 'invalid-response' | 'permission-denied') {
    super(code)
    this.name = 'ClashControlClientError'
  }
}

export class ClashControlClient {
  constructor(
    private readonly _transport: ClashControlTransport,
    private readonly _permissions: ClashControlPermissionRequester,
  ) {}

  private async request(message: ClashControlRequest) {
    let response: unknown
    try {
      response = await this._transport.sendMessage(message)
    }
    catch {
      throw new ClashControlClientError('transport-error')
    }
    if (!isClashControlResponse(response) || response.requestType !== message.type)
      throw new ClashControlClientError('invalid-response')
    return response.result
  }

  prepare(controllerUrl: string) {
    return this.request({
      channel: CLASH_CONTROL_CHANNEL,
      version: CLASH_CONTROL_PROTOCOL_VERSION,
      type: 'CLASH_CONTROL_PREPARE',
      controllerUrl,
    })
  }

  async connect(preparation: ClashConnectionPreparation, secret: string) {
    let granted = false
    try {
      granted = await this._permissions.request({ origins: [preparation.originPattern] })
    }
    catch {}
    if (!granted)
      throw new ClashControlClientError('permission-denied')
    return this.request({
      channel: CLASH_CONTROL_CHANNEL,
      version: CLASH_CONTROL_PROTOCOL_VERSION,
      type: 'CLASH_CONTROL_CONNECT',
      token: preparation.token,
      generation: preparation.generation,
      controllerOrigin: preparation.controllerOrigin,
      originPattern: preparation.originPattern,
      expiresAt: preparation.expiresAt,
      secret,
    })
  }

  status() {
    return this.request({
      channel: CLASH_CONTROL_CHANNEL,
      version: CLASH_CONTROL_PROTOCOL_VERSION,
      type: 'CLASH_CONTROL_STATUS',
    })
  }

  refresh() {
    return this.request({
      channel: CLASH_CONTROL_CHANNEL,
      version: CLASH_CONTROL_PROTOCOL_VERSION,
      type: 'CLASH_CONTROL_REFRESH',
    })
  }

  prepareProxySwitch(groupName: string, targetNode: string) {
    return this.request({
      channel: CLASH_CONTROL_CHANNEL,
      version: CLASH_CONTROL_PROTOCOL_VERSION,
      type: 'CLASH_CONTROL_PREPARE_PROXY_SWITCH',
      groupName,
      targetNode,
    })
  }

  confirmProxySwitch(token: string) {
    return this.request({
      channel: CLASH_CONTROL_CHANNEL,
      version: CLASH_CONTROL_PROTOCOL_VERSION,
      type: 'CLASH_CONTROL_CONFIRM_PROXY_SWITCH',
      token,
    })
  }

  disconnect() {
    return this.request({
      channel: CLASH_CONTROL_CHANNEL,
      version: CLASH_CONTROL_PROTOCOL_VERSION,
      type: 'CLASH_CONTROL_DISCONNECT',
    })
  }
}
