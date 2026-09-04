import type {
  SendToOpenListProfileCollectionV1,
  SendToOpenListProfileV1,
} from './contracts'
import {
  SEND_TO_OPENLIST_MAX_PROFILES,
  SEND_TO_OPENLIST_PROFILE_COLLECTION_SCHEMA_VERSION,
} from './contracts'
import { validateSendToOpenListProfiles } from './validation'

export const SEND_TO_OPENLIST_PROFILES_STORAGE_KEY = 'oneweb.send-to-openlist.profiles.v1' as const
export const SEND_TO_OPENLIST_SECRET_KEY_PREFIX = 'oneweb.send-to-openlist.secret.v1.' as const

export interface SendToOpenListStorageBoundary {
  get: (_key: string) => Promise<Record<string, unknown>>
  set: (_items: Record<string, unknown>) => Promise<void>
  remove: (_keys: string | string[]) => Promise<void>
}

interface StoredSecretV1 {
  readonly version: 1
  readonly profileId: string
  readonly controllerOrigin: string
  readonly installationId: string
  readonly token: string
}

export interface SendToOpenListProfileStore {
  load: (_installationId: string) => Promise<{
    profile: SendToOpenListProfileV1 | null
    hasStoredToken: boolean
  }>
  loadToken: (_profile: SendToOpenListProfileV1, _installationId: string) => Promise<string | null>
  loadCollection: () => Promise<SendToOpenListProfileCollectionV1>
  saveVerified: (
    _profile: SendToOpenListProfileV1,
    _token: string,
    _installationId: string,
  ) => Promise<void>
  clearToken: (_profileId: string) => Promise<void>
  clearTokensForOrigins: (_originPatterns: readonly string[]) => Promise<readonly string[]>
  clearAllTokens: () => Promise<void>
  removeProfile: (_profileId: string) => Promise<SendToOpenListProfileCollectionV1>
  clearAll: () => Promise<void>
}

function secretKey(profileId: string) {
  return `${SEND_TO_OPENLIST_SECRET_KEY_PREFIX}${profileId}`
}

function emptyProfiles(): SendToOpenListProfileCollectionV1 {
  return Object.freeze({
    schemaVersion: SEND_TO_OPENLIST_PROFILE_COLLECTION_SCHEMA_VERSION,
    activeProfileId: null,
    profiles: Object.freeze([]),
  })
}

function isStoredSecret(
  value: unknown,
  profile: SendToOpenListProfileV1,
  installationId: string,
): value is StoredSecretV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return false
  const record = value as Record<string, unknown>
  return Object.keys(record).length === 5
    && record.version === 1
    && record.profileId === profile.id
    && record.controllerOrigin === profile.controllerOrigin
    && record.installationId === installationId
    && typeof record.token === 'string'
}

export function createSendToOpenListProfileStore(
  storage: SendToOpenListStorageBoundary,
): SendToOpenListProfileStore {
  let mutation = Promise.resolve()

  function serialize<Value>(operation: () => Promise<Value>) {
    const result = mutation.then(operation)
    mutation = result.then(() => undefined, () => undefined)
    return result
  }

  async function readProfiles() {
    const stored = await storage.get(SEND_TO_OPENLIST_PROFILES_STORAGE_KEY)
    const validated = validateSendToOpenListProfiles(stored[SEND_TO_OPENLIST_PROFILES_STORAGE_KEY])
    if (!validated.ok)
      return emptyProfiles()
    return validated.value
  }

  return {
    async load(installationId) {
      await mutation
      const profiles = await readProfiles()
      const profile = profiles.activeProfileId === null
        ? null
        : profiles.profiles.find(item => item.id === profiles.activeProfileId) || null
      if (!profile)
        return { profile: null, hasStoredToken: false }
      const token = await this.loadToken(profile, installationId)
      return { profile: structuredClone(profile), hasStoredToken: token !== null }
    },
    async loadToken(profile, installationId) {
      await mutation
      const key = secretKey(profile.id)
      const stored = await storage.get(key)
      const value = stored[key]
      if (!isStoredSecret(value, profile, installationId)) {
        if (value !== undefined)
          await storage.remove(key)
        return null
      }
      return value.token
    },
    async loadCollection() {
      await mutation
      return structuredClone(await readProfiles())
    },
    saveVerified(profile, token, installationId) {
      return serialize(async () => {
        const current = await readProfiles()
        const retained = current.profiles.filter(item => item.id !== profile.id)
        if (retained.length >= SEND_TO_OPENLIST_MAX_PROFILES)
          throw new TypeError('Send to OpenList profile limit reached')
        const profiles: SendToOpenListProfileCollectionV1 = {
          schemaVersion: SEND_TO_OPENLIST_PROFILE_COLLECTION_SCHEMA_VERSION,
          activeProfileId: profile.id,
          profiles: [...retained.map(item => structuredClone(item)), structuredClone(profile)],
        }
        const secret: StoredSecretV1 = {
          version: 1,
          profileId: profile.id,
          controllerOrigin: profile.controllerOrigin,
          installationId,
          token,
        }
        await storage.set({
          [SEND_TO_OPENLIST_PROFILES_STORAGE_KEY]: profiles,
          [secretKey(profile.id)]: secret,
        })
      })
    },
    clearToken(profileId) {
      return serialize(() => storage.remove(secretKey(profileId)))
    },
    clearTokensForOrigins(originPatterns) {
      return serialize(async () => {
        const patterns = new Set(originPatterns)
        const profiles = await readProfiles()
        const removed = profiles.profiles
          .filter(profile => patterns.has(`${profile.controllerOrigin}/*`))
          .map(profile => profile.id)
        if (removed.length)
          await storage.remove(removed.map(secretKey))
        return Object.freeze(removed)
      })
    },
    clearAllTokens() {
      return serialize(async () => {
        const profiles = await readProfiles()
        if (profiles.profiles.length)
          await storage.remove(profiles.profiles.map(profile => secretKey(profile.id)))
      })
    },
    removeProfile(profileId) {
      return serialize(async () => {
        const current = await readProfiles()
        const retained = current.profiles.filter(profile => profile.id !== profileId)
        const activeProfileId = current.activeProfileId === profileId
          ? retained[0]?.id || null
          : current.activeProfileId
        const profiles: SendToOpenListProfileCollectionV1 = {
          schemaVersion: SEND_TO_OPENLIST_PROFILE_COLLECTION_SCHEMA_VERSION,
          activeProfileId,
          profiles: retained.map(profile => structuredClone(profile)),
        }
        await storage.remove(secretKey(profileId))
        await storage.set({ [SEND_TO_OPENLIST_PROFILES_STORAGE_KEY]: profiles })
        return structuredClone(profiles)
      })
    },
    clearAll() {
      return serialize(async () => {
        const profiles = await readProfiles()
        await storage.remove([
          SEND_TO_OPENLIST_PROFILES_STORAGE_KEY,
          ...profiles.profiles.map(profile => secretKey(profile.id)),
        ])
      })
    },
  }
}
