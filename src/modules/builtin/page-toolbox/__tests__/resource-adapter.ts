import type {
  PageToolOwnedResourceKind,
  PageToolResourceAdapter,
  PageToolResourceEntry,
} from '../resource-ledger'

interface PureResourceState {
  failCleanup: boolean
  owner: string | null
  present: boolean
  value: string | null
}

type OwnedEntry = Extract<PageToolResourceEntry<string, string | null>, { kind: PageToolOwnedResourceKind }>

export class PurePageToolResourceTestAdapter implements PageToolResourceAdapter<string, string | null> {
  readonly cleanupEvents: string[] = []
  readonly ownershipChecks: string[] = []
  readonly resources = new Map<string, PureResourceState>()

  seed(
    handle: string,
    state: Partial<PureResourceState> = {},
  ) {
    this.resources.set(handle, {
      failCleanup: false,
      owner: null,
      present: true,
      value: null,
      ...state,
    })
  }

  isOwned(entry: OwnedEntry): boolean {
    this.ownershipChecks.push(entry.id)
    return this.resources.get(entry.handle)?.owner === entry.ownershipToken
  }

  release(entry: Exclude<PageToolResourceEntry<string, string | null>, { kind: 'dom-prior-value' }>) {
    this.cleanupEvents.push(`release:${entry.id}`)
    const state = this.resources.get(entry.handle)
    if (state?.failCleanup)
      throw new Error('fixture cleanup failure')
    this.resources.delete(entry.handle)
  }

  restore(entry: Extract<PageToolResourceEntry<string, string | null>, { kind: 'dom-prior-value' }>) {
    this.cleanupEvents.push(`restore:${entry.id}`)
    const state = this.resources.get(entry.handle)
    if (state?.failCleanup)
      throw new Error('fixture cleanup failure')
    this.resources.set(entry.handle, {
      failCleanup: false,
      owner: null,
      present: entry.prior.present,
      value: entry.prior.value,
    })
  }
}
