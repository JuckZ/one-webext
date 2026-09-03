import type { BrowserJournalObservation } from '../contracts'
import { validateModuleManifest } from '../../../manifest'
import {
  BROWSER_JOURNAL_ENTRY_LIMIT,
  BROWSER_JOURNAL_TITLE_LIMIT,
} from '../contracts'
import { createBrowserJournalSeed } from '../manifest'
import {
  appendBrowserJournalEntry,
  normalizeBrowserJournalObservation,
  normalizeBrowserJournalTitle,
  normalizeBrowserJournalUrl,
} from '../model'

function observation(overrides: Partial<BrowserJournalObservation> = {}): BrowserJournalObservation {
  return {
    kind: 'navigation',
    tabId: 7,
    windowId: 2,
    occurredAt: '2026-08-29T08:00:00.000Z',
    active: true,
    incognito: false,
    title: '  Example   page  ',
    url: 'https://example.com/path?q=1#private-fragment',
    ...overrides,
  }
}

describe('browser journal pure model', () => {
  it('defines a packaged disabled builtin with no context, capability or remote entry', () => {
    const seed = createBrowserJournalSeed()
    expect(seed).toMatchObject({
      enabled: false,
      grantedContexts: [],
      grantedContextFields: {},
      grantedCapabilities: [],
      manifest: {
        runtime: 'builtin',
        id: 'dev.oneweb.browser-journal',
        entry_id: 'browser-journal',
        matches: [],
        contexts: [],
        capabilities: [],
      },
    })
    expect(validateModuleManifest(seed.manifest, { allowBuiltin: true })).toMatchObject({ ok: true })
    expect(JSON.stringify(seed)).not.toContain('history')
    expect(JSON.stringify(seed)).not.toContain('sessions')
  })

  it('normalizes a bounded HTTP(S) observation without credentials or fragments', () => {
    expect(normalizeBrowserJournalUrl('https://example.com/path#fragment')).toBe('https://example.com/path')
    expect(normalizeBrowserJournalUrl('http://example.com')).toBe('http://example.com/')
    expect(normalizeBrowserJournalUrl('https://user:secret@example.com/')).toBeNull()
    expect(normalizeBrowserJournalUrl('file:///private/note')).toBeNull()
    expect(normalizeBrowserJournalUrl('not a url')).toBeNull()

    const entry = normalizeBrowserJournalObservation(observation())
    expect(entry).toMatchObject({
      kind: 'navigation',
      tabId: 7,
      windowId: 2,
      occurredAt: '2026-08-29T08:00:00.000Z',
      title: 'Example page',
      url: 'https://example.com/path?q=1',
    })
    expect(entry?.id).toMatch(/^journal-[a-z0-9]+$/)
    expect(normalizeBrowserJournalObservation(observation())?.id).toBe(entry?.id)
  })

  it('drops incognito, inactive, malformed and unsupported observations', () => {
    expect(normalizeBrowserJournalObservation(observation({ incognito: true }))).toBeNull()
    expect(normalizeBrowserJournalObservation(observation({ active: false }))).toBeNull()
    expect(normalizeBrowserJournalObservation(observation({ tabId: -1 }))).toBeNull()
    expect(normalizeBrowserJournalObservation(observation({ windowId: Number.NaN }))).toBeNull()
    expect(normalizeBrowserJournalObservation(observation({ occurredAt: 'invalid' }))).toBeNull()
    expect(normalizeBrowserJournalObservation(observation({ url: 'chrome://settings' }))).toBeNull()
    expect(normalizeBrowserJournalObservation(observation({ kind: 'history' as never }))).toBeNull()
  })

  it('bounds untrusted title text without interpreting markup', () => {
    const markup = '<img src=x onerror=alert(1)> <script>ignored</script>'
    expect(normalizeBrowserJournalTitle(`  ${markup}  `)).toBe(markup)
    expect(normalizeBrowserJournalTitle('x'.repeat(BROWSER_JOURNAL_TITLE_LIMIT + 50))).toHaveLength(
      BROWSER_JOURNAL_TITLE_LIMIT,
    )
    expect(normalizeBrowserJournalTitle({ toString: () => markup })).toBe('')
  })

  it('collapses consecutive equivalents and discards the oldest entry at capacity', () => {
    const first = normalizeBrowserJournalObservation(observation())!
    const duplicate = normalizeBrowserJournalObservation(observation({
      kind: 'activation',
      occurredAt: '2026-08-29T08:00:01.000Z',
    }))!
    expect(appendBrowserJournalEntry([first], duplicate)).toEqual([first])

    let entries = [first]
    for (let index = 1; index <= BROWSER_JOURNAL_ENTRY_LIMIT; index++) {
      const next = normalizeBrowserJournalObservation(observation({
        tabId: index + 7,
        occurredAt: new Date(Date.parse('2026-08-29T08:00:00.000Z') + index * 1000).toISOString(),
        url: `https://example.com/${index}`,
      }))!
      entries = appendBrowserJournalEntry(entries, next)
    }
    expect(entries).toHaveLength(BROWSER_JOURNAL_ENTRY_LIMIT)
    expect(entries[0]!.url).toBe('https://example.com/1')
    expect(entries.at(-1)!.url).toBe(`https://example.com/${BROWSER_JOURNAL_ENTRY_LIMIT}`)
  })
})
