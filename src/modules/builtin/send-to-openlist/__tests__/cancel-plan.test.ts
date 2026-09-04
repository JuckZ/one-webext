import {
  consumeSendToOpenListCancelReviewPlan,
  createSendToOpenListCancelReviewPlan,
  invalidateSendToOpenListCancelReviewPlan,
} from '../cancel-plan'
import { SEND_TO_OPENLIST_MODULE_ID } from '../contracts'

const authority = {
  moduleId: SEND_TO_OPENLIST_MODULE_ID,
  profileId: 'home',
  controllerOrigin: 'https://openlist.example',
  generation: 5,
} as const
const token = 'cancel_review_token_0123456789abcdef'
const snapshotId = 'undone_snapshot_0123456789abcdef'

function activePlan() {
  const result = createSendToOpenListCancelReviewPlan(
    authority,
    token,
    snapshotId,
    'task-1',
    ['task-1'],
    '2026-09-03T12:00:00.000Z',
  )
  if (!result.ok)
    throw new Error(result.code)
  return result.value
}

describe('send to OpenList cancel review plan', () => {
  it('binds one reviewed task to exact authority, snapshot and a fixed expiry', () => {
    const state = activePlan()
    expect(state).toEqual({
      status: 'active',
      plan: {
        schemaVersion: 1,
        token,
        authority,
        snapshotId,
        taskId: 'task-1',
        createdAt: '2026-09-03T12:00:00.000Z',
        expiresAt: '2026-09-03T12:02:00.000Z',
      },
    })
    expect(Object.isFrozen(state)).toBe(true)
    expect(Object.isFrozen(state.plan)).toBe(true)
  })

  it('rejects unreviewed tasks, weak tokens and non-canonical timestamps', () => {
    expect(createSendToOpenListCancelReviewPlan(
      authority,
      'short',
      snapshotId,
      'task-1',
      ['task-1'],
      '2026-09-03T12:00:00Z',
    )).toMatchObject({ ok: false, code: 'unreviewed-task' })
    expect(createSendToOpenListCancelReviewPlan(
      authority,
      token,
      snapshotId,
      'substituted-task',
      ['task-1'],
      '2026-09-03T12:00:00.000Z',
    )).toMatchObject({ ok: false, code: 'unreviewed-task' })
  })

  it('consumes a matching plan exactly once', () => {
    const state = activePlan()
    const consumed = consumeSendToOpenListCancelReviewPlan(
      state,
      authority,
      token,
      snapshotId,
      'task-1',
      '2026-09-03T12:01:59.999Z',
    )
    expect(consumed).toMatchObject({ ok: true, state: { status: 'consumed' } })
    expect(consumeSendToOpenListCancelReviewPlan(
      consumed.state,
      authority,
      token,
      snapshotId,
      'task-1',
      '2026-09-03T12:01:59.999Z',
    )).toMatchObject({ ok: false, code: 'stale-generation' })
  })

  it('rejects task, token and snapshot substitution without consuming legitimate authority', () => {
    const state = activePlan()
    for (const [changedToken, changedSnapshot, changedTask] of [
      ['different_cancel_review_token_12345', snapshotId, 'task-1'],
      [token, 'different_undone_snapshot_123456', 'task-1'],
      [token, snapshotId, 'task-2'],
    ]) {
      expect(consumeSendToOpenListCancelReviewPlan(
        state,
        authority,
        changedToken,
        changedSnapshot,
        changedTask,
        '2026-09-03T12:01:00.000Z',
      )).toMatchObject({ ok: false, code: 'operation-not-allowed', state: { status: 'active' } })
    }
  })

  it('expires at the boundary and rejects profile/origin/generation replacement', () => {
    const state = activePlan()
    expect(consumeSendToOpenListCancelReviewPlan(
      state,
      authority,
      token,
      snapshotId,
      'task-1',
      '2026-09-03T12:02:00.000Z',
    )).toMatchObject({ ok: false, code: 'lifecycle-invalidated', state: { status: 'invalidated' } })

    for (const changed of [
      { ...authority, profileId: 'other' },
      { ...authority, controllerOrigin: 'https://other.example' },
      { ...authority, generation: 6 },
    ]) {
      expect(consumeSendToOpenListCancelReviewPlan(
        state,
        changed,
        token,
        snapshotId,
        'task-1',
        '2026-09-03T12:01:00.000Z',
      )).toMatchObject({ ok: false, code: 'stale-generation' })
    }
  })

  it('invalidates only the matching active authority', () => {
    const state = activePlan()
    expect(invalidateSendToOpenListCancelReviewPlan(state, { ...authority, generation: 6 })).toBe(state)
    expect(invalidateSendToOpenListCancelReviewPlan(state, authority)).toMatchObject({ status: 'invalidated' })
  })
})
