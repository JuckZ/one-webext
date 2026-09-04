import type { SendToOpenListSubmissionStateV1 } from '../contracts'
import { SEND_TO_OPENLIST_MAX_SUBMISSION_CANDIDATES, SEND_TO_OPENLIST_MODULE_ID } from '../contracts'
import {
  createSendToOpenListSubmissionState,
  getSendToOpenListDispatchableCandidates,
  reduceSendToOpenListSubmission,
} from '../submission'

function authority(overrides: Record<string, unknown> = {}) {
  return {
    moduleId: SEND_TO_OPENLIST_MODULE_ID,
    profileId: 'home',
    controllerOrigin: 'https://openlist.example',
    generation: 9,
    ...overrides,
  }
}

function candidate(index: number) {
  return { url: `https://downloads.example/${index}`, source: 'manual' }
}

function state(count = 3) {
  const result = createSendToOpenListSubmissionState(
    authority(),
    Array.from({ length: count }, (_, index) => candidate(index)),
  )
  if (!result.ok)
    throw new Error(result.code)
  return result.value
}

function start(current: SendToOpenListSubmissionStateV1) {
  return reduceSendToOpenListSubmission(current, { type: 'start', authority: authority() })
}

describe('send to OpenList submission lifecycle', () => {
  it('creates an immutable deduplicated local plan without dispatching anything', () => {
    const result = createSendToOpenListSubmissionState(authority(), [candidate(1), candidate(1)])
    expect(result).toMatchObject({
      ok: true,
      value: { status: 'ready', inFlight: 0, entries: [{ status: 'queued' }] },
    })
    if (!result.ok)
      throw new Error(result.code)
    expect(Object.isFrozen(result.value)).toBe(true)
    expect(Object.isFrozen(result.value.entries)).toBe(true)
    expect(Object.isFrozen(result.value.entries[0]?.candidate)).toBe(true)
  })

  it('exposes at most two dispatchable candidates and enforces the in-flight cap', () => {
    let current = start(state())
    expect(getSendToOpenListDispatchableCandidates(current)).toHaveLength(2)
    current = reduceSendToOpenListSubmission(current, {
      type: 'dispatch',
      authority: authority(),
      candidateId: current.entries[0]!.candidate.id,
    })
    current = reduceSendToOpenListSubmission(current, {
      type: 'dispatch',
      authority: authority(),
      candidateId: current.entries[1]!.candidate.id,
    })
    const unchanged = reduceSendToOpenListSubmission(current, {
      type: 'dispatch',
      authority: authority(),
      candidateId: current.entries[2]!.candidate.id,
    })
    expect(current.inFlight).toBe(2)
    expect(getSendToOpenListDispatchableCandidates(current)).toHaveLength(0)
    expect(unchanged).toBe(current)
  })

  it('records independent accepted, failed and ambiguous write outcomes', () => {
    let current = start(state())
    const [first, second, third] = current.entries.map(entry => entry.candidate.id)
    current = reduceSendToOpenListSubmission(current, { type: 'dispatch', authority: authority(), candidateId: first! })
    current = reduceSendToOpenListSubmission(current, { type: 'dispatch', authority: authority(), candidateId: second! })
    current = reduceSendToOpenListSubmission(current, {
      type: 'resolve',
      authority: authority(),
      candidateId: first!,
      outcome: { status: 'accepted', taskId: null },
    })
    current = reduceSendToOpenListSubmission(current, {
      type: 'resolve',
      authority: authority(),
      candidateId: second!,
      outcome: { status: 'failed', code: 'authentication-failed' },
    })
    current = reduceSendToOpenListSubmission(current, { type: 'dispatch', authority: authority(), candidateId: third! })
    current = reduceSendToOpenListSubmission(current, {
      type: 'resolve',
      authority: authority(),
      candidateId: third!,
      outcome: { status: 'outcome-unknown', code: 'outcome-unknown' },
    })

    expect(current.status).toBe('completed')
    expect(current.entries.map(entry => entry.status)).toEqual(['accepted', 'failed', 'outcome-unknown'])
    expect(current.inFlight).toBe(0)
  })

  it('uses first-terminal-wins for duplicate and late results', () => {
    let current = start(state(1))
    const candidateId = current.entries[0]!.candidate.id
    current = reduceSendToOpenListSubmission(current, { type: 'dispatch', authority: authority(), candidateId })
    current = reduceSendToOpenListSubmission(current, {
      type: 'resolve',
      authority: authority(),
      candidateId,
      outcome: { status: 'accepted', taskId: 'task-1' },
    })
    const duplicate = reduceSendToOpenListSubmission(current, {
      type: 'resolve',
      authority: authority(),
      candidateId,
      outcome: { status: 'failed', code: 'network-failed' },
    })
    expect(duplicate).toBe(current)
    expect(duplicate.entries[0]).toMatchObject({ status: 'accepted', taskId: 'task-1' })
  })

  it('rejects cross-profile, cross-origin, stale-generation and forged-module actions', () => {
    const current = start(state(1))
    const candidateId = current.entries[0]!.candidate.id
    for (const changed of [
      authority({ profileId: 'other' }),
      authority({ controllerOrigin: 'https://other.example' }),
      authority({ generation: 8 }),
      authority({ moduleId: 'dev.remote.attacker' }),
    ]) {
      expect(reduceSendToOpenListSubmission(current, {
        type: 'dispatch',
        authority: changed as ReturnType<typeof authority>,
        candidateId,
      })).toBe(current)
    }
  })

  it('stops locally without pretending an in-flight server write was cancelled', () => {
    let current = start(state(3))
    current = reduceSendToOpenListSubmission(current, {
      type: 'dispatch',
      authority: authority(),
      candidateId: current.entries[0]!.candidate.id,
    })
    current = reduceSendToOpenListSubmission(current, { type: 'stop', authority: authority() })
    expect(current.status).toBe('cancelled')
    expect(current.entries.map(entry => entry.status)).toEqual(['outcome-unknown', 'cancelled', 'cancelled'])

    const late = reduceSendToOpenListSubmission(current, {
      type: 'resolve',
      authority: authority(),
      candidateId: current.entries[0]!.candidate.id,
      outcome: { status: 'accepted', taskId: 'late-task' },
    })
    expect(late).toBe(current)
  })

  it.each(['disabled', 'profile-removed', 'grant-revoked', 'reinstalled', 'worker-restart'] as const)(
    'invalidates only local authority on %s',
    (reason) => {
      let current = start(state(2))
      current = reduceSendToOpenListSubmission(current, {
        type: 'dispatch',
        authority: authority(),
        candidateId: current.entries[0]!.candidate.id,
      })
      current = reduceSendToOpenListSubmission(current, { type: 'invalidate', authority: authority(), reason })
      expect(current.status).toBe('invalidated')
      expect(current.entries.map(entry => entry.status)).toEqual(['outcome-unknown', 'cancelled'])
    },
  )

  it('completes an empty plan and rejects over-limit or local-use plans', () => {
    expect(start(state(0))).toMatchObject({ status: 'completed', entries: [] })
    expect(createSendToOpenListSubmissionState(
      authority(),
      Array.from({ length: SEND_TO_OPENLIST_MAX_SUBMISSION_CANDIDATES + 1 }, (_, index) => candidate(index)),
    )).toMatchObject({ ok: false, code: 'submission-limit' })
    expect(createSendToOpenListSubmissionState(authority(), [{ url: 'http://127.1/file', source: 'manual' }]))
      .toMatchObject({ ok: false, code: 'local-use-blocked' })
  })

  it('keeps concurrent profile instances isolated', () => {
    const alpha = start(state(1))
    const betaResult = createSendToOpenListSubmissionState(
      authority({ profileId: 'beta', controllerOrigin: 'https://alist.example' }),
      [candidate(2)],
    )
    if (!betaResult.ok)
      throw new Error(betaResult.code)
    const beta = reduceSendToOpenListSubmission(betaResult.value, {
      type: 'start',
      authority: authority({ profileId: 'beta', controllerOrigin: 'https://alist.example' }),
    })
    const changedAlpha = reduceSendToOpenListSubmission(alpha, {
      type: 'dispatch',
      authority: authority(),
      candidateId: alpha.entries[0]!.candidate.id,
    })
    expect(changedAlpha).not.toBe(alpha)
    expect(beta.entries[0]?.status).toBe('queued')
    expect(beta.inFlight).toBe(0)
  })
})
