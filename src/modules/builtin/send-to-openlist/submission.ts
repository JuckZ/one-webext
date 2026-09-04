import type {
  ResourceCandidateV1,
  SendToOpenListAddOutcome,
  SendToOpenListAuthorityV1,
  SendToOpenListSubmissionAction,
  SendToOpenListSubmissionEntryV1,
  SendToOpenListSubmissionStateV1,
  SendToOpenListValidationResult,
} from './contracts'
import { normalizeResourceCandidateList } from './candidate'
import { SEND_TO_OPENLIST_MAX_IN_FLIGHT } from './contracts'
import {
  sameSendToOpenListAuthority,
  validateSendToOpenListAuthority,
  validationSuccess,
} from './validation'

function freezeEntry(entry: SendToOpenListSubmissionEntryV1): SendToOpenListSubmissionEntryV1 {
  return Object.freeze({ ...entry })
}

function freezeState(
  authority: SendToOpenListAuthorityV1,
  status: SendToOpenListSubmissionStateV1['status'],
  entries: readonly SendToOpenListSubmissionEntryV1[],
): SendToOpenListSubmissionStateV1 {
  return Object.freeze({
    schemaVersion: 1,
    authority,
    status,
    entries: Object.freeze(entries.map(freezeEntry)),
    inFlight: entries.filter(entry => entry.status === 'in-flight').length,
  })
}

export function createSendToOpenListSubmissionState(
  authorityInput: unknown,
  candidateInputs: readonly unknown[],
): SendToOpenListValidationResult<SendToOpenListSubmissionStateV1> {
  const authority = validateSendToOpenListAuthority(authorityInput)
  if (!authority.ok)
    return authority
  const candidates = normalizeResourceCandidateList(candidateInputs, 'submission')
  if (!candidates.ok)
    return candidates
  const entries = candidates.value.map(candidate => Object.freeze({ candidate, status: 'queued' as const }))
  return validationSuccess(freezeState(authority.value, 'ready', entries))
}

function terminalEntry(
  entry: SendToOpenListSubmissionEntryV1,
  outcome: SendToOpenListAddOutcome,
): SendToOpenListSubmissionEntryV1 {
  if (outcome.status === 'accepted')
    return Object.freeze({ candidate: entry.candidate, status: 'accepted', taskId: outcome.taskId })
  return Object.freeze({ candidate: entry.candidate, status: outcome.status, errorCode: outcome.code })
}

function completedWhenDrained(
  current: SendToOpenListSubmissionStateV1,
  entries: readonly SendToOpenListSubmissionEntryV1[],
) {
  const drained = entries.every(entry => entry.status !== 'queued' && entry.status !== 'in-flight')
  return freezeState(current.authority, drained ? 'completed' : current.status, entries)
}

function invalidateEntries(entries: readonly SendToOpenListSubmissionEntryV1[]) {
  return entries.map((entry): SendToOpenListSubmissionEntryV1 => {
    if (entry.status === 'queued')
      return Object.freeze({ candidate: entry.candidate, status: 'cancelled', errorCode: 'cancelled' })
    if (entry.status === 'in-flight')
      return Object.freeze({ candidate: entry.candidate, status: 'outcome-unknown', errorCode: 'outcome-unknown' })
    return entry
  })
}

export function reduceSendToOpenListSubmission(
  state: SendToOpenListSubmissionStateV1,
  action: SendToOpenListSubmissionAction,
): SendToOpenListSubmissionStateV1 {
  const authority = validateSendToOpenListAuthority(action.authority)
  if (!authority.ok || !sameSendToOpenListAuthority(state.authority, authority.value))
    return state

  if (action.type === 'start') {
    if (state.status !== 'ready')
      return state
    return freezeState(state.authority, state.entries.length === 0 ? 'completed' : 'running', state.entries)
  }

  if (action.type === 'invalidate') {
    if (state.status === 'completed' || state.status === 'cancelled' || state.status === 'invalidated')
      return state
    return freezeState(state.authority, 'invalidated', invalidateEntries(state.entries))
  }

  if (action.type === 'stop') {
    if (state.status !== 'ready' && state.status !== 'running')
      return state
    return freezeState(state.authority, 'cancelled', invalidateEntries(state.entries))
  }

  if (state.status !== 'running')
    return state

  const entryIndex = state.entries.findIndex(entry => entry.candidate.id === action.candidateId)
  if (entryIndex < 0)
    return state
  const entry = state.entries[entryIndex]!
  const entries = [...state.entries]

  if (action.type === 'dispatch') {
    if (entry.status !== 'queued' || state.inFlight >= SEND_TO_OPENLIST_MAX_IN_FLIGHT)
      return state
    entries[entryIndex] = Object.freeze({ candidate: entry.candidate, status: 'in-flight' })
    return freezeState(state.authority, state.status, entries)
  }

  if (entry.status !== 'in-flight')
    return state
  entries[entryIndex] = terminalEntry(entry, action.outcome)
  return completedWhenDrained(state, entries)
}

export function getSendToOpenListDispatchableCandidates(
  state: SendToOpenListSubmissionStateV1,
): readonly ResourceCandidateV1[] {
  if (state.status !== 'running')
    return Object.freeze([])
  const available = Math.max(0, SEND_TO_OPENLIST_MAX_IN_FLIGHT - state.inFlight)
  return Object.freeze(state.entries
    .filter(entry => entry.status === 'queued')
    .slice(0, available)
    .map(entry => entry.candidate))
}
