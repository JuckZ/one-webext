import type { ModuleContextFieldGrants } from './types'

export {
  isModuleContextField,
  moduleContextFieldIds,
} from '@oneweb/module-sdk'

export function cloneContextFieldGrants(value: ModuleContextFieldGrants): ModuleContextFieldGrants {
  return Object.fromEntries(
    Object.entries(value).map(([contextId, fields]) => [contextId, [...fields]]),
  )
}
