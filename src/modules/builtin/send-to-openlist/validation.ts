import type {
  SendToOpenListAuthorityV1,
  SendToOpenListProfileCollectionV1,
  SendToOpenListProfileTransport,
  SendToOpenListProfileV1,
  SendToOpenListValidationErrorCode,
  SendToOpenListValidationResult,
} from './contracts'
import {
  SEND_TO_OPENLIST_CONTRACT_VERSION,
  SEND_TO_OPENLIST_MAX_ORIGIN_BYTES,
  SEND_TO_OPENLIST_MAX_PROFILE_ID_LENGTH,
  SEND_TO_OPENLIST_MAX_PROFILE_LABEL_BYTES,
  SEND_TO_OPENLIST_MAX_PROFILES,
  SEND_TO_OPENLIST_MODULE_ID,
  SEND_TO_OPENLIST_PROFILE_COLLECTION_SCHEMA_VERSION,
  SEND_TO_OPENLIST_PROFILE_SCHEMA_VERSION,
} from './contracts'

const profileIdPattern = /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/
const profileKeys = new Set(['schemaVersion', 'id', 'label', 'controllerOrigin'])
const profileCollectionKeys = new Set(['schemaVersion', 'activeProfileId', 'profiles'])
const authorityKeys = new Set(['moduleId', 'profileId', 'controllerOrigin', 'generation'])

export function utf8ByteLength(value: string) {
  let bytes = 0
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code <= 0x7F) {
      bytes += 1
    }
    else if (code <= 0x7FF) {
      bytes += 2
    }
    else if (code >= 0xD800 && code <= 0xDBFF
      && index + 1 < value.length
      && value.charCodeAt(index + 1) >= 0xDC00
      && value.charCodeAt(index + 1) <= 0xDFFF) {
      bytes += 4
      index += 1
    }
    else {
      bytes += 3
    }
  }
  return bytes
}

export function hasOnlyDataProperties(
  value: object,
  expectedKeys?: ReadonlySet<string>,
): value is Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null)
    return false
  const keys = Reflect.ownKeys(value)
  if (keys.some(key => typeof key !== 'string'))
    return false
  if (expectedKeys && (keys.length !== expectedKeys.size || keys.some(key => !expectedKeys.has(String(key)))))
    return false
  return keys.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    return Boolean(descriptor && 'value' in descriptor && descriptor.enumerable)
  })
}

export function readDataProperty(value: Record<string, unknown>, key: string): unknown {
  return Object.getOwnPropertyDescriptor(value, key)?.value
}

export function validationFailure<Value>(
  code: SendToOpenListValidationErrorCode,
  path: string,
): SendToOpenListValidationResult<Value> {
  return Object.freeze({ ok: false, code, path })
}

export function validationSuccess<Value>(value: Value): SendToOpenListValidationResult<Value> {
  return Object.freeze({ ok: true, value })
}

export function isProfileId(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= SEND_TO_OPENLIST_MAX_PROFILE_ID_LENGTH
    && profileIdPattern.test(value)
}

export function normalizeSendToOpenListExactOrigin(value: unknown): string | null {
  if (typeof value !== 'string' || !value || utf8ByteLength(value) > SEND_TO_OPENLIST_MAX_ORIGIN_BYTES)
    return null
  try {
    const parsed = new URL(value)
    if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
      || parsed.username
      || parsed.password
      || parsed.pathname !== '/'
      || parsed.search
      || parsed.hash
      || parsed.origin === 'null') {
      return null
    }
    return parsed.origin
  }
  catch {
    return null
  }
}

export function validateSendToOpenListProfile(
  input: unknown,
): SendToOpenListValidationResult<SendToOpenListProfileV1> {
  if (!input || typeof input !== 'object' || !hasOnlyDataProperties(input, profileKeys))
    return validationFailure('invalid-profile', '$')
  const record = input as Record<string, unknown>
  const schemaVersion = readDataProperty(record, 'schemaVersion')
  const id = readDataProperty(record, 'id')
  const label = readDataProperty(record, 'label')
  const origin = normalizeSendToOpenListExactOrigin(readDataProperty(record, 'controllerOrigin'))
  if (schemaVersion !== SEND_TO_OPENLIST_PROFILE_SCHEMA_VERSION
    || !isProfileId(id)
    || typeof label !== 'string'
    || !label.trim()
    || utf8ByteLength(label) > SEND_TO_OPENLIST_MAX_PROFILE_LABEL_BYTES
    || !origin) {
    return validationFailure('invalid-profile', '$')
  }
  return validationSuccess(Object.freeze({
    schemaVersion: SEND_TO_OPENLIST_PROFILE_SCHEMA_VERSION,
    id,
    label,
    controllerOrigin: origin,
  }))
}

export function validateSendToOpenListProfiles(
  input: unknown,
): SendToOpenListValidationResult<SendToOpenListProfileCollectionV1> {
  if (!input || typeof input !== 'object' || !hasOnlyDataProperties(input, profileCollectionKeys))
    return validationFailure('invalid-profile', '$')
  const record = input as Record<string, unknown>
  const schemaVersion = readDataProperty(record, 'schemaVersion')
  const activeProfileId = readDataProperty(record, 'activeProfileId')
  const profiles = readDataProperty(record, 'profiles')
  if (schemaVersion !== SEND_TO_OPENLIST_PROFILE_COLLECTION_SCHEMA_VERSION
    || (activeProfileId !== null && !isProfileId(activeProfileId))
    || !Array.isArray(profiles)) {
    return validationFailure('invalid-profile', '$')
  }
  if (profiles.length > SEND_TO_OPENLIST_MAX_PROFILES)
    return validationFailure('profile-limit', '$.profiles')

  const normalized: SendToOpenListProfileV1[] = []
  const ids = new Set<string>()
  for (let index = 0; index < profiles.length; index += 1) {
    const profile = validateSendToOpenListProfile(profiles[index])
    if (!profile.ok)
      return validationFailure(profile.code, `$.profiles[${index}]`)
    if (ids.has(profile.value.id))
      return validationFailure('duplicate-profile', `$.profiles[${index}].id`)
    ids.add(profile.value.id)
    normalized.push(profile.value)
  }
  if (activeProfileId !== null && !ids.has(activeProfileId))
    return validationFailure('invalid-profile', '$.activeProfileId')
  return validationSuccess(Object.freeze({
    schemaVersion: SEND_TO_OPENLIST_PROFILE_COLLECTION_SCHEMA_VERSION,
    activeProfileId,
    profiles: Object.freeze(normalized),
  }))
}

function isLoopbackOrigin(origin: string) {
  const hostname = new URL(origin).hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname === '::1')
    return true
  const octets = hostname.split('.').map(Number)
  return octets.length === 4 && octets.every(Number.isInteger) && octets[0] === 127
}

export function classifySendToOpenListProfileTransport(
  profile: SendToOpenListProfileV1,
): SendToOpenListProfileTransport {
  if (profile.controllerOrigin.startsWith('https://'))
    return 'encrypted'
  return isLoopbackOrigin(profile.controllerOrigin) ? 'loopback-cleartext' : 'cleartext-token-risk'
}

export function validateSendToOpenListAuthority(
  input: unknown,
): SendToOpenListValidationResult<SendToOpenListAuthorityV1> {
  if (!input || typeof input !== 'object' || !hasOnlyDataProperties(input, authorityKeys))
    return validationFailure('invalid-authority', '$')
  const record = input as Record<string, unknown>
  const moduleId = readDataProperty(record, 'moduleId')
  const profileId = readDataProperty(record, 'profileId')
  const controllerOrigin = normalizeSendToOpenListExactOrigin(readDataProperty(record, 'controllerOrigin'))
  const generation = readDataProperty(record, 'generation')
  if (moduleId !== SEND_TO_OPENLIST_MODULE_ID
    || !isProfileId(profileId)
    || !controllerOrigin
    || !Number.isSafeInteger(generation)
    || Number(generation) < SEND_TO_OPENLIST_CONTRACT_VERSION) {
    return validationFailure('invalid-authority', '$')
  }
  return validationSuccess(Object.freeze({
    moduleId: SEND_TO_OPENLIST_MODULE_ID,
    profileId,
    controllerOrigin,
    generation: Number(generation),
  }))
}

export function sameSendToOpenListAuthority(
  left: SendToOpenListAuthorityV1,
  right: SendToOpenListAuthorityV1,
) {
  return left.moduleId === right.moduleId
    && left.profileId === right.profileId
    && left.controllerOrigin === right.controllerOrigin
    && left.generation === right.generation
}
