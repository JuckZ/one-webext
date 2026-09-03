import type {
  BookmarkRepairConfirmation,
  BookmarkRepairRequest,
  BookmarkRestoreConfirmation,
  BookmarkScanPreparation,
  BookmarkScanSnapshot,
} from './contracts'
import type {
  BookmarkDoctorRequest,
  BookmarkDoctorResult,
} from './protocol'
import {
  BOOKMARK_DOCTOR_CHANNEL,
  BOOKMARK_DOCTOR_PROTOCOL_VERSION,
  isBookmarkDoctorResponse,
} from './protocol'

export interface BookmarkDoctorTransport {
  sendMessage: (_message: BookmarkDoctorRequest) => Promise<unknown>
}

export interface BookmarkDoctorPermissionRequester {
  request: (_permissions: { permissions?: Array<'bookmarks'>, origins?: string[] }) => Promise<boolean>
}

export interface BookmarkDoctorClientOptions extends BookmarkDoctorTransport {
  permissions: BookmarkDoctorPermissionRequester
}

export class BookmarkDoctorClientError extends Error {
  constructor(public readonly code: 'transport-error' | 'invalid-response' | 'permission-denied') {
    super(code)
    this.name = 'BookmarkDoctorClientError'
  }
}

export class BookmarkDoctorClient {
  private readonly transport: BookmarkDoctorTransport
  private readonly permissions: BookmarkDoctorPermissionRequester

  constructor({ sendMessage, permissions }: BookmarkDoctorClientOptions) {
    this.transport = { sendMessage }
    this.permissions = permissions
  }

  private async request(message: BookmarkDoctorRequest): Promise<BookmarkDoctorResult> {
    let response: unknown
    try {
      response = await this.transport.sendMessage(message)
    }
    catch {
      throw new BookmarkDoctorClientError('transport-error')
    }
    if (!isBookmarkDoctorResponse(response) || response.requestType !== message.type)
      throw new BookmarkDoctorClientError('invalid-response')
    return response.result
  }

  async authorize() {
    let granted = false
    try {
      granted = await this.permissions.request({ permissions: ['bookmarks'] })
    }
    catch {}
    if (!granted)
      throw new BookmarkDoctorClientError('permission-denied')
    return this.request({
      channel: BOOKMARK_DOCTOR_CHANNEL,
      version: BOOKMARK_DOCTOR_PROTOCOL_VERSION,
      type: 'BOOKMARK_DOCTOR_AUTHORIZE',
    })
  }

  async prepare() {
    return this.request({
      channel: BOOKMARK_DOCTOR_CHANNEL,
      version: BOOKMARK_DOCTOR_PROTOCOL_VERSION,
      type: 'BOOKMARK_DOCTOR_PREPARE',
    })
  }

  async start(preparation: BookmarkScanPreparation) {
    if (preparation.originPatterns.length) {
      let granted = false
      try {
        granted = await this.permissions.request({ origins: preparation.originPatterns })
      }
      catch {}
      if (!granted)
        throw new BookmarkDoctorClientError('permission-denied')
    }
    return this.request({
      channel: BOOKMARK_DOCTOR_CHANNEL,
      version: BOOKMARK_DOCTOR_PROTOCOL_VERSION,
      type: 'BOOKMARK_DOCTOR_START',
      token: preparation.token,
    })
  }

  async status(): Promise<BookmarkScanSnapshot | null> {
    const result = await this.request({
      channel: BOOKMARK_DOCTOR_CHANNEL,
      version: BOOKMARK_DOCTOR_PROTOCOL_VERSION,
      type: 'BOOKMARK_DOCTOR_STATUS',
    })
    if (result.operation !== 'status')
      throw new BookmarkDoctorClientError('invalid-response')
    return result.snapshot
  }

  async stop() {
    return this.request({
      channel: BOOKMARK_DOCTOR_CHANNEL,
      version: BOOKMARK_DOCTOR_PROTOCOL_VERSION,
      type: 'BOOKMARK_DOCTOR_STOP',
    })
  }

  async authorizeRepairs() {
    return this.request({
      channel: BOOKMARK_DOCTOR_CHANNEL,
      version: BOOKMARK_DOCTOR_PROTOCOL_VERSION,
      type: 'BOOKMARK_DOCTOR_AUTHORIZE_REPAIRS',
    })
  }

  async prepareRepair(request: BookmarkRepairRequest) {
    return this.request({
      channel: BOOKMARK_DOCTOR_CHANNEL,
      version: BOOKMARK_DOCTOR_PROTOCOL_VERSION,
      type: 'BOOKMARK_DOCTOR_PREPARE_REPAIR',
      request,
    })
  }

  async confirmRepairs(confirmations: BookmarkRepairConfirmation[]) {
    return this.request({
      channel: BOOKMARK_DOCTOR_CHANNEL,
      version: BOOKMARK_DOCTOR_PROTOCOL_VERSION,
      type: 'BOOKMARK_DOCTOR_CONFIRM_REPAIRS',
      confirmations,
    })
  }

  async workspaceState() {
    return this.request({
      channel: BOOKMARK_DOCTOR_CHANNEL,
      version: BOOKMARK_DOCTOR_PROTOCOL_VERSION,
      type: 'BOOKMARK_DOCTOR_WORKSPACE_STATE',
    })
  }

  async unignore(bookmarkId: string) {
    return this.request({
      channel: BOOKMARK_DOCTOR_CHANNEL,
      version: BOOKMARK_DOCTOR_PROTOCOL_VERSION,
      type: 'BOOKMARK_DOCTOR_UNIGNORE',
      bookmarkId,
    })
  }

  async clearLocalData() {
    return this.request({
      channel: BOOKMARK_DOCTOR_CHANNEL,
      version: BOOKMARK_DOCTOR_PROTOCOL_VERSION,
      type: 'BOOKMARK_DOCTOR_CLEAR_LOCAL_DATA',
      confirmation: 'clear-local-data',
    })
  }

  async prepareRestore(backupToken: string) {
    return this.request({
      channel: BOOKMARK_DOCTOR_CHANNEL,
      version: BOOKMARK_DOCTOR_PROTOCOL_VERSION,
      type: 'BOOKMARK_DOCTOR_PREPARE_RESTORE',
      backupToken,
    })
  }

  async confirmRestore(confirmation: BookmarkRestoreConfirmation) {
    return this.request({
      channel: BOOKMARK_DOCTOR_CHANNEL,
      version: BOOKMARK_DOCTOR_PROTOCOL_VERSION,
      type: 'BOOKMARK_DOCTOR_CONFIRM_RESTORE',
      confirmation,
    })
  }

  async revoke() {
    return this.request({
      channel: BOOKMARK_DOCTOR_CHANNEL,
      version: BOOKMARK_DOCTOR_PROTOCOL_VERSION,
      type: 'BOOKMARK_DOCTOR_REVOKE',
    })
  }
}
