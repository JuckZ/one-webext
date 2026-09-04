import type {
  ResourceCandidateV1,
  SendToOpenListConnectionPreparationV1,
  SendToOpenListProfileV1,
} from './contracts'
import {
  SEND_TO_OPENLIST_MAX_DESTINATION_PATH_BYTES,
  SEND_TO_OPENLIST_MAX_SUBMISSION_CANDIDATES,
  SEND_TO_OPENLIST_MAX_TOKEN_BYTES,
  SEND_TO_OPENLIST_MAX_TOOL_NAME_BYTES,
} from './contracts'
import { utf8ByteLength } from './validation'

export const SEND_TO_OPENLIST_CHANNEL = 'oneweb.send-to-openlist' as const
export const SEND_TO_OPENLIST_PROTOCOL_VERSION = 1 as const

interface RequestBase {
  channel: typeof SEND_TO_OPENLIST_CHANNEL
  version: typeof SEND_TO_OPENLIST_PROTOCOL_VERSION
}

export type SendToOpenListRequest =
  | RequestBase & { type: 'SEND_TO_OPENLIST_PREPARE', profile: SendToOpenListProfileV1 }
  | RequestBase & {
    type: 'SEND_TO_OPENLIST_CONNECT'
    preparation: SendToOpenListConnectionPreparationV1
    token?: string
  }
  | RequestBase & { type: 'SEND_TO_OPENLIST_STATUS' }
  | RequestBase & { type: 'SEND_TO_OPENLIST_DISCOVER_TOOLS', destinationPath: string }
  | RequestBase & {
    type: 'SEND_TO_OPENLIST_SUBMIT'
    candidates: readonly ResourceCandidateV1[]
    destinationPath: string
    tool: string
  }
  | RequestBase & { type: 'SEND_TO_OPENLIST_LIST_TASKS', list: 'undone' | 'done' }
  | RequestBase & { type: 'SEND_TO_OPENLIST_PREPARE_CANCEL', taskId: string }
  | RequestBase & { type: 'SEND_TO_OPENLIST_CONFIRM_CANCEL', token: string }
  | RequestBase & { type: 'SEND_TO_OPENLIST_DISCONNECT' }
  | RequestBase & { type: 'SEND_TO_OPENLIST_DELETE_PROFILE' }

export type SendToOpenListRequestType = SendToOpenListRequest['type']

export interface SendToOpenListResponse {
  channel: typeof SEND_TO_OPENLIST_CHANNEL
  version: typeof SEND_TO_OPENLIST_PROTOCOL_VERSION
  type: 'SEND_TO_OPENLIST_RESPONSE'
  requestType: SendToOpenListRequestType
  result: unknown
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function boundedText(value: unknown, maximumBytes: number) {
  return typeof value === 'string' && utf8ByteLength(value) <= maximumBytes
}

export function isSendToOpenListRequest(value: unknown): value is SendToOpenListRequest {
  if (!isPlainRecord(value)
    || value.channel !== SEND_TO_OPENLIST_CHANNEL
    || value.version !== SEND_TO_OPENLIST_PROTOCOL_VERSION
    || typeof value.type !== 'string') {
    return false
  }
  if (value.type === 'SEND_TO_OPENLIST_PREPARE')
    return Object.keys(value).length === 4 && isPlainRecord(value.profile)
  if (value.type === 'SEND_TO_OPENLIST_CONNECT') {
    return (Object.keys(value).length === 4 || Object.keys(value).length === 5)
      && isPlainRecord(value.preparation)
      && (value.token === undefined
        || (boundedText(value.token, SEND_TO_OPENLIST_MAX_TOKEN_BYTES)
          && (value.token as string).length > 0
          && !(value.token as string).includes('\r')
          && !(value.token as string).includes('\n')))
  }
  if (value.type === 'SEND_TO_OPENLIST_STATUS'
    || value.type === 'SEND_TO_OPENLIST_DISCONNECT'
    || value.type === 'SEND_TO_OPENLIST_DELETE_PROFILE') {
    return Object.keys(value).length === 3
  }
  if (value.type === 'SEND_TO_OPENLIST_DISCOVER_TOOLS') {
    return Object.keys(value).length === 4
      && boundedText(value.destinationPath, SEND_TO_OPENLIST_MAX_DESTINATION_PATH_BYTES)
  }
  if (value.type === 'SEND_TO_OPENLIST_LIST_TASKS') {
    return Object.keys(value).length === 4
      && (value.list === 'undone' || value.list === 'done')
  }
  if (value.type === 'SEND_TO_OPENLIST_PREPARE_CANCEL') {
    return Object.keys(value).length === 4
      && boundedText(value.taskId, 512)
      && (value.taskId as string).length > 0
  }
  if (value.type === 'SEND_TO_OPENLIST_CONFIRM_CANCEL') {
    return Object.keys(value).length === 4
      && boundedText(value.token, 128)
      && (value.token as string).length >= 32
  }
  if (value.type === 'SEND_TO_OPENLIST_SUBMIT') {
    return Object.keys(value).length === 6
      && Array.isArray(value.candidates)
      && value.candidates.length <= SEND_TO_OPENLIST_MAX_SUBMISSION_CANDIDATES
      && boundedText(value.destinationPath, SEND_TO_OPENLIST_MAX_DESTINATION_PATH_BYTES)
      && boundedText(value.tool, SEND_TO_OPENLIST_MAX_TOOL_NAME_BYTES)
  }
  return false
}

export function createSendToOpenListResponse(
  requestType: SendToOpenListRequestType,
  result: unknown,
): SendToOpenListResponse {
  return {
    channel: SEND_TO_OPENLIST_CHANNEL,
    version: SEND_TO_OPENLIST_PROTOCOL_VERSION,
    type: 'SEND_TO_OPENLIST_RESPONSE',
    requestType,
    result,
  }
}

export function isSendToOpenListResponse(value: unknown): value is SendToOpenListResponse {
  return isPlainRecord(value)
    && value.channel === SEND_TO_OPENLIST_CHANNEL
    && value.version === SEND_TO_OPENLIST_PROTOCOL_VERSION
    && value.type === 'SEND_TO_OPENLIST_RESPONSE'
    && typeof value.requestType === 'string'
    && Object.prototype.hasOwnProperty.call(value, 'result')
}
