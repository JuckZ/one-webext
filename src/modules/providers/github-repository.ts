import type { ModuleContextId } from '../types'

export const githubPageTypes = [
  'repository',
  'code',
  'issues',
  'pulls',
  'actions',
  'releases',
  'discussions',
  'security',
  'wiki',
  'settings',
  'other',
] as const

export type GitHubPageType = typeof githubPageTypes[number]

export interface GitHubRepositoryContext extends Record<string, unknown> {
  repo: string
  url: string
  pageType: GitHubPageType
}

const githubReservedOwners = new Set([
  'about',
  'account',
  'apps',
  'codespaces',
  'collections',
  'contact',
  'dashboard',
  'events',
  'explore',
  'features',
  'issues',
  'login',
  'marketplace',
  'notifications',
  'orgs',
  'pulls',
  'search',
  'settings',
  'site',
  'sponsors',
  'stars',
  'topics',
  'trending',
  'users',
])

const repoPartPattern = /^[\w.-]+$/
const pageTypeSet = new Set<string>(githubPageTypes)

function pageTypeFromPath(segment: string | undefined): GitHubPageType {
  if (!segment)
    return 'repository'
  if (segment === 'tree' || segment === 'blob' || segment === 'commits' || segment === 'branches' || segment === 'tags')
    return 'code'
  return pageTypeSet.has(segment) && segment !== 'repository'
    ? segment as GitHubPageType
    : 'other'
}

export function normalizeGitHubRepositoryContext(value: unknown): GitHubRepositoryContext | null {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return null
  const candidate = value as Partial<GitHubRepositoryContext>
  const repo = String(candidate.repo || '').trim()
  const pageType = String(candidate.pageType || '')
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || !pageTypeSet.has(pageType))
    return null
  try {
    const url = new URL(String(candidate.url || ''))
    if (url.protocol !== 'https:' || url.hostname !== 'github.com')
      return null
    const parsed = parseGitHubRepositoryContext(url.href)
    if (!parsed || parsed.repo.toLowerCase() !== repo.toLowerCase() || parsed.pageType !== pageType)
      return null
    return { repo, url: url.href, pageType: pageType as GitHubPageType }
  }
  catch {
    return null
  }
}

export function parseGitHubRepositoryContext(href: string): GitHubRepositoryContext | null {
  let url: URL
  try {
    url = new URL(href)
  }
  catch {
    return null
  }
  if (url.protocol !== 'https:' || url.hostname !== 'github.com')
    return null
  const segments = url.pathname.split('/').filter(Boolean)
  const [owner, repository, section] = segments
  if (!owner || !repository || githubReservedOwners.has(owner.toLowerCase()))
    return null
  if (!repoPartPattern.test(owner) || !repoPartPattern.test(repository))
    return null
  return {
    repo: `${owner}/${repository}`,
    url: url.href,
    pageType: pageTypeFromPath(section),
  }
}

export function githubRepositoryContextKey(context: GitHubRepositoryContext) {
  return `${context.repo.toLowerCase()}|${context.url}|${context.pageType}`
}

export const githubRepositoryProvider = {
  id: 'github.repository' as ModuleContextId,
  fields: ['repo', 'url', 'pageType'] as const,
  normalize: normalizeGitHubRepositoryContext,
  revision(context: Record<string, unknown>) {
    return githubRepositoryContextKey(context as GitHubRepositoryContext)
  },
  parseUrl: parseGitHubRepositoryContext,
  acceptsSource(sourceUrl: string | undefined) {
    try {
      return new URL(sourceUrl || '').origin === 'https://github.com'
    }
    catch {
      return false
    }
  },
}
