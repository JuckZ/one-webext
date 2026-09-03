import type {
  CapabilityRpcErrorCode,
  CapabilityRpcResultPayload,
  CapabilityRpcSessionBinding,
  StorageModuleCatalog,
  StorageModuleDocument,
  StorageModuleOperation,
  StorageModuleRequest,
} from '@oneweb/module-sdk'
import type { ModuleRegistry } from './registry'
import {
  createCapabilityRpcLifecycleState,
  createStorageModuleRevision,
  createStorageModuleState,
  isStorageModuleRevision,
  reduceStorageModuleState,
  STORAGE_MODULE_REVISION_ENTROPY_BYTES,
  validateStorageModuleDocument,
  validateStorageModuleRequestEnvelope,
} from '@oneweb/module-sdk'

export const STORAGE_MODULE_DOCUMENT_STORAGE_PREFIX = 'oneweb.remote-storage.v1:' as const
export const STORAGE_MODULE_STORED_SCHEMA_VERSION = 1 as const

export interface StorageModuleStorageArea {
  get: (_key: string) => Promise<Record<string, unknown>>
  set: (_items: Record<string, unknown>) => Promise<void>
  remove: (_key: string) => Promise<void>
}

export type StorageModuleAdapterResult<Result = unknown> =
  | { readonly ok: true, readonly result: Result }
  | { readonly ok: false, readonly code: CapabilityRpcErrorCode }

type StorageModuleAdapterOperationResult<Operation extends StorageModuleOperation> = CapabilityRpcResultPayload<
  StorageModuleCatalog,
  'storage.module',
  Operation
>

interface ActiveStorageModuleSession {
  readonly binding: CapabilityRpcSessionBinding
  readonly installationId: string
}

interface StoredStorageModuleDocument {
  readonly schemaVersion: typeof STORAGE_MODULE_STORED_SCHEMA_VERSION
  readonly installationId: string
  readonly revision: string
  readonly document: StorageModuleDocument
}

export interface StorageModuleAdapterOptions {
  readonly registry: ModuleRegistry
  readonly storage: StorageModuleStorageArea
  readonly entropy?: () => Uint8Array
}

function sameBinding(left: CapabilityRpcSessionBinding, right: CapabilityRpcSessionBinding) {
  return left.moduleId === right.moduleId
    && left.sessionId === right.sessionId
    && left.generation === right.generation
}

function failure(code: CapabilityRpcErrorCode): StorageModuleAdapterResult<never> {
  return Object.freeze({ ok: false, code })
}

function success<Result>(result: Result): StorageModuleAdapterResult<Result> {
  return Object.freeze({ ok: true, result })
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function exactStoredRecord(value: unknown) {
  if (!isPlainRecord(value))
    return null
  const keys = Reflect.ownKeys(value)
  const expected = ['schemaVersion', 'installationId', 'revision', 'document']
  if (keys.length !== expected.length
    || keys.some(key => typeof key !== 'string' || !expected.includes(key))) {
    return null
  }
  const record: Record<string, unknown> = {}
  for (const key of keys as string[]) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor))
      return null
    record[key] = descriptor.value
  }
  return record
}

export function getStorageModuleDocumentStorageKey(moduleId: string) {
  const binding = createCapabilityRpcLifecycleState({
    moduleId,
    sessionId: 'storage-key-validation-session',
    generation: 1,
  }).binding
  return `${STORAGE_MODULE_DOCUMENT_STORAGE_PREFIX}${encodeURIComponent(binding.moduleId)}`
}

export class StorageModuleAdapter {
  private readonly registry: ModuleRegistry
  private readonly storage: StorageModuleStorageArea
  private readonly entropy: () => Uint8Array
  private readonly sessions = new Map<string, ActiveStorageModuleSession>()
  private readonly queues = new Map<string, Promise<void>>()

  constructor({
    registry,
    storage,
    entropy = () => crypto.getRandomValues(new Uint8Array(STORAGE_MODULE_REVISION_ENTROPY_BYTES)),
  }: StorageModuleAdapterOptions) {
    this.registry = registry
    this.storage = storage
    this.entropy = entropy
  }

  async openSession(binding: CapabilityRpcSessionBinding): Promise<StorageModuleAdapterResult<null>> {
    let canonical: CapabilityRpcSessionBinding
    try {
      canonical = createCapabilityRpcLifecycleState(binding).binding
    }
    catch {
      return failure('SESSION_MISMATCH')
    }
    return this.runExclusive(canonical.moduleId, async () => {
      const authorization = await this.authorize(canonical.moduleId)
      if (!authorization.ok)
        return authorization
      this.sessions.set(canonical.moduleId, Object.freeze({
        binding: canonical,
        installationId: authorization.installationId,
      }))
      return success(null)
    })
  }

  async closeSession(binding: CapabilityRpcSessionBinding) {
    let canonical: CapabilityRpcSessionBinding
    try {
      canonical = createCapabilityRpcLifecycleState(binding).binding
    }
    catch {
      return false
    }
    return this.runExclusive(canonical.moduleId, async () => {
      const current = this.sessions.get(canonical.moduleId)
      if (!current || !sameBinding(current.binding, canonical))
        return false
      this.sessions.delete(canonical.moduleId)
      return true
    })
  }

  async execute<Operation extends StorageModuleOperation>(
    binding: CapabilityRpcSessionBinding,
    request: StorageModuleRequest<Operation>,
  ): Promise<StorageModuleAdapterResult<StorageModuleAdapterOperationResult<Operation>>> {
    let canonical: CapabilityRpcSessionBinding
    try {
      canonical = createCapabilityRpcLifecycleState(binding).binding
    }
    catch {
      return failure('SESSION_MISMATCH')
    }
    return this.runExclusive(canonical.moduleId, async () => {
      const current = this.sessions.get(canonical.moduleId)
      if (!current)
        return failure('SESSION_DESTROYED')
      if (!sameBinding(current.binding, canonical))
        return failure('SESSION_MISMATCH')

      const validated = validateStorageModuleRequestEnvelope(request, canonical)
      if (!validated.ok)
        return failure(validated.code)
      const authorization = await this.authorize(canonical.moduleId)
      if (!authorization.ok) {
        this.sessions.delete(canonical.moduleId)
        return authorization
      }
      if (authorization.installationId !== current.installationId) {
        this.sessions.delete(canonical.moduleId)
        return failure('SESSION_DESTROYED')
      }

      try {
        const stored = await this.readStored(canonical.moduleId, current.installationId)
        if (!stored.ok)
          return stored
        const state = createStorageModuleState(
          canonical,
          stored.result.revision,
          stored.result.document,
        )
        const transition = reduceStorageModuleState(state, validated.value.operation === 'read'
          ? { type: 'read', request: validated.value }
          : validated.value.operation === 'replace'
            ? {
                type: 'replace',
                request: validated.value,
                nextRevision: this.nextRevision(stored.result.revision),
              }
            : {
                type: 'clear',
                request: validated.value,
                nextRevision: this.nextRevision(stored.result.revision),
              })
        if (!transition.ok)
          return failure(transition.code)
        if (validated.value.operation !== 'read') {
          await this.storage.set({
            [getStorageModuleDocumentStorageKey(canonical.moduleId)]: this.storedRecord(
              current.installationId,
              transition.state.revision,
              transition.state.document,
            ),
          })
        }
        if (transition.result === null)
          return failure('OPERATION_FAILED')
        return success(transition.result as StorageModuleAdapterOperationResult<Operation>)
      }
      catch {
        return failure('OPERATION_FAILED')
      }
    })
  }

  async handleInstalledRecordChanged(moduleId: string) {
    return this.runExclusive(moduleId, async () => {
      const current = this.sessions.get(moduleId)
      if (!current)
        return false
      const authorization = await this.authorize(moduleId)
      if (authorization.ok && authorization.installationId === current.installationId)
        return false
      this.sessions.delete(moduleId)
      return true
    })
  }

  async removeInstalledRecord(moduleId: string) {
    return this.runExclusive(moduleId, async () => {
      this.sessions.delete(moduleId)
      await this.storage.remove(getStorageModuleDocumentStorageKey(moduleId))
    })
  }

  private async authorize(moduleId: string) {
    const record = await this.registry.get(moduleId)
    if (!record || !record.enabled)
      return { ok: false, code: 'SESSION_DESTROYED' } as const
    if (!record.manifest.capabilities.includes('storage.module')
      || !record.grantedCapabilities.includes('storage.module')) {
      return { ok: false, code: 'CAPABILITY_NOT_ALLOWED' } as const
    }
    return { ok: true, installationId: record.installedAt } as const
  }

  private async readStored(moduleId: string, installationId: string) {
    const key = getStorageModuleDocumentStorageKey(moduleId)
    const stored = await this.storage.get(key)
    if (!Object.hasOwn(stored, key)) {
      const initial = this.storedRecord(installationId, this.nextRevision(), null)
      await this.storage.set({ [key]: initial })
      return success(initial)
    }
    const raw = exactStoredRecord(stored[key])
    if (!raw)
      return failure('OPERATION_FAILED')
    if (raw.installationId !== installationId) {
      const initial = this.storedRecord(installationId, this.nextRevision(), null)
      await this.storage.set({ [key]: initial })
      return success(initial)
    }
    const document = validateStorageModuleDocument(raw.document)
    if (raw.schemaVersion !== STORAGE_MODULE_STORED_SCHEMA_VERSION
      || !isStorageModuleRevision(raw.revision)
      || !document.ok) {
      return failure('OPERATION_FAILED')
    }
    return success(this.storedRecord(installationId, raw.revision, document.value))
  }

  private storedRecord(
    installationId: string,
    revision: string,
    document: StorageModuleDocument,
  ): StoredStorageModuleDocument {
    return Object.freeze({
      schemaVersion: STORAGE_MODULE_STORED_SCHEMA_VERSION,
      installationId,
      revision,
      document,
    })
  }

  private nextRevision(current?: string) {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const revision = createStorageModuleRevision(this.entropy())
      if (revision !== current)
        return revision
    }
    throw new Error('storage revision source repeated the current revision')
  }

  private runExclusive<Result>(moduleId: string, operation: () => Promise<Result>): Promise<Result> {
    const previous = this.queues.get(moduleId) || Promise.resolve()
    const result = previous.then(operation)
    const tail = result.then(() => undefined, () => undefined)
    this.queues.set(moduleId, tail)
    void tail.finally(() => {
      if (this.queues.get(moduleId) === tail)
        this.queues.delete(moduleId)
    })
    return result
  }
}
