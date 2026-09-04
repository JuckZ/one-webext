import type { Manifest } from 'webextension-polyfill'
import type PkgType from '../package.json'
import fs from 'fs-extra'
import { isDev, isFirefox, port, r } from '../scripts/utils'

/**
 * Generates the browser extension's Manifest V3 configuration from package metadata and build settings.
 *
 * @returns The generated browser extension manifest
 */
export async function getManifest() {
  const pkg = await fs.readJSON(r('package.json')) as typeof PkgType
  const repolensOrigin = 'http://127.0.0.1:4747'

  // update this file to update this manifest.json
  // can also be conditional based on your need

  const manifest: Manifest.WebExtensionManifest = {
    manifest_version: 3,
    name: pkg.displayName || pkg.name,
    version: pkg.version,
    description: pkg.description,
    author: pkg.author.name,
    homepage_url: pkg.homepage,
    action: {
      default_icon: './assets/icon-128.png',
    },
    side_panel: {
      default_path: './dist/sidebar/index.html',
    },
    background: isFirefox
      ? {
          scripts: ['./dist/background/index.mjs'],
          type: 'module',
        }
      : {
          service_worker: './dist/background/index.mjs',
          type: 'module',
        },
    icons: {
      16: './assets/icon-16.png',
      48: './assets/icon-48.png',
      128: './assets/icon-128.png',
    },
    permissions: [
      'activeTab',
      'contextMenus',
      'scripting',
      'storage',
      'tabs',
      ...(isFirefox ? [] : ['sidePanel']),
    ],
    optional_permissions: ['bookmarks'],
    host_permissions: [
      'https://github.com/*',
      `${repolensOrigin}/*`,
    ],
    optional_host_permissions: [
      'https://*/*',
      'http://*/*',
    ],
    content_scripts: [
      {
        matches: [
          'https://github.com/*',
        ],
        js: [
          'dist/contentScripts/index.global.js',
        ],
        run_at: 'document_idle',
        all_frames: false,
      },
    ],
    web_accessible_resources: [
      {
        resources: ['dist/contentScripts/style.css', 'dist/assets/*'],
        matches: ['https://github.com/*'],
      },
    ],
    content_security_policy: {
      extension_pages: isDev
        // this is required on dev for Vite script to load
        ? `script-src 'self' http://localhost:${port}; object-src 'self'; frame-src ${repolensOrigin} https: http://localhost:* http://127.0.0.1:*; connect-src https: http:`
        : `script-src 'self'; object-src 'self'; frame-src ${repolensOrigin} https: http://localhost:* http://127.0.0.1:*; connect-src https: http:`,
    },
    browser_specific_settings: {
      gecko: {
        id: 'one-web@juckz.local',
        strict_min_version: '121.0',
      },
    },
  }

  // add sidepanel
  if (isFirefox) {
    delete manifest.side_panel
    manifest.sidebar_action = {
      default_panel: 'dist/sidebar/index.html',
      default_title: 'OneWeb',
      default_icon: './assets/icon-128.png',
    }
  }
  else {
    // the sidebar_action does not work for chromium based
    (manifest as any).side_panel = {
      default_path: 'dist/sidebar/index.html',
    }
  }

  return manifest
}
