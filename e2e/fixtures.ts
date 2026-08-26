import type { Manifest } from 'webextension-polyfill'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { test as base, type BrowserContext, chromium } from '@playwright/test'
import fs from 'fs-extra'

const currentDir = path.dirname(fileURLToPath(import.meta.url))

export const extensionPath = process.env.EXTENSION_PATH || path.join(currentDir, '../artifacts/chromium')

export const test = base.extend<{
  context: BrowserContext
  extensionId: string
}>({
  context: async ({ headless }, use) => {
    const context = await chromium.launchPersistentContext('', {
      headless,
      ...(process.env.PW_BROWSER_CHANNEL ? { channel: process.env.PW_BROWSER_CHANNEL as 'chrome' | 'msedge' } : {}),
      args: [
        ...(headless ? ['--headless=new'] : []),
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
      ],
    })
    await use(context)
    await context.close()
  },
  extensionId: async ({ context }, use) => {
    // for manifest v3:
    let [background] = context.serviceWorkers()
    if (!background)
      background = await context.waitForEvent('serviceworker')

    const extensionId = background.url().split('/')[2]
    await use(extensionId)
  },
})

export const expect = test.expect

export function isDevArtifact() {
  const manifest: Manifest.WebExtensionManifest = fs.readJsonSync(path.resolve(extensionPath, 'manifest.json'))
  return Boolean(
    typeof manifest.content_security_policy === 'object'
    && manifest.content_security_policy.extension_pages?.includes('localhost'),
  )
}
