import type { SetModuleCapabilityGrantResult } from '../../registry'
import type { InstalledModuleRecord, ModuleCapabilityId } from '../../types'
import type {
  ClashConfirmProxySwitchResult,
  ClashConnectionPreparation,
  ClashConnectResult,
  ClashControlErrorCode,
  ClashDisconnectResult,
  ClashPrepareProxySwitchResult,
  ClashPrepareResult,
  ClashReadState,
  ClashRefreshResult,
} from './contracts'
import type { ClashControllerProfileStore } from './profile'
import type { ClashProxySwitchPlanRecord } from './proxy-switch'
import type { ClashConnectionState } from './state'
import {
  CLASH_CONTROL_CAPABILITY,
  CLASH_CONTROL_ENTRY_ID,
  CLASH_CONTROL_MODULE_ID,
  CLASH_CONTROL_PREPARATION_TTL_MS,
  CLASH_CONTROL_REQUEST_TIMEOUT_MS,
  CLASH_CONTROL_RESPONSE_LIMIT_BYTES,
  CLASH_PROXY_SWITCH_PLAN_TTL_MS,
} from './contracts'
import {
  compareClashProxySwitchPreflight,
  createClashProxySwitchPlan,
  createClashProxySwitchWrite,
  toPublicClashProxySwitchPlan,
  validateClashProxySwitchPlan,
} from './proxy-switch'
import {
  parseClashConnectionStatus,
  parseClashProxyGroups,
  parseClashReadOnlySnapshot,
} from './snapshot'
import {
  beginClashConnection,
  beginClashPreparation,
  completeClashConnection,
  createDisconnectedClashState,
  disconnectClashState,
  failClashConnection,
  toClashConnectionSnapshot,
} from './state'
import { normalizeClashControllerUrl } from './url'

export interface ClashControlRegistryBoundary {
  get: (_moduleId: string) => Promise<InstalledModuleRecord | null>
  list: () => Promise<InstalledModuleRecord[]>
  setCapabilityGrant: (
    _moduleId: string,
    _capability: ModuleCapabilityId,
    _granted: boolean,
  ) => Promise<SetModuleCapabilityGrantResult>
}

export interface ClashControlPermissionBoundary {
  contains: (_permissions: { origins: string[] }) => Promise<boolean>
  remove: (_permissions: { origins: string[] }) => Promise<boolean>
}

export interface ClashControlControllerOptions {
  registry: ClashControlRegistryBoundary
  permissions: ClashControlPermissionBoundary
  profileStore?: ClashControllerProfileStore
  fetch?: typeof globalThis.fetch
  createToken?: () => string
  now?: () => string
  timeoutMs?: number
  originInUse?: (_originPattern: string) => boolean | Promise<boolean>
}

interface PreparationOwnership {
  generation: number
  preExistingOriginPermission: boolean
}

type GrantMutationResult =
  | { ok: true, applied: false }
  | { ok: true, applied: true, result: Extract<SetModuleCapabilityGrantResult, { ok: true }> }
  | { ok: false }

class ClashRequestError extends Error {
  constructor(readonly code: Extract<
    ClashControlErrorCode,
    'network-failure' | 'authentication-failed' | 'protocol-incompatible' | 'response-too-large' | 'response-malformed'
  >) {
    super(code)
    this.name = 'ClashRequestError'
  }
}

function isClashControlRecord(record: InstalledModuleRecord | null): record is InstalledModuleRecord {
  return Boolean(record
    && record.source === 'seeded'
    && record.manifest.id === CLASH_CONTROL_MODULE_ID
    && record.manifest.runtime === 'builtin'
    && record.manifest.entry_id === CLASH_CONTROL_ENTRY_ID
    && record.manifest.capabilities.includes(CLASH_CONTROL_CAPABILITY))
}

function validSecret(value: unknown): value is string {
  return typeof value === 'string'
    && value.length <= 1024
    && !value.includes('\r')
    && !value.includes('\n')
}

function exactOriginPattern(value: string) {
  try {
    return `${new URL(value).origin}/*`
  }
  catch {
    return null
  }
}

function memoryProfileStore(): ClashControllerProfileStore {
  let profile: { version: 1, controllerOrigin: string } | null = null
  return {
    async load() {
      return profile ? structuredClone(profile) : null
    },
    async save(controllerOrigin) {
      profile = { version: 1, controllerOrigin }
      return structuredClone(profile)
    },
  }
}

export class ClashControlController {
  private readonly registry: ClashControlRegistryBoundary
  private readonly permissions: ClashControlPermissionBoundary
  private readonly profileStore: ClashControllerProfileStore
  private readonly fetcher: typeof globalThis.fetch
  private readonly createToken: () => string
  private readonly now: () => string
  private readonly timeoutMs: number
  private readonly originInUse: (_originPattern: string) => boolean | Promise<boolean>
  private state: ClashConnectionState = createDisconnectedClashState()
  private preparationOwnership: PreparationOwnership | null = null
  private ownedOriginPattern: string | null = null
  private activeAbort: AbortController | null = null
  private activeRefreshAbort: AbortController | null = null
  private activeSwitchAbort: AbortController | null = null
  private initialization: Promise<void> | null = null
  private grantQueue: Promise<void> = Promise.resolve()
  private cleanupQueue: Promise<void> = Promise.resolve()
  private preparationSequence = 0
  private refreshSequence = 0
  private switchSequence = 0
  private sessionSecret: string | null = null
  private readState: ClashReadState = { status: 'empty', snapshot: null, diagnostic: null }
  private proxySwitchPlan: ClashProxySwitchPlanRecord | null = null

  constructor({
    registry,
    permissions,
    profileStore = memoryProfileStore(),
    fetch = globalThis.fetch,
    createToken = () => crypto.randomUUID(),
    now = () => new Date().toISOString(),
    timeoutMs = CLASH_CONTROL_REQUEST_TIMEOUT_MS,
    originInUse = () => false,
  }: ClashControlControllerOptions) {
    this.registry = registry
    this.permissions = permissions
    this.profileStore = profileStore
    this.fetcher = fetch
    this.createToken = createToken
    this.now = now
    this.timeoutMs = timeoutMs
    this.originInUse = originInUse
  }

  private timestamp() {
    const value = this.now()
    return Number.isFinite(Date.parse(value)) ? value : new Date(0).toISOString()
  }

  private async initialize() {
    try {
      const profile = await this.profileStore.load()
      this.state = createDisconnectedClashState(profile)
    }
    catch {
      this.state = failClashConnection(
        createDisconnectedClashState(),
        0,
        'profile-read-failed',
        this.timestamp(),
      )!
    }
    const grant = await this.mutateGrant(false, this.state.generation, true)
    if (!grant.ok) {
      this.state = failClashConnection(
        this.state,
        this.state.generation,
        'capability-sync-failed',
        this.timestamp(),
      )!
    }
  }

  private ensureInitialized() {
    if (!this.initialization)
      this.initialization = this.initialize()
    return this.initialization
  }

  startup() {
    return this.ensureInitialized()
  }

  private async installedRecord() {
    const record = await this.registry.get(CLASH_CONTROL_MODULE_ID)
    return isClashControlRecord(record)
      ? { ok: true, record } as const
      : { ok: false, reason: 'module-unavailable' } as const
  }

  private async availableRecord() {
    const installed = await this.installedRecord()
    if (!installed.ok)
      return installed
    return installed.record.enabled
      ? installed
      : { ok: false, reason: 'module-disabled' } as const
  }

  private mutateGrant(granted: boolean, generation: number, force = false): Promise<GrantMutationResult> {
    const operation = this.grantQueue.then(async (): Promise<GrantMutationResult> => {
      if (!force) {
        if (granted && (this.state.generation !== generation || this.state.phase !== 'connecting'))
          return { ok: true, applied: false }
        if (!granted
          && this.state.generation !== generation
          && (this.state.phase === 'connecting' || this.state.phase === 'connected')) {
          return { ok: true, applied: false }
        }
      }
      try {
        const result = await this.registry.setCapabilityGrant(
          CLASH_CONTROL_MODULE_ID,
          CLASH_CONTROL_CAPABILITY,
          granted,
        )
        return result.ok
          ? { ok: true, applied: true, result }
          : { ok: false }
      }
      catch {
        return { ok: false }
      }
    })
    this.grantQueue = operation.then(() => undefined, () => undefined)
    return operation
  }

  private invalidateLifecycle() {
    this.preparationSequence += 1
    this.state = disconnectClashState(this.state)
    this.preparationOwnership = null
    this.activeAbort?.abort()
    this.activeAbort = null
    this.clearReadSession()
  }

  private clearReadSession() {
    this.refreshSequence += 1
    this.activeRefreshAbort?.abort()
    this.activeRefreshAbort = null
    this.clearProxySwitchPlan(true)
    this.sessionSecret = null
    this.readState = { status: 'empty', snapshot: null, diagnostic: null }
  }

  private clearProxySwitchPlan(abortActive: boolean) {
    this.switchSequence += 1
    this.proxySwitchPlan = null
    if (abortActive) {
      this.activeSwitchAbort?.abort()
      this.activeSwitchAbort = null
    }
  }

  async prepare(controllerUrl: unknown): Promise<ClashPrepareResult> {
    await this.ensureInitialized()
    await this.cleanupQueue
    if (this.state.phase === 'connecting' || this.state.phase === 'connected')
      return { ok: false, reason: 'connection-active' }
    if (this.state.phase === 'preparing' || this.state.phase === 'error')
      this.invalidateLifecycle()
    const sequence = ++this.preparationSequence
    const available = await this.availableRecord()
    if (!available.ok)
      return available
    const normalized = normalizeClashControllerUrl(controllerUrl)
    if (!normalized.ok)
      return normalized
    let preExistingOriginPermission: boolean
    try {
      preExistingOriginPermission = await this.permissions.contains({ origins: [normalized.controller.originPattern] })
    }
    catch {
      return { ok: false, reason: 'permission-check-failed' }
    }
    if (sequence !== this.preparationSequence)
      return { ok: false, reason: 'invalid-preparation' }
    const createdAt = Date.parse(this.now())
    const token = this.createToken()
    if (!Number.isFinite(createdAt) || !token || token.length > 128)
      return { ok: false, reason: 'invalid-preparation' }
    let profile
    try {
      profile = await this.profileStore.save(normalized.controller.controllerOrigin)
    }
    catch {
      if (sequence === this.preparationSequence) {
        this.state = failClashConnection(
          this.state,
          this.state.generation,
          'profile-write-failed',
          this.timestamp(),
        )!
      }
      return { ok: false, reason: 'profile-write-failed' }
    }
    if (sequence !== this.preparationSequence)
      return { ok: false, reason: 'invalid-preparation' }
    const prepared = beginClashPreparation(
      this.state,
      profile,
      token,
      new Date(createdAt + CLASH_CONTROL_PREPARATION_TTL_MS).toISOString(),
    )
    this.state = prepared
    this.preparationOwnership = {
      generation: prepared.generation,
      preExistingOriginPermission,
    }
    return {
      ok: true,
      preparation: structuredClone(prepared.preparation),
    }
  }

  async connect(
    preparation: ClashConnectionPreparation,
    secretValue: unknown,
  ): Promise<ClashConnectResult> {
    await this.ensureInitialized()
    await this.cleanupQueue
    const secret = validSecret(secretValue) ? secretValue : null
    const next = secret === null ? null : beginClashConnection(this.state, preparation, this.now())
    const ownership = this.preparationOwnership
    this.preparationOwnership = null
    if (!next || !ownership || ownership.generation !== preparation.generation) {
      if (this.state.phase === 'preparing')
        this.invalidateLifecycle()
      return { ok: false, reason: 'invalid-preparation' }
    }
    this.state = next
    const generation = this.state.generation
    if (!ownership.preExistingOriginPermission)
      this.ownedOriginPattern = preparation.originPattern
    const available = await this.availableRecord()
    if (!available.ok)
      return this.failConnectionAttempt(generation, available.reason)
    let permitted: boolean
    try {
      permitted = await this.permissions.contains({ origins: [preparation.originPattern] })
    }
    catch {
      return this.failConnectionAttempt(generation, 'permission-check-failed')
    }
    if (!permitted)
      return this.failConnectionAttempt(generation, 'permission-missing')
    const abort = new AbortController()
    this.activeAbort = abort
    const timeout = globalThis.setTimeout(() => abort.abort(), this.timeoutMs)
    try {
      const version = await this.fetchJson(preparation.controllerOrigin, '/version', secret!, abort.signal)
      const configs = await this.fetchJson(preparation.controllerOrigin, '/configs', secret!, abort.signal)
      if (generation !== this.state.generation || this.state.phase !== 'connecting')
        return { ok: false, reason: 'lifecycle-cancelled' }
      const parsed = parseClashConnectionStatus(version, configs, {
        controllerOrigin: preparation.controllerOrigin,
        refreshedAt: this.timestamp(),
        forbiddenText: secret!,
      })
      if (!parsed)
        throw new ClashRequestError('response-malformed')
      const current = await this.availableRecord()
      if (!current.ok || generation !== this.state.generation || this.state.phase !== 'connecting')
        return { ok: false, reason: 'lifecycle-cancelled' }
      const grant = await this.mutateGrant(true, generation)
      if (!grant.ok)
        return this.failConnectionAttempt(generation, 'capability-sync-failed')
      if (!grant.applied || generation !== this.state.generation || this.state.phase !== 'connecting') {
        await this.mutateGrant(false, this.state.generation)
        return { ok: false, reason: 'lifecycle-cancelled' }
      }
      const completed = completeClashConnection(this.state, generation, parsed)
      if (!completed) {
        await this.mutateGrant(false, this.state.generation)
        return { ok: false, reason: 'lifecycle-cancelled' }
      }
      this.state = completed
      this.sessionSecret = secret!
      this.readState = { status: 'empty', snapshot: null, diagnostic: null }
      return { ok: true, status: structuredClone(parsed), record: grant.result.record }
    }
    catch (error) {
      if (generation !== this.state.generation)
        return { ok: false, reason: 'lifecycle-cancelled' }
      return this.failConnectionAttempt(
        generation,
        error instanceof ClashRequestError ? error.code : 'network-failure',
      )
    }
    finally {
      globalThis.clearTimeout(timeout)
      if (this.activeAbort === abort)
        this.activeAbort = null
    }
  }

  private async failConnectionAttempt(
    generation: number,
    reason: ClashControlErrorCode,
  ): Promise<{ ok: false, reason: ClashControlErrorCode }> {
    if (generation !== this.state.generation)
      return { ok: false, reason: 'lifecycle-cancelled' }
    this.clearReadSession()
    const grant = await this.mutateGrant(false, generation)
    const release = await this.releaseOwnedOrigin()
    if (generation !== this.state.generation)
      return { ok: false, reason: 'lifecycle-cancelled' }
    const finalReason = !grant.ok
      ? 'capability-sync-failed'
      : !release.ok
          ? release.reason
          : reason
    this.state = failClashConnection(this.state, generation, finalReason, this.timestamp())!
    return { ok: false, reason: finalReason }
  }

  private async fetchJson(origin: string, path: '/version' | '/configs' | '/proxies', secret: string, signal: AbortSignal) {
    let response: Response
    try {
      response = await this.fetcher.call(globalThis, `${origin}${path}`, {
        method: 'GET',
        headers: {
          accept: 'application/json',
          ...(secret ? { authorization: `Bearer ${secret}` } : {}),
        },
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'manual',
        referrerPolicy: 'no-referrer',
        signal,
      })
    }
    catch {
      throw new ClashRequestError('network-failure')
    }
    if (response.status === 401 || response.status === 403)
      throw new ClashRequestError('authentication-failed')
    if (!response.ok || response.redirected)
      throw new ClashRequestError('protocol-incompatible')
    const text = await this.readBoundedResponse(response)
    try {
      return JSON.parse(text) as unknown
    }
    catch {
      throw new ClashRequestError('response-malformed')
    }
  }

  private async readBoundedResponse(response: Response, requireDeclaredCompleteness = false) {
    const declaredLength = response.headers.get('content-length')
    let expectedLength: number | null = null
    if (declaredLength !== null) {
      const parsedLength = Number(declaredLength)
      if (Number.isFinite(parsedLength) && parsedLength > CLASH_CONTROL_RESPONSE_LIMIT_BYTES)
        throw new ClashRequestError('response-too-large')
      if (Number.isSafeInteger(parsedLength) && parsedLength >= 0)
        expectedLength = parsedLength
    }
    if (requireDeclaredCompleteness && expectedLength === null)
      throw new ClashRequestError('network-failure')
    if (!response.body) {
      const text = await response.text()
      const byteLength = new TextEncoder().encode(text).byteLength
      if (byteLength > CLASH_CONTROL_RESPONSE_LIMIT_BYTES)
        throw new ClashRequestError('response-too-large')
      if (requireDeclaredCompleteness && expectedLength !== null && byteLength !== expectedLength)
        throw new ClashRequestError('network-failure')
      return text
    }

    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let total = 0
    try {
      while (true) {
        const chunk = await reader.read()
        if (chunk.done)
          break
        total += chunk.value.byteLength
        if (total > CLASH_CONTROL_RESPONSE_LIMIT_BYTES) {
          await reader.cancel().catch(() => undefined)
          throw new ClashRequestError('response-too-large')
        }
        chunks.push(chunk.value)
      }
    }
    finally {
      reader.releaseLock()
    }
    if (requireDeclaredCompleteness && expectedLength !== null && total !== expectedLength)
      throw new ClashRequestError('network-failure')
    const bytes = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    return new TextDecoder().decode(bytes)
  }

  async refresh(): Promise<ClashRefreshResult> {
    await this.ensureInitialized()
    await this.cleanupQueue
    if (this.state.phase !== 'connected' || this.sessionSecret === null)
      return { ok: false, reason: 'connection-required' }
    if (this.activeSwitchAbort)
      return { ok: false, reason: 'operation-active' }
    this.clearProxySwitchPlan(false)
    const available = await this.availableRecord()
    if (!available.ok)
      return this.failConnectionAttempt(this.state.generation, available.reason)

    const generation = this.state.generation
    const controllerOrigin = this.state.status.controllerOrigin
    const originPattern = exactOriginPattern(controllerOrigin)
    const secret = this.sessionSecret
    if (!originPattern)
      return this.failConnectionAttempt(generation, 'protocol-incompatible')
    let permitted: boolean
    try {
      permitted = await this.permissions.contains({ origins: [originPattern] })
    }
    catch {
      return this.failConnectionAttempt(generation, 'permission-check-failed')
    }
    if (!permitted)
      return this.failConnectionAttempt(generation, 'permission-missing')

    const sequence = ++this.refreshSequence
    this.activeRefreshAbort?.abort()
    const abort = new AbortController()
    this.activeRefreshAbort = abort
    const timeout = globalThis.setTimeout(() => abort.abort(), this.timeoutMs)
    try {
      const version = await this.fetchJson(controllerOrigin, '/version', secret, abort.signal)
      const configs = await this.fetchJson(controllerOrigin, '/configs', secret, abort.signal)
      const proxies = await this.fetchJson(controllerOrigin, '/proxies', secret, abort.signal)
      if (sequence !== this.refreshSequence
        || generation !== this.state.generation
        || this.state.phase !== 'connected') {
        return { ok: false, reason: 'lifecycle-cancelled' }
      }
      const current = await this.availableRecord()
      if (!current.ok
        || sequence !== this.refreshSequence
        || generation !== this.state.generation
        || this.state.phase !== 'connected') {
        return { ok: false, reason: 'lifecycle-cancelled' }
      }
      let permissionStillPresent: boolean
      try {
        permissionStillPresent = await this.permissions.contains({ origins: [originPattern] })
      }
      catch {
        return this.failConnectionAttempt(generation, 'permission-check-failed')
      }
      if (!permissionStillPresent)
        return this.failConnectionAttempt(generation, 'permission-missing')
      const parsed = parseClashReadOnlySnapshot({ version, configs, proxies }, {
        controllerOrigin,
        generation,
        refreshedAt: this.timestamp(),
        forbiddenText: secret,
      })
      if (!parsed.ok)
        throw new ClashRequestError(parsed.reason)
      if (sequence !== this.refreshSequence
        || generation !== this.state.generation
        || this.state.phase !== 'connected') {
        return { ok: false, reason: 'lifecycle-cancelled' }
      }
      this.state = {
        ...this.state,
        status: {
          ...this.state.status,
          implementation: parsed.snapshot.implementation,
          version: parsed.snapshot.controllerVersion,
          mode: parsed.snapshot.mode,
        },
      }
      this.readState = { status: 'ready', snapshot: parsed.snapshot, diagnostic: null }
      return { ok: true, snapshot: structuredClone(parsed.snapshot) }
    }
    catch (error) {
      if (sequence !== this.refreshSequence || generation !== this.state.generation)
        return { ok: false, reason: 'lifecycle-cancelled' }
      const reason = error instanceof ClashRequestError ? error.code : 'network-failure'
      if (reason === 'network-failure') {
        const diagnostic = { code: reason, occurredAt: this.timestamp() } as const
        this.readState = this.readState.snapshot
          ? { status: 'stale', snapshot: this.readState.snapshot, diagnostic }
          : { status: 'empty', snapshot: null, diagnostic }
        return { ok: false, reason }
      }
      return this.failConnectionAttempt(generation, reason)
    }
    finally {
      globalThis.clearTimeout(timeout)
      if (this.activeRefreshAbort === abort)
        this.activeRefreshAbort = null
    }
  }

  async prepareProxySwitch(
    groupName: unknown,
    targetNode: unknown,
  ): Promise<ClashPrepareProxySwitchResult> {
    await this.ensureInitialized()
    await this.cleanupQueue
    if (this.activeRefreshAbort || this.activeSwitchAbort)
      return { ok: false, reason: 'operation-active' }
    this.clearProxySwitchPlan(false)
    const sequence = this.switchSequence
    if (this.state.phase !== 'connected' || this.sessionSecret === null)
      return { ok: false, reason: 'connection-required' }
    if (this.readState.status !== 'ready')
      return { ok: false, reason: 'switch-snapshot-required' }

    const generation = this.state.generation
    const snapshot = this.readState.snapshot
    if (snapshot.generation !== generation
      || snapshot.controllerOrigin !== this.state.status.controllerOrigin) {
      this.readState = { status: 'empty', snapshot: null, diagnostic: null }
      return { ok: false, reason: 'switch-plan-stale' }
    }
    const available = await this.availableRecord()
    if (!available.ok)
      return this.failConnectionAttempt(generation, available.reason)
    const originPattern = exactOriginPattern(snapshot.controllerOrigin)
    if (!originPattern)
      return this.failConnectionAttempt(generation, 'protocol-incompatible')
    let permitted: boolean
    try {
      permitted = await this.permissions.contains({ origins: [originPattern] })
    }
    catch {
      return this.failConnectionAttempt(generation, 'permission-check-failed')
    }
    if (!permitted)
      return this.failConnectionAttempt(generation, 'permission-missing')

    const created = createClashProxySwitchPlan(
      snapshot,
      groupName,
      targetNode,
      this.createToken(),
      this.timestamp(),
      CLASH_PROXY_SWITCH_PLAN_TTL_MS,
    )
    if (!created.ok)
      return created
    if (sequence !== this.switchSequence
      || generation !== this.state.generation
      || this.state.phase !== 'connected'
      || this.readState.status !== 'ready') {
      return { ok: false, reason: 'lifecycle-cancelled' }
    }
    this.proxySwitchPlan = created.plan
    return { ok: true, plan: toPublicClashProxySwitchPlan(created.plan) }
  }

  async confirmProxySwitch(token: unknown): Promise<ClashConfirmProxySwitchResult> {
    await this.ensureInitialized()
    await this.cleanupQueue
    const plan = this.proxySwitchPlan
    if (!plan)
      return { ok: false, reason: 'switch-plan-not-found' }
    this.proxySwitchPlan = null
    const sequence = ++this.switchSequence
    if (this.activeRefreshAbort || this.activeSwitchAbort)
      return { ok: false, reason: 'operation-active' }
    if (this.state.phase !== 'connected'
      || this.sessionSecret === null
      || this.readState.status !== 'ready') {
      return { ok: false, reason: 'switch-plan-stale' }
    }

    const generation = this.state.generation
    const controllerOrigin = this.state.status.controllerOrigin
    const secret = this.sessionSecret
    const validated = validateClashProxySwitchPlan(
      plan,
      this.readState.snapshot,
      token,
      this.timestamp(),
    )
    if (!validated.ok)
      return validated
    const originPattern = exactOriginPattern(controllerOrigin)
    if (!originPattern)
      return this.failConnectionAttempt(generation, 'protocol-incompatible')
    const available = await this.availableRecord()
    if (!available.ok)
      return this.failConnectionAttempt(generation, available.reason)
    let permitted: boolean
    try {
      permitted = await this.permissions.contains({ origins: [originPattern] })
    }
    catch {
      return this.failConnectionAttempt(generation, 'permission-check-failed')
    }
    if (!permitted)
      return this.failConnectionAttempt(generation, 'permission-missing')

    this.readState = { status: 'empty', snapshot: null, diagnostic: null }
    const abort = new AbortController()
    this.activeSwitchAbort = abort
    const timeout = globalThis.setTimeout(() => abort.abort(), this.timeoutMs)
    let writeStarted = false
    try {
      const proxies = await this.fetchJson(controllerOrigin, '/proxies', secret, abort.signal)
      if (!this.canCompleteProxySwitch(sequence, generation))
        return { ok: false, reason: 'lifecycle-cancelled' }
      const parsed = parseClashProxyGroups(proxies, secret)
      if (!parsed.ok)
        throw new ClashRequestError(parsed.reason)
      const compared = compareClashProxySwitchPreflight(plan, parsed.proxyGroups)
      if (!compared.ok)
        return compared
      const current = await this.availableRecord()
      if (!current.ok || !this.canCompleteProxySwitch(sequence, generation))
        return { ok: false, reason: 'lifecycle-cancelled' }
      let permissionStillPresent: boolean
      try {
        permissionStillPresent = await this.permissions.contains({ origins: [originPattern] })
      }
      catch {
        return this.failConnectionAttempt(generation, 'permission-check-failed')
      }
      if (!permissionStillPresent)
        return this.failConnectionAttempt(generation, 'permission-missing')
      const write = createClashProxySwitchWrite(plan)
      writeStarted = true
      await this.writeProxySelection(
        controllerOrigin,
        write.path,
        write.body,
        secret,
        abort.signal,
      )
      if (!this.canCompleteProxySwitch(sequence, generation))
        return { ok: false, reason: 'lifecycle-cancelled' }
      return {
        ok: true,
        groupName: plan.groupName,
        previousNode: plan.originalNode,
        selectedNode: plan.targetNode,
      }
    }
    catch (error) {
      if (!this.canCompleteProxySwitch(sequence, generation))
        return { ok: false, reason: 'lifecycle-cancelled' }
      const reason = error instanceof ClashRequestError ? error.code : 'network-failure'
      if (writeStarted) {
        if (reason !== 'network-failure')
          await this.failConnectionAttempt(generation, reason)
        return { ok: false, reason: 'switch-outcome-unknown' }
      }
      if (reason === 'network-failure')
        return { ok: false, reason }
      return this.failConnectionAttempt(generation, reason)
    }
    finally {
      globalThis.clearTimeout(timeout)
      if (this.activeSwitchAbort === abort)
        this.activeSwitchAbort = null
    }
  }

  private canCompleteProxySwitch(sequence: number, generation: number) {
    return sequence === this.switchSequence
      && generation === this.state.generation
      && this.state.phase === 'connected'
      && this.sessionSecret !== null
  }

  private async writeProxySelection(
    origin: string,
    path: string,
    body: { name: string },
    secret: string,
    signal: AbortSignal,
  ) {
    let response: Response
    try {
      response = await this.fetcher.call(globalThis, `${origin}${path}`, {
        method: 'PUT',
        headers: {
          'accept': 'application/json',
          'authorization': `Bearer ${secret}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ name: body.name }),
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'manual',
        referrerPolicy: 'no-referrer',
        signal,
      })
    }
    catch {
      throw new ClashRequestError('network-failure')
    }
    if (response.status === 401 || response.status === 403)
      throw new ClashRequestError('authentication-failed')
    if (response.redirected)
      throw new ClashRequestError('protocol-incompatible')
    if (response.status === 200) {
      await this.readBoundedResponse(response, true)
      throw new ClashRequestError('protocol-incompatible')
    }
    if (response.status !== 204)
      throw new ClashRequestError('protocol-incompatible')
    await this.readBoundedResponse(response)
  }

  async readStatus(): Promise<ClashReadState> {
    await this.ensureInitialized()
    return structuredClone(this.readState)
  }

  async status() {
    await this.ensureInitialized()
    return toClashConnectionSnapshot(this.state)
  }

  usesOriginPattern(pattern: string) {
    if (this.state.phase === 'preparing')
      return this.state.preparation.originPattern === pattern
    if (this.state.phase === 'connecting')
      return exactOriginPattern(this.state.controllerOrigin) === pattern
    if (this.state.phase === 'connected')
      return exactOriginPattern(this.state.status.controllerOrigin) === pattern
    return false
  }

  async disconnect(): Promise<ClashDisconnectResult> {
    await this.ensureInitialized()
    const installed = await this.installedRecord()
    if (!installed.ok)
      return installed
    const changed = this.state.phase !== 'disconnected' || Boolean(this.ownedOriginPattern)
    this.invalidateLifecycle()
    const generation = this.state.generation
    const cleanup = (async () => {
      const grant = await this.mutateGrant(false, generation)
      const release = await this.releaseOwnedOrigin()
      if (!grant.ok)
        return { ok: false as const, reason: 'capability-sync-failed' as const }
      if (!release.ok)
        return release
      const current = await this.installedRecord()
      if (!current.ok)
        return current
      return {
        ok: true as const,
        changed,
        releasedOrigin: release.released,
        record: current.record,
      }
    })()
    this.cleanupQueue = cleanup.then(() => undefined, () => undefined)
    const result = await cleanup
    if (!result.ok && generation === this.state.generation) {
      this.state = failClashConnection(
        this.state,
        generation,
        result.reason,
        this.timestamp(),
      )!
    }
    return result
  }

  private async releaseOwnedOrigin(): Promise<{ ok: true, released: boolean } | { ok: false, reason: ClashControlErrorCode }> {
    const pattern = this.ownedOriginPattern
    if (!pattern)
      return { ok: true, released: false }
    try {
      if (await this.originInUse(pattern)) {
        this.ownedOriginPattern = null
        return { ok: true, released: false }
      }
    }
    catch {
      return { ok: false, reason: 'permission-remove-failed' }
    }
    let records: InstalledModuleRecord[]
    try {
      records = await this.registry.list()
    }
    catch {
      return { ok: false, reason: 'permission-remove-failed' }
    }
    const shared = records.some((record) => {
      if (record.source !== 'user' || record.manifest.runtime !== 'remote-frame')
        return false
      return [record.sourceUrl, record.manifest.entry_url, record.manifest.icon_url]
        .some(url => Boolean(url && exactOriginPattern(url) === pattern))
    })
    if (shared) {
      this.ownedOriginPattern = null
      return { ok: true, released: false }
    }
    try {
      await this.permissions.remove({ origins: [pattern] })
      const remains = await this.permissions.contains({ origins: [pattern] })
      if (remains)
        return { ok: false, reason: 'permission-remove-failed' }
      if (this.ownedOriginPattern === pattern)
        this.ownedOriginPattern = null
      return { ok: true, released: true }
    }
    catch {
      return { ok: false, reason: 'permission-remove-failed' }
    }
  }

  async handleInstalledRecordChanged(record: InstalledModuleRecord) {
    await this.ensureInitialized()
    if (record.manifest.runtime !== 'builtin'
      || record.manifest.entry_id !== CLASH_CONTROL_ENTRY_ID
      || record.enabled) {
      return
    }
    await this.disconnect().catch(() => undefined)
  }

  async handlePermissionsRemoved(removed: { origins?: string[] }) {
    await this.ensureInitialized()
    const relevant = removed.origins?.some(origin => this.usesOriginPattern(origin) || origin === this.ownedOriginPattern)
    if (!relevant)
      return
    this.invalidateLifecycle()
    this.ownedOriginPattern = null
    const generation = this.state.generation
    const grant = await this.mutateGrant(false, generation).catch(() => ({ ok: false as const }))
    if (!grant.ok && generation === this.state.generation) {
      this.state = failClashConnection(
        this.state,
        generation,
        'capability-sync-failed',
        this.timestamp(),
      )!
    }
  }
}
