import { contextKey, normalizeRepoContext, type RepoContext } from './protocol'

export class RepoContextRegistry {
  private contexts = new Map<number, RepoContext>()

  update(tabId: number, value: unknown): RepoContext | null {
    const context = normalizeRepoContext(value)
    if (!Number.isInteger(tabId) || tabId < 0 || !context)
      return null
    const previous = this.contexts.get(tabId)
    if (previous && contextKey(previous) === contextKey(context))
      return null
    this.contexts.set(tabId, context)
    return context
  }

  get(tabId: number): RepoContext | null {
    return this.contexts.get(tabId) || null
  }

  remove(tabId: number) {
    this.contexts.delete(tabId)
  }
}
