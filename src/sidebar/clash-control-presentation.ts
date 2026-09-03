import type {
  ClashProxyNodeStatus,
  ClashProxySwitchPlan,
  ClashReadOnlySnapshot,
} from '~/modules/builtin/clash-control'

export interface ClashProxyGroupChoice {
  groupName: string
  groupType: string
  selectedNode: string
  targets: ClashProxyNodeStatus[]
}

export interface ClashProxySwitchReviewPresentation {
  state: 'ready' | 'expired' | 'stale'
  canConfirm: boolean
  controllerOrigin: string
  groupName: string
  groupType: string
  originalNode: string
  targetNode: string
  expiresAt: string
  message: string
}

export function presentClashProxyGroupChoices(
  snapshot: ClashReadOnlySnapshot,
): ClashProxyGroupChoice[] {
  return snapshot.proxyGroups.map(group => ({
    groupName: group.name,
    groupType: group.type,
    selectedNode: group.selectedNode,
    targets: group.nodes
      .filter(node => node.name !== group.selectedNode)
      .map(node => structuredClone(node)),
  }))
}

export function presentClashProxySwitchReview(
  snapshot: ClashReadOnlySnapshot | null,
  plan: ClashProxySwitchPlan,
  now: string,
): ClashProxySwitchReviewPresentation {
  const base = {
    controllerOrigin: plan.controllerOrigin,
    groupName: plan.groupName,
    groupType: plan.groupType,
    originalNode: plan.originalNode,
    targetNode: plan.targetNode,
    expiresAt: plan.expiresAt,
  }
  const currentTime = Date.parse(now)
  const expiresAt = Date.parse(plan.expiresAt)
  const group = snapshot?.proxyGroups.find(candidate => candidate.name === plan.groupName)
  const stale = !snapshot
    || snapshot.controllerOrigin !== plan.controllerOrigin
    || snapshot.generation !== plan.generation
    || snapshot.version !== plan.snapshotVersion
    || snapshot.refreshedAt !== plan.snapshotRefreshedAt
    || group?.type !== plan.groupType
    || group.selectedNode !== plan.originalNode
    || !group.nodes.some(node => node.name === plan.targetNode)
    || !Number.isFinite(currentTime)
    || !Number.isFinite(expiresAt)
  if (stale) {
    return {
      ...base,
      state: 'stale',
      canConfirm: false,
      message: '快照或节点选择已经变化，请手动刷新后重新审查。',
    }
  }
  if (currentTime >= expiresAt) {
    return {
      ...base,
      state: 'expired',
      canConfirm: false,
      message: '审查计划已过期，请重新选择节点并审查。',
    }
  }
  return {
    ...base,
    state: 'ready',
    canConfirm: true,
    message: `仅在 ${plan.expiresAt} 前有效；确认后仍会重新读取并核对代理组。`,
  }
}
