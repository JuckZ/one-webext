import type {
  InstalledModuleRecord,
  ModuleUpdateApprovalStatus,
  ModuleUpdateCandidate,
  OneWebModuleManifest,
} from './types'
import { diffModulePermissions, type ModulePermissionDiff } from './permission-diff'

export type ModuleUpdateOutcome = 'safe' | 'approval-required' | 'rejected'

export type ModuleUpdateApprovalReason =
  | 'match-pattern'
  | 'context'
  | 'context-field'
  | 'capability'
  | 'activation'

export type ModuleUpdateRejectionReason =
  | 'manifest-version'
  | 'module-id'
  | 'runtime'
  | 'source-origin'
  | 'entry-origin'
  | 'bridge-protocol'

export interface ModuleUpdateClassification {
  outcome: ModuleUpdateOutcome
  permissionDiff: ModulePermissionDiff
  approvalReasons: ModuleUpdateApprovalReason[]
  rejectionReasons: ModuleUpdateRejectionReason[]
}

type InstalledUpdateBoundary = Pick<InstalledModuleRecord, 'manifest' | 'sourceUrl'>

function addUnique<T>(values: T[], value: T) {
  if (!values.includes(value))
    values.push(value)
}

function urlOrigin(value: string | null | undefined) {
  if (value === null || value === undefined)
    return null
  try {
    return new URL(value).origin
  }
  catch {
    return 'invalid:'
  }
}

function entryOrigin(manifest: OneWebModuleManifest) {
  return manifest.runtime === 'remote-frame' ? urlOrigin(manifest.entry_url) : null
}

function bridgeProtocolChanged(previous: OneWebModuleManifest, candidate: OneWebModuleManifest) {
  if (previous.runtime !== 'remote-frame' || candidate.runtime !== 'remote-frame')
    return false
  return previous.bridge.protocol !== candidate.bridge.protocol
    || previous.bridge.version !== candidate.bridge.version
}

export function isNormalizedManifestDigest(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
}

export function expectedModuleUpdateApprovalStatus(
  classification: ModuleUpdateClassification,
  storedStatus: unknown,
  candidateDigest: unknown,
  approvedDigest: unknown,
): ModuleUpdateApprovalStatus {
  if (classification.outcome === 'safe')
    return 'not-required'
  if (classification.outcome === 'rejected')
    return 'rejected'
  return storedStatus === 'approved'
    && isNormalizedManifestDigest(candidateDigest)
    && approvedDigest === candidateDigest
    ? 'approved'
    : 'pending'
}

export function classifyModuleUpdate(
  installed: InstalledUpdateBoundary,
  candidate: ModuleUpdateCandidate,
): ModuleUpdateClassification {
  const previous = installed.manifest
  const next = candidate.candidateManifest
  const permissionDiff = diffModulePermissions(previous, next)
  const rejectionReasons: ModuleUpdateRejectionReason[] = []

  if (previous.manifest_version !== next.manifest_version)
    addUnique(rejectionReasons, 'manifest-version')
  if (previous.id !== next.id)
    addUnique(rejectionReasons, 'module-id')
  if (previous.runtime !== next.runtime)
    addUnique(rejectionReasons, 'runtime')
  if (urlOrigin(installed.sourceUrl) !== urlOrigin(candidate.candidateSourceUrl))
    addUnique(rejectionReasons, 'source-origin')
  if (entryOrigin(previous) !== entryOrigin(next))
    addUnique(rejectionReasons, 'entry-origin')
  if (bridgeProtocolChanged(previous, next))
    addUnique(rejectionReasons, 'bridge-protocol')

  const approvalReasons: ModuleUpdateApprovalReason[] = []
  if (permissionDiff.matches.added.length)
    addUnique(approvalReasons, 'match-pattern')
  if (permissionDiff.contexts.added.length)
    addUnique(approvalReasons, 'context')
  if (permissionDiff.contextFields.some(fields => fields.added.length))
    addUnique(approvalReasons, 'context-field')
  if (permissionDiff.capabilities.added.length)
    addUnique(approvalReasons, 'capability')
  if (previous.activation === 'manual' && next.activation === 'suggest')
    addUnique(approvalReasons, 'activation')

  return {
    outcome: rejectionReasons.length
      ? 'rejected'
      : approvalReasons.length ? 'approval-required' : 'safe',
    permissionDiff,
    approvalReasons,
    rejectionReasons,
  }
}
