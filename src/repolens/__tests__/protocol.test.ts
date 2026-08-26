import {
  bridgeEnvelope,
  isTrustedEmbedMessage,
  normalizeRepoContext,
  parseGitHubContext,
  REPOLENS_ORIGIN,
} from '../protocol'

describe('repoLens protocol', () => {
  it('extracts only normalized repository metadata from GitHub URLs', () => {
    expect(parseGitHubContext('https://github.com/vuejs/core')).toEqual({
      repo: 'vuejs/core',
      url: 'https://github.com/vuejs/core',
      pageType: 'repository',
    })
    expect(parseGitHubContext('https://github.com/vuejs/core/pulls?q=is%3Aopen')).toEqual({
      repo: 'vuejs/core',
      url: 'https://github.com/vuejs/core/pulls?q=is%3Aopen',
      pageType: 'pulls',
    })
    expect(parseGitHubContext('https://github.com/vuejs/core/blob/main/README.md')?.pageType).toBe('code')
    expect(parseGitHubContext('https://github.com/settings/profile')).toBeNull()
    expect(parseGitHubContext('https://evil.example/vuejs/core')).toBeNull()
  })

  it('drops extra page content from context messages', () => {
    expect(normalizeRepoContext({
      repo: 'vuejs/core',
      url: 'https://github.com/vuejs/core/issues',
      pageType: 'issues',
      body: 'private code must not cross the bridge',
    })).toEqual({
      repo: 'vuejs/core',
      url: 'https://github.com/vuejs/core/issues',
      pageType: 'issues',
    })
  })

  it('requires the exact iframe source, origin, protocol and allowlisted type', () => {
    const source = {} as Window
    const envelope = { protocol: 'repolens.bridge', version: 1, type: 'BRIDGE_HELLO', challenge: 'challenge' }
    expect(isTrustedEmbedMessage({ origin: REPOLENS_ORIGIN, source, data: envelope }, REPOLENS_ORIGIN, source)).toBe(true)
    expect(isTrustedEmbedMessage({ origin: 'https://evil.example', source, data: envelope }, REPOLENS_ORIGIN, source)).toBe(false)
    expect(isTrustedEmbedMessage({ origin: REPOLENS_ORIGIN, source: {} as Window, data: envelope }, REPOLENS_ORIGIN, source)).toBe(false)
    expect(isTrustedEmbedMessage({ origin: REPOLENS_ORIGIN, source, data: { ...envelope, type: 'EVAL' } }, REPOLENS_ORIGIN, source)).toBe(false)
    expect(bridgeEnvelope('CONTEXT_UPDATE', { sessionNonce: 'nonce' })).toEqual({
      protocol: 'repolens.bridge',
      version: 1,
      type: 'CONTEXT_UPDATE',
      sessionNonce: 'nonce',
    })
  })
})
