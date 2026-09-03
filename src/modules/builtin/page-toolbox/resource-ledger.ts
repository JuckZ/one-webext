import type { PageToolAuthorityV1, PageToolRuntimeBindingV1 } from './contracts'
import { createPageToolAuthority } from './validation'

export const PAGE_TOOL_RESOURCE_KINDS = [
  'listener',
  'timer',
  'observer',
  'abort',
  'owned-node',
  'owned-style',
  'dom-prior-value',
] as const

export type PageToolResourceKind = typeof PAGE_TOOL_RESOURCE_KINDS[number]
export type PageToolOwnedResourceKind = 'owned-node' | 'owned-style' | 'dom-prior-value'
export type PageToolRestorableValue = null | boolean | number | string

interface PageToolResourceBase<Handle> {
  readonly id: string
  readonly handle: Handle
}

export type PageToolResourceEntry<
  Handle = unknown,
  PriorValue extends PageToolRestorableValue = PageToolRestorableValue,
> =
  | (PageToolResourceBase<Handle> & {
    readonly kind: 'listener' | 'timer' | 'observer' | 'abort'
  })
  | (PageToolResourceBase<Handle> & {
    readonly kind: 'owned-node' | 'owned-style'
    readonly ownershipToken: string
  })
  | (PageToolResourceBase<Handle> & {
    readonly kind: 'dom-prior-value'
    readonly ownershipToken: string
    readonly property: string
    readonly prior: Readonly<{
      present: boolean
      value: PriorValue
    }>
  })

export interface PageToolResourceAdapter<
  Handle = unknown,
  PriorValue extends PageToolRestorableValue = PageToolRestorableValue,
> {
  isOwned: (
    _entry: Extract<PageToolResourceEntry<Handle, PriorValue>, { kind: PageToolOwnedResourceKind }>,
  ) => boolean
  release: (
    _entry: Exclude<PageToolResourceEntry<Handle, PriorValue>, { kind: 'dom-prior-value' }>,
  ) => void
  restore: (
    _entry: Extract<PageToolResourceEntry<Handle, PriorValue>, { kind: 'dom-prior-value' }>,
  ) => void
}

export type PageToolResourceRegistrationResult =
  | { readonly ok: true, readonly index: number }
  | { readonly ok: false, readonly reason: 'authority-mismatch' | 'disposed' | 'duplicate-id' | 'invalid-entry' }

export type PageToolResourceCleanupOutcome =
  | 'released'
  | 'restored'
  | 'skipped-unowned'
  | 'failed'

export interface PageToolResourceCleanupResult {
  readonly id: string
  readonly kind: PageToolResourceKind
  readonly outcome: PageToolResourceCleanupOutcome
}

export interface PageToolResourceCleanupReport {
  readonly authority: PageToolAuthorityV1
  readonly repeated: boolean
  readonly results: readonly PageToolResourceCleanupResult[]
}

export type PageToolResourceDisposalResult =
  | { readonly ok: true, readonly report: PageToolResourceCleanupReport }
  | { readonly ok: false, readonly reason: 'authority-mismatch' }

function isValidToken(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 160
}

function readDataProperty(record: Record<string, unknown>, key: string): unknown {
  return Object.getOwnPropertyDescriptor(record, key)?.value
}

function hasExactDataProperties(value: object, keys: ReadonlySet<string>): value is Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null)
    return false
  const ownKeys = Reflect.ownKeys(value)
  if (ownKeys.length !== keys.size
    || ownKeys.some(key => typeof key !== 'string' || !keys.has(key))) {
    return false
  }
  return ownKeys.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    return Boolean(descriptor && 'value' in descriptor && descriptor.enumerable)
  })
}

function isOwnedEntry<Handle, PriorValue extends PageToolRestorableValue>(
  entry: PageToolResourceEntry<Handle, PriorValue>,
): entry is Extract<PageToolResourceEntry<Handle, PriorValue>, { kind: PageToolOwnedResourceKind }> {
  return entry.kind === 'owned-node' || entry.kind === 'owned-style' || entry.kind === 'dom-prior-value'
}

function cloneEntry<Handle, PriorValue extends PageToolRestorableValue>(
  entry: PageToolResourceEntry<Handle, PriorValue>,
): PageToolResourceEntry<Handle, PriorValue> | null {
  if (!entry || typeof entry !== 'object')
    return null
  const kindDescriptor = Object.getOwnPropertyDescriptor(entry, 'kind')
  if (!kindDescriptor || !('value' in kindDescriptor) || typeof kindDescriptor.value !== 'string')
    return null
  const kind = kindDescriptor.value
  const record = entry as unknown as Record<string, unknown>
  if (kind === 'listener' || kind === 'timer' || kind === 'observer' || kind === 'abort') {
    if (!hasExactDataProperties(entry, new Set(['id', 'kind', 'handle'])))
      return null
    const id = readDataProperty(record, 'id')
    if (!isValidToken(id))
      return null
    return Object.freeze({ id, kind, handle: readDataProperty(record, 'handle') as Handle })
  }
  if (kind === 'owned-node' || kind === 'owned-style') {
    if (!hasExactDataProperties(entry, new Set(['id', 'kind', 'handle', 'ownershipToken'])))
      return null
    const id = readDataProperty(record, 'id')
    const ownershipToken = readDataProperty(record, 'ownershipToken')
    if (!isValidToken(id) || !isValidToken(ownershipToken))
      return null
    return Object.freeze({
      id,
      kind,
      handle: readDataProperty(record, 'handle') as Handle,
      ownershipToken,
    })
  }
  if (kind !== 'dom-prior-value'
    || !hasExactDataProperties(entry, new Set(['id', 'kind', 'handle', 'ownershipToken', 'property', 'prior']))) {
    return null
  }
  const id = readDataProperty(record, 'id')
  const ownershipToken = readDataProperty(record, 'ownershipToken')
  const property = readDataProperty(record, 'property')
  const prior = readDataProperty(record, 'prior')
  if (!isValidToken(id)
    || !isValidToken(ownershipToken)
    || !isValidToken(property)
    || !prior
    || typeof prior !== 'object'
    || !hasExactDataProperties(prior, new Set(['present', 'value']))) {
    return null
  }
  const priorRecord = prior as Record<string, unknown>
  const present = readDataProperty(priorRecord, 'present')
  if (typeof present !== 'boolean')
    return null
  return Object.freeze({
    id,
    kind,
    handle: readDataProperty(record, 'handle') as Handle,
    ownershipToken,
    property,
    prior: Object.freeze({ present, value: readDataProperty(priorRecord, 'value') as PriorValue }),
  })
}

export class PageToolResourceLedger<
  Handle = unknown,
  PriorValue extends PageToolRestorableValue = PageToolRestorableValue,
> {
  private readonly adapter: PageToolResourceAdapter<Handle, PriorValue>
  private readonly authority: PageToolAuthorityV1
  private cleanupReport: PageToolResourceCleanupReport | null = null
  private disposed = false
  private readonly entries: PageToolResourceEntry<Handle, PriorValue>[] = []
  private readonly resourceIds = new Set<string>()

  constructor(
    binding: PageToolRuntimeBindingV1,
    adapter: PageToolResourceAdapter<Handle, PriorValue>,
  ) {
    this.authority = createPageToolAuthority(binding)
    this.adapter = adapter
  }

  get size(): number {
    return this.entries.length
  }

  register(
    authority: PageToolAuthorityV1,
    entry: PageToolResourceEntry<Handle, PriorValue>,
  ): PageToolResourceRegistrationResult {
    if (!this.matches(authority))
      return { ok: false, reason: 'authority-mismatch' }
    if (this.disposed)
      return { ok: false, reason: 'disposed' }
    const cloned = cloneEntry(entry)
    if (!cloned)
      return { ok: false, reason: 'invalid-entry' }
    if (this.resourceIds.has(cloned.id))
      return { ok: false, reason: 'duplicate-id' }
    const index = this.entries.push(cloned) - 1
    this.resourceIds.add(cloned.id)
    return { ok: true, index }
  }

  dispose(authority: PageToolAuthorityV1): PageToolResourceDisposalResult {
    if (!this.matches(authority))
      return { ok: false, reason: 'authority-mismatch' }
    if (this.cleanupReport) {
      return {
        ok: true,
        report: Object.freeze({
          authority: this.cleanupReport.authority,
          repeated: true,
          results: this.cleanupReport.results,
        }),
      }
    }

    this.disposed = true
    const results: PageToolResourceCleanupResult[] = []
    for (let index = this.entries.length - 1; index >= 0; index -= 1) {
      const entry = this.entries[index]
      try {
        if (isOwnedEntry(entry) && !this.adapter.isOwned(entry)) {
          results.push(Object.freeze({ id: entry.id, kind: entry.kind, outcome: 'skipped-unowned' }))
          continue
        }
        if (entry.kind === 'dom-prior-value') {
          this.adapter.restore(entry)
          results.push(Object.freeze({ id: entry.id, kind: entry.kind, outcome: 'restored' }))
        }
        else {
          this.adapter.release(entry)
          results.push(Object.freeze({ id: entry.id, kind: entry.kind, outcome: 'released' }))
        }
      }
      catch {
        results.push(Object.freeze({ id: entry.id, kind: entry.kind, outcome: 'failed' }))
      }
    }
    this.entries.length = 0
    this.resourceIds.clear()
    this.cleanupReport = Object.freeze({
      authority: this.authority,
      repeated: false,
      results: Object.freeze(results),
    })
    return { ok: true, report: this.cleanupReport }
  }

  private matches(authority: PageToolAuthorityV1): boolean {
    return authority.bindingKey === this.authority.bindingKey
      && authority.generation === this.authority.generation
  }
}
