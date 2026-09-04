import { normalizeResourceCandidate } from '../candidate'
import {
  createSendToOpenListAddResourceCommand,
  createSendToOpenListCancelTaskCommand,
  createSendToOpenListDiscoverToolsCommand,
  createSendToOpenListListTasksCommand,
  createSendToOpenListVerifyCommand,
} from '../commands'
import { SEND_TO_OPENLIST_MAX_TASK_ITEMS, SEND_TO_OPENLIST_MODULE_ID } from '../contracts'
import {
  createSendToOpenListAddResult,
  createSendToOpenListCancelledTaskResult,
  createSendToOpenListErrorResult,
  createSendToOpenListTasksResult,
  createSendToOpenListToolsResult,
  createSendToOpenListVerifiedResult,
  normalizeSendToOpenListTasks,
  normalizeSendToOpenListTools,
} from '../results'

function valueOf<Value>(result: { ok: true, value: Value } | { ok: false }) {
  if (!result.ok)
    throw new Error('Expected validation success')
  return result.value
}

const authority = {
  moduleId: SEND_TO_OPENLIST_MODULE_ID,
  profileId: 'home',
  controllerOrigin: 'https://openlist.example',
  generation: 4,
} as const

function rawTask(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task-1',
    name: '<img onerror=alert(1)>',
    creator: 'ignored-user',
    creator_role: 0,
    state: 1,
    status: 'running <script>',
    progress: 25.5,
    start_time: null,
    end_time: null,
    total_bytes: 2048,
    error: '',
    ...overrides,
  }
}

describe('send to OpenList result contract', () => {
  it('binds success and stable error results to canonical command identity', () => {
    const command = valueOf(createSendToOpenListVerifyCommand(authority, 'request-1'))
    expect(createSendToOpenListVerifiedResult(command)).toEqual({
      schemaVersion: 1,
      requestId: 'request-1',
      authority,
      operation: 'verify-profile',
      status: 'ok',
      data: { authenticated: true },
    })
    expect(createSendToOpenListErrorResult(command, 'authentication-failed')).toEqual({
      schemaVersion: 1,
      requestId: 'request-1',
      authority,
      operation: 'verify-profile',
      status: 'error',
      code: 'authentication-failed',
    })
    expect(() => createSendToOpenListErrorResult(command, 'raw-upstream-message')).toThrow(TypeError)
  })

  it('keeps server-returned tools dynamic, bounded, deduplicated and text-only', () => {
    const command = valueOf(createSendToOpenListDiscoverToolsCommand(authority, 'request-2', '/downloads'))
    const result = valueOf(createSendToOpenListToolsResult(command, ['Aria2', '<b>custom tool</b>', 'Aria2']))
    expect(result.data.tools).toEqual(['Aria2', '<b>custom tool</b>'])
    expect(Object.isFrozen(result.data.tools)).toBe(true)
    expect(normalizeSendToOpenListTools(['bad\nname'])).toMatchObject({ ok: false })
  })

  it('accepts direct SimpleHttp success without inventing a task ID', () => {
    const candidate = valueOf(normalizeResourceCandidate({
      url: 'https://downloads.example/file',
      source: 'manual',
    }))
    const command = valueOf(createSendToOpenListAddResourceCommand(
      authority,
      'request-3',
      candidate,
      '/downloads',
      'SimpleHttp',
      ['SimpleHttp'],
    ))
    expect(valueOf(createSendToOpenListAddResult(command, [])).data).toEqual({
      candidateId: candidate.id,
      taskId: null,
    })
    expect(valueOf(createSendToOpenListAddResult(command, ['task-1'])).data.taskId).toBe('task-1')
    expect(createSendToOpenListAddResult(command, ['task-1', 'unexpected-task']))
      .toMatchObject({ ok: false })
  })

  it('projects only bounded task fields and drops creator/session details', () => {
    const tasks = valueOf(normalizeSendToOpenListTasks([rawTask()]))
    expect(tasks).toEqual([{
      id: 'task-1',
      name: '<img onerror=alert(1)>',
      state: 1,
      status: 'running <script>',
      progress: 25.5,
      totalBytes: 2048,
      error: '',
    }])
    expect(JSON.stringify(tasks)).not.toContain('ignored-user')
    expect(Object.isFrozen(tasks[0])).toBe(true)
  })

  it('rejects malformed, duplicate, non-finite and over-limit task responses', () => {
    expect(normalizeSendToOpenListTasks([rawTask({ progress: Number.NaN })])).toMatchObject({ ok: false })
    expect(normalizeSendToOpenListTasks([rawTask(), rawTask()])).toMatchObject({ ok: false })
    expect(normalizeSendToOpenListTasks(Array.from(
      { length: SEND_TO_OPENLIST_MAX_TASK_ITEMS + 1 },
      (_, index) => rawTask({ id: `task-${index}` }),
    ))).toMatchObject({ ok: false })

    const aggregateOverflow = Array.from({ length: 400 }, (_, index) => rawTask({
      id: `task-${index}`,
      name: 'n'.repeat(500),
      status: 's'.repeat(500),
      error: 'e'.repeat(500),
    }))
    expect(normalizeSendToOpenListTasks(aggregateOverflow))
      .toMatchObject({ ok: false, code: 'response-too-large' })
  })

  it('builds task list and cancel results without accepting caller transport data', () => {
    const list = valueOf(createSendToOpenListListTasksCommand(authority, 'request-4', 'undone'))
    const listResult = valueOf(createSendToOpenListTasksResult(list, [rawTask()]))
    expect(listResult.operation).toBe('list-undone-tasks')
    expect(listResult.data.tasks).toHaveLength(1)

    const cancel = valueOf(createSendToOpenListCancelTaskCommand(
      authority,
      'request-5',
      'task-1',
      'review-token',
      ['task-1'],
    ))
    expect(createSendToOpenListCancelledTaskResult(cancel)).toMatchObject({
      operation: 'cancel-task',
      status: 'ok',
      data: { taskId: 'task-1' },
    })
  })
})
