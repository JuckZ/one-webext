import { type ModuleContextId, moduleContextIds, type OneWebModuleManifest } from './types'

export interface AccessListDiff<T extends string> {
  added: T[]
  removed: T[]
}

export interface ContextFieldPermissionDiff extends AccessListDiff<string> {
  contextId: ModuleContextId
}

export type PermissionExpansionReason =
  | 'entry-origin'
  | 'match-pattern'
  | 'context'
  | 'context-field'
  | 'capability'

export interface ModulePermissionDiff {
  entryOrigin: {
    previous: string | null
    next: string | null
    changed: boolean
  }
  matches: AccessListDiff<string>
  contexts: AccessListDiff<ModuleContextId>
  contextFields: ContextFieldPermissionDiff[]
  capabilities: AccessListDiff<string>
  requiresReapproval: boolean
  expansionReasons: PermissionExpansionReason[]
}

function diffList<T extends string>(previous: readonly T[], next: readonly T[]): AccessListDiff<T> {
  return {
    added: next.filter(value => !previous.includes(value)),
    removed: previous.filter(value => !next.includes(value)),
  }
}

function getEntryOrigin(manifest: OneWebModuleManifest) {
  return manifest.runtime === 'remote-frame' ? new URL(manifest.entry_url).origin : null
}

function addReason(reasons: PermissionExpansionReason[], reason: PermissionExpansionReason) {
  if (!reasons.includes(reason))
    reasons.push(reason)
}

export function diffModulePermissions(
  previous: OneWebModuleManifest,
  next: OneWebModuleManifest,
): ModulePermissionDiff {
  const previousOrigin = getEntryOrigin(previous)
  const nextOrigin = getEntryOrigin(next)
  const entryOrigin = {
    previous: previousOrigin,
    next: nextOrigin,
    changed: previousOrigin !== nextOrigin,
  }
  const matches = diffList(previous.matches, next.matches)
  const contexts = diffList(previous.contexts, next.contexts)
  const capabilities = diffList(previous.capabilities, next.capabilities)
  const contextFields = moduleContextIds.flatMap((contextId) => {
    const fields = diffList(previous.context_fields[contextId] || [], next.context_fields[contextId] || [])
    return fields.added.length || fields.removed.length ? [{ contextId, ...fields }] : []
  })

  const expansionReasons: PermissionExpansionReason[] = []
  if (entryOrigin.changed)
    addReason(expansionReasons, 'entry-origin')
  if (matches.added.length)
    addReason(expansionReasons, 'match-pattern')
  if (contexts.added.length)
    addReason(expansionReasons, 'context')
  if (contextFields.some(fields => fields.added.length))
    addReason(expansionReasons, 'context-field')
  if (capabilities.added.length)
    addReason(expansionReasons, 'capability')

  return {
    entryOrigin,
    matches,
    contexts,
    contextFields,
    capabilities,
    requiresReapproval: expansionReasons.length > 0,
    expansionReasons,
  }
}
