import { normalizeResourceCandidate } from '../candidate'
import {
  createSendToOpenListAddResourceCommand,
  createSendToOpenListCancelTaskCommand,
  createSendToOpenListDiscoverToolsCommand,
  createSendToOpenListListTasksCommand,
  createSendToOpenListVerifyCommand,
  validateSendToOpenListCommand,
} from '../commands'
import { SEND_TO_OPENLIST_MODULE_ID } from '../contracts'

function authority(overrides: Record<string, unknown> = {}) {
  return {
    moduleId: SEND_TO_OPENLIST_MODULE_ID,
    profileId: 'home',
    controllerOrigin: 'https://openlist.example',
    generation: 3,
    ...overrides,
  }
}

function valueOf<Value>(result: { ok: true, value: Value } | { ok: false }) {
  if (!result.ok)
    throw new Error('Expected validation success')
  return result.value
}

function candidate(url = 'https://downloads.example/file') {
  return valueOf(normalizeResourceCandidate({ url, source: 'manual', title: 'Untrusted <b>title</b>' }))
}

describe('send to OpenList canonical commands', () => {
  it('defines only the fixed connector operation surface without transport fields', () => {
    const commands = [
      valueOf(createSendToOpenListVerifyCommand(authority(), 'request-1')),
      valueOf(createSendToOpenListDiscoverToolsCommand(authority(), 'request-2', '/downloads')),
      valueOf(createSendToOpenListAddResourceCommand(
        authority(),
        'request-3',
        candidate(),
        '/downloads',
        'server-returned-tool',
        ['server-returned-tool'],
      )),
      valueOf(createSendToOpenListListTasksCommand(authority(), 'request-4', 'undone')),
      valueOf(createSendToOpenListListTasksCommand(authority(), 'request-5', 'done')),
      valueOf(createSendToOpenListCancelTaskCommand(
        authority(),
        'request-6',
        'task-from-snapshot',
        'single-use-review-token',
        ['task-from-snapshot'],
      )),
    ]

    expect(commands.map(command => command.operation)).toEqual([
      'verify-profile',
      'discover-tools',
      'add-resource',
      'list-undone-tasks',
      'list-done-tasks',
      'cancel-task',
    ])
    for (const command of commands) {
      expect(Object.isFrozen(command)).toBe(true)
      expect(Object.isFrozen(command.authority)).toBe(true)
      expect(command).not.toHaveProperty('url')
      expect(command).not.toHaveProperty('method')
      expect(command).not.toHaveProperty('apiPath')
      expect(command).not.toHaveProperty('headers')
      expect(JSON.stringify(command)).not.toContain('Authorization')
      expect(validateSendToOpenListCommand(command)).toMatchObject({ ok: true })
    }
  })

  it('derives canonical identity and rejects attempts to replace it or attach a secret', () => {
    expect(createSendToOpenListVerifyCommand({
      ...authority(),
      moduleId: 'dev.remote.attacker',
    }, 'request-1')).toMatchObject({ ok: false, code: 'invalid-authority' })
    expect(createSendToOpenListVerifyCommand({
      ...authority(),
      token: 'secret',
    }, 'request-1')).toMatchObject({ ok: false, code: 'invalid-authority' })
    expect(createSendToOpenListVerifyCommand(authority(), '../request')).toMatchObject({
      ok: false,
      code: 'invalid-command',
    })
  })

  it('accepts only a currently reviewed dynamic tool and a public candidate', () => {
    expect(createSendToOpenListAddResourceCommand(
      authority(),
      'request-1',
      candidate(),
      '/downloads',
      'caller-invented-tool',
      ['server-returned-tool'],
    )).toMatchObject({ ok: false, code: 'unreviewed-tool' })
    expect(createSendToOpenListAddResourceCommand(
      authority(),
      'request-1',
      candidate('http://127.1/private'),
      '/downloads',
      'server-returned-tool',
      ['server-returned-tool'],
    )).toMatchObject({ ok: false, code: 'local-use-blocked' })
  })

  it('accepts cancellation only for a task from reviewed server authority', () => {
    expect(createSendToOpenListCancelTaskCommand(
      authority(),
      'request-1',
      'substituted-task',
      'review-token',
      ['reviewed-task'],
    )).toMatchObject({ ok: false, code: 'unreviewed-task' })
    expect(createSendToOpenListCancelTaskCommand(
      authority(),
      'request-1',
      'reviewed-task',
      '',
      ['reviewed-task'],
    )).toMatchObject({ ok: false, code: 'invalid-command' })
  })

  it('rejects arbitrary list variants, paths and command envelope fields', () => {
    expect(createSendToOpenListListTasksCommand(authority(), 'request-1', 'all'))
      .toMatchObject({ ok: false, code: 'invalid-command' })
    expect(createSendToOpenListDiscoverToolsCommand(authority(), 'request-1', 'relative/path'))
      .toMatchObject({ ok: false, code: 'invalid-command' })

    const valid = valueOf(createSendToOpenListVerifyCommand(authority(), 'request-1'))
    expect(validateSendToOpenListCommand({ ...valid, method: 'DELETE' }))
      .toMatchObject({ ok: false, code: 'invalid-command' })
    expect(validateSendToOpenListCommand({ ...valid, authority: { ...valid.authority, origin: 'https://evil.example' } }))
      .toMatchObject({ ok: false, code: 'invalid-authority' })
  })

  it('canonically clones caller-owned candidates so later mutation cannot alter a command', () => {
    const source = { ...candidate() }
    const command = valueOf(createSendToOpenListAddResourceCommand(
      authority(),
      'request-1',
      source,
      '/downloads',
      'tool-a',
      ['tool-a'],
    ))
    source.url = 'https://evil.example/replaced'
    expect(command.candidate.url).toBe('https://downloads.example/file')
    expect(Object.isFrozen(command.candidate)).toBe(true)
  })
})
