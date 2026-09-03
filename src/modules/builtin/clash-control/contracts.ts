import type { InstalledModuleRecord } from '../../types'

export const CLASH_CONTROL_MODULE_ID = 'dev.oneweb.clash-control' as const
export const CLASH_CONTROL_ENTRY_ID = 'clash-control' as const
export const CLASH_CONTROL_CAPABILITY = 'clash.status.read' as const
export const CLASH_CONTROL_REQUEST_TIMEOUT_MS = 5_000 as const
export const CLASH_CONTROL_RESPONSE_LIMIT_BYTES = 64 * 1024
export const CLASH_CONTROL_PREPARATION_TTL_MS = 120_000
export const CLASH_CONTROL_READ_ENDPOINTS = ['/version', '/configs', '/proxies'] as const
export const CLASH_CONTROL_SNAPSHOT_VERSION = 1 as const
export const CLASH_PROXY_SWITCH_PLAN_VERSION = 1 as const
export const CLASH_PROXY_SWITCH_PLAN_TTL_MS = 60_000 as const

export type ClashControlReadEndpoint = typeof CLASH_CONTROL_READ_ENDPOINTS[number]

export type ClashConnectionPhase =
  | 'disconnected'
  | 'preparing'
  | 'connecting'
  | 'connected'
  | 'error'

export type ClashControlErrorCode =
  | 'module-unavailable'
  | 'module-disabled'
  | 'invalid-controller-url'
  | 'controller-not-loopback'
  | 'connection-active'
  | 'invalid-preparation'
  | 'permission-missing'
  | 'permission-check-failed'
  | 'connection-required'
  | 'network-failure'
  | 'authentication-failed'
  | 'protocol-incompatible'
  | 'response-too-large'
  | 'response-malformed'
  | 'operation-active'
  | 'switch-snapshot-required'
  | 'switch-target-invalid'
  | 'switch-no-change'
  | 'switch-plan-not-found'
  | 'switch-plan-expired'
  | 'switch-plan-stale'
  | 'switch-outcome-unknown'
  | 'lifecycle-cancelled'
  | 'capability-sync-failed'
  | 'permission-remove-failed'
  | 'profile-read-failed'
  | 'profile-write-failed'

export interface NormalizedClashController {
  controllerOrigin: string
  originPattern: string
}

export interface ClashControllerProfile {
  version: 1
  controllerOrigin: string
}

export interface ClashConnectionPreparation extends NormalizedClashController {
  token: string
  generation: number
  expiresAt: string
}

export interface ClashConnectionStatus {
  controllerOrigin: string
  implementation: string
  version: string
  mode: string
  connectedAt: string
}

export interface ClashConnectionDiagnostic {
  code: ClashControlErrorCode
  occurredAt: string
}

export interface ClashProxyNodeStatus {
  name: string
  type: string
  alive: boolean | null
}

export interface ClashProxyGroupSnapshot {
  name: string
  type: string
  selectedNode: string
  nodes: ClashProxyNodeStatus[]
}

export interface ClashReadOnlySnapshot {
  version: typeof CLASH_CONTROL_SNAPSHOT_VERSION
  controllerOrigin: string
  generation: number
  refreshedAt: string
  implementation: string
  controllerVersion: string
  mode: string
  proxyGroups: ClashProxyGroupSnapshot[]
}

export type ClashReadState =
  | { status: 'empty', snapshot: null, diagnostic: ClashConnectionDiagnostic | null }
  | { status: 'ready', snapshot: ClashReadOnlySnapshot, diagnostic: null }
  | { status: 'stale', snapshot: ClashReadOnlySnapshot, diagnostic: ClashConnectionDiagnostic }

export type ClashConnectionSnapshot =
  | { phase: 'disconnected', generation: number, profile: ClashControllerProfile | null }
  | {
    phase: 'preparing'
    generation: number
    profile: ClashControllerProfile
    preparationExpiresAt: string
  }
  | { phase: 'connecting', generation: number, profile: ClashControllerProfile }
  | {
    phase: 'connected'
    generation: number
    profile: ClashControllerProfile
    status: ClashConnectionStatus
  }
  | {
    phase: 'error'
    generation: number
    profile: ClashControllerProfile | null
    diagnostic: ClashConnectionDiagnostic
  }

export type ClashPrepareResult =
  | { ok: true, preparation: ClashConnectionPreparation }
  | { ok: false, reason: ClashControlErrorCode }

export type ClashConnectResult =
  | { ok: true, status: ClashConnectionStatus, record: InstalledModuleRecord }
  | { ok: false, reason: ClashControlErrorCode }

export type ClashDisconnectResult =
  | { ok: true, changed: boolean, releasedOrigin: boolean, record: InstalledModuleRecord }
  | { ok: false, reason: ClashControlErrorCode }

export type ClashRefreshResult =
  | { ok: true, snapshot: ClashReadOnlySnapshot }
  | { ok: false, reason: ClashControlErrorCode }

export interface ClashProxySwitchPlan {
  version: typeof CLASH_PROXY_SWITCH_PLAN_VERSION
  token: string
  controllerOrigin: string
  generation: number
  snapshotVersion: typeof CLASH_CONTROL_SNAPSHOT_VERSION
  snapshotRefreshedAt: string
  groupName: string
  groupType: string
  originalNode: string
  targetNode: string
  createdAt: string
  expiresAt: string
}

export type ClashPrepareProxySwitchResult =
  | { ok: true, plan: ClashProxySwitchPlan }
  | { ok: false, reason: ClashControlErrorCode }

export type ClashConfirmProxySwitchResult =
  | {
    ok: true
    groupName: string
    previousNode: string
    selectedNode: string
  }
  | { ok: false, reason: ClashControlErrorCode }
