import type {
  ResourceCandidateSsrClassification,
  ResourceCandidateSsrRisk,
  ResourceCandidateV1,
  SendToOpenListCandidateKind,
  SendToOpenListCandidateSource,
  SendToOpenListValidationResult,
} from './contracts'
import {
  SEND_TO_OPENLIST_CANDIDATE_KINDS,
  SEND_TO_OPENLIST_CANDIDATE_SCHEMA_VERSION,
  SEND_TO_OPENLIST_CANDIDATE_SOURCES,
  SEND_TO_OPENLIST_MAX_CANDIDATE_BYTES,
  SEND_TO_OPENLIST_MAX_DISCOVERY_BYTES,
  SEND_TO_OPENLIST_MAX_DISCOVERY_CANDIDATES,
  SEND_TO_OPENLIST_MAX_SUBMISSION_BYTES,
  SEND_TO_OPENLIST_MAX_SUBMISSION_CANDIDATES,
  SEND_TO_OPENLIST_MAX_TITLE_BYTES,
  SEND_TO_OPENLIST_MAX_URL_BYTES,
} from './contracts'
import {
  hasOnlyDataProperties,
  readDataProperty,
  utf8ByteLength,
  validationFailure,
  validationSuccess,
} from './validation'

const candidateInputKeysWithoutTitle = new Set(['url', 'source'])
const candidateInputKeysWithTitle = new Set([...candidateInputKeysWithoutTitle, 'title'])
const candidateKeysWithoutTitle = new Set(['schemaVersion', 'id', 'url', 'kind', 'source'])
const candidateKeysWithTitle = new Set([...candidateKeysWithoutTitle, 'title'])
const candidateKindValues = new Set<string>(SEND_TO_OPENLIST_CANDIDATE_KINDS)
const candidateSourceValues = new Set<string>(SEND_TO_OPENLIST_CANDIDATE_SOURCES)

function containsControlOrSpace(value: string) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code <= 0x20 || code === 0x7F)
      return true
  }
  return false
}

function stableTextHash(value: string) {
  let hash = 0xCBF29CE484222325n
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index))
    hash = BigInt.asUintN(64, hash * 0x100000001B3n)
  }
  return hash.toString(16).padStart(16, '0')
}

export function createResourceCandidateId(url: string) {
  return `resource-${stableTextHash(url)}`
}

function normalizeHttpUrl(raw: string): SendToOpenListValidationResult<string> {
  try {
    const parsed = new URL(raw)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
      return validationFailure('unsupported-scheme', '$.url')
    if (parsed.username || parsed.password)
      return validationFailure('credentials-forbidden', '$.url')
    const fragmentIndex = raw.indexOf('#')
    return validationSuccess(fragmentIndex < 0 ? raw : raw.slice(0, fragmentIndex))
  }
  catch {
    return validationFailure('invalid-candidate', '$.url')
  }
}

function classifyCandidateKind(raw: string): SendToOpenListCandidateKind | null {
  const separator = raw.indexOf(':')
  if (separator <= 0)
    return null
  const scheme = raw.slice(0, separator).toLowerCase()
  return candidateKindValues.has(scheme) ? scheme as SendToOpenListCandidateKind : null
}

export function normalizeResourceCandidateUrl(
  input: unknown,
): SendToOpenListValidationResult<{ readonly url: string, readonly kind: SendToOpenListCandidateKind }> {
  if (typeof input !== 'string' || !input)
    return validationFailure('invalid-candidate', '$.url')
  if (containsControlOrSpace(input))
    return validationFailure('control-character', '$.url')
  if (utf8ByteLength(input) > SEND_TO_OPENLIST_MAX_URL_BYTES)
    return validationFailure('url-limit', '$.url')

  const kind = classifyCandidateKind(input)
  if (!kind)
    return validationFailure('unsupported-scheme', '$.url')

  let url = input
  if (kind === 'http' || kind === 'https') {
    const normalized = normalizeHttpUrl(input)
    if (!normalized.ok)
      return normalized
    url = normalized.value
  }
  else {
    const suffix = input.slice(input.indexOf(':') + 1)
    if ((kind === 'magnet' && !suffix.startsWith('?'))
      || (kind === 'ed2k' && (!suffix.startsWith('//') || suffix.length <= 2))) {
      return validationFailure('invalid-candidate', '$.url')
    }
  }

  if (utf8ByteLength(url) > SEND_TO_OPENLIST_MAX_URL_BYTES)
    return validationFailure('url-limit', '$.url')
  return validationSuccess(Object.freeze({ url, kind }))
}

function candidateByteLength(candidate: ResourceCandidateV1) {
  return utf8ByteLength(JSON.stringify(candidate))
}

export function normalizeResourceCandidate(input: unknown): SendToOpenListValidationResult<ResourceCandidateV1> {
  if (!input || typeof input !== 'object')
    return validationFailure('invalid-candidate', '$')
  const hasTitle = Object.prototype.hasOwnProperty.call(input, 'title')
  if (!hasOnlyDataProperties(input, hasTitle ? candidateInputKeysWithTitle : candidateInputKeysWithoutTitle))
    return validationFailure('invalid-candidate', '$')
  const record = input as Record<string, unknown>
  const source = readDataProperty(record, 'source')
  const title = readDataProperty(record, 'title')
  if (typeof source !== 'string' || !candidateSourceValues.has(source))
    return validationFailure('invalid-candidate', '$.source')
  if (title !== undefined && (typeof title !== 'string' || utf8ByteLength(title) > SEND_TO_OPENLIST_MAX_TITLE_BYTES))
    return validationFailure('title-limit', '$.title')

  const normalizedUrl = normalizeResourceCandidateUrl(readDataProperty(record, 'url'))
  if (!normalizedUrl.ok)
    return normalizedUrl
  const candidate: ResourceCandidateV1 = Object.freeze({
    schemaVersion: SEND_TO_OPENLIST_CANDIDATE_SCHEMA_VERSION,
    id: createResourceCandidateId(normalizedUrl.value.url),
    url: normalizedUrl.value.url,
    kind: normalizedUrl.value.kind,
    source: source as SendToOpenListCandidateSource,
    ...(title === undefined ? {} : { title }),
  })
  if (candidateByteLength(candidate) > SEND_TO_OPENLIST_MAX_CANDIDATE_BYTES)
    return validationFailure('candidate-bytes-limit', '$')
  return validationSuccess(candidate)
}

export function validateResourceCandidate(input: unknown): SendToOpenListValidationResult<ResourceCandidateV1> {
  if (!input || typeof input !== 'object')
    return validationFailure('invalid-candidate', '$')
  const record = input as Record<string, unknown>
  const hasTitle = Object.prototype.hasOwnProperty.call(record, 'title')
  if (!hasOnlyDataProperties(input, hasTitle ? candidateKeysWithTitle : candidateKeysWithoutTitle))
    return validationFailure('invalid-candidate', '$')
  const normalized = normalizeResourceCandidate({
    url: readDataProperty(record, 'url'),
    source: readDataProperty(record, 'source'),
    ...(hasTitle ? { title: readDataProperty(record, 'title') } : {}),
  })
  if (!normalized.ok)
    return normalized
  if (readDataProperty(record, 'schemaVersion') !== SEND_TO_OPENLIST_CANDIDATE_SCHEMA_VERSION
    || readDataProperty(record, 'id') !== normalized.value.id
    || readDataProperty(record, 'kind') !== normalized.value.kind) {
    return validationFailure('invalid-candidate', '$')
  }
  return normalized
}

function parseIpv4(hostname: string): readonly number[] | null {
  const parts = hostname.split('.')
  if (parts.length !== 4 || parts.some(part => !/^\d{1,3}$/.test(part)))
    return null
  const octets = parts.map(Number)
  return octets.every(value => value >= 0 && value <= 255) ? octets : null
}

function ipv4Risk(
  octets: readonly number[],
): Exclude<ResourceCandidateSsrRisk, 'server-policy-required'> | null {
  const [first, second, third] = octets
  if (first === 0)
    return 'ipv4-unspecified'
  if (first === 127)
    return 'ipv4-loopback'
  if (first === 10 || (first === 172 && second! >= 16 && second! <= 31) || (first === 192 && second === 168))
    return 'ipv4-private'
  if (first === 100 && second! >= 64 && second! <= 127)
    return 'ipv4-shared'
  if (first === 169 && second === 254)
    return 'ipv4-link-local'
  if (first! >= 224
    || (first === 192 && second === 0 && (third === 0 || third === 2))
    || (first === 192 && second === 88 && third === 99)
    || (first === 198 && (second === 18 || second === 19 || (second === 51 && third === 100)))
    || (first === 203 && second === 0 && third === 113)) {
    return 'ipv4-reserved'
  }
  return null
}

function parseIpv6(hostname: string): readonly number[] | null {
  const unwrapped = hostname.replace(/^\[|\]$/g, '')
  if (!unwrapped.includes(':') || unwrapped.includes('%'))
    return null
  const sections = unwrapped.split('::')
  if (sections.length > 2)
    return null
  const parseSide = (side: string) => side ? side.split(':').map(part => /^[0-9a-f]{1,4}$/i.test(part) ? Number.parseInt(part, 16) : -1) : []
  const left = parseSide(sections[0]!)
  const right = parseSide(sections[1] ?? '')
  if (left.includes(-1) || right.includes(-1))
    return null
  const missing = 8 - left.length - right.length
  if ((sections.length === 1 && missing !== 0) || (sections.length === 2 && missing < 1))
    return null
  const groups = [...left, ...Array.from({ length: missing }, () => 0), ...right]
  return groups.length === 8 ? groups : null
}

function ipv6Risk(
  groups: readonly number[],
): Exclude<ResourceCandidateSsrRisk, 'server-policy-required'> | null {
  if (groups.every(group => group === 0))
    return 'ipv6-unspecified'
  if (groups.slice(0, 7).every(group => group === 0) && groups[7] === 1)
    return 'ipv6-loopback'
  if ((groups[0]! & 0xFE00) === 0xFC00)
    return 'ipv6-private'
  if ((groups[0]! & 0xFFC0) === 0xFE80)
    return 'ipv6-link-local'
  if ((groups[0]! & 0xFF00) === 0xFF00)
    return 'ipv6-multicast'
  if (groups.slice(0, 5).every(group => group === 0) && groups[5] === 0xFFFF) {
    const mapped = [(groups[6]! >> 8) & 0xFF, groups[6]! & 0xFF, (groups[7]! >> 8) & 0xFF, groups[7]! & 0xFF]
    return ipv4Risk(mapped)
  }
  const isGlobalUnicast = groups[0]! >= 0x2000 && groups[0]! <= 0x3FFF
  const specialGlobal = (groups[0] === 0x2001 && [0x2, 0x10, 0x20, 0xDB8].includes(groups[1]!))
    || groups[0] === 0x2002
  return !isGlobalUnicast || specialGlobal ? 'ipv6-reserved' : null
}

function blockedClassification(
  risk: Exclude<ResourceCandidateSsrRisk, 'server-policy-required'>,
  canonicalHostname: string,
): ResourceCandidateSsrClassification {
  return Object.freeze({ decision: 'block-local-use', risk, canonicalHostname })
}

export function classifyResourceCandidateSsr(
  candidate: ResourceCandidateV1,
): ResourceCandidateSsrClassification {
  if (candidate.kind === 'magnet' || candidate.kind === 'ed2k') {
    return Object.freeze({
      decision: 'allow-with-server-policy',
      risk: 'server-policy-required',
      canonicalHostname: null,
    })
  }

  const parsed = new URL(candidate.url)
  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
  if (hostname === 'localhost' || hostname.endsWith('.localhost'))
    return blockedClassification('local-hostname', hostname)
  if (!hostname.includes('.') && !hostname.includes(':'))
    return blockedClassification('single-label-hostname', hostname)
  if (hostname.endsWith('.local')
    || hostname.endsWith('.internal')
    || hostname === 'home.arpa'
    || hostname.endsWith('.home.arpa')) {
    return blockedClassification('special-use-hostname', hostname)
  }

  const ipv4 = parseIpv4(hostname)
  const ipv6 = ipv4 ? null : parseIpv6(hostname)
  const literalRisk = ipv4 ? ipv4Risk(ipv4) : ipv6 ? ipv6Risk(ipv6) : null
  if (literalRisk)
    return blockedClassification(literalRisk, hostname)
  return Object.freeze({
    decision: 'allow-with-server-policy',
    risk: 'server-policy-required',
    canonicalHostname: hostname,
  })
}

export function normalizeResourceCandidateList(
  inputs: readonly unknown[],
  purpose: 'discovery' | 'submission',
): SendToOpenListValidationResult<readonly ResourceCandidateV1[]> {
  const maximumItems = purpose === 'discovery'
    ? SEND_TO_OPENLIST_MAX_DISCOVERY_CANDIDATES
    : SEND_TO_OPENLIST_MAX_SUBMISSION_CANDIDATES
  const maximumBytes = purpose === 'discovery'
    ? SEND_TO_OPENLIST_MAX_DISCOVERY_BYTES
    : SEND_TO_OPENLIST_MAX_SUBMISSION_BYTES
  const limitCode = purpose === 'discovery' ? 'candidate-limit' : 'submission-limit'
  const bytesCode = purpose === 'discovery' ? 'candidate-bytes-limit' : 'submission-bytes-limit'
  if (!Array.isArray(inputs) || inputs.length > maximumItems)
    return validationFailure(limitCode, '$')

  const normalized: ResourceCandidateV1[] = []
  const seenUrls = new Set<string>()
  let bytes = 0
  for (let index = 0; index < inputs.length; index += 1) {
    const storedCandidate = inputs[index]
    const candidate = storedCandidate
      && typeof storedCandidate === 'object'
      && Object.prototype.hasOwnProperty.call(storedCandidate, 'schemaVersion')
      ? validateResourceCandidate(storedCandidate)
      : normalizeResourceCandidate(storedCandidate)
    if (!candidate.ok)
      return validationFailure(candidate.code, `$[${index}]${candidate.path.slice(1)}`)
    if (seenUrls.has(candidate.value.url))
      continue
    if (purpose === 'submission' && classifyResourceCandidateSsr(candidate.value).decision === 'block-local-use')
      return validationFailure('local-use-blocked', `$[${index}].url`)
    seenUrls.add(candidate.value.url)
    bytes += candidateByteLength(candidate.value)
    if (bytes > maximumBytes)
      return validationFailure(bytesCode, '$')
    normalized.push(candidate.value)
  }
  return validationSuccess(Object.freeze(normalized))
}
