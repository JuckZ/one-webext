import type {
  ClashControlErrorCode,
  ClashProxyGroupSnapshot,
  ClashProxySwitchPlan,
  ClashReadOnlySnapshot,
} from './contracts'
import {
  CLASH_CONTROL_SNAPSHOT_VERSION,
  CLASH_PROXY_SWITCH_PLAN_TTL_MS,
  CLASH_PROXY_SWITCH_PLAN_VERSION,
} from './contracts'

const MAX_SWITCH_TEXT_LENGTH = 256

export interface ClashProxySwitchPlanRecord extends ClashProxySwitchPlan {
  snapshotBinding: string
}

export interface ClashProxySwitchWrite {
  path: string
  body: { name: string }
}

function validText(value: unknown) {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_SWITCH_TEXT_LENGTH
}

function validToken(value: unknown) {
  return typeof value === 'string' && value.length > 0 && value.length <= 128
}

export function createClashSnapshotBinding(snapshot: ClashReadOnlySnapshot) {
  return JSON.stringify(snapshot)
}

export function createClashProxySwitchPlan(
  snapshot: ClashReadOnlySnapshot,
  groupNameValue: unknown,
  targetNodeValue: unknown,
  token: string,
  createdAt: string,
  ttlMs = CLASH_PROXY_SWITCH_PLAN_TTL_MS,
): { ok: true, plan: ClashProxySwitchPlanRecord } | { ok: false, reason: ClashControlErrorCode } {
  const created = Date.parse(createdAt)
  if (!validText(groupNameValue)
    || !validText(targetNodeValue)
    || !validToken(token)
    || !Number.isFinite(created)
    || !Number.isSafeInteger(ttlMs)
    || ttlMs <= 0) {
    return { ok: false, reason: 'switch-target-invalid' }
  }
  const group = snapshot.proxyGroups.find(candidate => candidate.name === groupNameValue)
  const target = group?.nodes.find(candidate => candidate.name === targetNodeValue)
  if (!group || !target)
    return { ok: false, reason: 'switch-target-invalid' }
  if (group.selectedNode === target.name)
    return { ok: false, reason: 'switch-no-change' }

  return {
    ok: true,
    plan: {
      version: CLASH_PROXY_SWITCH_PLAN_VERSION,
      token,
      controllerOrigin: snapshot.controllerOrigin,
      generation: snapshot.generation,
      snapshotVersion: snapshot.version,
      snapshotRefreshedAt: snapshot.refreshedAt,
      snapshotBinding: createClashSnapshotBinding(snapshot),
      groupName: group.name,
      groupType: group.type,
      originalNode: group.selectedNode,
      targetNode: target.name,
      createdAt: new Date(created).toISOString(),
      expiresAt: new Date(created + ttlMs).toISOString(),
    },
  }
}

export function toPublicClashProxySwitchPlan(plan: ClashProxySwitchPlanRecord): ClashProxySwitchPlan {
  const { snapshotBinding: _snapshotBinding, ...publicPlan } = plan
  return structuredClone(publicPlan)
}

export function validateClashProxySwitchPlan(
  plan: ClashProxySwitchPlanRecord,
  snapshot: ClashReadOnlySnapshot,
  token: unknown,
  now: string,
): { ok: true } | { ok: false, reason: ClashControlErrorCode } {
  if (!validToken(token) || token !== plan.token)
    return { ok: false, reason: 'switch-plan-not-found' }
  const currentTime = Date.parse(now)
  const expiresAt = Date.parse(plan.expiresAt)
  if (!Number.isFinite(currentTime) || !Number.isFinite(expiresAt) || currentTime >= expiresAt)
    return { ok: false, reason: 'switch-plan-expired' }
  if (snapshot.version !== CLASH_CONTROL_SNAPSHOT_VERSION
    || plan.snapshotVersion !== snapshot.version
    || plan.controllerOrigin !== snapshot.controllerOrigin
    || plan.generation !== snapshot.generation
    || plan.snapshotRefreshedAt !== snapshot.refreshedAt
    || plan.snapshotBinding !== createClashSnapshotBinding(snapshot)) {
    return { ok: false, reason: 'switch-plan-stale' }
  }
  return compareClashProxySwitchPreflight(plan, snapshot.proxyGroups)
}

export function compareClashProxySwitchPreflight(
  plan: Pick<ClashProxySwitchPlan, 'groupName' | 'originalNode' | 'targetNode'>,
  proxyGroups: ClashProxyGroupSnapshot[],
): { ok: true } | { ok: false, reason: 'switch-plan-stale' } {
  const group = proxyGroups.find(candidate => candidate.name === plan.groupName)
  if (!group
    || group.selectedNode !== plan.originalNode
    || !group.nodes.some(candidate => candidate.name === plan.targetNode)) {
    return { ok: false, reason: 'switch-plan-stale' }
  }
  return { ok: true }
}

export function createClashProxySwitchWrite(
  plan: Pick<ClashProxySwitchPlan, 'groupName' | 'targetNode'>,
): ClashProxySwitchWrite {
  return {
    path: `/proxies/${encodeURIComponent(plan.groupName)}`,
    body: { name: plan.targetNode },
  }
}

export function isClashProxySwitchPlan(value: unknown): value is ClashProxySwitchPlan {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return false
  const plan = value as Record<string, unknown>
  const keys = Object.keys(plan)
  const allowedKeys = [
    'version',
    'token',
    'controllerOrigin',
    'generation',
    'snapshotVersion',
    'snapshotRefreshedAt',
    'groupName',
    'groupType',
    'originalNode',
    'targetNode',
    'createdAt',
    'expiresAt',
  ]
  return keys.length === allowedKeys.length
    && keys.every(key => allowedKeys.includes(key))
    && plan.version === CLASH_PROXY_SWITCH_PLAN_VERSION
    && validToken(plan.token)
    && typeof plan.controllerOrigin === 'string'
    && Number.isSafeInteger(plan.generation)
    && plan.snapshotVersion === CLASH_CONTROL_SNAPSHOT_VERSION
    && typeof plan.snapshotRefreshedAt === 'string'
    && validText(plan.groupName)
    && validText(plan.groupType)
    && validText(plan.originalNode)
    && validText(plan.targetNode)
    && typeof plan.createdAt === 'string'
    && typeof plan.expiresAt === 'string'
}
