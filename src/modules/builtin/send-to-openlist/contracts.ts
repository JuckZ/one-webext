export const SEND_TO_OPENLIST_MODULE_ID = 'dev.oneweb.send-to-openlist' as const
export const SEND_TO_OPENLIST_ENTRY_ID = 'send-to-openlist' as const
export const SEND_TO_OPENLIST_CAPABILITY = 'resources.openlist.submit' as const
export const SEND_TO_OPENLIST_CONTRACT_VERSION = 1 as const
export const SEND_TO_OPENLIST_PREPARATION_TTL_MS = 2 * 60 * 1000
export const SEND_TO_OPENLIST_REQUEST_TIMEOUT_MS = 8 * 1000
export const SEND_TO_OPENLIST_MAX_TOKEN_BYTES = 4 * 1024

export const SEND_TO_OPENLIST_MAX_PROFILES = 8 as const
export const SEND_TO_OPENLIST_MAX_PROFILE_ID_LENGTH = 64 as const
export const SEND_TO_OPENLIST_MAX_PROFILE_LABEL_BYTES = 128 as const
export const SEND_TO_OPENLIST_MAX_ORIGIN_BYTES = 2048 as const

export const SEND_TO_OPENLIST_MAX_URL_BYTES = 8 * 1024
export const SEND_TO_OPENLIST_MAX_TITLE_BYTES = 512
export const SEND_TO_OPENLIST_MAX_CANDIDATE_BYTES = 12 * 1024
export const SEND_TO_OPENLIST_MAX_DISCOVERY_CANDIDATES = 200 as const
export const SEND_TO_OPENLIST_MAX_DISCOVERY_BYTES = 512 * 1024
export const SEND_TO_OPENLIST_MAX_SUBMISSION_CANDIDATES = 50 as const
export const SEND_TO_OPENLIST_MAX_SUBMISSION_BYTES = 256 * 1024
export const SEND_TO_OPENLIST_MAX_IN_FLIGHT = 2 as const

export const SEND_TO_OPENLIST_MAX_REQUEST_ID_LENGTH = 128 as const
export const SEND_TO_OPENLIST_MAX_DESTINATION_PATH_BYTES = 2 * 1024
export const SEND_TO_OPENLIST_MAX_TOOL_NAME_BYTES = 256
export const SEND_TO_OPENLIST_MAX_TASK_ID_BYTES = 512
export const SEND_TO_OPENLIST_MAX_UPSTREAM_MESSAGE_BYTES = 512
export const SEND_TO_OPENLIST_MAX_TOOL_ITEMS = 128 as const
export const SEND_TO_OPENLIST_MAX_TASK_ITEMS = 1024 as const
export const SEND_TO_OPENLIST_MAX_RESPONSE_BYTES = 512 * 1024
export const SEND_TO_OPENLIST_CANCEL_REVIEW_TTL_MS = 2 * 60 * 1000
export const SEND_TO_OPENLIST_CANCEL_TOKEN_MIN_LENGTH = 32 as const

export const SEND_TO_OPENLIST_PROFILE_SCHEMA_VERSION = 1 as const
export const SEND_TO_OPENLIST_PROFILE_COLLECTION_SCHEMA_VERSION = 1 as const
export const SEND_TO_OPENLIST_CANDIDATE_SCHEMA_VERSION = 1 as const
export const SEND_TO_OPENLIST_COMMAND_SCHEMA_VERSION = 1 as const
export const SEND_TO_OPENLIST_RESULT_SCHEMA_VERSION = 1 as const

export const SEND_TO_OPENLIST_CANDIDATE_KINDS = ['http', 'https', 'magnet', 'ed2k'] as const
export const SEND_TO_OPENLIST_CANDIDATE_SOURCES = [
  'manual',
  'context-link',
  'context-media',
  'current-page',
  'page-scan',
] as const

export type SendToOpenListCandidateKind = typeof SEND_TO_OPENLIST_CANDIDATE_KINDS[number]
export type SendToOpenListCandidateSource = typeof SEND_TO_OPENLIST_CANDIDATE_SOURCES[number]

export interface SendToOpenListProfileV1 {
  readonly schemaVersion: typeof SEND_TO_OPENLIST_PROFILE_SCHEMA_VERSION
  readonly id: string
  readonly label: string
  readonly controllerOrigin: string
}

export interface SendToOpenListProfileCollectionV1 {
  readonly schemaVersion: typeof SEND_TO_OPENLIST_PROFILE_COLLECTION_SCHEMA_VERSION
  readonly activeProfileId: string | null
  readonly profiles: readonly SendToOpenListProfileV1[]
}

export type SendToOpenListProfileTransport =
  | 'encrypted'
  | 'loopback-cleartext'
  | 'cleartext-token-risk'

export interface ResourceCandidateV1 {
  readonly schemaVersion: typeof SEND_TO_OPENLIST_CANDIDATE_SCHEMA_VERSION
  readonly id: string
  readonly url: string
  readonly kind: SendToOpenListCandidateKind
  readonly source: SendToOpenListCandidateSource
  readonly title?: string
}

export interface SendToOpenListDiscoverySnapshotV1 {
  readonly schemaVersion: 1
  readonly generation: number
  readonly updatedAt: string | null
  readonly candidates: readonly ResourceCandidateV1[]
  readonly rejectedCount: number
}

export type ResourceCandidateSsrRisk =
  | 'server-policy-required'
  | 'local-hostname'
  | 'single-label-hostname'
  | 'special-use-hostname'
  | 'ipv4-unspecified'
  | 'ipv4-loopback'
  | 'ipv4-private'
  | 'ipv4-shared'
  | 'ipv4-link-local'
  | 'ipv4-reserved'
  | 'ipv6-unspecified'
  | 'ipv6-loopback'
  | 'ipv6-private'
  | 'ipv6-link-local'
  | 'ipv6-multicast'
  | 'ipv6-reserved'

export interface ResourceCandidateSsrClassification {
  readonly decision: 'allow-with-server-policy' | 'block-local-use'
  readonly risk: ResourceCandidateSsrRisk
  readonly canonicalHostname: string | null
}

export interface SendToOpenListAuthorityV1 {
  readonly moduleId: typeof SEND_TO_OPENLIST_MODULE_ID
  readonly profileId: string
  readonly controllerOrigin: string
  readonly generation: number
}

export interface SendToOpenListConnectionPreparationV1 {
  readonly token: string
  readonly profile: SendToOpenListProfileV1
  readonly originPattern: string
  readonly generation: number
  readonly expiresAt: string
}

export type SendToOpenListConnectionSnapshotV1 =
  | {
    readonly phase: 'disconnected'
    readonly generation: number
    readonly profile: SendToOpenListProfileV1 | null
    readonly hasStoredToken: boolean
  }
  | {
    readonly phase: 'preparing'
    readonly generation: number
    readonly profile: SendToOpenListProfileV1
    readonly hasStoredToken: boolean
    readonly preparationExpiresAt: string
  }
  | {
    readonly phase: 'connected'
    readonly generation: number
    readonly profile: SendToOpenListProfileV1
    readonly hasStoredToken: true
    readonly connectedAt: string
  }
  | {
    readonly phase: 'error'
    readonly generation: number
    readonly profile: SendToOpenListProfileV1 | null
    readonly hasStoredToken: boolean
    readonly errorCode: SendToOpenListStableErrorCode
    readonly occurredAt: string
  }

export type SendToOpenListOperation =
  | 'verify-profile'
  | 'discover-tools'
  | 'add-resource'
  | 'list-undone-tasks'
  | 'list-done-tasks'
  | 'cancel-task'

interface SendToOpenListCommandBaseV1 {
  readonly schemaVersion: typeof SEND_TO_OPENLIST_COMMAND_SCHEMA_VERSION
  readonly requestId: string
  readonly authority: SendToOpenListAuthorityV1
  readonly operation: SendToOpenListOperation
}

export interface SendToOpenListVerifyCommandV1 extends SendToOpenListCommandBaseV1 {
  readonly operation: 'verify-profile'
}

export interface SendToOpenListDiscoverToolsCommandV1 extends SendToOpenListCommandBaseV1 {
  readonly operation: 'discover-tools'
  readonly destinationPath: string
}

export interface SendToOpenListAddResourceCommandV1 extends SendToOpenListCommandBaseV1 {
  readonly operation: 'add-resource'
  readonly candidate: ResourceCandidateV1
  readonly destinationPath: string
  readonly tool: string
}

export interface SendToOpenListListTasksCommandV1 extends SendToOpenListCommandBaseV1 {
  readonly operation: 'list-undone-tasks' | 'list-done-tasks'
}

export interface SendToOpenListCancelTaskCommandV1 extends SendToOpenListCommandBaseV1 {
  readonly operation: 'cancel-task'
  readonly taskId: string
  readonly reviewToken: string
}

export interface SendToOpenListCancelReviewPlanV1 {
  readonly schemaVersion: 1
  readonly token: string
  readonly authority: SendToOpenListAuthorityV1
  readonly snapshotId: string
  readonly taskId: string
  readonly createdAt: string
  readonly expiresAt: string
}

export interface SendToOpenListCancelReviewStateV1 {
  readonly status: 'active' | 'consumed' | 'invalidated'
  readonly plan: SendToOpenListCancelReviewPlanV1
}

export type SendToOpenListCommandV1 =
  | SendToOpenListVerifyCommandV1
  | SendToOpenListDiscoverToolsCommandV1
  | SendToOpenListAddResourceCommandV1
  | SendToOpenListListTasksCommandV1
  | SendToOpenListCancelTaskCommandV1

export const SEND_TO_OPENLIST_STABLE_ERROR_CODES = [
  'module-unavailable',
  'module-disabled',
  'invalid-profile',
  'invalid-candidate',
  'local-use-blocked',
  'quota-exceeded',
  'permission-missing',
  'token-missing',
  'authentication-failed',
  'http-error',
  'upstream-rejected',
  'network-failed',
  'outcome-unknown',
  'protocol-incompatible',
  'response-too-large',
  'operation-not-allowed',
  'stale-generation',
  'request-conflict',
  'cancelled',
  'lifecycle-invalidated',
  'permission-check-failed',
  'permission-remove-failed',
  'capability-sync-failed',
  'profile-read-failed',
  'profile-write-failed',
  'active-tab-unavailable',
  'page-scan-failed',
  'discovery-empty',
] as const

export type SendToOpenListStableErrorCode = typeof SEND_TO_OPENLIST_STABLE_ERROR_CODES[number]

export type SendToOpenListAddOutcome =
  | { readonly status: 'accepted', readonly taskId: string | null }
  | { readonly status: 'failed', readonly code: Exclude<SendToOpenListStableErrorCode, 'outcome-unknown'> }
  | { readonly status: 'outcome-unknown', readonly code: 'outcome-unknown' }

export interface SendToOpenListTaskSummaryV1 {
  readonly id: string
  readonly name: string
  readonly state: number
  readonly status: string
  readonly progress: number
  readonly totalBytes: number
  readonly error: string
}

export interface SendToOpenListTaskSnapshotV1 {
  readonly schemaVersion: 1
  readonly authority: SendToOpenListAuthorityV1
  readonly snapshotId: string
  readonly list: 'undone' | 'done'
  readonly refreshedAt: string
  readonly tasks: readonly SendToOpenListTaskSummaryV1[]
}

interface SendToOpenListResultBaseV1 {
  readonly schemaVersion: typeof SEND_TO_OPENLIST_RESULT_SCHEMA_VERSION
  readonly requestId: string
  readonly authority: SendToOpenListAuthorityV1
  readonly operation: SendToOpenListOperation
}

export interface SendToOpenListVerifiedResultV1 extends SendToOpenListResultBaseV1 {
  readonly status: 'ok'
  readonly operation: 'verify-profile'
  readonly data: { readonly authenticated: true }
}

export interface SendToOpenListToolsResultV1 extends SendToOpenListResultBaseV1 {
  readonly status: 'ok'
  readonly operation: 'discover-tools'
  readonly data: { readonly tools: readonly string[] }
}

export interface SendToOpenListAddResultV1 extends SendToOpenListResultBaseV1 {
  readonly status: 'ok'
  readonly operation: 'add-resource'
  readonly data: { readonly candidateId: string, readonly taskId: string | null }
}

export interface SendToOpenListTasksResultV1 extends SendToOpenListResultBaseV1 {
  readonly status: 'ok'
  readonly operation: 'list-undone-tasks' | 'list-done-tasks'
  readonly data: { readonly tasks: readonly SendToOpenListTaskSummaryV1[] }
}

export interface SendToOpenListCancelledTaskResultV1 extends SendToOpenListResultBaseV1 {
  readonly status: 'ok'
  readonly operation: 'cancel-task'
  readonly data: { readonly taskId: string }
}

export interface SendToOpenListErrorResultV1 extends SendToOpenListResultBaseV1 {
  readonly status: 'error'
  readonly code: SendToOpenListStableErrorCode
}

export type SendToOpenListSuccessResultV1 =
  | SendToOpenListVerifiedResultV1
  | SendToOpenListToolsResultV1
  | SendToOpenListAddResultV1
  | SendToOpenListTasksResultV1
  | SendToOpenListCancelledTaskResultV1

export type SendToOpenListResultV1 = SendToOpenListSuccessResultV1 | SendToOpenListErrorResultV1

export type SendToOpenListValidationErrorCode =
  | 'invalid-profile'
  | 'profile-limit'
  | 'duplicate-profile'
  | 'invalid-candidate'
  | 'unsupported-scheme'
  | 'credentials-forbidden'
  | 'control-character'
  | 'url-limit'
  | 'title-limit'
  | 'candidate-limit'
  | 'candidate-bytes-limit'
  | 'submission-limit'
  | 'submission-bytes-limit'
  | 'local-use-blocked'
  | 'invalid-authority'
  | 'invalid-command'
  | 'unreviewed-tool'
  | 'unreviewed-task'
  | 'response-too-large'
  | 'protocol-incompatible'

export type SendToOpenListValidationResult<Value> =
  | { readonly ok: true, readonly value: Value }
  | { readonly ok: false, readonly code: SendToOpenListValidationErrorCode, readonly path: string }

export type SendToOpenListSubmissionEntryStatus =
  | 'queued'
  | 'in-flight'
  | 'accepted'
  | 'failed'
  | 'outcome-unknown'
  | 'cancelled'

export interface SendToOpenListSubmissionEntryV1 {
  readonly candidate: ResourceCandidateV1
  readonly status: SendToOpenListSubmissionEntryStatus
  readonly taskId?: string | null
  readonly errorCode?: SendToOpenListStableErrorCode
}

export interface SendToOpenListSubmissionStateV1 {
  readonly schemaVersion: 1
  readonly authority: SendToOpenListAuthorityV1
  readonly status: 'ready' | 'running' | 'completed' | 'cancelled' | 'invalidated'
  readonly entries: readonly SendToOpenListSubmissionEntryV1[]
  readonly inFlight: number
}

export type SendToOpenListLifecycleInvalidationReason =
  | 'disabled'
  | 'profile-removed'
  | 'grant-revoked'
  | 'reinstalled'
  | 'worker-restart'

export type SendToOpenListSubmissionAction =
  | { readonly type: 'start', readonly authority: SendToOpenListAuthorityV1 }
  | { readonly type: 'dispatch', readonly authority: SendToOpenListAuthorityV1, readonly candidateId: string }
  | {
    readonly type: 'resolve'
    readonly authority: SendToOpenListAuthorityV1
    readonly candidateId: string
    readonly outcome: SendToOpenListAddOutcome
  }
  | { readonly type: 'stop', readonly authority: SendToOpenListAuthorityV1 }
  | {
    readonly type: 'invalidate'
    readonly authority: SendToOpenListAuthorityV1
    readonly reason: SendToOpenListLifecycleInvalidationReason
  }
