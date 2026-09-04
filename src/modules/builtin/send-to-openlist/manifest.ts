import type { SeededModuleDefinition } from '../../types'
import {
  SEND_TO_OPENLIST_CAPABILITY,
  SEND_TO_OPENLIST_ENTRY_ID,
  SEND_TO_OPENLIST_MODULE_ID,
} from './contracts'

export function createSendToOpenListSeed(): SeededModuleDefinition {
  return {
    manifest: {
      manifest_version: 1,
      runtime: 'builtin',
      id: SEND_TO_OPENLIST_MODULE_ID,
      name: 'Send to OpenList',
      version: '0.1.0',
      description: 'Review resource URLs and send them to one approved OpenList or AList service',
      icon_path: '/assets/icon-128.png',
      entry_id: SEND_TO_OPENLIST_ENTRY_ID,
      matches: [],
      contexts: [],
      context_fields: {},
      capabilities: [SEND_TO_OPENLIST_CAPABILITY],
      activation: 'manual',
      min_host_version: '0.0.1',
    },
    enabled: false,
    grantedContexts: [],
    grantedContextFields: {},
    grantedCapabilities: [],
  }
}
