import {
  normalizeGitHubRepositoryContext,
  parseGitHubRepositoryContext,
} from '../github-repository'

describe('github repository provider', () => {
  it('parses repository routes without reading page content', () => {
    expect(parseGitHubRepositoryContext('https://github.com/vuejs/core')).toEqual({
      repo: 'vuejs/core',
      url: 'https://github.com/vuejs/core',
      pageType: 'repository',
    })
    expect(parseGitHubRepositoryContext('https://github.com/vuejs/core/pulls?q=is%3Aopen')).toEqual({
      repo: 'vuejs/core',
      url: 'https://github.com/vuejs/core/pulls?q=is%3Aopen',
      pageType: 'pulls',
    })
    expect(parseGitHubRepositoryContext('https://github.com/vuejs/core/blob/main/README.md')?.pageType).toBe('code')
    expect(parseGitHubRepositoryContext('https://github.com/settings/profile')).toBeNull()
    expect(parseGitHubRepositoryContext('https://evil.example/vuejs/core')).toBeNull()
  })

  it('normalizes only the provider allowlist', () => {
    expect(normalizeGitHubRepositoryContext({
      repo: 'vuejs/core',
      url: 'https://github.com/vuejs/core/issues',
      pageType: 'issues',
      privateBody: 'discarded',
    })).toEqual({
      repo: 'vuejs/core',
      url: 'https://github.com/vuejs/core/issues',
      pageType: 'issues',
    })
    expect(normalizeGitHubRepositoryContext({
      repo: 'vuejs/core',
      url: 'https://evil.example/vuejs/core',
      pageType: 'repository',
    })).toBeNull()
    expect(normalizeGitHubRepositoryContext({
      repo: 'facebook/react',
      url: 'https://github.com/vuejs/core/issues',
      pageType: 'repository',
    })).toBeNull()
  })
})
