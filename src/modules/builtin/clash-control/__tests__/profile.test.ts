import {
  CLASH_CONTROLLER_PROFILE_STORAGE_KEY,
  createClashControllerProfileStore,
  normalizeClashControllerProfile,
} from '../profile'

function createStorage(initial?: unknown) {
  const state: Record<string, unknown> = {}
  if (initial !== undefined)
    state[CLASH_CONTROLLER_PROFILE_STORAGE_KEY] = structuredClone(initial)
  return {
    state,
    get: vi.fn(async (key: string) => ({ [key]: structuredClone(state[key]) })),
    set: vi.fn(async (value: Record<string, unknown>) => {
      Object.assign(state, structuredClone(value))
    }),
    remove: vi.fn(async (key: string) => void delete state[key]),
  }
}

describe('clash controller profile', () => {
  it.each([
    ['http://localhost:9090/', 'http://localhost:9090'],
    [{ controllerOrigin: 'HTTPS://LOCALHOST:443/' }, 'https://localhost'],
    [{ controllerUrl: 'http://127.1.2.3:9090' }, 'http://127.1.2.3:9090'],
    [{ origin: 'http://[::1]:9090' }, 'http://[::1]:9090'],
  ])('migrates a legacy profile %j', (value, controllerOrigin) => {
    expect(normalizeClashControllerProfile(value)).toEqual({
      version: 1,
      controllerOrigin,
    })
  })

  it.each([
    'https://controller.example',
    { controllerOrigin: 'http://127.0.0.1:9090/version' },
    { controllerUrl: 'http://user:secret@localhost:9090' },
    { origin: 'file:///tmp/controller' },
  ])('discards an invalid or remote legacy profile %j', (value) => {
    expect(normalizeClashControllerProfile(value)).toBeNull()
  })

  it('rewrites legacy state to the origin-only versioned schema', async () => {
    const storage = createStorage({
      controllerUrl: 'http://127.0.0.1:9090/',
      secret: 'legacy-secret-must-be-dropped',
    })
    const store = createClashControllerProfileStore(storage)
    await expect(store.load()).resolves.toEqual({
      version: 1,
      controllerOrigin: 'http://127.0.0.1:9090',
    })
    expect(storage.state[CLASH_CONTROLLER_PROFILE_STORAGE_KEY]).toEqual({
      version: 1,
      controllerOrigin: 'http://127.0.0.1:9090',
    })
    expect(JSON.stringify(storage.state)).not.toContain('legacy-secret-must-be-dropped')
  })

  it('removes malformed stored state and serializes profile replacements', async () => {
    const storage = createStorage({ controllerOrigin: 'https://remote.example' })
    const store = createClashControllerProfileStore(storage)
    await expect(store.load()).resolves.toBeNull()
    expect(storage.remove).toHaveBeenCalledWith(CLASH_CONTROLLER_PROFILE_STORAGE_KEY)
    await Promise.all([
      store.save('http://localhost:9090'),
      store.save('http://127.0.0.1:9091'),
    ])
    expect(storage.state[CLASH_CONTROLLER_PROFILE_STORAGE_KEY]).toEqual({
      version: 1,
      controllerOrigin: 'http://127.0.0.1:9091',
    })
  })
})
