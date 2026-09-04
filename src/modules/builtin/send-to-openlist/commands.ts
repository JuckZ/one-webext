import type {
  SendToOpenListAddResourceCommandV1,
  SendToOpenListAuthorityV1,
  SendToOpenListCancelTaskCommandV1,
  SendToOpenListCommandV1,
  SendToOpenListDiscoverToolsCommandV1,
  SendToOpenListListTasksCommandV1,
  SendToOpenListOperation,
  SendToOpenListValidationResult,
  SendToOpenListVerifyCommandV1,
} from './contracts'
import { classifyResourceCandidateSsr, validateResourceCandidate } from './candidate'
import {
  SEND_TO_OPENLIST_COMMAND_SCHEMA_VERSION,
  SEND_TO_OPENLIST_MAX_DESTINATION_PATH_BYTES,
  SEND_TO_OPENLIST_MAX_REQUEST_ID_LENGTH,
  SEND_TO_OPENLIST_MAX_TASK_ID_BYTES,
  SEND_TO_OPENLIST_MAX_TOOL_NAME_BYTES,
} from './contracts'
import {
  hasOnlyDataProperties,
  readDataProperty,
  utf8ByteLength,
  validateSendToOpenListAuthority,
  validationFailure,
  validationSuccess,
} from './validation'

const requestIdPattern = /^\w[\w.:-]*$/
const authorityKeys = new Set(['moduleId', 'profileId', 'controllerOrigin', 'generation'])
const baseKeys = ['schemaVersion', 'requestId', 'authority', 'operation']
const commandKeys = new Map<SendToOpenListOperation, ReadonlySet<string>>([
  ['verify-profile', new Set(baseKeys)],
  ['discover-tools', new Set([...baseKeys, 'destinationPath'])],
  ['add-resource', new Set([...baseKeys, 'candidate', 'destinationPath', 'tool'])],
  ['list-undone-tasks', new Set(baseKeys)],
  ['list-done-tasks', new Set(baseKeys)],
  ['cancel-task', new Set([...baseKeys, 'taskId', 'reviewToken'])],
])

function validBoundedText(value: unknown, maximumBytes: number) {
  return typeof value === 'string'
    && value.length > 0
    && !Array.from(value).some((character) => {
      const code = character.charCodeAt(0)
      return code <= 0x1F || code === 0x7F
    })
    && utf8ByteLength(value) <= maximumBytes
}

function canonicalBase(
  authorityInput: unknown,
  requestId: unknown,
): SendToOpenListValidationResult<{
    readonly authority: SendToOpenListAuthorityV1
    readonly requestId: string
  }> {
  const authority = validateSendToOpenListAuthority(authorityInput)
  if (!authority.ok)
    return authority
  if (typeof requestId !== 'string'
    || requestId.length > SEND_TO_OPENLIST_MAX_REQUEST_ID_LENGTH
    || !requestIdPattern.test(requestId)) {
    return validationFailure('invalid-command', '$.requestId')
  }
  return validationSuccess(Object.freeze({ authority: authority.value, requestId }))
}

function frozenBase<Operation extends SendToOpenListOperation>(
  base: { readonly authority: SendToOpenListAuthorityV1, readonly requestId: string },
  operation: Operation,
) {
  return {
    schemaVersion: SEND_TO_OPENLIST_COMMAND_SCHEMA_VERSION,
    requestId: base.requestId,
    authority: base.authority,
    operation,
  } as const
}

export function createSendToOpenListVerifyCommand(
  authority: unknown,
  requestId: unknown,
): SendToOpenListValidationResult<SendToOpenListVerifyCommandV1> {
  const base = canonicalBase(authority, requestId)
  return base.ok
    ? validationSuccess(Object.freeze(frozenBase(base.value, 'verify-profile')))
    : base
}

export function createSendToOpenListDiscoverToolsCommand(
  authority: unknown,
  requestId: unknown,
  destinationPath: unknown,
): SendToOpenListValidationResult<SendToOpenListDiscoverToolsCommandV1> {
  const base = canonicalBase(authority, requestId)
  if (!base.ok)
    return base
  if (!validBoundedText(destinationPath, SEND_TO_OPENLIST_MAX_DESTINATION_PATH_BYTES)
    || !(destinationPath as string).startsWith('/')) {
    return validationFailure('invalid-command', '$.destinationPath')
  }
  return validationSuccess(Object.freeze({
    ...frozenBase(base.value, 'discover-tools'),
    destinationPath: destinationPath as string,
  }))
}

export function createSendToOpenListAddResourceCommand(
  authority: unknown,
  requestId: unknown,
  candidateInput: unknown,
  destinationPath: unknown,
  tool: unknown,
  reviewedTools: readonly string[],
): SendToOpenListValidationResult<SendToOpenListAddResourceCommandV1> {
  const base = canonicalBase(authority, requestId)
  if (!base.ok)
    return base
  const candidate = validateResourceCandidate(candidateInput)
  if (!candidate.ok)
    return candidate
  if (classifyResourceCandidateSsr(candidate.value).decision === 'block-local-use')
    return validationFailure('local-use-blocked', '$.candidate.url')
  if (!validBoundedText(destinationPath, SEND_TO_OPENLIST_MAX_DESTINATION_PATH_BYTES)
    || !(destinationPath as string).startsWith('/')) {
    return validationFailure('invalid-command', '$.destinationPath')
  }
  if (!validBoundedText(tool, SEND_TO_OPENLIST_MAX_TOOL_NAME_BYTES)
    || !Array.isArray(reviewedTools)
    || !reviewedTools.includes(tool as string)) {
    return validationFailure('unreviewed-tool', '$.tool')
  }
  return validationSuccess(Object.freeze({
    ...frozenBase(base.value, 'add-resource'),
    candidate: candidate.value,
    destinationPath: destinationPath as string,
    tool: tool as string,
  }))
}

export function createSendToOpenListListTasksCommand(
  authority: unknown,
  requestId: unknown,
  list: unknown,
): SendToOpenListValidationResult<SendToOpenListListTasksCommandV1> {
  const base = canonicalBase(authority, requestId)
  if (!base.ok)
    return base
  if (list !== 'undone' && list !== 'done')
    return validationFailure('invalid-command', '$.operation')
  return validationSuccess(Object.freeze(frozenBase(
    base.value,
    list === 'undone' ? 'list-undone-tasks' : 'list-done-tasks',
  )))
}

export function createSendToOpenListCancelTaskCommand(
  authority: unknown,
  requestId: unknown,
  taskId: unknown,
  reviewToken: unknown,
  reviewedTaskIds: readonly string[],
): SendToOpenListValidationResult<SendToOpenListCancelTaskCommandV1> {
  const base = canonicalBase(authority, requestId)
  if (!base.ok)
    return base
  if (!validBoundedText(taskId, SEND_TO_OPENLIST_MAX_TASK_ID_BYTES)
    || !Array.isArray(reviewedTaskIds)
    || !reviewedTaskIds.includes(taskId as string)) {
    return validationFailure('unreviewed-task', '$.taskId')
  }
  if (!validBoundedText(reviewToken, SEND_TO_OPENLIST_MAX_REQUEST_ID_LENGTH))
    return validationFailure('invalid-command', '$.reviewToken')
  return validationSuccess(Object.freeze({
    ...frozenBase(base.value, 'cancel-task'),
    taskId: taskId as string,
    reviewToken: reviewToken as string,
  }))
}

export function validateSendToOpenListCommand(
  input: unknown,
): SendToOpenListValidationResult<SendToOpenListCommandV1> {
  if (!input || typeof input !== 'object' || !hasOnlyDataProperties(input))
    return validationFailure('invalid-command', '$')
  const record = input as Record<string, unknown>
  const operation = readDataProperty(record, 'operation') as SendToOpenListOperation
  const expectedKeys = commandKeys.get(operation)
  if (!expectedKeys || !hasOnlyDataProperties(input, expectedKeys))
    return validationFailure('invalid-command', '$')
  if (readDataProperty(record, 'schemaVersion') !== SEND_TO_OPENLIST_COMMAND_SCHEMA_VERSION)
    return validationFailure('invalid-command', '$.schemaVersion')

  const authority = readDataProperty(record, 'authority')
  const requestId = readDataProperty(record, 'requestId')
  switch (operation) {
    case 'verify-profile':
      return createSendToOpenListVerifyCommand(authority, requestId)
    case 'discover-tools':
      return createSendToOpenListDiscoverToolsCommand(authority, requestId, readDataProperty(record, 'destinationPath'))
    case 'add-resource':
      return createSendToOpenListAddResourceCommand(
        authority,
        requestId,
        readDataProperty(record, 'candidate'),
        readDataProperty(record, 'destinationPath'),
        readDataProperty(record, 'tool'),
        [readDataProperty(record, 'tool') as string],
      )
    case 'list-undone-tasks':
      return createSendToOpenListListTasksCommand(authority, requestId, 'undone')
    case 'list-done-tasks':
      return createSendToOpenListListTasksCommand(authority, requestId, 'done')
    case 'cancel-task':
      return createSendToOpenListCancelTaskCommand(
        authority,
        requestId,
        readDataProperty(record, 'taskId'),
        readDataProperty(record, 'reviewToken'),
        [readDataProperty(record, 'taskId') as string],
      )
  }
}

export function authorityHasOnlyCanonicalFields(authority: object) {
  return hasOnlyDataProperties(authority, authorityKeys)
}
