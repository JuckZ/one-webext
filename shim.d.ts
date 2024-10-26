import type { ProtocolWithReturn } from 'webext-bridge'

declare module 'webext-bridge' {
  export interface ProtocolMap {
    // define message protocol types
    // see https://github.com/antfu/webext-bridge#type-safe-protocols
    'tab-prev': { title: string | undefined }
    'get-current-tab': ProtocolWithReturn<{ tabId: number }, { title?: string }>
  }
}

declare module 'webextension-polyfill' {
  // FIXME for chrome now
  declare const sidePanel = {
    setOptions: ({ tabId, windowId, path, enable }: { tabId?: number; path?: string; enabled?: boolean; }) => {},
    open: (options: OpenOptions, callback?: function) => {},
  }
  namespace Manifest {
    interface WebExtensionManifest {
      // FIXME for chrome now
      side_panel: {
        default_path: string
      }
    }
  }
}
