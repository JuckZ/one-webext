import {
  createSendToOpenListProfileStore,
  SEND_TO_OPENLIST_PROFILES_STORAGE_KEY,
  SEND_TO_OPENLIST_SECRET_KEY_PREFIX,
} from '../profile-store'

function createStorage(initial: Record<string, unknown> = {}) {
  const state = structuredClone(initial)
  return {
    state,
    get: vi.fn(async (key: string) => ({ [key]: structuredClone(state[key]) })),
    set: vi.fn(async (items: Record<string, unknown>) => {
      Object.assign(state, structuredClone(items))
    }),
    remove: vi.fn(async (keys: string | string[]) => {
      for (const key of Array.isArray(keys) ? keys : [keys])
        delete state[key]
    }),
  }
}

const profile = {
  schemaVersion: 1 as const,
  id: 'primary',
  label: 'Home server',
  controllerOrigin: 'https://openlist.example',
}

describe('send to OpenList profile and secret store', () => {
  it('keeps the token in a dedicated installation-bound record', async () => {
    const storage = createStorage()
    const store = createSendToOpenListProfileStore(storage)
    await store.saveVerified(profile, 'private-token', 'installation-a')

    expect(storage.state[SEND_TO_OPENLIST_PROFILES_STORAGE_KEY]).toEqual({
      schemaVersion: 1,
      activeProfileId: 'primary',
      profiles: [profile],
    })
    expect(JSON.stringify(storage.state[SEND_TO_OPENLIST_PROFILES_STORAGE_KEY])).not.toContain('private-token')
    await expect(store.load('installation-a')).resolves.toEqual({ profile, hasStoredToken: true })
    await expect(store.loadToken(profile, 'installation-a')).resolves.toBe('private-token')
  })

  it('drops a token after reinstall or origin replacement', async () => {
    const storage = createStorage()
    const store = createSendToOpenListProfileStore(storage)
    await store.saveVerified(profile, 'private-token', 'installation-a')

    await expect(store.load('installation-b')).resolves.toEqual({ profile, hasStoredToken: false })
    expect(storage.state[`${SEND_TO_OPENLIST_SECRET_KEY_PREFIX}primary`]).toBeUndefined()
    await store.saveVerified(profile, 'next-token', 'installation-b')
    await expect(store.loadToken({ ...profile, controllerOrigin: 'https://other.example' }, 'installation-b')).resolves.toBeNull()
  })

  it('clears profile and secret together without touching unrelated storage', async () => {
    const storage = createStorage({ unrelated: { kept: true } })
    const store = createSendToOpenListProfileStore(storage)
    await store.saveVerified(profile, 'private-token', 'installation-a')
    await store.clearAll()

    expect(storage.state).toEqual({ unrelated: { kept: true } })
  })

  it('keeps two profiles and secrets isolated while exposing only one active profile', async () => {
    const storage = createStorage({ unrelated: { kept: true } })
    const store = createSendToOpenListProfileStore(storage)
    const peer = { ...profile, id: 'peer', label: 'Peer', controllerOrigin: 'https://alist.example' }
    await store.saveVerified(profile, 'primary-token', 'installation-a')
    await store.saveVerified(peer, 'peer-token', 'installation-a')

    await expect(store.loadCollection()).resolves.toEqual({
      schemaVersion: 1,
      activeProfileId: 'peer',
      profiles: [profile, peer],
    })
    await expect(store.loadToken(profile, 'installation-a')).resolves.toBe('primary-token')
    await expect(store.loadToken(peer, 'installation-a')).resolves.toBe('peer-token')

    await store.clearTokensForOrigins(['https://openlist.example/*'])
    await expect(store.loadToken(profile, 'installation-a')).resolves.toBeNull()
    await expect(store.loadToken(peer, 'installation-a')).resolves.toBe('peer-token')
    await store.removeProfile('peer')
    await expect(store.loadCollection()).resolves.toEqual({
      schemaVersion: 1,
      activeProfileId: 'primary',
      profiles: [profile],
    })
    expect(storage.state.unrelated).toEqual({ kept: true })
  })

  it('clears every profile token on disable semantics without deleting profile metadata', async () => {
    const storage = createStorage()
    const store = createSendToOpenListProfileStore(storage)
    const peer = { ...profile, id: 'peer', controllerOrigin: 'https://alist.example' }
    await store.saveVerified(profile, 'primary-token', 'installation-a')
    await store.saveVerified(peer, 'peer-token', 'installation-a')
    await store.clearAllTokens()

    expect(await store.loadCollection()).toMatchObject({ profiles: [profile, peer] })
    await expect(store.loadToken(profile, 'installation-a')).resolves.toBeNull()
    await expect(store.loadToken(peer, 'installation-a')).resolves.toBeNull()
  })
})
