import type { SeededModuleDefinition } from '../../types'
import { BROWSER_JOURNAL_ENTRY_ID, BROWSER_JOURNAL_MODULE_ID } from './contracts'

export function createBrowserJournalSeed(): SeededModuleDefinition {
  return {
    manifest: {
      manifest_version: 1,
      runtime: 'builtin',
      id: BROWSER_JOURNAL_MODULE_ID,
      name: 'Browser Journal',
      version: '0.1.0',
      description: 'Record one explicit, private browsing session in memory',
      icon_path: '/assets/icon-128.png',
      entry_id: BROWSER_JOURNAL_ENTRY_ID,
      matches: [],
      contexts: [],
      context_fields: {},
      capabilities: [],
      activation: 'manual',
      min_host_version: '0.0.1',
    },
    enabled: false,
    grantedContexts: [],
    grantedContextFields: {},
    grantedCapabilities: [],
  }
}
