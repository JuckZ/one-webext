import type { SeededModuleDefinition } from '../../types'
import {
  BOOKMARK_DOCTOR_ENTRY_ID,
  BOOKMARK_DOCTOR_MODULE_ID,
} from './contracts'

export function createBookmarkDoctorSeed(): SeededModuleDefinition {
  return {
    manifest: {
      manifest_version: 1,
      runtime: 'builtin',
      id: BOOKMARK_DOCTOR_MODULE_ID,
      name: 'Bookmark Doctor',
      version: '0.2.0',
      description: 'Local, private bookmark diagnostics',
      icon_path: '/assets/icon-128.png',
      entry_id: BOOKMARK_DOCTOR_ENTRY_ID,
      matches: [],
      contexts: [],
      context_fields: {},
      capabilities: ['bookmarks.read', 'bookmarks.write'],
      activation: 'manual',
      min_host_version: '0.0.1',
    },
    enabled: false,
    grantedContexts: [],
    grantedContextFields: {},
    grantedCapabilities: [],
  }
}
