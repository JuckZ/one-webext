export const remoteFrameRuntimeStatuses = Object.freeze([
  'idle',
  'hello-sent',
  'connected',
  'destroyed',
] as const)

export type RemoteFrameRuntimeStatus = typeof remoteFrameRuntimeStatuses[number]

export interface RemoteFrameRuntimeState {
  status: RemoteFrameRuntimeStatus
  challenge: string | null
  sessionNonce: string | null
}

export type RemoteFrameRuntimeTransition =
  | { ok: true, state: RemoteFrameRuntimeState }
  | {
    ok: false
    reason: 'challenge-mismatch' | 'invalid-state' | 'nonce-too-short'
    state: RemoteFrameRuntimeState
  }

export function createRemoteFrameRuntimeState(): RemoteFrameRuntimeState {
  return { status: 'idle', challenge: null, sessionNonce: null }
}

export function beginRemoteFrameRuntime(
  state: RemoteFrameRuntimeState,
  challenge: string,
): RemoteFrameRuntimeTransition {
  if (state.status !== 'idle')
    return { ok: false, reason: 'invalid-state', state }
  return {
    ok: true,
    state: { status: 'hello-sent', challenge, sessionNonce: null },
  }
}

export function connectRemoteFrameRuntime(
  state: RemoteFrameRuntimeState,
  challenge: string,
  sessionNonce: string,
): RemoteFrameRuntimeTransition {
  if (state.status !== 'hello-sent')
    return { ok: false, reason: 'invalid-state', state }
  if (state.challenge !== challenge)
    return { ok: false, reason: 'challenge-mismatch', state }
  if (sessionNonce.length < 24)
    return { ok: false, reason: 'nonce-too-short', state }
  return {
    ok: true,
    state: { status: 'connected', challenge: null, sessionNonce },
  }
}

export function destroyRemoteFrameRuntime(
  _state: RemoteFrameRuntimeState,
): RemoteFrameRuntimeState {
  return { status: 'destroyed', challenge: null, sessionNonce: null }
}
