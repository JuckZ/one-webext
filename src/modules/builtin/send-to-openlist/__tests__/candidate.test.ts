import {
  classifyResourceCandidateSsr,
  createResourceCandidateId,
  normalizeResourceCandidate,
  normalizeResourceCandidateList,
  normalizeResourceCandidateUrl,
  validateResourceCandidate,
} from '../candidate'
import {
  SEND_TO_OPENLIST_MAX_DISCOVERY_CANDIDATES,
  SEND_TO_OPENLIST_MAX_SUBMISSION_CANDIDATES,
  SEND_TO_OPENLIST_MAX_TITLE_BYTES,
  SEND_TO_OPENLIST_MAX_URL_BYTES,
} from '../contracts'

function candidate(url: string, title?: string) {
  return { url, source: 'manual', ...(title === undefined ? {} : { title }) }
}

function valueOf<Value>(result: { ok: true, value: Value } | { ok: false }) {
  if (!result.ok)
    throw new Error('Expected validation success')
  return result.value
}

describe('send to OpenList resource candidates', () => {
  it('removes only the HTTP fragment and preserves signed path/query bytes', () => {
    const raw = 'HTTPS://EXAMPLE.com:443/a/../download?X-Amz-Signature=A%2Fb&x=1&x=2#ignored'
    const normalized = valueOf(normalizeResourceCandidate(candidate(raw, '<script>plain text</script>')))

    expect(normalized.url).toBe(raw.slice(0, raw.indexOf('#')))
    expect(normalized.kind).toBe('https')
    expect(normalized.title).toBe('<script>plain text</script>')
    expect(normalized.id).toBe(createResourceCandidateId(normalized.url))
    expect(Object.isFrozen(normalized)).toBe(true)
  })

  it('accepts only finite HTTP, HTTPS, magnet and ed2k shapes', () => {
    expect(valueOf(normalizeResourceCandidateUrl('http://example.com/a')).kind).toBe('http')
    expect(valueOf(normalizeResourceCandidateUrl('magnet:?xt=urn:btih:ABC')).kind).toBe('magnet')
    expect(valueOf(normalizeResourceCandidateUrl('ed2k://|file|a@b.iso|1|HASH|/')).kind).toBe('ed2k')
    expect(normalizeResourceCandidateUrl('blob:https://example.com/id')).toMatchObject({
      ok: false,
      code: 'unsupported-scheme',
    })
    expect(normalizeResourceCandidateUrl('javascript:alert(1)')).toMatchObject({ ok: false })
    expect(normalizeResourceCandidateUrl('magnet:missing-query')).toMatchObject({ ok: false })
    expect(normalizeResourceCandidateUrl('ed2k://')).toMatchObject({ ok: false })
  })

  it('rejects credentials, controls, spaces and URL/title byte overflow', () => {
    expect(normalizeResourceCandidateUrl('https://user:secret@example.com/file')).toMatchObject({
      ok: false,
      code: 'credentials-forbidden',
    })
    expect(normalizeResourceCandidateUrl('https://example.com/a b')).toMatchObject({
      ok: false,
      code: 'control-character',
    })
    expect(normalizeResourceCandidateUrl(`https://example.com/${'x'.repeat(SEND_TO_OPENLIST_MAX_URL_BYTES)}`))
      .toMatchObject({ ok: false, code: 'url-limit' })
    expect(normalizeResourceCandidate(candidate('https://example.com', '界'.repeat(SEND_TO_OPENLIST_MAX_TITLE_BYTES))))
      .toMatchObject({ ok: false, code: 'title-limit' })
  })

  it('strictly validates stored candidates and rejects identity replacement or secret fields', () => {
    const normalized = valueOf(normalizeResourceCandidate(candidate('https://example.com/file')))
    expect(validateResourceCandidate(normalized)).toEqual({ ok: true, value: normalized })
    expect(validateResourceCandidate({ ...normalized, id: 'resource-forged' })).toMatchObject({ ok: false })
    expect(validateResourceCandidate({ ...normalized, kind: 'magnet' })).toMatchObject({ ok: false })
    expect(validateResourceCandidate({ ...normalized, headers: { Cookie: 'secret' } })).toMatchObject({ ok: false })
  })

  it.each([
    ['http://localhost/file', 'local-hostname'],
    ['http://a.localhost/file', 'local-hostname'],
    ['http://nas/file', 'single-label-hostname'],
    ['http://router.home.arpa/file', 'special-use-hostname'],
    ['http://service.internal/file', 'special-use-hostname'],
    ['http://0/file', 'ipv4-unspecified'],
    ['http://127.1/file', 'ipv4-loopback'],
    ['http://0x7f000001/file', 'ipv4-loopback'],
    ['http://2130706433/file', 'ipv4-loopback'],
    ['http://10.0.0.1/file', 'ipv4-private'],
    ['http://100.64.0.1/file', 'ipv4-shared'],
    ['http://169.254.169.254/latest/meta-data', 'ipv4-link-local'],
    ['http://192.0.2.1/file', 'ipv4-reserved'],
    ['http://[::]/file', 'ipv6-unspecified'],
    ['http://[::1]/file', 'ipv6-loopback'],
    ['http://[fd00::1]/file', 'ipv6-private'],
    ['http://[fe80::1]/file', 'ipv6-link-local'],
    ['http://[ff02::1]/file', 'ipv6-multicast'],
    ['http://[2001:db8::1]/file', 'ipv6-reserved'],
    ['http://[::ffff:127.0.0.1]/file', 'ipv4-loopback'],
  ])('hard-blocks explicit local-use target %s', (url, risk) => {
    const normalized = valueOf(normalizeResourceCandidate(candidate(url)))
    expect(classifyResourceCandidateSsr(normalized)).toMatchObject({
      decision: 'block-local-use',
      risk,
    })
  })

  it('keeps public DNS and opaque peer resources behind the server-policy warning', () => {
    const publicHttp = valueOf(normalizeResourceCandidate(candidate('https://downloads.example.org/file')))
    const publicIp = valueOf(normalizeResourceCandidate(candidate('https://8.8.8.8/file')))
    const magnet = valueOf(normalizeResourceCandidate(candidate('magnet:?xt=urn:btih:ABC')))

    expect(classifyResourceCandidateSsr(publicHttp)).toEqual({
      decision: 'allow-with-server-policy',
      risk: 'server-policy-required',
      canonicalHostname: 'downloads.example.org',
    })
    expect(classifyResourceCandidateSsr(publicIp).decision).toBe('allow-with-server-policy')
    expect(classifyResourceCandidateSsr(magnet).canonicalHostname).toBeNull()
  })

  it('deduplicates canonical URLs without treating the stable ID as authority', () => {
    const result = valueOf(normalizeResourceCandidateList([
      candidate('https://example.com/file#first', 'first'),
      candidate('https://example.com/file#second', 'second'),
      candidate('https://example.com/other'),
    ], 'discovery'))
    expect(result).toHaveLength(2)
    expect(result[0]?.title).toBe('first')
    expect(Object.isFrozen(result)).toBe(true)
  })

  it('enforces discovery and submission item limits before any network boundary', () => {
    const discoveryOverflow = Array.from(
      { length: SEND_TO_OPENLIST_MAX_DISCOVERY_CANDIDATES + 1 },
      (_, index) => candidate(`https://example.com/${index}`),
    )
    const submissionOverflow = Array.from(
      { length: SEND_TO_OPENLIST_MAX_SUBMISSION_CANDIDATES + 1 },
      (_, index) => candidate(`https://example.com/${index}`),
    )
    expect(normalizeResourceCandidateList(discoveryOverflow, 'discovery'))
      .toMatchObject({ ok: false, code: 'candidate-limit' })
    expect(normalizeResourceCandidateList(submissionOverflow, 'submission'))
      .toMatchObject({ ok: false, code: 'submission-limit' })
    expect(normalizeResourceCandidateList([candidate('http://127.1/file')], 'submission'))
      .toMatchObject({ ok: false, code: 'local-use-blocked' })
  })

  it('enforces aggregate bytes after validation and deduplication', () => {
    const large = Array.from({ length: 40 }, (_, index) => candidate(
      `https://example.com/${index}/${'x'.repeat(7000)}`,
    ))
    expect(normalizeResourceCandidateList(large, 'submission'))
      .toMatchObject({ ok: false, code: 'submission-bytes-limit' })
  })
})
