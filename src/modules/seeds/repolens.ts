import { REPOLENS_ORIGIN } from '~/repolens/config'
import {
  ONEWEB_MODULE_MANIFEST_VERSION,
  ONEWEB_MODULE_PROTOCOL,
  ONEWEB_MODULE_PROTOCOL_VERSION,
  type SeededModuleDefinition,
} from '../types'

export function createRepoLensSeed(origin: string = REPOLENS_ORIGIN): SeededModuleDefinition {
  const normalizedOrigin = new URL(origin).origin
  return {
    manifest: {
      manifest_version: ONEWEB_MODULE_MANIFEST_VERSION,
      runtime: 'remote-frame',
      id: 'dev.juck.repolens',
      name: 'RepoLens',
      version: '0.1.0',
      description: 'GitHub repository intelligence',
      icon_url: `${normalizedOrigin}/favicon.ico`,
      entry_url: `${normalizedOrigin}/embed`,
      matches: ['https://github.com/*/*'],
      contexts: ['github.repository'],
      context_fields: {
        'github.repository': ['repo', 'url', 'pageType'],
      },
      capabilities: [],
      activation: 'manual',
      min_host_version: '0.0.1',
      bridge: {
        protocol: ONEWEB_MODULE_PROTOCOL,
        version: ONEWEB_MODULE_PROTOCOL_VERSION,
      },
    },
    grantedContexts: ['github.repository'],
    grantedContextFields: {
      'github.repository': ['repo', 'url', 'pageType'],
    },
    grantedCapabilities: [],
  }
}
