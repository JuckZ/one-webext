import type { ClashControllerProfile } from './contracts'
import { normalizeClashControllerUrl } from './url'

export const CLASH_CONTROLLER_PROFILE_STORAGE_KEY = 'oneweb.clash-control.profile.v1' as const
export const CLASH_CONTROLLER_PROFILE_VERSION = 1 as const

export interface ClashControllerProfileStorage {
  get: (_key: string) => Promise<Record<string, unknown>>
  set: (_value: Record<string, unknown>) => Promise<void>
  remove: (_key: string) => Promise<void>
}

export interface ClashControllerProfileStore {
  load: () => Promise<ClashControllerProfile | null>
  save: (_controllerOrigin: string) => Promise<ClashControllerProfile>
}

function profileOrigin(value: unknown) {
  if (typeof value === 'string')
    return value
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return null
  const candidate = value as Record<string, unknown>
  if (typeof candidate.controllerOrigin === 'string')
    return candidate.controllerOrigin
  if (typeof candidate.controllerUrl === 'string')
    return candidate.controllerUrl
  if (typeof candidate.origin === 'string')
    return candidate.origin
  return null
}

export function normalizeClashControllerProfile(value: unknown): ClashControllerProfile | null {
  const origin = profileOrigin(value)
  if (!origin)
    return null
  const normalized = normalizeClashControllerUrl(origin)
  if (!normalized.ok)
    return null
  return {
    version: CLASH_CONTROLLER_PROFILE_VERSION,
    controllerOrigin: normalized.controller.controllerOrigin,
  }
}

function isCurrentProfile(value: unknown, profile: ClashControllerProfile) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return false
  const candidate = value as Record<string, unknown>
  return candidate.version === CLASH_CONTROLLER_PROFILE_VERSION
    && candidate.controllerOrigin === profile.controllerOrigin
    && Object.keys(candidate).length === 2
}

export function createClashControllerProfileStore(
  storage: ClashControllerProfileStorage,
): ClashControllerProfileStore {
  let mutation = Promise.resolve()

  function serialize<T>(operation: () => Promise<T>) {
    const result = mutation.then(operation)
    mutation = result.then(() => undefined, () => undefined)
    return result
  }

  return {
    async load() {
      await mutation
      const stored = await storage.get(CLASH_CONTROLLER_PROFILE_STORAGE_KEY)
      const raw = stored[CLASH_CONTROLLER_PROFILE_STORAGE_KEY]
      const profile = normalizeClashControllerProfile(raw)
      if (!profile) {
        if (raw !== undefined)
          await storage.remove(CLASH_CONTROLLER_PROFILE_STORAGE_KEY)
        return null
      }
      if (!isCurrentProfile(raw, profile))
        await storage.set({ [CLASH_CONTROLLER_PROFILE_STORAGE_KEY]: profile })
      return structuredClone(profile)
    },
    save(controllerOrigin) {
      return serialize(async () => {
        const profile = normalizeClashControllerProfile(controllerOrigin)
        if (!profile)
          throw new TypeError('Invalid Clash controller profile origin')
        await storage.set({ [CLASH_CONTROLLER_PROFILE_STORAGE_KEY]: profile })
        return structuredClone(profile)
      })
    },
  }
}
