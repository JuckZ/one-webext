export const REPOLENS_PROTOCOL = 'repolens.bridge' as const
export const REPOLENS_VERSION = 1 as const
export const REPOLENS_ORIGIN = 'http://127.0.0.1:4747' as const

export const pageTypes = [
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

export type GitHubPageType = typeof pageTypes[number]

export interface RepoContext {
  repo: string
  url: string
  pageType: GitHubPageType
}

export interface GitHubContextMessage {
  channel: 'repolens.extension'
  version: 1
  type: 'GITHUB_CONTEXT'
  context: RepoContext
}

export interface PanelReadyMessage {
  channel: 'repolens.extension'
  version: 1
  type: 'PANEL_READY'
}

export interface PanelContextMessage {
  channel: 'repolens.extension'
  version: 1
  type: 'PANEL_CONTEXT'
  tabId: number
  context: RepoContext
}

export type ExtensionMessage = GitHubContextMessage | PanelReadyMessage | PanelContextMessage

export interface BridgeEnvelope {
  protocol: typeof REPOLENS_PROTOCOL
  version: typeof REPOLENS_VERSION
  type: string
  challenge?: string
  sessionNonce?: string | null
  repo?: string
  state?: string
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
const pageTypeSet = new Set<string>(pageTypes)
const embedMessageTypes = new Set([
  'BRIDGE_HELLO',
  'BRIDGE_READY',
  'CONTEXT_ACCEPTED',
  'ANALYSIS_STATE',
])

function pageTypeFromPath(segment: string | undefined): GitHubPageType {
  if (!segment)
    return 'repository'
  if (segment === 'tree' || segment === 'blob' || segment === 'commits' || segment === 'branches' || segment === 'tags')
    return 'code'
  return pageTypeSet.has(segment) && segment !== 'repository'
    ? segment as GitHubPageType
    : 'other'
}

export function normalizeRepoContext(value: unknown): RepoContext | null {
  if (!value || typeof value !== 'object')
    return null
  const candidate = value as Partial<RepoContext>
  const repo = String(candidate.repo || '').trim()
  const pageType = String(candidate.pageType || '')
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || !pageTypeSet.has(pageType))
    return null
  try {
    const url = new URL(String(candidate.url || ''))
    if (url.protocol !== 'https:' || url.hostname !== 'github.com')
      return null
    return { repo, url: url.href, pageType: pageType as GitHubPageType }
  }
  catch {
    return null
  }
}

export function parseGitHubContext(href: string): RepoContext | null {
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

export function contextKey(context: RepoContext): string {
  return `${context.repo.toLowerCase()}|${context.url}|${context.pageType}`
}

export function isExtensionMessage(value: unknown): value is ExtensionMessage {
  if (!value || typeof value !== 'object')
    return false
  const message = value as Partial<ExtensionMessage>
  return message.channel === 'repolens.extension' && message.version === 1
}

export function isTrustedEmbedMessage(
  event: Pick<MessageEvent, 'origin' | 'source' | 'data'>,
  expectedOrigin: string,
  expectedSource: Window | null,
): event is Pick<MessageEvent, 'origin' | 'source'> & { data: BridgeEnvelope } {
  if (event.origin !== expectedOrigin || event.source !== expectedSource)
    return false
  const message = event.data as Partial<BridgeEnvelope> | null
  return Boolean(
    message
    && message.protocol === REPOLENS_PROTOCOL
    && message.version === REPOLENS_VERSION
    && typeof message.type === 'string'
    && embedMessageTypes.has(message.type),
  )
}

export function bridgeEnvelope(type: 'BRIDGE_INIT' | 'CONTEXT_UPDATE' | 'REQUEST_DEEP_ANALYSIS', fields: Record<string, unknown> = {}) {
  return { protocol: REPOLENS_PROTOCOL, version: REPOLENS_VERSION, type, ...fields }
}
