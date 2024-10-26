import type { Manifest } from 'webextension-polyfill'
import type PkgType from '../package.json'
import fs from 'fs-extra'
import { isDev, isFirefox, port, r } from '../scripts/utils'

export async function getManifest() {
  const pkg = await fs.readJSON(r('package.json')) as typeof PkgType
  const ModifierKey = 'Alt+Shift'

  // update this file to update this manifest.json
  // can also be conditional based on your need

  const manifest: Manifest.WebExtensionManifest = {
    manifest_version: 3,
    name: pkg.displayName || pkg.name,
    version: pkg.version,
    description: pkg.description,
    author: pkg.author.name,
    homepage_url: pkg.homepage,
    declarative_net_request: {
      rule_resources: [],
    },
    action: {
      default_icon: './assets/icon-512.png',
      default_popup: './dist/popup/index.html',
    },
    options_ui: {
      page: './dist/options/index.html',
      open_in_tab: true,
    },
    chrome_url_overrides: {
      newtab: './dist/home/index.html',
    },
    side_panel: {
      default_path: './dist/sidebar/index.html',
    },
    background: isFirefox
      ? {
          service_worker: './dist/background/index.mjs',
          type: 'module',
        }
      : {
          service_worker: './dist/background/index.mjs',
        },
    devtools_page: './dist/devtools/index.html',
    icons: {
      16: './assets/icon-512.png',
      48: './assets/icon-512.png',
      128: './assets/icon-512.png',
    },
    permissions: [
      'activeTab',
      'alarms',
      'background',
      'bookmarks',
      'browsingData',
      // 'certificateProvider',
      'clipboardRead',
      'clipboardWrite',
      'contentSettings',
      'contextMenus',
      'cookies',
      'debugger',
      'declarativeContent',
      'webRequest',
      'declarativeNetRequest',
      'declarativeNetRequestWithHostAccess',
      'declarativeNetRequestFeedback',
      'desktopCapture',
      // 'documentScan',
      'downloads',
      'downloads.open',
      'downloads.ui',
      // 'enterprise.deviceAttributes',
      // 'enterprise.hardwarePlatform',
      // 'enterprise.networkingAttributes',
      // 'enterprise.platformKeys',
      // 'experimental',
      // 'fileBrowserHandler',
      // 'fileSystemProvider',
      'fontSettings',
      'gcm',
      'geolocation',
      'history',
      'identity',
      'idle',
      // 'loginState',
      'management',
      'nativeMessaging',
      'notifications',
      'offscreen',
      'pageCapture',
      // 'platformKeys',
      'power',
      'printerProvider',
      // 'printing',
      // 'printingMetrics',
      'privacy',
      // 'processes',
      'proxy',
      'scripting',
      'search',
      'sessions',
      'sidePanel',
      'storage',
      'system.cpu',
      'system.display',
      'system.memory',
      'system.storage',
      'tabCapture',
      'tabGroups',
      'tabs',
      'topSites',
      'tts',
      'ttsEngine',
      'unlimitedStorage',
      // 'vpnProvider',
      // 'wallpaper',
      'webAuthenticationProxy',
      'webNavigation',

    ],
    commands: {
      switchToLeftTab: {
        suggested_key: {
          default: `${ModifierKey}+E`,
        },
        description: 'Switch to the left tab',
      },
      reloadThisExtension: {
        suggested_key: {
          default: `${ModifierKey}+D`,
        },
        description: 'Reload this extensions',
      },
      wsInspector: {
        suggested_key: {
          default: `${ModifierKey}+W`,
        },
        description: 'Open WebSocket Inspector',
      },
    },
    host_permissions: ['*://*/*'],
    content_scripts: [
      {
        matches: [
          '<all_urls>',
        ],
        js: [
          'dist/contentScripts/index.global.js',
        ],
        run_at: 'document_start', // Defaults to "document_idle"
        all_frames: true,
      },
    ],
    web_accessible_resources: [
      {
        resources: ['dist/contentScripts/style.css', 'dist/assets/*'],
        matches: ['<all_urls>'],
      },
    ],
    content_security_policy: {
      extension_pages: isDev
        // this is required on dev for Vite script to load
        ? `script-src \'self\' http://localhost:${port}; object-src \'self\'`
        : 'script-src \'self\'; object-src \'self\'',
    },
  }

  // add sidepanel
  if (isFirefox) {
    manifest.sidebar_action = {
      default_panel: 'dist/sidebar/index.html',
    }
  }
  else {
    // the sidebar_action does not work for chromium based
    (manifest as any).side_panel = {
      default_path: 'dist/sidebar/index.html',
    }
  }

  // FIXME: not work in MV3

  if (isDev && false) {
    // for content script, as browsers will cache them for each reload,
    // we use a background script to always inject the latest version
    // see src/background/contentScriptHMR.ts
    delete manifest.content_scripts
    manifest.permissions?.push('webNavigation')
  }

  return manifest
}
