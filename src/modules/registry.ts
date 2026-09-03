import type {
  InstalledModuleRecord,
  ModuleCapabilityId,
  ModuleContextFieldGrants,
  ModuleContextId,
  ModuleUpdateApprovalSelection,
  ModuleUpdateApprovalSnapshot,
  ModuleUpdateCandidate,
  ModuleUpdateMetadata,
  OneWebModuleManifest,
  SeededModuleDefinition,
} from './types'
import { validateModuleManifest } from './manifest'
import {
  classifyModuleUpdate,
  expectedModuleUpdateApprovalStatus,
  isNormalizedManifestDigest,
} from './module-update'

export const MODULES_STORAGE_KEY = 'oneweb.modules.v1' as const

export interface ModuleStorageArea {
  get: (_key: string) => Promise<Record<string, unknown>>
  set: (_items: Record<string, unknown>) => Promise<void>
}

export interface ModuleRegistryOptions {
  storage: ModuleStorageArea
  seeds?: SeededModuleDefinition[]
  now?: () => string
}

export type SetModuleEnabledResult =
  | {
    ok: true
    changed: boolean
    record: InstalledModuleRecord
  }
  | {
    ok: false
    changed: false
    reason: 'not-found'
  }

export type SetModuleCapabilityGrantResult =
  | {
    ok: true
    changed: boolean
    record: InstalledModuleRecord
  }
  | {
    ok: false
    changed: false
    reason: 'not-found' | 'capability-not-declared'
  }

export type RemoveUserModuleResult =
  | {
    ok: true
    changed: true
    removed: InstalledModuleRecord
  }
  | {
    ok: false
    changed: false
    reason: 'not-found' | 'protected-seed'
  }

export interface InstallUserModuleInput {
  manifest: OneWebModuleManifest
  sourceUrl: string
  grantedContextFields: ModuleContextFieldGrants
  grantedCapabilities: ModuleCapabilityId[]
}

export type InstallUserModuleResult =
  | {
    ok: true
    changed: true
    record: InstalledModuleRecord
  }
  | {
    ok: false
    changed: false
    reason: 'invalid-manifest' | 'invalid-source-url' | 'already-installed'
  }

export type SetModuleUpdateCandidateResult =
  | {
    ok: true
    changed: boolean
    record: InstalledModuleRecord
  }
  | {
    ok: false
    changed: false
    reason: 'not-found' | 'installed-record-changed' | 'invalid-candidate'
  }

export type ModuleUpdateApprovalErrorCode =
  | 'not-found'
  | 'no-update-candidate'
  | 'update-candidate-changed'
  | 'update-approval-not-required'
  | 'update-rejected'
  | 'invalid-update-approval'

export type ApproveModuleUpdateResult =
  | {
    ok: true
    changed: true
    record: InstalledModuleRecord
  }
  | {
    ok: false
    changed: false
    reason: ModuleUpdateApprovalErrorCode
  }

export type ModuleUpdateApplicationErrorCode =
  | 'not-found'
  | 'installed-record-changed'
  | 'no-update-candidate'
  | 'update-candidate-changed'
  | 'update-approval-required'
  | 'update-rejected'
  | 'invalid-candidate'

export type ApplyModuleUpdateResult =
  | {
    ok: true
    changed: true
    record: InstalledModuleRecord
  }
  | {
    ok: false
    changed: false
    reason: ModuleUpdateApplicationErrorCode
  }

interface NormalizedRecord {
  record: InstalledModuleRecord
  changed: boolean
}

interface NormalizedUpdate {
  update: ModuleUpdateMetadata | null
  changed: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

function normalizeUserSourceUrl(value: unknown, entryUrl: string) {
  if (typeof value !== 'string')
    return null
  try {
    const source = new URL(value)
    const entry = new URL(entryUrl)
    const localHttp = source.protocol === 'http:' && (source.hostname === 'localhost' || source.hostname === '127.0.0.1')
    if ((source.protocol !== 'https:' && !localHttp) || source.username || source.password)
      return null
    if (source.origin !== entry.origin)
      return null
    return source.href
  }
  catch {
    return null
  }
}

function normalizeGrantList<T extends string>(value: unknown, allowed: readonly T[]) {
  if (!Array.isArray(value))
    return { grants: [] as T[], changed: true }
  const grants = value.filter((item): item is T => typeof item === 'string' && allowed.includes(item as T))
  const normalized = [...new Set(grants)]
  return {
    grants: normalized,
    changed: normalized.length !== value.length || normalized.some((entry, index) => entry !== value[index]),
  }
}

function normalizeContextFieldGrants(
  value: unknown,
  allowed: ModuleContextFieldGrants,
  grantedContexts: ModuleContextId[],
) {
  const candidate = isRecord(value) ? value : {}
  const grants: ModuleContextFieldGrants = {}
  let changed = !isRecord(value)
  for (const contextId of grantedContexts) {
    const allowedFields = allowed[contextId] || []
    const normalized = normalizeGrantList<string>(candidate[contextId], allowedFields)
    if (normalized.grants.length)
      grants[contextId] = normalized.grants
    changed ||= normalized.changed
  }
  changed ||= Object.keys(candidate).some(contextId => !grantedContexts.includes(contextId as ModuleContextId))
  return { grants, changed }
}

function contextsWithFieldGrants(contexts: ModuleContextId[], fields: ModuleContextFieldGrants) {
  return contexts.filter(contextId => Boolean(fields[contextId]?.length))
}

function normalizeUpdateApprovalSelection(
  value: unknown,
  classification: ReturnType<typeof classifyModuleUpdate>,
): ModuleUpdateApprovalSelection | null {
  if (!isRecord(value) || !isRecord(value.approvedContextFields) || !Array.isArray(value.approvedCapabilities))
    return null

  const allowedContextFields = new Map(
    classification.permissionDiff.contextFields
      .filter(fields => fields.added.length)
      .map(fields => [fields.contextId, fields.added] as const),
  )
  const approvedContextFields: ModuleContextFieldGrants = {}
  for (const [rawContextId, rawFields] of Object.entries(value.approvedContextFields)) {
    const contextId = rawContextId as ModuleContextId
    const allowed = allowedContextFields.get(contextId)
    if (!allowed
      || !Array.isArray(rawFields)
      || rawFields.some(field => typeof field !== 'string' || !allowed.includes(field))) {
      return null
    }
    const fields = [...new Set(rawFields)]
    if (fields.length)
      approvedContextFields[contextId] = fields
  }

  const allowedCapabilities = classification.permissionDiff.capabilities.added
  if (value.approvedCapabilities.some(capability => (
    typeof capability !== 'string' || !allowedCapabilities.includes(capability)
  ))) {
    return null
  }
  return {
    approvedContextFields,
    approvedCapabilities: [...new Set(value.approvedCapabilities)] as ModuleCapabilityId[],
  }
}

function normalizeUpdateApprovalSnapshot(
  value: unknown,
  candidate: ModuleUpdateCandidate,
  classification: ReturnType<typeof classifyModuleUpdate>,
) {
  if (!isRecord(value)
    || value.approvedManifestDigest !== candidate.normalizedManifestDigest
    || !Array.isArray(value.approvedMatches)
    || JSON.stringify(value.approvedMatches) !== JSON.stringify(candidate.candidateManifest.matches)
    || value.approvedActivation !== candidate.candidateManifest.activation
    || !isTimestamp(value.approvedAt)) {
    return null
  }
  const selection = normalizeUpdateApprovalSelection(value, classification)
  if (!selection)
    return null
  const snapshot: ModuleUpdateApprovalSnapshot = {
    approvedManifestDigest: candidate.normalizedManifestDigest,
    approvedMatches: [...candidate.candidateManifest.matches],
    approvedActivation: candidate.candidateManifest.activation,
    ...selection,
    approvedAt: value.approvedAt,
  }
  return snapshot
}

function normalizeModuleUpdate(
  value: unknown,
  installed: Pick<InstalledModuleRecord, 'manifest' | 'source' | 'sourceUrl' | 'installedAt'>,
): NormalizedUpdate {
  if (value === null)
    return { update: null, changed: false }
  if (!isRecord(value))
    return { update: null, changed: true }

  const manifestResult = validateModuleManifest(value.candidateManifest, {
    allowBuiltin: installed.source === 'seeded',
  })
  if (!manifestResult.ok)
    return { update: null, changed: true }

  let candidateSourceUrl: string | null
  if (installed.source === 'user' && manifestResult.manifest.runtime === 'remote-frame') {
    const normalized = normalizeUserSourceUrl(value.candidateSourceUrl, manifestResult.manifest.entry_url)
    if (!normalized)
      return { update: null, changed: true }
    candidateSourceUrl = normalized
  }
  else {
    if (value.candidateSourceUrl !== null)
      return { update: null, changed: true }
    candidateSourceUrl = null
  }

  if (!isNormalizedManifestDigest(value.normalizedManifestDigest)
    || !isTimestamp(value.checkedAt)
    || Date.parse(value.checkedAt) < Date.parse(installed.installedAt)) {
    return { update: null, changed: true }
  }

  const candidate = {
    candidateManifest: manifestResult.manifest,
    candidateSourceUrl,
    normalizedManifestDigest: value.normalizedManifestDigest,
    checkedAt: value.checkedAt,
  }
  const classification = classifyModuleUpdate(installed, candidate)
  const approvalSnapshot = normalizeUpdateApprovalSnapshot(
    value.approvalSnapshot,
    candidate,
    classification,
  )
  const approvalStatus = expectedModuleUpdateApprovalStatus(
    classification,
    approvalSnapshot ? value.approvalStatus : 'pending',
    value.normalizedManifestDigest,
    value.approvedManifestDigest,
  )
  const update: ModuleUpdateMetadata = {
    ...candidate,
    approvalStatus,
    approvedManifestDigest: approvalStatus === 'approved'
      ? value.normalizedManifestDigest
      : null,
    approvalSnapshot: approvalStatus === 'approved' ? approvalSnapshot : null,
  }
  const expectedKeys = new Set([
    'candidateManifest',
    'candidateSourceUrl',
    'normalizedManifestDigest',
    'checkedAt',
    'approvalStatus',
    'approvedManifestDigest',
    'approvalSnapshot',
  ])
  return {
    update,
    changed: JSON.stringify(value.candidateManifest) !== JSON.stringify(manifestResult.manifest)
      || value.candidateSourceUrl !== candidateSourceUrl
      || value.approvalStatus !== approvalStatus
      || value.approvedManifestDigest !== update.approvedManifestDigest
      || JSON.stringify(value.approvalSnapshot) !== JSON.stringify(update.approvalSnapshot)
      || Object.keys(value).some(key => !expectedKeys.has(key)),
  }
}

function normalizeInstalledRecord(value: unknown): NormalizedRecord | null {
  if (!isRecord(value))
    return null
  const manifestResult = validateModuleManifest(value.manifest, { allowBuiltin: true })
  if (!manifestResult.ok)
    return null
  if (value.source !== 'seeded' && value.source !== 'user')
    return null
  if (manifestResult.manifest.runtime === 'builtin' && value.source !== 'seeded')
    return null
  if (typeof value.enabled !== 'boolean' || !isTimestamp(value.installedAt) || !isTimestamp(value.updatedAt))
    return null
  if (Date.parse(value.updatedAt) < Date.parse(value.installedAt))
    return null

  const contexts = normalizeGrantList<ModuleContextId>(value.grantedContexts, manifestResult.manifest.contexts)
  const contextFields = normalizeContextFieldGrants(
    value.grantedContextFields,
    manifestResult.manifest.context_fields,
    contexts.grants,
  )
  const grantedContexts = contextsWithFieldGrants(contexts.grants, contextFields.grants)
  const capabilities = normalizeGrantList<ModuleCapabilityId>(value.grantedCapabilities, manifestResult.manifest.capabilities)
  const sourceUrl = value.source === 'user' && manifestResult.manifest.runtime === 'remote-frame'
    ? normalizeUserSourceUrl(value.sourceUrl, manifestResult.manifest.entry_url)
    : undefined
  if (value.source === 'user' && !sourceUrl)
    return null

  const update = normalizeModuleUpdate(value.update, {
    manifest: manifestResult.manifest,
    source: value.source,
    ...(sourceUrl ? { sourceUrl } : {}),
    installedAt: value.installedAt,
  })

  return {
    record: {
      manifest: manifestResult.manifest,
      enabled: value.enabled,
      source: value.source,
      ...(sourceUrl ? { sourceUrl } : {}),
      grantedContexts,
      grantedContextFields: contextFields.grants,
      grantedCapabilities: capabilities.grants,
      update: update.update,
      installedAt: value.installedAt,
      updatedAt: value.updatedAt,
    },
    changed: contexts.changed
      || contextFields.changed
      || grantedContexts.length !== contexts.grants.length
      || capabilities.changed
      || update.changed
      || (value.source === 'seeded' && value.sourceUrl !== undefined)
      || sourceUrl !== value.sourceUrl,
  }
}

function createSeededRecord(seed: SeededModuleDefinition, timestamp: string): InstalledModuleRecord {
  const result = validateModuleManifest(seed.manifest, { allowBuiltin: true })
  if (!result.ok)
    throw new Error(`Invalid seeded module ${seed.manifest.id}: ${result.issues.join('; ')}`)

  const contexts = normalizeGrantList<ModuleContextId>(seed.grantedContexts, result.manifest.contexts).grants
  const contextFields = normalizeContextFieldGrants(
    seed.grantedContextFields,
    result.manifest.context_fields,
    contexts,
  ).grants
  const grantedContexts = contextsWithFieldGrants(contexts, contextFields)
  const capabilities = normalizeGrantList<ModuleCapabilityId>(seed.grantedCapabilities, result.manifest.capabilities).grants
  return {
    manifest: result.manifest,
    enabled: seed.enabled ?? true,
    source: 'seeded',
    grantedContexts,
    grantedContextFields: contextFields,
    grantedCapabilities: capabilities,
    update: null,
    installedAt: timestamp,
    updatedAt: timestamp,
  }
}

function updateSeededRecord(
  existing: InstalledModuleRecord,
  seed: SeededModuleDefinition,
  timestamp: string,
): NormalizedRecord {
  const current = createSeededRecord(seed, timestamp)
  const contexts = normalizeGrantList<ModuleContextId>(existing.grantedContexts, current.manifest.contexts)
  const contextFields = normalizeContextFieldGrants(
    existing.grantedContextFields,
    current.manifest.context_fields,
    contexts.grants,
  )
  const grantedContexts = contextsWithFieldGrants(contexts.grants, contextFields.grants)
  const capabilities = normalizeGrantList<ModuleCapabilityId>(existing.grantedCapabilities, current.manifest.capabilities)
  const manifestChanged = JSON.stringify(existing.manifest) !== JSON.stringify(current.manifest)
  const changed = manifestChanged
    || contexts.changed
    || contextFields.changed
    || grantedContexts.length !== contexts.grants.length
    || capabilities.changed
    || Boolean(existing.sourceUrl)
  const record: InstalledModuleRecord = {
    ...existing,
    manifest: current.manifest,
    source: 'seeded',
    grantedContexts,
    grantedContextFields: contextFields.grants,
    grantedCapabilities: capabilities.grants,
    update: manifestChanged ? null : existing.update,
    updatedAt: changed ? timestamp : existing.updatedAt,
  }
  delete record.sourceUrl

  return {
    record,
    changed,
  }
}

function cloneRecords(records: InstalledModuleRecord[]) {
  return structuredClone(records)
}

export class ModuleRegistry {
  private readonly storage: ModuleStorageArea
  private readonly seeds: SeededModuleDefinition[]
  private readonly now: () => string
  private operationQueue: Promise<void> = Promise.resolve()

  constructor({ storage, seeds = [], now = () => new Date().toISOString() }: ModuleRegistryOptions) {
    this.storage = storage
    this.seeds = seeds
    this.now = now
  }

  private runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationQueue.then(operation)
    this.operationQueue = result.then(() => undefined, () => undefined)
    return result
  }

  private async loadRecords(): Promise<InstalledModuleRecord[]> {
    const stored = await this.storage.get(MODULES_STORAGE_KEY)
    const rawRecords = stored[MODULES_STORAGE_KEY]
    const records: InstalledModuleRecord[] = []
    let changed = !Array.isArray(rawRecords)

    if (Array.isArray(rawRecords)) {
      for (const value of rawRecords) {
        const normalized = normalizeInstalledRecord(value)
        if (!normalized) {
          changed = true
          continue
        }
        if (records.some(record => record.manifest.id === normalized.record.manifest.id)) {
          changed = true
          continue
        }
        records.push(normalized.record)
        changed ||= normalized.changed
      }
    }

    const timestamp = this.now()
    for (const seed of this.seeds) {
      const existingIndex = records.findIndex(record => record.manifest.id === seed.manifest.id)
      if (existingIndex < 0) {
        records.push(createSeededRecord(seed, timestamp))
        changed = true
        continue
      }
      if (records[existingIndex].source !== 'seeded') {
        records.splice(existingIndex, 1, createSeededRecord(seed, timestamp))
        changed = true
      }
      else {
        const updated = updateSeededRecord(records[existingIndex], seed, timestamp)
        records[existingIndex] = updated.record
        changed ||= updated.changed
      }
    }

    if (changed)
      await this.storage.set({ [MODULES_STORAGE_KEY]: records })
    return records
  }

  list(): Promise<InstalledModuleRecord[]> {
    return this.runExclusive(async () => cloneRecords(await this.loadRecords()))
  }

  get(moduleId: string): Promise<InstalledModuleRecord | null> {
    return this.runExclusive(async () => {
      const records = await this.loadRecords()
      const record = records.find(record => record.manifest.id === moduleId)
      return record ? structuredClone(record) : null
    })
  }

  setModuleUpdateCandidate(
    expected: Pick<InstalledModuleRecord, 'manifest' | 'source' | 'sourceUrl' | 'update' | 'installedAt'>,
    candidate: ModuleUpdateCandidate | null,
  ): Promise<SetModuleUpdateCandidateResult> {
    return this.runExclusive(async () => {
      const records = await this.loadRecords()
      const recordIndex = records.findIndex(record => record.manifest.id === expected.manifest.id)
      if (recordIndex < 0)
        return { ok: false, changed: false, reason: 'not-found' }

      const current = records[recordIndex]
      if (current.source !== expected.source
        || current.sourceUrl !== expected.sourceUrl
        || current.installedAt !== expected.installedAt
        || JSON.stringify(current.manifest) !== JSON.stringify(expected.manifest)
        || JSON.stringify(current.update) !== JSON.stringify(expected.update)) {
        return { ok: false, changed: false, reason: 'installed-record-changed' }
      }

      if (candidate === null) {
        if (current.update === null)
          return { ok: true, changed: false, record: structuredClone(current) }
        const updated = { ...current, update: null }
        records[recordIndex] = updated
        await this.storage.set({ [MODULES_STORAGE_KEY]: records })
        return { ok: true, changed: true, record: structuredClone(updated) }
      }

      const sameCandidate = current.update !== null
        && current.update.normalizedManifestDigest === candidate.normalizedManifestDigest
        && JSON.stringify(current.update.candidateManifest) === JSON.stringify(candidate.candidateManifest)
      const normalized = normalizeModuleUpdate({
        ...candidate,
        approvalStatus: sameCandidate ? current.update?.approvalStatus : 'pending',
        approvedManifestDigest: sameCandidate ? current.update?.approvedManifestDigest : null,
        approvalSnapshot: sameCandidate ? current.update?.approvalSnapshot : null,
      }, current)
      if (!normalized.update)
        return { ok: false, changed: false, reason: 'invalid-candidate' }

      if (JSON.stringify(current.update) === JSON.stringify(normalized.update))
        return { ok: true, changed: false, record: structuredClone(current) }
      const updated = { ...current, update: normalized.update }
      records[recordIndex] = updated
      await this.storage.set({ [MODULES_STORAGE_KEY]: records })
      return { ok: true, changed: true, record: structuredClone(updated) }
    })
  }

  approveModuleUpdate(
    moduleId: string,
    expectedDigest: string,
    selection: ModuleUpdateApprovalSelection,
  ): Promise<ApproveModuleUpdateResult> {
    return this.runExclusive(async () => {
      const records = await this.loadRecords()
      const recordIndex = records.findIndex(record => record.manifest.id === moduleId)
      if (recordIndex < 0)
        return { ok: false, changed: false, reason: 'not-found' }

      const current = records[recordIndex]
      if (!current.update)
        return { ok: false, changed: false, reason: 'no-update-candidate' }
      if (!isNormalizedManifestDigest(expectedDigest)
        || current.update.normalizedManifestDigest !== expectedDigest) {
        return { ok: false, changed: false, reason: 'update-candidate-changed' }
      }

      const classification = classifyModuleUpdate(current, current.update)
      if (classification.outcome === 'safe')
        return { ok: false, changed: false, reason: 'update-approval-not-required' }
      if (classification.outcome === 'rejected')
        return { ok: false, changed: false, reason: 'update-rejected' }

      const normalizedSelection = normalizeUpdateApprovalSelection(selection, classification)
      if (!normalizedSelection)
        return { ok: false, changed: false, reason: 'invalid-update-approval' }
      const approvalSnapshot: ModuleUpdateApprovalSnapshot = {
        approvedManifestDigest: expectedDigest,
        approvedMatches: [...current.update.candidateManifest.matches],
        approvedActivation: current.update.candidateManifest.activation,
        ...normalizedSelection,
        approvedAt: this.now(),
      }
      const updated: InstalledModuleRecord = {
        ...current,
        update: {
          ...current.update,
          approvalStatus: 'approved',
          approvedManifestDigest: expectedDigest,
          approvalSnapshot,
        },
      }
      records[recordIndex] = updated
      await this.storage.set({ [MODULES_STORAGE_KEY]: records })
      return { ok: true, changed: true, record: structuredClone(updated) }
    })
  }

  applyModuleUpdate(
    expected: InstalledModuleRecord,
    candidate: ModuleUpdateCandidate,
  ): Promise<ApplyModuleUpdateResult> {
    return this.runExclusive(async () => {
      const records = await this.loadRecords()
      const recordIndex = records.findIndex(record => record.manifest.id === expected.manifest.id)
      if (recordIndex < 0)
        return { ok: false, changed: false, reason: 'not-found' }

      const current = records[recordIndex]
      if (JSON.stringify(current) !== JSON.stringify(expected))
        return { ok: false, changed: false, reason: 'installed-record-changed' }
      if (!current.update)
        return { ok: false, changed: false, reason: 'no-update-candidate' }

      const normalizedCandidate = normalizeModuleUpdate({
        ...candidate,
        approvalStatus: 'pending',
        approvedManifestDigest: null,
        approvalSnapshot: null,
      }, current).update
      if (!normalizedCandidate)
        return { ok: false, changed: false, reason: 'invalid-candidate' }
      if (normalizedCandidate.normalizedManifestDigest !== current.update.normalizedManifestDigest
        || JSON.stringify(normalizedCandidate.candidateManifest) !== JSON.stringify(current.update.candidateManifest)) {
        return { ok: false, changed: false, reason: 'update-candidate-changed' }
      }

      const classification = classifyModuleUpdate(current, normalizedCandidate)
      if (classification.outcome === 'rejected')
        return { ok: false, changed: false, reason: 'update-rejected' }

      let approvalSnapshot: ModuleUpdateApprovalSnapshot | null = null
      if (classification.outcome === 'approval-required') {
        approvalSnapshot = normalizeUpdateApprovalSnapshot(
          current.update.approvalSnapshot,
          normalizedCandidate,
          classification,
        )
        if (current.update.approvalStatus !== 'approved'
          || current.update.approvedManifestDigest !== normalizedCandidate.normalizedManifestDigest
          || !approvalSnapshot) {
          return { ok: false, changed: false, reason: 'update-approval-required' }
        }
      }

      const nextManifest = normalizedCandidate.candidateManifest
      const nextCapabilitySet = new Set<ModuleCapabilityId>(nextManifest.capabilities)
      const grantedContextFields: ModuleContextFieldGrants = {}
      for (const contextId of nextManifest.contexts) {
        const allowedFields = nextManifest.context_fields[contextId] || []
        const preserved = (current.grantedContextFields[contextId] || [])
          .filter(field => allowedFields.includes(field))
        const approved = approvalSnapshot?.approvedContextFields[contextId] || []
        const fields = [...new Set([...preserved, ...approved])]
        if (fields.length)
          grantedContextFields[contextId] = fields
      }
      const grantedContexts = contextsWithFieldGrants(nextManifest.contexts, grantedContextFields)
      const preservedCapabilities = current.grantedCapabilities
        .filter(capability => nextCapabilitySet.has(capability))
      const grantedCapabilities = [...new Set([
        ...preservedCapabilities,
        ...(approvalSnapshot?.approvedCapabilities || []),
      ])]
      const updated: InstalledModuleRecord = {
        ...current,
        manifest: nextManifest,
        grantedContexts,
        grantedContextFields,
        grantedCapabilities,
        update: null,
        updatedAt: this.now(),
      }
      records[recordIndex] = updated
      await this.storage.set({ [MODULES_STORAGE_KEY]: records })
      return { ok: true, changed: true, record: structuredClone(updated) }
    })
  }

  installUserModule(input: InstallUserModuleInput): Promise<InstallUserModuleResult> {
    return this.runExclusive(async () => {
      const manifestResult = validateModuleManifest(input.manifest)
      if (!manifestResult.ok || manifestResult.manifest.runtime !== 'remote-frame')
        return { ok: false, changed: false, reason: 'invalid-manifest' }

      const sourceUrl = normalizeUserSourceUrl(input.sourceUrl, manifestResult.manifest.entry_url)
      if (!sourceUrl)
        return { ok: false, changed: false, reason: 'invalid-source-url' }

      const records = await this.loadRecords()
      if (records.some(record => record.manifest.id === manifestResult.manifest.id))
        return { ok: false, changed: false, reason: 'already-installed' }

      const requestedContexts = manifestResult.manifest.contexts.filter(contextId => (
        Array.isArray(input.grantedContextFields[contextId])
      ))
      const contextFields = normalizeContextFieldGrants(
        input.grantedContextFields,
        manifestResult.manifest.context_fields,
        requestedContexts,
      ).grants
      const grantedContexts = contextsWithFieldGrants(requestedContexts, contextFields)
      const grantedCapabilities = normalizeGrantList<ModuleCapabilityId>(
        input.grantedCapabilities,
        manifestResult.manifest.capabilities,
      ).grants
      const timestamp = this.now()
      const record: InstalledModuleRecord = {
        manifest: manifestResult.manifest,
        enabled: true,
        source: 'user',
        sourceUrl,
        grantedContexts,
        grantedContextFields: contextFields,
        grantedCapabilities,
        update: null,
        installedAt: timestamp,
        updatedAt: timestamp,
      }
      records.push(record)
      await this.storage.set({ [MODULES_STORAGE_KEY]: records })
      return { ok: true, changed: true, record: structuredClone(record) }
    })
  }

  setEnabled(moduleId: string, enabled: boolean): Promise<SetModuleEnabledResult> {
    return this.runExclusive(async () => {
      const records = await this.loadRecords()
      const recordIndex = records.findIndex(record => record.manifest.id === moduleId)
      if (recordIndex < 0)
        return { ok: false, changed: false, reason: 'not-found' }

      const current = records[recordIndex]
      if (current.enabled === enabled)
        return { ok: true, changed: false, record: structuredClone(current) }

      const updated: InstalledModuleRecord = {
        ...current,
        enabled,
        updatedAt: this.now(),
      }
      records[recordIndex] = updated
      await this.storage.set({ [MODULES_STORAGE_KEY]: records })
      return { ok: true, changed: true, record: structuredClone(updated) }
    })
  }

  setCapabilityGrant(
    moduleId: string,
    capability: ModuleCapabilityId,
    granted: boolean,
  ): Promise<SetModuleCapabilityGrantResult> {
    return this.runExclusive(async () => {
      const records = await this.loadRecords()
      const recordIndex = records.findIndex(record => record.manifest.id === moduleId)
      if (recordIndex < 0)
        return { ok: false, changed: false, reason: 'not-found' }

      const current = records[recordIndex]
      const declaredCapabilities = new Set<ModuleCapabilityId>(current.manifest.capabilities)
      if (!declaredCapabilities.has(capability))
        return { ok: false, changed: false, reason: 'capability-not-declared' }

      const currentlyGranted = current.grantedCapabilities.includes(capability)
      if (currentlyGranted === granted)
        return { ok: true, changed: false, record: structuredClone(current) }

      const updated: InstalledModuleRecord = {
        ...current,
        grantedCapabilities: granted
          ? [...current.grantedCapabilities, capability]
          : current.grantedCapabilities.filter(candidate => candidate !== capability),
        updatedAt: this.now(),
      }
      records[recordIndex] = updated
      await this.storage.set({ [MODULES_STORAGE_KEY]: records })
      return { ok: true, changed: true, record: structuredClone(updated) }
    })
  }

  removeUserModule(moduleId: string): Promise<RemoveUserModuleResult> {
    return this.runExclusive(async () => {
      const records = await this.loadRecords()
      const recordIndex = records.findIndex(record => record.manifest.id === moduleId)
      if (recordIndex < 0)
        return { ok: false, changed: false, reason: 'not-found' }

      const current = records[recordIndex]
      if (current.source === 'seeded')
        return { ok: false, changed: false, reason: 'protected-seed' }

      records.splice(recordIndex, 1)
      await this.storage.set({ [MODULES_STORAGE_KEY]: records })
      return { ok: true, changed: true, removed: structuredClone(current) }
    })
  }
}
