import {
  classifyModuleUpdate,
  type ModuleUpdateOutcome,
  type ModuleUpdateRejectionReason,
} from '~/modules/module-update'
import type {
  InstalledModuleRecord,
  ModuleCapabilityId,
  ModuleContextId,
} from '~/modules/types'
import {
  presentModuleCapability,
  presentModuleContext,
} from './module-presentation'

export type ModuleUpdateViewState = 'safe' | 'pending' | 'approved' | 'rejected' | 'stale'

export interface ModuleUpdateCopyChange {
  field: 'name' | 'description'
  label: string
  previous: string
  next: string
}

export interface ModuleUpdateContextFieldChange {
  contextId: ModuleContextId
  contextLabel: string
  added: string[]
  removed: string[]
}

export interface ModuleUpdateContextFieldChoice {
  contextId: ModuleContextId
  contextLabel: string
  field: string
  selected: boolean
}

export interface ModuleUpdateCapabilityChoice {
  capabilityId: ModuleCapabilityId
  label: string
  selected: boolean
}

export interface ModuleUpdatePresentation {
  outcome: ModuleUpdateOutcome
  state: ModuleUpdateViewState
  statusLabel: string
  candidateDigest: string
  checkedAt: string
  currentVersion: string
  candidateVersion: string
  copyChanges: ModuleUpdateCopyChange[]
  addedMatches: string[]
  removedMatches: string[]
  addedContexts: string[]
  removedContexts: string[]
  contextFieldChanges: ModuleUpdateContextFieldChange[]
  addedCapabilities: string[]
  removedCapabilities: string[]
  activationChange: string | null
  rejectionReasons: string[]
  contextFieldChoices: ModuleUpdateContextFieldChoice[]
  capabilityChoices: ModuleUpdateCapabilityChoice[]
  canApprove: boolean
  canApply: boolean
  requiresFreshCheck: boolean
}

const rejectionLabels: Record<ModuleUpdateRejectionReason, string> = {
  'manifest-version': 'Manifest schema 版本发生变化',
  'module-id': '模块 ID 发生变化',
  'runtime': '运行时类型发生变化',
  'source-origin': 'Manifest 来源 origin 发生变化',
  'entry-origin': '模块入口 origin 发生变化',
  'bridge-protocol': '安全桥接协议发生变化',
}

const stateLabels: Record<ModuleUpdateViewState, string> = {
  safe: '安全更新',
  pending: '需要审批',
  approved: '已审批，等待应用',
  rejected: '已拒绝',
  stale: '候选已过期',
}

const activationLabels = {
  manual: '手动启用',
  suggest: '页面建议',
} as const

export function isRemotelyUpdateable(record: InstalledModuleRecord) {
  return record.source === 'user'
    && record.manifest.runtime === 'remote-frame'
    && Boolean(record.sourceUrl)
}

export function formatModuleUpdateCheckedAt(value: string) {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime()))
    return value
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

export function presentModuleUpdate(
  record: InstalledModuleRecord,
  staleCandidateDigest: string | null = null,
): ModuleUpdatePresentation | null {
  const update = record.update
  if (!update)
    return null

  const classification = classifyModuleUpdate(record, update)
  const isStale = staleCandidateDigest === update.normalizedManifestDigest
  const state: ModuleUpdateViewState = isStale
    ? 'stale'
    : classification.outcome === 'rejected'
      ? 'rejected'
      : classification.outcome === 'safe'
        ? 'safe'
        : update.approvalStatus === 'approved' ? 'approved' : 'pending'
  const selectedFields = update.approvalSnapshot?.approvedContextFields || {}
  const selectedCapabilities = update.approvalSnapshot?.approvedCapabilities || []
  const candidate = update.candidateManifest
  const copyChanges: ModuleUpdateCopyChange[] = []
  if (record.manifest.name !== candidate.name) {
    copyChanges.push({
      field: 'name',
      label: '名称',
      previous: record.manifest.name,
      next: candidate.name,
    })
  }
  if (record.manifest.description !== candidate.description) {
    copyChanges.push({
      field: 'description',
      label: '说明',
      previous: record.manifest.description,
      next: candidate.description,
    })
  }

  const contextFieldChanges = classification.permissionDiff.contextFields.map(change => ({
    contextId: change.contextId,
    contextLabel: presentModuleContext(change.contextId),
    added: [...change.added],
    removed: [...change.removed],
  }))
  const contextFieldChoices = contextFieldChanges.flatMap(change => change.added.map(field => ({
    contextId: change.contextId,
    contextLabel: change.contextLabel,
    field,
    selected: Boolean(selectedFields[change.contextId]?.includes(field)),
  })))
  const capabilityChoices = classification.permissionDiff.capabilities.added.map((capability) => {
    const capabilityId = capability as ModuleCapabilityId
    return {
      capabilityId,
      label: presentModuleCapability(capabilityId),
      selected: selectedCapabilities.includes(capabilityId),
    }
  })

  return {
    outcome: classification.outcome,
    state,
    statusLabel: stateLabels[state],
    candidateDigest: update.normalizedManifestDigest,
    checkedAt: update.checkedAt,
    currentVersion: record.manifest.version,
    candidateVersion: candidate.version,
    copyChanges,
    addedMatches: [...classification.permissionDiff.matches.added],
    removedMatches: [...classification.permissionDiff.matches.removed],
    addedContexts: classification.permissionDiff.contexts.added.map(presentModuleContext),
    removedContexts: classification.permissionDiff.contexts.removed.map(presentModuleContext),
    contextFieldChanges,
    addedCapabilities: classification.permissionDiff.capabilities.added
      .map(capability => presentModuleCapability(capability as ModuleCapabilityId)),
    removedCapabilities: classification.permissionDiff.capabilities.removed
      .map(capability => presentModuleCapability(capability as ModuleCapabilityId)),
    activationChange: record.manifest.activation === candidate.activation
      ? null
      : `${activationLabels[record.manifest.activation]} → ${activationLabels[candidate.activation]}`,
    rejectionReasons: classification.rejectionReasons.map(reason => rejectionLabels[reason]),
    contextFieldChoices,
    capabilityChoices,
    canApprove: state === 'pending',
    canApply: state === 'safe' || state === 'approved',
    requiresFreshCheck: state === 'stale',
  }
}
