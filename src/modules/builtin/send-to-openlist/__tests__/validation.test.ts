import {
  SEND_TO_OPENLIST_MAX_PROFILES,
  SEND_TO_OPENLIST_MODULE_ID,
} from '../contracts'
import {
  classifySendToOpenListProfileTransport,
  normalizeSendToOpenListExactOrigin,
  sameSendToOpenListAuthority,
  validateSendToOpenListAuthority,
  validateSendToOpenListProfile,
  validateSendToOpenListProfiles,
} from '../validation'

function profile(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    id: 'home',
    label: 'Home OpenList',
    controllerOrigin: 'https://files.example:443',
    ...overrides,
  }
}

function authority(overrides: Record<string, unknown> = {}) {
  return {
    moduleId: SEND_TO_OPENLIST_MODULE_ID,
    profileId: 'home',
    controllerOrigin: 'https://files.example',
    generation: 7,
    ...overrides,
  }
}

function valueOf<Value>(result: { ok: true, value: Value } | { ok: false }) {
  if (!result.ok)
    throw new Error('Expected validation success')
  return result.value
}

describe('send to OpenList profile contract', () => {
  it('canonically clones a finite non-secret profile collection', () => {
    const input = {
      schemaVersion: 1,
      activeProfileId: 'home',
      profiles: [profile()],
    }
    const result = valueOf(validateSendToOpenListProfiles(input))

    expect(result).toEqual({
      schemaVersion: 1,
      activeProfileId: 'home',
      profiles: [{
        schemaVersion: 1,
        id: 'home',
        label: 'Home OpenList',
        controllerOrigin: 'https://files.example',
      }],
    })
    expect(result).not.toBe(input)
    expect(result.profiles).not.toBe(input.profiles)
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.profiles)).toBe(true)
    expect(Object.isFrozen(result.profiles[0])).toBe(true)
  })

  it('uses URL parsing to derive an exact origin and reject non-origin input', () => {
    expect(normalizeSendToOpenListExactOrigin('HTTP://127.1:5244')).toBe('http://127.0.0.1:5244')
    expect(normalizeSendToOpenListExactOrigin('https://[::1]:5244')).toBe('https://[::1]:5244')
    expect(normalizeSendToOpenListExactOrigin('https://example.com/path')).toBeNull()
    expect(normalizeSendToOpenListExactOrigin('https://example.com/?query')).toBeNull()
    expect(normalizeSendToOpenListExactOrigin('https://user:secret@example.com')).toBeNull()
    expect(normalizeSendToOpenListExactOrigin('file:///tmp/openlist')).toBeNull()
  })

  it('classifies HTTPS and loopback versus exposed cleartext token transport', () => {
    const https = valueOf(validateSendToOpenListProfile(profile()))
    const loopback = valueOf(validateSendToOpenListProfile(profile({ controllerOrigin: 'http://127.1:5244' })))
    const cleartext = valueOf(validateSendToOpenListProfile(profile({ controllerOrigin: 'http://files.example:5244' })))

    expect(classifySendToOpenListProfileTransport(https)).toBe('encrypted')
    expect(classifySendToOpenListProfileTransport(loopback)).toBe('loopback-cleartext')
    expect(classifySendToOpenListProfileTransport(cleartext)).toBe('cleartext-token-risk')
  })

  it('rejects token fields, unknown data, accessors and invalid profile identity', () => {
    expect(validateSendToOpenListProfile(profile({ token: 'must-not-clone' }))).toMatchObject({
      ok: false,
      code: 'invalid-profile',
    })
    expect(validateSendToOpenListProfile(profile({ id: '../other-module' }))).toMatchObject({ ok: false })
    expect(validateSendToOpenListProfile(profile({ label: '' }))).toMatchObject({ ok: false })

    const accessor = profile()
    Object.defineProperty(accessor, 'label', { enumerable: true, get: () => 'secret side effect' })
    expect(validateSendToOpenListProfile(accessor)).toMatchObject({ ok: false })
  })

  it('enforces collection cardinality, unique IDs and an existing active profile', () => {
    const tooMany = Array.from({ length: SEND_TO_OPENLIST_MAX_PROFILES + 1 }, (_, index) => profile({ id: `p-${index}` }))
    expect(validateSendToOpenListProfiles({ schemaVersion: 1, activeProfileId: null, profiles: tooMany }))
      .toMatchObject({ ok: false, code: 'profile-limit' })
    expect(validateSendToOpenListProfiles({
      schemaVersion: 1,
      activeProfileId: 'home',
      profiles: [profile(), profile()],
    })).toMatchObject({ ok: false, code: 'duplicate-profile' })
    expect(validateSendToOpenListProfiles({
      schemaVersion: 1,
      activeProfileId: 'missing',
      profiles: [profile()],
    })).toMatchObject({ ok: false, code: 'invalid-profile' })
  })

  it('binds authority to the builtin, profile, exact origin and positive generation', () => {
    const canonical = valueOf(validateSendToOpenListAuthority(authority({
      controllerOrigin: 'HTTPS://FILES.EXAMPLE:443',
    })))
    expect(canonical).toEqual(authority())
    expect(Object.isFrozen(canonical)).toBe(true)
    expect(sameSendToOpenListAuthority(canonical, authority())).toBe(true)
    expect(sameSendToOpenListAuthority(canonical, authority({ generation: 8 }))).toBe(false)

    expect(validateSendToOpenListAuthority(authority({ moduleId: 'dev.remote.attacker' })))
      .toMatchObject({ ok: false, code: 'invalid-authority' })
    expect(validateSendToOpenListAuthority(authority({ controllerOrigin: 'https://files.example/api' })))
      .toMatchObject({ ok: false, code: 'invalid-authority' })
    expect(validateSendToOpenListAuthority(authority({ generation: 0 })))
      .toMatchObject({ ok: false, code: 'invalid-authority' })
    expect(validateSendToOpenListAuthority({ ...authority(), token: 'leak' }))
      .toMatchObject({ ok: false, code: 'invalid-authority' })
  })
})
