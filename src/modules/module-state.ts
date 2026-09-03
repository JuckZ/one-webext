export const MODULE_LOCAL_STATE_STORAGE_PREFIX = 'oneweb.module-state.v1:' as const

export interface ModuleLocalStateStorageArea {
  get: (_key: string) => Promise<Record<string, unknown>>
  set: (_items: Record<string, unknown>) => Promise<void>
}

export function getModuleLocalStateStorageKey(moduleId: string) {
  const normalized = moduleId.trim()
  if (!normalized || normalized.length > 128)
    throw new TypeError('moduleId must be between 1 and 128 characters')
  return `${MODULE_LOCAL_STATE_STORAGE_PREFIX}${encodeURIComponent(normalized)}`
}

export class ModuleLocalStateStore<T> {
  readonly storageKey: string
  private readonly storage: ModuleLocalStateStorageArea

  constructor(storage: ModuleLocalStateStorageArea, moduleId: string) {
    this.storage = storage
    this.storageKey = getModuleLocalStateStorageKey(moduleId)
  }

  async read(): Promise<T | null> {
    const stored = await this.storage.get(this.storageKey)
    if (!Object.hasOwn(stored, this.storageKey))
      return null
    const value = stored[this.storageKey]
    return value === undefined ? null : structuredClone(value) as T
  }

  async write(value: T): Promise<void> {
    await this.storage.set({ [this.storageKey]: structuredClone(value) })
  }
}
