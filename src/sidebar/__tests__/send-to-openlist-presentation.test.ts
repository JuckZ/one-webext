import {
  mergePresentedResourceCandidates,
  parseManualResourceCandidates,
  presentResourceCandidate,
  presentSubmissionStatus,
  presentTaskSnapshot,
} from '../send-to-openlist-presentation'

describe('send to OpenList presentation model', () => {
  it('normalizes, deduplicates and preserves signed query bytes', () => {
    const parsed = parseManualResourceCandidates([
      'https://cdn.example/file?b=2&a=a%2Bb#fragment',
      'https://cdn.example/file?b=2&a=a%2Bb#other',
      'magnet:?xt=urn:btih:abc',
    ].join('\n'))
    expect(parsed.error).toBeNull()
    expect(parsed.candidates.map(candidate => candidate.url)).toEqual([
      'https://cdn.example/file?b=2&a=a%2Bb',
      'magnet:?xt=urn:btih:abc',
    ])
  })

  it('rejects unsupported and credential-bearing input before rendering candidates', () => {
    expect(parseManualResourceCandidates('javascript:alert(1)')).toMatchObject({ candidates: [], error: expect.any(String) })
    expect(parseManualResourceCandidates('https://user:secret@example.com/file')).toMatchObject({ candidates: [], error: expect.any(String) })
  })

  it('merges browser and manual candidates while surfacing local-use blocks', () => {
    const manual = parseManualResourceCandidates('https://cdn.example/a')
    const browser = parseManualResourceCandidates('http://127.1/admin')
    const merged = mergePresentedResourceCandidates(manual.candidates, browser.candidates)
    expect(merged).toMatchObject({ ok: true, value: [{ url: 'https://cdn.example/a' }, { url: 'http://127.1/admin' }] })
    if (!merged.ok)
      throw new Error(merged.code)
    expect(presentResourceCandidate(merged.value[1]!)).toMatchObject({
      blocked: true,
      riskLabel: expect.stringContaining('ipv4-loopback'),
    })
  })

  it('presents unknown outcomes without recommending a retry', () => {
    const item = {
      schemaVersion: 1 as const,
      id: 'resource-a',
      url: 'https://example.com/a',
      kind: 'https' as const,
      source: 'manual' as const,
    }
    expect(presentSubmissionStatus({
      schemaVersion: 1,
      authority: { moduleId: 'dev.oneweb.send-to-openlist', profileId: 'p', controllerOrigin: 'https://server.example', generation: 1 },
      status: 'completed',
      entries: [{ candidate: item, status: 'outcome-unknown', errorCode: 'outcome-unknown' }],
      inFlight: 0,
    })[0]!.label).toContain('不会自动重试')
  })

  it('keeps upstream task text as plain presentation data', () => {
    expect(presentTaskSnapshot({
      schemaVersion: 1,
      authority: { moduleId: 'dev.oneweb.send-to-openlist', profileId: 'p', controllerOrigin: 'https://server.example', generation: 1 },
      snapshotId: 'snapshot',
      list: 'undone',
      refreshedAt: '2026-09-04T00:00:00.000Z',
      tasks: [{ id: '1', name: '<img src=x>', state: 1, status: 'running', progress: 2, totalBytes: 3, error: '<script>' }],
    }).tasks[0]).toMatchObject({ name: '<img src=x>', error: '<script>' })
  })
})
