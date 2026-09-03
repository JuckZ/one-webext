import type { SeededModuleDefinition } from '../../types'
import { PAGE_TOOLBOX_ENTRY_ID, PAGE_TOOLBOX_MODULE_ID } from './contracts'

export function createPageToolboxSeed(): SeededModuleDefinition {
  return {
    manifest: {
      manifest_version: 1,
      runtime: 'builtin',
      id: PAGE_TOOLBOX_MODULE_ID,
      name: 'Page Toolbox',
      version: '0.1.0',
      description: 'Explicit, reversible tools for the current website',
      icon_path: '/assets/icon-128.png',
      entry_id: PAGE_TOOLBOX_ENTRY_ID,
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
