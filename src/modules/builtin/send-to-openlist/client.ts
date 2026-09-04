import type {
  ResourceCandidateV1,
  SendToOpenListConnectionPreparationV1,
  SendToOpenListProfileV1,
} from './contracts'
import type { SendToOpenListRequest } from './protocol'
import {
  isSendToOpenListResponse,
  SEND_TO_OPENLIST_CHANNEL,
  SEND_TO_OPENLIST_PROTOCOL_VERSION,
} from './protocol'

export interface SendToOpenListTransport {
  sendMessage: (_message: SendToOpenListRequest) => Promise<unknown>
}

export interface SendToOpenListPermissionRequester {
  request: (_permissions: { origins: string[] }) => Promise<boolean>
}

export class SendToOpenListClientError extends Error {
  constructor(readonly code: 'transport-error' | 'invalid-response' | 'permission-denied') {
    super(code)
    this.name = 'SendToOpenListClientError'
  }
}

export class SendToOpenListClient {
  constructor(
    private readonly _transport: SendToOpenListTransport,
    private readonly _permissions: SendToOpenListPermissionRequester,
  ) {}

  private async request(message: SendToOpenListRequest) {
    let response: unknown
    try {
      response = await this._transport.sendMessage(message)
    }
    catch {
      throw new SendToOpenListClientError('transport-error')
    }
    if (!isSendToOpenListResponse(response) || response.requestType !== message.type)
      throw new SendToOpenListClientError('invalid-response')
    return response.result
  }

  prepare(profile: SendToOpenListProfileV1) {
    return this.request({
      channel: SEND_TO_OPENLIST_CHANNEL,
      version: SEND_TO_OPENLIST_PROTOCOL_VERSION,
      type: 'SEND_TO_OPENLIST_PREPARE',
      profile,
    })
  }

  async connect(preparation: SendToOpenListConnectionPreparationV1, token?: string) {
    let granted = false
    try {
      granted = await this._permissions.request({ origins: [preparation.originPattern] })
    }
    catch {}
    if (!granted)
      throw new SendToOpenListClientError('permission-denied')
    return this.request({
      channel: SEND_TO_OPENLIST_CHANNEL,
      version: SEND_TO_OPENLIST_PROTOCOL_VERSION,
      type: 'SEND_TO_OPENLIST_CONNECT',
      preparation,
      ...(token === undefined ? {} : { token }),
    })
  }

  status() {
    return this.request({
      channel: SEND_TO_OPENLIST_CHANNEL,
      version: SEND_TO_OPENLIST_PROTOCOL_VERSION,
      type: 'SEND_TO_OPENLIST_STATUS',
    })
  }

  discoverTools(destinationPath: string) {
    return this.request({
      channel: SEND_TO_OPENLIST_CHANNEL,
      version: SEND_TO_OPENLIST_PROTOCOL_VERSION,
      type: 'SEND_TO_OPENLIST_DISCOVER_TOOLS',
      destinationPath,
    })
  }

  submit(candidates: readonly ResourceCandidateV1[], destinationPath: string, tool: string) {
    return this.request({
      channel: SEND_TO_OPENLIST_CHANNEL,
      version: SEND_TO_OPENLIST_PROTOCOL_VERSION,
      type: 'SEND_TO_OPENLIST_SUBMIT',
      candidates,
      destinationPath,
      tool,
    })
  }

  listTasks(list: 'undone' | 'done') {
    return this.request({
      channel: SEND_TO_OPENLIST_CHANNEL,
      version: SEND_TO_OPENLIST_PROTOCOL_VERSION,
      type: 'SEND_TO_OPENLIST_LIST_TASKS',
      list,
    })
  }

  prepareCancel(taskId: string) {
    return this.request({
      channel: SEND_TO_OPENLIST_CHANNEL,
      version: SEND_TO_OPENLIST_PROTOCOL_VERSION,
      type: 'SEND_TO_OPENLIST_PREPARE_CANCEL',
      taskId,
    })
  }

  confirmCancel(token: string) {
    return this.request({
      channel: SEND_TO_OPENLIST_CHANNEL,
      version: SEND_TO_OPENLIST_PROTOCOL_VERSION,
      type: 'SEND_TO_OPENLIST_CONFIRM_CANCEL',
      token,
    })
  }

  discoveryStatus() {
    return this.request({
      channel: SEND_TO_OPENLIST_CHANNEL,
      version: SEND_TO_OPENLIST_PROTOCOL_VERSION,
      type: 'SEND_TO_OPENLIST_DISCOVERY_STATUS',
    })
  }

  captureCurrentPage() {
    return this.request({
      channel: SEND_TO_OPENLIST_CHANNEL,
      version: SEND_TO_OPENLIST_PROTOCOL_VERSION,
      type: 'SEND_TO_OPENLIST_CAPTURE_CURRENT_PAGE',
    })
  }

  scanCurrentPage() {
    return this.request({
      channel: SEND_TO_OPENLIST_CHANNEL,
      version: SEND_TO_OPENLIST_PROTOCOL_VERSION,
      type: 'SEND_TO_OPENLIST_SCAN_CURRENT_PAGE',
    })
  }

  clearDiscovery() {
    return this.request({
      channel: SEND_TO_OPENLIST_CHANNEL,
      version: SEND_TO_OPENLIST_PROTOCOL_VERSION,
      type: 'SEND_TO_OPENLIST_CLEAR_DISCOVERY',
    })
  }

  disconnect() {
    return this.request({
      channel: SEND_TO_OPENLIST_CHANNEL,
      version: SEND_TO_OPENLIST_PROTOCOL_VERSION,
      type: 'SEND_TO_OPENLIST_DISCONNECT',
    })
  }

  deleteProfile() {
    return this.request({
      channel: SEND_TO_OPENLIST_CHANNEL,
      version: SEND_TO_OPENLIST_PROTOCOL_VERSION,
      type: 'SEND_TO_OPENLIST_DELETE_PROFILE',
    })
  }
}
