import type { ProtocolWithReturn } from 'webext-bridge'

declare module 'webext-bridge' {
  export interface ProtocolMap {
    // define message protocol types
    // see https://github.com/antfu/webext-bridge#type-safe-protocols
    'tab-prev': { title: string | undefined }
    'on-bg-event': { message: string, params: any }
    'console-log': { message: string }
    'get-current-tab': ProtocolWithReturn<{ tabId: number }, { title?: string }>
  }
}

declare module 'webextension-polyfill' {
  namespace Manifest {
    interface WebExtensionManifest {
      // FIXME for chrome now
      side_panel?: {
        default_path: string
      }
    }
  }
}
