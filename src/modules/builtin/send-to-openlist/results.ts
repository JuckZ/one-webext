import type {
  SendToOpenListAddResourceCommandV1,
  SendToOpenListAddResultV1,
  SendToOpenListAuthorityV1,
  SendToOpenListCancelledTaskResultV1,
  SendToOpenListCancelTaskCommandV1,
  SendToOpenListCommandV1,
  SendToOpenListDiscoverToolsCommandV1,
  SendToOpenListErrorResultV1,
  SendToOpenListListTasksCommandV1,
  SendToOpenListOperation,
  SendToOpenListStableErrorCode,
  SendToOpenListTasksResultV1,
  SendToOpenListTaskSummaryV1,
  SendToOpenListToolsResultV1,
  SendToOpenListValidationResult,
  SendToOpenListVerifiedResultV1,
  SendToOpenListVerifyCommandV1,
} from './contracts'
import {
  SEND_TO_OPENLIST_MAX_RESPONSE_BYTES,
  SEND_TO_OPENLIST_MAX_TASK_ID_BYTES,
  SEND_TO_OPENLIST_MAX_TASK_ITEMS,
  SEND_TO_OPENLIST_MAX_TOOL_ITEMS,
  SEND_TO_OPENLIST_MAX_TOOL_NAME_BYTES,
  SEND_TO_OPENLIST_MAX_UPSTREAM_MESSAGE_BYTES,
  SEND_TO_OPENLIST_RESULT_SCHEMA_VERSION,
  SEND_TO_OPENLIST_STABLE_ERROR_CODES,
} from './contracts'
import {
  hasOnlyDataProperties,
  readDataProperty,
  utf8ByteLength,
  validationFailure,
  validationSuccess,
} from './validation'

const stableErrorCodes = new Set<string>(SEND_TO_OPENLIST_STABLE_ERROR_CODES)

function boundedText(value: unknown, maximumBytes: number, allowEmpty = false): value is string {
  if (typeof value !== 'string' || (!allowEmpty && value.length === 0) || utf8ByteLength(value) > maximumBytes)
    return false
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code <= 0x1F || code === 0x7F)
      return false
  }
  return true
}

function baseResult<Operation extends SendToOpenListOperation>(command: {
  readonly requestId: string
  readonly authority: SendToOpenListAuthorityV1
  readonly operation: Operation
}) {
  return {
    schemaVersion: SEND_TO_OPENLIST_RESULT_SCHEMA_VERSION,
    requestId: command.requestId,
    authority: command.authority,
    operation: command.operation,
  } as const
}

export function createSendToOpenListVerifiedResult(
  command: SendToOpenListVerifyCommandV1,
): SendToOpenListVerifiedResultV1 {
  return Object.freeze({
    ...baseResult(command),
    status: 'ok',
    data: Object.freeze({ authenticated: true as const }),
  })
}

export function normalizeSendToOpenListTools(
  input: unknown,
): SendToOpenListValidationResult<readonly string[]> {
  if (!Array.isArray(input) || input.length > SEND_TO_OPENLIST_MAX_TOOL_ITEMS)
    return validationFailure('protocol-incompatible', '$.tools')
  const tools: string[] = []
  for (let index = 0; index < input.length; index += 1) {
    const tool = input[index]
    if (!boundedText(tool, SEND_TO_OPENLIST_MAX_TOOL_NAME_BYTES))
      return validationFailure('protocol-incompatible', `$.tools[${index}]`)
    if (!tools.includes(tool))
      tools.push(tool)
  }
  if (utf8ByteLength(JSON.stringify(tools)) > SEND_TO_OPENLIST_MAX_RESPONSE_BYTES)
    return validationFailure('response-too-large', '$.tools')
  return validationSuccess(Object.freeze(tools))
}

export function createSendToOpenListToolsResult(
  command: SendToOpenListDiscoverToolsCommandV1,
  input: unknown,
): SendToOpenListValidationResult<SendToOpenListToolsResultV1> {
  const tools = normalizeSendToOpenListTools(input)
  if (!tools.ok)
    return tools
  return validationSuccess(Object.freeze({
    ...baseResult(command),
    status: 'ok',
    data: Object.freeze({ tools: tools.value }),
  }))
}

export function createSendToOpenListAddResult(
  command: SendToOpenListAddResourceCommandV1,
  taskIds: unknown,
): SendToOpenListValidationResult<SendToOpenListAddResultV1> {
  if (!Array.isArray(taskIds) || taskIds.length > 1)
    return validationFailure('protocol-incompatible', '$.tasks')
  let taskId: string | null = null
  if (taskIds.length === 1) {
    const value = taskIds[0]
    if (!boundedText(value, SEND_TO_OPENLIST_MAX_TASK_ID_BYTES))
      return validationFailure('protocol-incompatible', '$.tasks[0].id')
    taskId = value
  }
  return validationSuccess(Object.freeze({
    ...baseResult(command),
    status: 'ok',
    data: Object.freeze({ candidateId: command.candidate.id, taskId }),
  }))
}

function normalizeTask(input: unknown): SendToOpenListTaskSummaryV1 | null {
  if (!input || typeof input !== 'object' || !hasOnlyDataProperties(input))
    return null
  const record = input as Record<string, unknown>
  const id = readDataProperty(record, 'id')
  const name = readDataProperty(record, 'name')
  const state = readDataProperty(record, 'state')
  const status = readDataProperty(record, 'status')
  const progress = readDataProperty(record, 'progress')
  const totalBytes = readDataProperty(record, 'total_bytes')
  const error = readDataProperty(record, 'error')
  if (!boundedText(id, SEND_TO_OPENLIST_MAX_TASK_ID_BYTES)
    || !boundedText(name, SEND_TO_OPENLIST_MAX_UPSTREAM_MESSAGE_BYTES, true)
    || !Number.isSafeInteger(state)
    || Number(state) < 0
    || !boundedText(status, SEND_TO_OPENLIST_MAX_UPSTREAM_MESSAGE_BYTES, true)
    || typeof progress !== 'number'
    || !Number.isFinite(progress)
    || progress < 0
    || progress > 100
    || !Number.isSafeInteger(totalBytes)
    || Number(totalBytes) < 0
    || !boundedText(error, SEND_TO_OPENLIST_MAX_UPSTREAM_MESSAGE_BYTES, true)) {
    return null
  }
  return Object.freeze({
    id,
    name,
    state: Number(state),
    status,
    progress,
    totalBytes: Number(totalBytes),
    error,
  })
}

export function normalizeSendToOpenListTasks(
  input: unknown,
): SendToOpenListValidationResult<readonly SendToOpenListTaskSummaryV1[]> {
  if (!Array.isArray(input) || input.length > SEND_TO_OPENLIST_MAX_TASK_ITEMS)
    return validationFailure('protocol-incompatible', '$.tasks')
  const tasks: SendToOpenListTaskSummaryV1[] = []
  const ids = new Set<string>()
  for (let index = 0; index < input.length; index += 1) {
    const task = normalizeTask(input[index])
    if (!task || ids.has(task.id))
      return validationFailure('protocol-incompatible', `$.tasks[${index}]`)
    ids.add(task.id)
    tasks.push(task)
  }
  if (utf8ByteLength(JSON.stringify(tasks)) > SEND_TO_OPENLIST_MAX_RESPONSE_BYTES)
    return validationFailure('response-too-large', '$.tasks')
  return validationSuccess(Object.freeze(tasks))
}

export function createSendToOpenListTasksResult(
  command: SendToOpenListListTasksCommandV1,
  input: unknown,
): SendToOpenListValidationResult<SendToOpenListTasksResultV1> {
  const tasks = normalizeSendToOpenListTasks(input)
  if (!tasks.ok)
    return tasks
  return validationSuccess(Object.freeze({
    ...baseResult(command),
    status: 'ok',
    data: Object.freeze({ tasks: tasks.value }),
  }))
}

export function createSendToOpenListCancelledTaskResult(
  command: SendToOpenListCancelTaskCommandV1,
): SendToOpenListCancelledTaskResultV1 {
  return Object.freeze({
    ...baseResult(command),
    status: 'ok',
    data: Object.freeze({ taskId: command.taskId }),
  })
}

export function createSendToOpenListErrorResult(
  command: SendToOpenListCommandV1,
  code: unknown,
): SendToOpenListErrorResultV1 {
  if (typeof code !== 'string' || !stableErrorCodes.has(code))
    throw new TypeError('invalid Send to OpenList error code')
  return Object.freeze({
    ...baseResult(command),
    status: 'error',
    code: code as SendToOpenListStableErrorCode,
  })
}
