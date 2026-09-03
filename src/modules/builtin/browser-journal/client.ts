import type { BrowserJournalRequest } from './protocol'
import {
  BROWSER_JOURNAL_CHANNEL,
  BROWSER_JOURNAL_PROTOCOL_VERSION,
  isBrowserJournalResponse,
} from './protocol'

export interface BrowserJournalTransport {
  sendMessage: (_message: BrowserJournalRequest) => Promise<unknown>
}

export class BrowserJournalClientError extends Error {
  constructor(readonly code: 'transport-error' | 'invalid-response') {
    super(code)
    this.name = 'BrowserJournalClientError'
  }
}

export class BrowserJournalClient {
  constructor(private readonly _transport: BrowserJournalTransport) {}

  private async request(message: BrowserJournalRequest) {
    let response: unknown
    try {
      response = await this._transport.sendMessage(message)
    }
    catch {
      throw new BrowserJournalClientError('transport-error')
    }
    if (!isBrowserJournalResponse(response) || response.requestType !== message.type)
      throw new BrowserJournalClientError('invalid-response')
    return response.result
  }

  start() {
    return this.request({
      channel: BROWSER_JOURNAL_CHANNEL,
      version: BROWSER_JOURNAL_PROTOCOL_VERSION,
      type: 'BROWSER_JOURNAL_START',
    })
  }

  stop() {
    return this.request({
      channel: BROWSER_JOURNAL_CHANNEL,
      version: BROWSER_JOURNAL_PROTOCOL_VERSION,
      type: 'BROWSER_JOURNAL_STOP',
    })
  }

  status() {
    return this.request({
      channel: BROWSER_JOURNAL_CHANNEL,
      version: BROWSER_JOURNAL_PROTOCOL_VERSION,
      type: 'BROWSER_JOURNAL_STATUS',
    })
  }

  archive() {
    return this.request({
      channel: BROWSER_JOURNAL_CHANNEL,
      version: BROWSER_JOURNAL_PROTOCOL_VERSION,
      type: 'BROWSER_JOURNAL_ARCHIVE',
    })
  }

  save() {
    return this.request({
      channel: BROWSER_JOURNAL_CHANNEL,
      version: BROWSER_JOURNAL_PROTOCOL_VERSION,
      type: 'BROWSER_JOURNAL_SAVE',
    })
  }

  deleteSaved(savedSessionId: string) {
    return this.request({
      channel: BROWSER_JOURNAL_CHANNEL,
      version: BROWSER_JOURNAL_PROTOCOL_VERSION,
      type: 'BROWSER_JOURNAL_DELETE_SAVED',
      savedSessionId,
    })
  }

  clearSaved() {
    return this.request({
      channel: BROWSER_JOURNAL_CHANNEL,
      version: BROWSER_JOURNAL_PROTOCOL_VERSION,
      type: 'BROWSER_JOURNAL_CLEAR_SAVED',
      confirmation: 'clear-saved-sessions',
    })
  }
}
