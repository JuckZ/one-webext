import type {
  SendToOpenListCancelReviewPlanV1,
  SendToOpenListCancelReviewStateV1,
  SendToOpenListStableErrorCode,
  SendToOpenListValidationResult,
} from './contracts'
import {
  SEND_TO_OPENLIST_CANCEL_REVIEW_TTL_MS,
  SEND_TO_OPENLIST_CANCEL_TOKEN_MIN_LENGTH,
  SEND_TO_OPENLIST_MAX_REQUEST_ID_LENGTH,
  SEND_TO_OPENLIST_MAX_TASK_ID_BYTES,
} from './contracts'
import {
  sameSendToOpenListAuthority,
  utf8ByteLength,
  validateSendToOpenListAuthority,
  validationFailure,
  validationSuccess,
} from './validation'

const tokenPattern = /^[\w-]+$/

function canonicalTimestamp(value: unknown) {
  if (typeof value !== 'string' || value.length > 64)
    return null
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp))
    return null
  const canonical = new Date(timestamp).toISOString()
  return canonical === value ? canonical : null
}

function validToken(value: unknown): value is string {
  return typeof value === 'string'
    && value.length >= SEND_TO_OPENLIST_CANCEL_TOKEN_MIN_LENGTH
    && value.length <= SEND_TO_OPENLIST_MAX_REQUEST_ID_LENGTH
    && tokenPattern.test(value)
}

function validTaskId(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && utf8ByteLength(value) <= SEND_TO_OPENLIST_MAX_TASK_ID_BYTES
}

export function createSendToOpenListCancelReviewPlan(
  authorityInput: unknown,
  token: unknown,
  snapshotId: unknown,
  taskId: unknown,
  reviewedTaskIds: readonly string[],
  createdAtInput: unknown,
): SendToOpenListValidationResult<SendToOpenListCancelReviewStateV1> {
  const authority = validateSendToOpenListAuthority(authorityInput)
  if (!authority.ok)
    return authority
  const createdAt = canonicalTimestamp(createdAtInput)
  if (!validToken(token)
    || !validToken(snapshotId)
    || !validTaskId(taskId)
    || !Array.isArray(reviewedTaskIds)
    || !reviewedTaskIds.includes(taskId as string)
    || !createdAt) {
    return validationFailure('unreviewed-task', '$')
  }
  const plan: SendToOpenListCancelReviewPlanV1 = Object.freeze({
    schemaVersion: 1,
    token,
    authority: authority.value,
    snapshotId,
    taskId,
    createdAt,
    expiresAt: new Date(Date.parse(createdAt) + SEND_TO_OPENLIST_CANCEL_REVIEW_TTL_MS).toISOString(),
  })
  return validationSuccess(Object.freeze({ status: 'active', plan }))
}

export type SendToOpenListCancelReviewDecision =
  | {
    readonly ok: true
    readonly state: SendToOpenListCancelReviewStateV1
    readonly plan: SendToOpenListCancelReviewPlanV1
  }
  | {
    readonly ok: false
    readonly state: SendToOpenListCancelReviewStateV1
    readonly code: SendToOpenListStableErrorCode
  }

function updateStatus(
  state: SendToOpenListCancelReviewStateV1,
  status: SendToOpenListCancelReviewStateV1['status'],
) {
  return Object.freeze({ status, plan: state.plan })
}

export function consumeSendToOpenListCancelReviewPlan(
  state: SendToOpenListCancelReviewStateV1,
  authorityInput: unknown,
  token: unknown,
  snapshotId: unknown,
  taskId: unknown,
  nowInput: unknown,
): SendToOpenListCancelReviewDecision {
  const authority = validateSendToOpenListAuthority(authorityInput)
  if (!authority.ok
    || state.status !== 'active'
    || !sameSendToOpenListAuthority(state.plan.authority, authority.value)) {
    return Object.freeze({ ok: false, state, code: 'stale-generation' })
  }
  const now = canonicalTimestamp(nowInput)
  if (!now || Date.parse(now) >= Date.parse(state.plan.expiresAt)) {
    return Object.freeze({
      ok: false,
      state: updateStatus(state, 'invalidated'),
      code: 'lifecycle-invalidated',
    })
  }
  if (token !== state.plan.token || snapshotId !== state.plan.snapshotId || taskId !== state.plan.taskId)
    return Object.freeze({ ok: false, state, code: 'operation-not-allowed' })
  return Object.freeze({
    ok: true,
    state: updateStatus(state, 'consumed'),
    plan: state.plan,
  })
}

export function invalidateSendToOpenListCancelReviewPlan(
  state: SendToOpenListCancelReviewStateV1,
  authorityInput: unknown,
) {
  const authority = validateSendToOpenListAuthority(authorityInput)
  if (!authority.ok
    || state.status !== 'active'
    || !sameSendToOpenListAuthority(state.plan.authority, authority.value)) {
    return state
  }
  return updateStatus(state, 'invalidated')
}
