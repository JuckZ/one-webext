import type { SetModuleCapabilityGrantResult } from '../../registry'
import type { InstalledModuleRecord, ModuleCapabilityId } from '../../types'
import type {
  SendToOpenListCancelReviewPlanV1,
  SendToOpenListCancelReviewStateV1,
  SendToOpenListConnectionPreparationV1,
  SendToOpenListConnectionSnapshotV1,
  SendToOpenListProfileV1,
  SendToOpenListStableErrorCode,
  SendToOpenListSubmissionStateV1,
  SendToOpenListTaskSnapshotV1,
} from './contracts'
import type { SendToOpenListProfileStore } from './profile-store'
import {
  consumeSendToOpenListCancelReviewPlan,
  createSendToOpenListCancelReviewPlan,
} from './cancel-plan'
import {
  createSendToOpenListAddResourceCommand,
  createSendToOpenListListTasksCommand,
} from './commands'
import {
  SendToOpenListConnector,
  SendToOpenListConnectorError,
} from './connector'
import {
  SEND_TO_OPENLIST_CAPABILITY,
  SEND_TO_OPENLIST_ENTRY_ID,
  SEND_TO_OPENLIST_MAX_TOKEN_BYTES,
  SEND_TO_OPENLIST_MODULE_ID,
  SEND_TO_OPENLIST_PREPARATION_TTL_MS,
} from './contracts'
import {
  createSendToOpenListSubmissionState,
  getSendToOpenListDispatchableCandidates,
  reduceSendToOpenListSubmission,
} from './submission'
import {
  normalizeSendToOpenListExactOrigin,
  utf8ByteLength,
  validateSendToOpenListProfile,
} from './validation'

export interface SendToOpenListRegistryBoundary {
  get: (_moduleId: string) => Promise<InstalledModuleRecord | null>
  list: () => Promise<InstalledModuleRecord[]>
  setCapabilityGrant: (
    _moduleId: string,
    _capability: ModuleCapabilityId,
    _granted: boolean,
  ) => Promise<SetModuleCapabilityGrantResult>
}

export interface SendToOpenListPermissionBoundary {
  contains: (_permissions: { origins: string[] }) => Promise<boolean>
  remove: (_permissions: { origins: string[] }) => Promise<boolean>
}

export interface SendToOpenListConnectorBoundary {
  verify: (_origin: string, _profileId: string, _token: string, _signal?: AbortSignal) => Promise<{ authenticated: true }>
  discoverTools: (_origin: string, _profileId: string, _path: string, _signal?: AbortSignal) => Promise<readonly string[]>
  addResource: (
    _origin: string,
    _profileId: string,
    _token: string,
    _input: { url: string, destinationPath: string, tool: string },
    _signal?: AbortSignal,
  ) => Promise<string | null>
  listTasks: (
    _origin: string,
    _profileId: string,
    _token: string,
    _list: 'undone' | 'done',
    _signal?: AbortSignal,
  ) => Promise<readonly import('./contracts').SendToOpenListTaskSummaryV1[]>
  cancelTask: (
    _origin: string,
    _profileId: string,
    _token: string,
    _taskId: string,
    _signal?: AbortSignal,
  ) => Promise<{ cancelled: true }>
}

export interface SendToOpenListControllerOptions {
  registry: SendToOpenListRegistryBoundary
  permissions: SendToOpenListPermissionBoundary
  store: SendToOpenListProfileStore
  connector?: SendToOpenListConnectorBoundary
  createToken?: () => string
  now?: () => string
  originInUse?: (_originPattern: string) => boolean | Promise<boolean>
}

export type SendToOpenListControllerResult<Value> =
  | { ok: true, value: Value }
  | { ok: false, reason: SendToOpenListStableErrorCode }

type AvailableRecord =
  | { readonly ok: true, readonly record: InstalledModuleRecord }
  | { readonly ok: false, readonly reason: 'module-unavailable' | 'module-disabled' }

type ConnectedAuthority =
  | {
    readonly ok: true
    readonly profile: SendToOpenListProfileV1
    readonly token: string
    readonly generation: number
  }
  | {
    readonly ok: false
    readonly reason: 'module-unavailable' | 'module-disabled' | 'lifecycle-invalidated' | 'permission-missing' | 'permission-check-failed'
  }

function isSendToOpenListRecord(record: InstalledModuleRecord | null): record is InstalledModuleRecord {
  return Boolean(record
    && record.source === 'seeded'
    && record.manifest.id === SEND_TO_OPENLIST_MODULE_ID
    && record.manifest.runtime === 'builtin'
    && record.manifest.entry_id === SEND_TO_OPENLIST_ENTRY_ID
    && record.manifest.capabilities.includes(SEND_TO_OPENLIST_CAPABILITY))
}

function exactOriginPattern(origin: string) {
  const normalized = normalizeSendToOpenListExactOrigin(origin)
  return normalized ? `${normalized}/*` : null
}

function validToken(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && utf8ByteLength(value) <= SEND_TO_OPENLIST_MAX_TOKEN_BYTES
    && !value.includes('\r')
    && !value.includes('\n')
}

function connectorError(error: unknown): SendToOpenListStableErrorCode {
  return error instanceof SendToOpenListConnectorError ? error.code : 'network-failed'
}

export class SendToOpenListController {
  private readonly connector: SendToOpenListConnectorBoundary
  private readonly createToken: () => string
  private readonly now: () => string
  private readonly originInUse: (_originPattern: string) => boolean | Promise<boolean>
  private readonly aborts = new Set<AbortController>()
  private initialization: Promise<void> | null = null
  private grantQueue = Promise.resolve()
  private generation = 1
  private profile: SendToOpenListProfileV1 | null = null
  private installationId: string | null = null
  private hasStoredToken = false
  private sessionToken: string | null = null
  private preparation: SendToOpenListConnectionPreparationV1 | null = null
  private phase: SendToOpenListConnectionSnapshotV1['phase'] = 'disconnected'
  private errorCode: SendToOpenListStableErrorCode | null = null
  private occurredAt: string | null = null
  private connectedAt: string | null = null
  private ownedOriginPattern: string | null = null
  private preparationPreExistingPermission = true
  private reviewedTools: { generation: number, destinationPath: string, tools: readonly string[] } | null = null
  private undoneSnapshot: SendToOpenListTaskSnapshotV1 | null = null
  private cancelReview: SendToOpenListCancelReviewStateV1 | null = null

  constructor(private readonly options: SendToOpenListControllerOptions) {
    this.connector = options.connector || new SendToOpenListConnector()
    this.createToken = options.createToken || (() => crypto.randomUUID())
    this.now = options.now || (() => new Date().toISOString())
    this.originInUse = options.originInUse || (() => false)
  }

  private timestamp() {
    const value = this.now()
    return Number.isFinite(Date.parse(value)) ? value : new Date(0).toISOString()
  }

  private async installedRecord() {
    const record = await this.options.registry.get(SEND_TO_OPENLIST_MODULE_ID)
    return isSendToOpenListRecord(record) ? record : null
  }

  private async availableRecord(): Promise<AvailableRecord> {
    const record = await this.installedRecord()
    if (!record)
      return { ok: false, reason: 'module-unavailable' }
    if (!record.enabled)
      return { ok: false, reason: 'module-disabled' }
    return { ok: true, record }
  }

  private async mutateGrant(granted: boolean) {
    const operation = this.grantQueue.then(() => this.options.registry.setCapabilityGrant(
      SEND_TO_OPENLIST_MODULE_ID,
      SEND_TO_OPENLIST_CAPABILITY,
      granted,
    )).catch(() => null)
    this.grantQueue = operation.then(() => undefined)
    return operation
  }

  private async initialize() {
    const record = await this.installedRecord()
    if (!record) {
      this.fail('module-unavailable')
      return
    }
    this.installationId = record.installedAt
    try {
      const stored = await this.options.store.load(record.installedAt)
      this.profile = stored.profile
      this.hasStoredToken = stored.hasStoredToken
    }
    catch {
      this.fail('profile-read-failed')
    }
    const grant = await this.mutateGrant(false)
    if (!grant?.ok)
      this.fail('capability-sync-failed')
  }

  private ensureInitialized() {
    if (!this.initialization)
      this.initialization = this.initialize()
    return this.initialization
  }

  startup() {
    return this.ensureInitialized()
  }

  private fail(code: SendToOpenListStableErrorCode) {
    this.abortTransient()
    this.phase = 'error'
    this.errorCode = code
    this.occurredAt = this.timestamp()
  }

  private abortTransient() {
    this.generation += 1
    this.preparation = null
    this.reviewedTools = null
    this.undoneSnapshot = null
    this.cancelReview = null
    this.sessionToken = null
    this.connectedAt = null
    for (const abort of this.aborts)
      abort.abort()
    this.aborts.clear()
  }

  private resetDisconnected() {
    this.abortTransient()
    this.phase = 'disconnected'
    this.errorCode = null
    this.occurredAt = null
  }

  private snapshot(): SendToOpenListConnectionSnapshotV1 {
    if (this.phase === 'preparing' && this.preparation) {
      return structuredClone({
        phase: 'preparing',
        generation: this.generation,
        profile: this.preparation.profile,
        hasStoredToken: this.hasStoredToken,
        preparationExpiresAt: this.preparation.expiresAt,
      })
    }
    if (this.phase === 'connected' && this.profile && this.connectedAt) {
      return structuredClone({
        phase: 'connected',
        generation: this.generation,
        profile: this.profile,
        hasStoredToken: true,
        connectedAt: this.connectedAt,
      })
    }
    if (this.phase === 'error') {
      return structuredClone({
        phase: 'error',
        generation: this.generation,
        profile: this.profile,
        hasStoredToken: this.hasStoredToken,
        errorCode: this.errorCode || 'lifecycle-invalidated',
        occurredAt: this.occurredAt || this.timestamp(),
      })
    }
    return structuredClone({
      phase: 'disconnected',
      generation: this.generation,
      profile: this.profile,
      hasStoredToken: this.hasStoredToken,
    })
  }

  async status() {
    await this.ensureInitialized()
    return this.snapshot()
  }

  async prepare(input: unknown): Promise<SendToOpenListControllerResult<SendToOpenListConnectionPreparationV1>> {
    await this.ensureInitialized()
    const available = await this.availableRecord()
    if (!available.ok)
      return available
    const validated = validateSendToOpenListProfile(input)
    if (!validated.ok)
      return { ok: false, reason: 'invalid-profile' }
    this.resetDisconnected()
    const grant = await this.mutateGrant(false)
    if (!grant?.ok)
      return { ok: false, reason: 'capability-sync-failed' }
    try {
      await this.releaseOwnedOrigin()
    }
    catch {
      return { ok: false, reason: 'permission-remove-failed' }
    }
    const pattern = exactOriginPattern(validated.value.controllerOrigin)!
    let preExisting: boolean
    try {
      preExisting = await this.options.permissions.contains({ origins: [pattern] })
    }
    catch {
      return { ok: false, reason: 'permission-check-failed' }
    }
    const createdAt = Date.parse(this.timestamp())
    const token = this.createToken()
    if (!Number.isFinite(createdAt) || typeof token !== 'string' || token.length < 16 || token.length > 128)
      return { ok: false, reason: 'lifecycle-invalidated' }
    this.phase = 'preparing'
    this.preparationPreExistingPermission = preExisting
    this.preparation = Object.freeze({
      token,
      profile: validated.value,
      originPattern: pattern,
      generation: this.generation,
      expiresAt: new Date(createdAt + SEND_TO_OPENLIST_PREPARATION_TTL_MS).toISOString(),
    })
    return { ok: true, value: structuredClone(this.preparation) }
  }

  async connect(
    preparation: unknown,
    tokenInput?: unknown,
  ): Promise<SendToOpenListControllerResult<SendToOpenListConnectionSnapshotV1>> {
    await this.ensureInitialized()
    const expected = this.preparation
    this.preparation = null
    if (!expected
      || !preparation
      || typeof preparation !== 'object'
      || JSON.stringify(preparation) !== JSON.stringify(expected)
      || Date.parse(expected.expiresAt) <= Date.parse(this.timestamp())
      || expected.generation !== this.generation) {
      this.resetDisconnected()
      return { ok: false, reason: 'lifecycle-invalidated' }
    }
    const available = await this.availableRecord()
    if (!available.ok)
      return available
    let permitted: boolean
    try {
      permitted = await this.options.permissions.contains({ origins: [expected.originPattern] })
    }
    catch {
      return { ok: false, reason: 'permission-check-failed' }
    }
    if (!permitted)
      return { ok: false, reason: 'permission-missing' }
    if (!this.preparationPreExistingPermission)
      this.ownedOriginPattern = expected.originPattern
    let sessionToken: string | null = validToken(tokenInput) ? tokenInput : null
    if (!sessionToken && this.installationId) {
      try {
        sessionToken = await this.options.store.loadToken(expected.profile, this.installationId)
      }
      catch {
        return this.failConnection('profile-read-failed')
      }
    }
    if (!sessionToken)
      return this.failConnection('token-missing')
    this.profile = expected.profile
    const operationGeneration = this.generation
    const abort = new AbortController()
    this.aborts.add(abort)
    try {
      await this.connector.verify(expected.profile.controllerOrigin, expected.profile.id, sessionToken, abort.signal)
      if (operationGeneration !== this.generation)
        return { ok: false, reason: 'lifecycle-invalidated' }
      const current = await this.availableRecord()
      if (!current.ok || current.record.installedAt !== this.installationId)
        return this.failConnection('lifecycle-invalidated')
      try {
        await this.options.store.saveVerified(expected.profile, sessionToken, current.record.installedAt)
      }
      catch {
        return this.failConnection('profile-write-failed')
      }
      const grant = await this.mutateGrant(true)
      if (!grant?.ok)
        return this.failConnection('capability-sync-failed')
      if (operationGeneration !== this.generation) {
        await this.mutateGrant(false)
        return { ok: false, reason: 'lifecycle-invalidated' }
      }
      this.profile = expected.profile
      this.installationId = current.record.installedAt
      this.hasStoredToken = true
      this.sessionToken = sessionToken
      this.phase = 'connected'
      this.connectedAt = this.timestamp()
      this.errorCode = null
      return { ok: true, value: this.snapshot() }
    }
    catch (error) {
      return this.failConnection(connectorError(error))
    }
    finally {
      this.aborts.delete(abort)
    }
  }

  private async failConnection(reason: SendToOpenListStableErrorCode): Promise<{ ok: false, reason: SendToOpenListStableErrorCode }> {
    this.fail(reason)
    await this.mutateGrant(false)
    if (reason === 'authentication-failed' && this.profile) {
      await this.options.store.clearToken(this.profile.id).catch(() => undefined)
      this.hasStoredToken = false
    }
    await this.releaseOwnedOrigin().catch(() => undefined)
    return { ok: false, reason }
  }

  private async connectedAuthority(): Promise<ConnectedAuthority> {
    if (this.phase !== 'connected' || !this.profile || !this.sessionToken)
      return { ok: false, reason: 'lifecycle-invalidated' }
    const available = await this.availableRecord()
    if (!available.ok)
      return available
    if (available.record.installedAt !== this.installationId
      || !available.record.grantedCapabilities.includes(SEND_TO_OPENLIST_CAPABILITY)) {
      return { ok: false, reason: 'lifecycle-invalidated' }
    }
    const pattern = exactOriginPattern(this.profile.controllerOrigin)!
    try {
      if (!await this.options.permissions.contains({ origins: [pattern] }))
        return { ok: false, reason: 'permission-missing' }
    }
    catch {
      return { ok: false, reason: 'permission-check-failed' }
    }
    return {
      ok: true,
      profile: this.profile,
      token: this.sessionToken,
      generation: this.generation,
    }
  }

  async discoverTools(destinationPath: unknown): Promise<SendToOpenListControllerResult<readonly string[]>> {
    await this.ensureInitialized()
    const authority = await this.connectedAuthority()
    if (!authority.ok)
      return authority
    if (typeof destinationPath !== 'string' || !destinationPath.startsWith('/'))
      return { ok: false, reason: 'operation-not-allowed' }
    const abort = new AbortController()
    this.aborts.add(abort)
    try {
      const tools = await this.connector.discoverTools(
        authority.profile.controllerOrigin,
        authority.profile.id,
        destinationPath,
        abort.signal,
      )
      if (authority.generation !== this.generation)
        return { ok: false, reason: 'lifecycle-invalidated' }
      this.reviewedTools = {
        generation: authority.generation,
        destinationPath,
        tools: Object.freeze([...tools]),
      }
      return { ok: true, value: Object.freeze([...tools]) }
    }
    catch (error) {
      const reason = connectorError(error)
      if (reason === 'authentication-failed')
        await this.invalidateAndClearToken()
      return { ok: false, reason }
    }
    finally {
      this.aborts.delete(abort)
    }
  }

  async submit(
    candidateInputs: readonly unknown[],
    destinationPath: unknown,
    tool: unknown,
  ): Promise<SendToOpenListControllerResult<SendToOpenListSubmissionStateV1>> {
    await this.ensureInitialized()
    const authority = await this.connectedAuthority()
    if (!authority.ok)
      return authority
    const reviewed = this.reviewedTools
    if (!reviewed
      || reviewed.generation !== authority.generation
      || destinationPath !== reviewed.destinationPath
      || typeof tool !== 'string'
      || !reviewed.tools.includes(tool)) {
      return { ok: false, reason: 'operation-not-allowed' }
    }
    const canonicalAuthority = {
      moduleId: SEND_TO_OPENLIST_MODULE_ID,
      profileId: authority.profile.id,
      controllerOrigin: authority.profile.controllerOrigin,
      generation: authority.generation,
    } as const
    const created = createSendToOpenListSubmissionState(canonicalAuthority, candidateInputs)
    if (!created.ok)
      return { ok: false, reason: created.code === 'local-use-blocked' ? 'local-use-blocked' : 'invalid-candidate' }
    let state = reduceSendToOpenListSubmission(created.value, { type: 'start', authority: canonicalAuthority })
    const worker = async () => {
      while (true) {
        const candidate = getSendToOpenListDispatchableCandidates(state)[0]
        if (!candidate)
          return
        const command = createSendToOpenListAddResourceCommand(
          canonicalAuthority,
          `${authority.generation}:${candidate.id}`,
          candidate,
          destinationPath,
          tool,
          reviewed.tools,
        )
        if (!command.ok) {
          state = reduceSendToOpenListSubmission(state, {
            type: 'dispatch',
            authority: canonicalAuthority,
            candidateId: candidate.id,
          })
          state = reduceSendToOpenListSubmission(state, {
            type: 'resolve',
            authority: canonicalAuthority,
            candidateId: candidate.id,
            outcome: { status: 'failed', code: command.code === 'local-use-blocked' ? 'local-use-blocked' : 'invalid-candidate' },
          })
          continue
        }
        state = reduceSendToOpenListSubmission(state, {
          type: 'dispatch',
          authority: canonicalAuthority,
          candidateId: candidate.id,
        })
        const abort = new AbortController()
        this.aborts.add(abort)
        try {
          const taskId = await this.connector.addResource(
            authority.profile.controllerOrigin,
            authority.profile.id,
            authority.token,
            { url: candidate.url, destinationPath: destinationPath as string, tool },
            abort.signal,
          )
          if (authority.generation !== this.generation)
            continue
          state = reduceSendToOpenListSubmission(state, {
            type: 'resolve',
            authority: canonicalAuthority,
            candidateId: candidate.id,
            outcome: { status: 'accepted', taskId },
          })
        }
        catch (error) {
          if (authority.generation !== this.generation)
            continue
          const code = connectorError(error)
          state = reduceSendToOpenListSubmission(state, {
            type: 'resolve',
            authority: canonicalAuthority,
            candidateId: candidate.id,
            outcome: code === 'outcome-unknown'
              ? { status: 'outcome-unknown', code }
              : { status: 'failed', code },
          })
        }
        finally {
          this.aborts.delete(abort)
        }
      }
    }
    await Promise.all([worker(), worker()])
    if (authority.generation !== this.generation) {
      state = reduceSendToOpenListSubmission(state, {
        type: 'invalidate',
        authority: canonicalAuthority,
        reason: 'worker-restart',
      })
    }
    return { ok: true, value: structuredClone(state) }
  }

  async listTasks(
    list: unknown,
  ): Promise<SendToOpenListControllerResult<SendToOpenListTaskSnapshotV1>> {
    await this.ensureInitialized()
    if (list !== 'undone' && list !== 'done')
      return { ok: false, reason: 'operation-not-allowed' }
    const authority = await this.connectedAuthority()
    if (!authority.ok)
      return authority
    const canonicalAuthority = {
      moduleId: SEND_TO_OPENLIST_MODULE_ID,
      profileId: authority.profile.id,
      controllerOrigin: authority.profile.controllerOrigin,
      generation: authority.generation,
    } as const
    const command = createSendToOpenListListTasksCommand(
      canonicalAuthority,
      `tasks:${list}:${authority.generation}`,
      list,
    )
    if (!command.ok)
      return { ok: false, reason: 'operation-not-allowed' }
    const abort = new AbortController()
    this.aborts.add(abort)
    try {
      const tasks = await this.connector.listTasks(
        authority.profile.controllerOrigin,
        authority.profile.id,
        authority.token,
        list,
        abort.signal,
      )
      if (authority.generation !== this.generation)
        return { ok: false, reason: 'lifecycle-invalidated' }
      const snapshot: SendToOpenListTaskSnapshotV1 = Object.freeze({
        schemaVersion: 1,
        authority: canonicalAuthority,
        snapshotId: `${this.createToken()}-${this.createToken()}`,
        list,
        refreshedAt: this.timestamp(),
        tasks: Object.freeze(tasks.map(task => Object.freeze({ ...task }))),
      })
      if (list === 'undone') {
        this.undoneSnapshot = snapshot
        this.cancelReview = null
      }
      return { ok: true, value: structuredClone(snapshot) }
    }
    catch (error) {
      const reason = connectorError(error)
      if (reason === 'authentication-failed')
        await this.invalidateAndClearToken()
      return { ok: false, reason }
    }
    finally {
      this.aborts.delete(abort)
    }
  }

  async prepareCancel(
    taskId: unknown,
  ): Promise<SendToOpenListControllerResult<SendToOpenListCancelReviewPlanV1>> {
    await this.ensureInitialized()
    const authority = await this.connectedAuthority()
    if (!authority.ok)
      return authority
    const snapshot = this.undoneSnapshot
    if (!snapshot || snapshot.authority.generation !== authority.generation)
      return { ok: false, reason: 'operation-not-allowed' }
    const created = createSendToOpenListCancelReviewPlan(
      snapshot.authority,
      `${this.createToken()}-${this.createToken()}`,
      snapshot.snapshotId,
      taskId,
      snapshot.tasks.map(task => task.id),
      this.timestamp(),
    )
    if (!created.ok)
      return { ok: false, reason: 'operation-not-allowed' }
    this.cancelReview = created.value
    return { ok: true, value: structuredClone(created.value.plan) }
  }

  async confirmCancel(
    token: unknown,
  ): Promise<SendToOpenListControllerResult<{ taskId: string }>> {
    await this.ensureInitialized()
    const authority = await this.connectedAuthority()
    if (!authority.ok)
      return authority
    const review = this.cancelReview
    const snapshot = this.undoneSnapshot
    this.cancelReview = null
    if (!review || !snapshot)
      return { ok: false, reason: 'operation-not-allowed' }
    const consumed = consumeSendToOpenListCancelReviewPlan(
      review,
      snapshot.authority,
      token,
      snapshot.snapshotId,
      review.plan.taskId,
      this.timestamp(),
    )
    if (!consumed.ok)
      return { ok: false, reason: consumed.code }
    const abort = new AbortController()
    this.aborts.add(abort)
    try {
      const current = await this.connector.listTasks(
        authority.profile.controllerOrigin,
        authority.profile.id,
        authority.token,
        'undone',
        abort.signal,
      )
      if (authority.generation !== this.generation
        || !current.some(task => task.id === consumed.plan.taskId)) {
        return { ok: false, reason: 'stale-generation' }
      }
      await this.connector.cancelTask(
        authority.profile.controllerOrigin,
        authority.profile.id,
        authority.token,
        consumed.plan.taskId,
        abort.signal,
      )
      if (authority.generation !== this.generation)
        return { ok: false, reason: 'lifecycle-invalidated' }
      this.undoneSnapshot = null
      return { ok: true, value: { taskId: consumed.plan.taskId } }
    }
    catch (error) {
      return { ok: false, reason: connectorError(error) }
    }
    finally {
      this.aborts.delete(abort)
    }
  }

  usesOriginPattern(pattern: string) {
    return this.preparation?.originPattern === pattern
      || exactOriginPattern(this.profile?.controllerOrigin || '') === pattern
      || this.ownedOriginPattern === pattern
  }

  private async releaseOwnedOrigin() {
    const pattern = this.ownedOriginPattern
    if (!pattern)
      return false
    if (await this.originInUse(pattern)) {
      this.ownedOriginPattern = null
      return false
    }
    const records = await this.options.registry.list()
    const shared = records.some(record => record.source === 'user'
      && record.manifest.runtime === 'remote-frame'
      && [record.sourceUrl, record.manifest.entry_url, record.manifest.icon_url]
        .some(url => Boolean(url && exactOriginPattern(url) === pattern)))
    if (shared) {
      this.ownedOriginPattern = null
      return false
    }
    await this.options.permissions.remove({ origins: [pattern] })
    if (await this.options.permissions.contains({ origins: [pattern] }))
      throw new Error('permission-remove-failed')
    this.ownedOriginPattern = null
    return true
  }

  private async invalidateAndClearToken() {
    const profileId = this.profile?.id
    this.resetDisconnected()
    await this.mutateGrant(false)
    if (profileId)
      await this.options.store.clearToken(profileId).catch(() => undefined)
    this.hasStoredToken = false
  }

  async disconnect() {
    await this.ensureInitialized()
    const profileId = this.profile?.id
    this.resetDisconnected()
    await this.mutateGrant(false)
    if (profileId)
      await this.options.store.clearToken(profileId).catch(() => undefined)
    this.hasStoredToken = false
    const releasedOrigin = await this.releaseOwnedOrigin().catch(() => false)
    return { disconnected: true as const, releasedOrigin }
  }

  async deleteProfile() {
    const profileId = this.profile?.id
    await this.disconnect()
    if (profileId)
      await this.options.store.removeProfile(profileId)
    const installedAt = (await this.installedRecord())?.installedAt || null
    this.installationId = installedAt
    if (installedAt) {
      const loaded = await this.options.store.load(installedAt)
      this.profile = loaded.profile
      this.hasStoredToken = loaded.hasStoredToken
    }
    else {
      this.profile = null
      this.hasStoredToken = false
    }
    return { deleted: true as const }
  }

  async handleInstalledRecordChanged(record: InstalledModuleRecord) {
    await this.ensureInitialized()
    if (record.manifest.id !== SEND_TO_OPENLIST_MODULE_ID)
      return
    if (!isSendToOpenListRecord(record) || record.installedAt !== this.installationId) {
      const reinstalled = this.installationId !== null && record.installedAt !== this.installationId
      await this.invalidateAndClearToken()
      if (reinstalled) {
        await this.options.store.clearAll().catch(() => undefined)
        this.profile = null
        this.installationId = record.installedAt
      }
      return
    }
    if (!record.enabled) {
      this.resetDisconnected()
      await this.mutateGrant(false)
      await this.options.store.clearAllTokens().catch(() => undefined)
      this.hasStoredToken = false
      await this.releaseOwnedOrigin().catch(() => undefined)
    }
  }

  async handlePermissionsRemoved(removed: { origins?: string[] }) {
    await this.ensureInitialized()
    if (!removed.origins?.length)
      return
    await this.options.store.clearTokensForOrigins(removed.origins).catch(() => undefined)
    if (!removed.origins.some(pattern => this.usesOriginPattern(pattern)))
      return
    this.ownedOriginPattern = null
    await this.invalidateAndClearToken()
  }
}
