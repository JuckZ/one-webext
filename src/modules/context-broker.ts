import type { ModuleContextId } from './types'
import { githubRepositoryProvider } from './providers/github-repository'

export type ContextValue = Record<string, unknown>
export type ContextMap = Partial<Record<ModuleContextId, ContextValue>>

export interface ContextSnapshot {
  tabId: number
  revision: string
  contexts: ContextMap
}

export interface OneWebContextProvider {
  id: ModuleContextId
  fields: readonly string[]
  normalize: (_value: unknown) => ContextValue | null
  revision: (_value: ContextValue) => string
  parseUrl?: (_href: string) => ContextValue | null
  acceptsSource?: (_sourceUrl: string | undefined) => boolean
}

function validTabId(tabId: number) {
  return Number.isInteger(tabId) && tabId >= 0
}

function cloneContexts(contexts: ContextMap): ContextMap {
  return structuredClone(contexts)
}

export class ContextBroker {
  private readonly providers = new Map<ModuleContextId, OneWebContextProvider>()
  private readonly contexts = new Map<number, ContextMap>()
  private readonly providerRevisions = new Map<number, Partial<Record<ModuleContextId, string>>>()
  private readonly tabRevisions = new Map<number, number>()

  constructor(providers: OneWebContextProvider[]) {
    for (const provider of providers) {
      if (this.providers.has(provider.id))
        throw new Error(`Duplicate context provider: ${provider.id}`)
      this.providers.set(provider.id, provider)
    }
  }

  updateFromSource(tabId: number, contextId: ModuleContextId, value: unknown, sourceUrl?: string) {
    const provider = this.providers.get(contextId)
    if (!provider || (provider.acceptsSource && !provider.acceptsSource(sourceUrl)))
      return null
    if (value === null)
      return this.clearValue(tabId, provider.id) ? this.getSnapshot(tabId) : null
    return this.update(tabId, provider, value)
  }

  updateFromUrl(tabId: number, href: string): ContextSnapshot | null {
    if (!validTabId(tabId))
      return null
    let changed = false
    for (const provider of this.providers.values()) {
      if (!provider.parseUrl)
        continue
      const value = provider.parseUrl(href)
      changed = value
        ? this.setValue(tabId, provider, value) || changed
        : this.clearValue(tabId, provider.id) || changed
    }
    return changed ? this.getSnapshot(tabId) : null
  }

  getSnapshot(tabId: number): ContextSnapshot | null {
    if (!validTabId(tabId))
      return null
    return {
      tabId,
      revision: String(this.tabRevisions.get(tabId) || 0),
      contexts: cloneContexts(this.contexts.get(tabId) || {}),
    }
  }

  normalizeSnapshot(tabId: number, value: unknown): ContextSnapshot | null {
    if (!validTabId(tabId) || !value || typeof value !== 'object' || Array.isArray(value))
      return null
    const contexts: ContextMap = {}
    for (const [contextId, candidate] of Object.entries(value)) {
      const provider = this.providers.get(contextId as ModuleContextId)
      if (!provider)
        continue
      const normalized = provider.normalize(candidate)
      if (normalized)
        contexts[provider.id] = normalized
    }
    return { tabId, revision: '0', contexts }
  }

  remove(tabId: number) {
    this.contexts.delete(tabId)
    this.providerRevisions.delete(tabId)
    this.tabRevisions.delete(tabId)
  }

  private update(tabId: number, provider: OneWebContextProvider, value: unknown) {
    if (!validTabId(tabId))
      return null
    const normalized = provider.normalize(value)
    if (!normalized)
      return null
    return this.setValue(tabId, provider, normalized) ? this.getSnapshot(tabId) : null
  }

  private setValue(tabId: number, provider: OneWebContextProvider, value: ContextValue) {
    const revision = provider.revision(value)
    const revisions = this.providerRevisions.get(tabId) || {}
    if (revisions[provider.id] === revision)
      return false
    const contexts = this.contexts.get(tabId) || {}
    contexts[provider.id] = value
    revisions[provider.id] = revision
    this.contexts.set(tabId, contexts)
    this.providerRevisions.set(tabId, revisions)
    this.bumpRevision(tabId)
    return true
  }

  private clearValue(tabId: number, contextId: ModuleContextId) {
    const contexts = this.contexts.get(tabId)
    if (!contexts || !Object.hasOwn(contexts, contextId))
      return false
    delete contexts[contextId]
    delete this.providerRevisions.get(tabId)?.[contextId]
    this.bumpRevision(tabId)
    return true
  }

  private bumpRevision(tabId: number) {
    this.tabRevisions.set(tabId, (this.tabRevisions.get(tabId) || 0) + 1)
  }
}

export function createDefaultContextBroker() {
  return new ContextBroker([githubRepositoryProvider])
}
