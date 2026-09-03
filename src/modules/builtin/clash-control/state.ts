import type {
  ClashConnectionDiagnostic,
  ClashConnectionPreparation,
  ClashConnectionSnapshot,
  ClashConnectionStatus,
  ClashControlErrorCode,
  ClashControllerProfile,
} from './contracts'

export type ClashConnectionState =
  | { phase: 'disconnected', generation: number, profile: ClashControllerProfile | null }
  | {
    phase: 'preparing'
    generation: number
    profile: ClashControllerProfile
    preparation: ClashConnectionPreparation
  }
  | {
    phase: 'connecting'
    generation: number
    profile: ClashControllerProfile
    controllerOrigin: string
  }
  | {
    phase: 'connected'
    generation: number
    profile: ClashControllerProfile
    status: ClashConnectionStatus
  }
  | {
    phase: 'error'
    generation: number
    profile: ClashControllerProfile | null
    diagnostic: ClashConnectionDiagnostic
  }

export function createDisconnectedClashState(
  profile: ClashControllerProfile | null = null,
  generation = 0,
): Extract<ClashConnectionState, { phase: 'disconnected' }> {
  return { phase: 'disconnected', generation, profile }
}

export function beginClashPreparation(
  state: ClashConnectionState,
  profile: ClashControllerProfile,
  token: string,
  expiresAt: string,
): Extract<ClashConnectionState, { phase: 'preparing' }> {
  const generation = state.generation + 1
  return {
    phase: 'preparing',
    generation,
    profile,
    preparation: {
      controllerOrigin: profile.controllerOrigin,
      originPattern: `${profile.controllerOrigin}/*`,
      token,
      generation,
      expiresAt,
    },
  }
}

export function beginClashConnection(
  state: ClashConnectionState,
  preparation: ClashConnectionPreparation,
  now: string,
): Extract<ClashConnectionState, { phase: 'connecting' }> | null {
  if (state.phase !== 'preparing'
    || preparation.token !== state.preparation.token
    || preparation.generation !== state.generation
    || preparation.controllerOrigin !== state.profile.controllerOrigin
    || preparation.originPattern !== state.preparation.originPattern
    || preparation.expiresAt !== state.preparation.expiresAt
    || !Number.isFinite(Date.parse(now))
    || Date.parse(now) >= Date.parse(state.preparation.expiresAt)) {
    return null
  }
  return {
    phase: 'connecting',
    generation: state.generation,
    profile: state.profile,
    controllerOrigin: state.profile.controllerOrigin,
  }
}

export function completeClashConnection(
  state: ClashConnectionState,
  generation: number,
  status: ClashConnectionStatus,
): Extract<ClashConnectionState, { phase: 'connected' }> | null {
  if (state.phase !== 'connecting'
    || state.generation !== generation
    || state.controllerOrigin !== status.controllerOrigin) {
    return null
  }
  return {
    phase: 'connected',
    generation,
    profile: state.profile,
    status: structuredClone(status),
  }
}

export function failClashConnection(
  state: ClashConnectionState,
  generation: number,
  code: ClashControlErrorCode,
  occurredAt: string,
): Extract<ClashConnectionState, { phase: 'error' }> | null {
  if (state.generation !== generation)
    return null
  return {
    phase: 'error',
    generation,
    profile: state.profile,
    diagnostic: { code, occurredAt },
  }
}

export function disconnectClashState(state: ClashConnectionState): Extract<ClashConnectionState, { phase: 'disconnected' }> {
  return createDisconnectedClashState(state.profile, state.generation + 1)
}

export function toClashConnectionSnapshot(state: ClashConnectionState): ClashConnectionSnapshot {
  if (state.phase === 'preparing') {
    return {
      phase: 'preparing',
      generation: state.generation,
      profile: structuredClone(state.profile),
      preparationExpiresAt: state.preparation.expiresAt,
    }
  }
  if (state.phase === 'connected') {
    return {
      phase: 'connected',
      generation: state.generation,
      profile: structuredClone(state.profile),
      status: structuredClone(state.status),
    }
  }
  if (state.phase === 'error') {
    return {
      phase: 'error',
      generation: state.generation,
      profile: state.profile ? structuredClone(state.profile) : null,
      diagnostic: structuredClone(state.diagnostic),
    }
  }
  if (state.phase === 'connecting') {
    return {
      phase: 'connecting',
      generation: state.generation,
      profile: structuredClone(state.profile),
    }
  }
  return {
    phase: 'disconnected',
    generation: state.generation,
    profile: state.profile ? structuredClone(state.profile) : null,
  }
}
