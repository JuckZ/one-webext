import type { ClashConnectionStatus, ClashControllerProfile } from '../contracts'
import {
  beginClashConnection,
  beginClashPreparation,
  completeClashConnection,
  createDisconnectedClashState,
  disconnectClashState,
  failClashConnection,
  toClashConnectionSnapshot,
} from '../state'

const profile: ClashControllerProfile = {
  version: 1,
  controllerOrigin: 'http://127.0.0.1:9090',
}

describe('clash connection state model', () => {
  it('moves through preparation, connection and connected states with one generation', () => {
    const prepared = beginClashPreparation(
      createDisconnectedClashState(profile),
      profile,
      'token-1',
      '2026-08-28T00:02:00.000Z',
    )
    expect(prepared).toMatchObject({ phase: 'preparing', generation: 1 })
    const connecting = beginClashConnection(
      prepared,
      prepared.preparation,
      '2026-08-28T00:01:00.000Z',
    )
    expect(connecting).toMatchObject({ phase: 'connecting', generation: 1 })
    const status: ClashConnectionStatus = {
      controllerOrigin: profile.controllerOrigin,
      implementation: 'Clash.Meta',
      version: '1.19.0',
      mode: 'rule',
      connectedAt: '2026-08-28T00:01:01.000Z',
    }
    expect(completeClashConnection(connecting!, 1, status)).toMatchObject({
      phase: 'connected',
      generation: 1,
      status,
    })
  })

  it('rejects altered origins, generations and expired preparations', () => {
    const prepared = beginClashPreparation(
      createDisconnectedClashState(profile),
      profile,
      'token-1',
      '2026-08-28T00:02:00.000Z',
    )
    expect(beginClashConnection(prepared, {
      ...prepared.preparation,
      controllerOrigin: 'http://127.0.0.1:9091',
    }, '2026-08-28T00:01:00.000Z')).toBeNull()
    expect(beginClashConnection(prepared, {
      ...prepared.preparation,
      generation: 2,
    }, '2026-08-28T00:01:00.000Z')).toBeNull()
    expect(beginClashConnection(
      prepared,
      prepared.preparation,
      prepared.preparation.expiresAt,
    )).toBeNull()
  })

  it('invalidates a generation on disconnect and exposes no preparation token in snapshots', () => {
    const prepared = beginClashPreparation(
      createDisconnectedClashState(profile),
      profile,
      'sensitive-preparation-token',
      '2026-08-28T00:02:00.000Z',
    )
    expect(JSON.stringify(toClashConnectionSnapshot(prepared))).not.toContain('sensitive-preparation-token')
    const disconnected = disconnectClashState(prepared)
    expect(disconnected).toEqual({
      phase: 'disconnected',
      generation: 2,
      profile,
    })
    expect(beginClashConnection(
      disconnected,
      prepared.preparation,
      '2026-08-28T00:01:00.000Z',
    )).toBeNull()
  })

  it('records stable typed diagnostics without changing the profile', () => {
    const state = failClashConnection(
      createDisconnectedClashState(profile, 3),
      3,
      'authentication-failed',
      '2026-08-28T00:01:00.000Z',
    )
    expect(state).toEqual({
      phase: 'error',
      generation: 3,
      profile,
      diagnostic: {
        code: 'authentication-failed',
        occurredAt: '2026-08-28T00:01:00.000Z',
      },
    })
  })
})
