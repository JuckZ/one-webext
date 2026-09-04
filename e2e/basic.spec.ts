import type { BrowserContext, FrameLocator, Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { expect, extensionPath, test } from './fixtures'

const browserLabel = process.env.PW_BROWSER_CHANNEL === 'msedge' ? 'edge' : (process.env.PW_BROWSER_CHANNEL === 'chrome' ? 'chrome' : 'chromium')
const reportScreenshot = path.resolve(process.cwd(), 'test-results', `oneweb-${browserLabel}-side-panel.png`)

interface RpcFixtureBrowserApi {
  beginHold: (_marker?: string) => Promise<string>
  cancelHeld: () => Promise<string>
  heldStatus: () => Promise<string>
  runCancel: () => Promise<string>
  runFailure: () => Promise<string>
  runFlood: () => Promise<string>
  runSuccess: (_marker: string) => Promise<{ requestId: string, result: string }>
}

interface RpcHostBrowserApi {
  forge: (_key: 'alpha' | 'beta') => boolean
  info: (_key: 'alpha' | 'beta') => {
    aborts: number
    generation: number
    hasPort: boolean
    lastRequestId: string | null
    moduleId: string
  }
  reload: (_key: 'alpha' | 'beta') => boolean
  remove: (_key: 'alpha' | 'beta') => boolean
  replay: (_key: 'alpha' | 'beta') => boolean
}

interface StorageModuleFixtureResult {
  code?: string
  ok: boolean
  requestId?: string
  result?: {
    document?: unknown
    revision: string
  }
}

interface StorageModuleFixtureBrowserApi {
  clear: (_expectedRevision: string) => Promise<StorageModuleFixtureResult>
  info: () => { extensionRuntime: boolean, moduleId: string, status: string }
  read: () => Promise<StorageModuleFixtureResult>
  replace: (_expectedRevision: string, _document: unknown) => Promise<StorageModuleFixtureResult>
}

async function openManagementPanel(context: BrowserContext, extensionId: string) {
  const panel = await context.newPage()
  await panel.setViewportSize({ width: 420, height: 900 })
  await panel.goto(`chrome-extension://${extensionId}/dist/sidebar/index.html`)
  await panel.getByTestId('manage-modules').click()
  await expect(panel.getByTestId('module-manager')).toBeVisible()
  return panel
}

async function installFixtureModule(
  panel: Page,
  manifestUrl: string,
  moduleId = 'dev.juck.installable',
) {
  await panel.getByTestId('add-module').click()
  await panel.locator('[data-manifest-url]').fill(manifestUrl)
  await panel.locator('[data-prepare-install]').click()
  await expect(panel.locator('[data-install-review]')).toBeVisible()
  await panel.locator('[data-confirm-install]').click()
  const card = panel.locator(`[data-testid="module-card"][data-module-id="${moduleId}"]`)
  await expect(card).toBeVisible()
  return card
}

async function readStoredModule(panel: Page, moduleId: string) {
  return panel.evaluate(async (id) => {
    const stored = await chrome.storage.local.get('oneweb.modules.v1')
    const records = stored['oneweb.modules.v1'] as Array<{ manifest: { id: string } }>
    return structuredClone(records.find(record => record.manifest.id === id) || null)
  }, moduleId)
}

async function hasFixtureOriginPermission(panel: Page, manifestUrl: string) {
  return panel.evaluate(origin => chrome.permissions.contains({ origins: [`${origin}/*`] }), new URL(manifestUrl).origin)
}

async function seedModuleLocalState(panel: Page, moduleIds: string[]) {
  return panel.evaluate(async (ids) => {
    const values = Object.fromEntries(ids.map((id, index) => [
      `oneweb.module-state.v1:${id}`,
      { sentinel: id, sequence: index },
    ]))
    await chrome.storage.local.set(values)
    return values
  }, moduleIds)
}

async function readModuleLocalState(panel: Page, moduleIds: string[]) {
  return panel.evaluate(async (ids) => {
    const keys = ids.map(id => `oneweb.module-state.v1:${id}`)
    return chrome.storage.local.get(keys)
  }, moduleIds)
}

async function readStorageFixture(frame: FrameLocator) {
  return frame.locator('body').evaluate(async () => (
    (globalThis as typeof globalThis & { __storageModuleFixture: StorageModuleFixtureBrowserApi })
      .__storageModuleFixture
      .read()
  ))
}

async function replaceStorageFixture(frame: FrameLocator, expectedRevision: string, document: unknown) {
  return frame.locator('body').evaluate(async (_, { document, expectedRevision }) => (
    (globalThis as typeof globalThis & { __storageModuleFixture: StorageModuleFixtureBrowserApi })
      .__storageModuleFixture
      .replace(expectedRevision, document)
  ), { document, expectedRevision })
}

async function clearStorageFixture(frame: FrameLocator, expectedRevision: string) {
  return frame.locator('body').evaluate(async (_, revision) => (
    (globalThis as typeof globalThis & { __storageModuleFixture: StorageModuleFixtureBrowserApi })
      .__storageModuleFixture
      .clear(revision)
  ), expectedRevision)
}

test('built artifact exposes a least-privilege RepoLens side panel', async ({ extensionId }) => {
  const manifest = await import(`${extensionPath}/manifest.json`, { with: { type: 'json' } }).then(module => module.default)
  expect(extensionId).toMatch(/^[a-p]{32}$/)
  expect(manifest.side_panel.default_path).toBe('dist/sidebar/index.html')
  expect(manifest.permissions).toEqual(['activeTab', 'contextMenus', 'scripting', 'storage', 'tabs', 'sidePanel'])
  expect(manifest.optional_permissions).toEqual(['bookmarks'])
  expect(manifest.optional_host_permissions).toEqual(['https://*/*', 'http://*/*'])
  expect(manifest.host_permissions).toEqual(['https://github.com/*', 'http://127.0.0.1:4747/*'])
  expect(manifest.content_scripts[0].matches).toEqual(['https://github.com/*'])
  expect(JSON.stringify(manifest.content_scripts)).not.toContain('pageToolbox')
  const toolboxRuntime = fs.readFileSync(`${extensionPath}/dist/pageToolbox/index.global.js`, 'utf8')
  expect(toolboxRuntime).toContain('oneweb.page-toolbox.lifecycle.v3')
  for (const forbidden of [
    'executeScript',
    'storage.local',
    'permissions.request',
    'fetch(',
    'MODULE_HELLO',
    'PAGE_TOOLBOX_PREPARE_CURRENT_SITE',
  ]) {
    expect(toolboxRuntime).not.toContain(forbidden)
  }
})

test('Send to OpenList uses one approved exact origin and fixed trusted background operations', async ({
  context,
  extensionId,
  openListFixture,
}) => {
  const panel = await openManagementPanel(context, extensionId)
  const protectedIds = [
    'dev.juck.repolens',
    'dev.oneweb.bookmark-doctor',
    'dev.oneweb.clash-control',
    'dev.oneweb.browser-journal',
    'dev.oneweb.page-toolbox',
  ]
  const protectedBefore = Object.fromEntries(await Promise.all(protectedIds.map(async id => [
    id,
    await readStoredModule(panel, id),
  ])))
  const card = panel.locator('[data-testid="module-card"][data-module-id="dev.oneweb.send-to-openlist"]')
  await expect(card).toBeVisible()
  await card.getByTestId('module-toggle').click()
  await expect(card.getByTestId('module-toggle')).toHaveAttribute('aria-checked', 'true')

  const profile = {
    schemaVersion: 1,
    id: 'primary',
    label: 'E2E OpenList',
    controllerOrigin: openListFixture.origin,
  }
  const prepared = await panel.evaluate(async profile => (
    await chrome.runtime.sendMessage({
      channel: 'oneweb.send-to-openlist',
      version: 1,
      type: 'SEND_TO_OPENLIST_PREPARE',
      profile,
    })
  ).result, profile) as { ok: true, value: { originPattern: string } }
  expect(prepared).toMatchObject({ ok: true, value: { originPattern: `${openListFixture.origin}/*` } })
  const connected = await panel.evaluate(async ({ preparation, token }) => (
    await chrome.runtime.sendMessage({
      channel: 'oneweb.send-to-openlist',
      version: 1,
      type: 'SEND_TO_OPENLIST_CONNECT',
      preparation,
      token,
    })
  ).result, { preparation: prepared.value, token: openListFixture.token }) as { ok: boolean }
  expect(connected.ok).toBe(true)
  const discovered = await panel.evaluate(async () => (
    await chrome.runtime.sendMessage({
      channel: 'oneweb.send-to-openlist',
      version: 1,
      type: 'SEND_TO_OPENLIST_DISCOVER_TOOLS',
      destinationPath: '/downloads',
    })
  ).result) as { ok: boolean, value: string[] }
  expect(discovered).toEqual({ ok: true, value: openListFixture.tools })

  const submitted = await panel.evaluate(async (tool) => {
    const id = (url: string) => {
      let hash = 0xCBF29CE484222325n
      for (let index = 0; index < url.length; index += 1) {
        hash ^= BigInt(url.charCodeAt(index))
        hash = BigInt.asUintN(64, hash * 0x100000001B3n)
      }
      return `resource-${hash.toString(16).padStart(16, '0')}`
    }
    const urls = ['https://cdn.example/a?sig=a%2Bb', 'magnet:?xt=urn:btih:abc']
    const candidates = urls.map((url, index) => ({
      schemaVersion: 1,
      id: id(url),
      url,
      kind: index === 0 ? 'https' : 'magnet',
      source: 'manual',
    }))
    return (await chrome.runtime.sendMessage({
      channel: 'oneweb.send-to-openlist',
      version: 1,
      type: 'SEND_TO_OPENLIST_SUBMIT',
      candidates,
      destinationPath: '/downloads',
      tool,
    })).result
  }, openListFixture.tools[0]) as { ok: boolean, value: { entries: Array<{ status: string }> } }
  expect(submitted.ok).toBe(true)
  expect(submitted.value.entries.map(entry => entry.status)).toEqual(['accepted', 'accepted'])
  expect(openListFixture.requests).toMatchObject({ me: 1, tools: 1, add: 2, unauthorized: 0 })
  expect(openListFixture.requests.maximumAdds).toBeLessThanOrEqual(2)

  const tokenSurfaces = await panel.evaluate(async (token) => {
    const all = await chrome.storage.local.get(null)
    return Object.entries(all)
      .filter(([, value]) => JSON.stringify(value).includes(token))
      .map(([key]) => key)
  }, openListFixture.token)
  expect(tokenSurfaces).toEqual(['oneweb.send-to-openlist.secret.v1.primary'])

  await panel.evaluate(async () => chrome.runtime.sendMessage({
    channel: 'oneweb.send-to-openlist',
    version: 1,
    type: 'SEND_TO_OPENLIST_DISCONNECT',
  }))
  expect(await panel.evaluate(async token => JSON.stringify(await chrome.storage.local.get(null)).includes(token), openListFixture.token)).toBe(false)
  const protectedAfter = Object.fromEntries(await Promise.all(protectedIds.map(async id => [
    id,
    await readStoredModule(panel, id),
  ])))
  expect(protectedAfter).toEqual(protectedBefore)
})

test('Send to OpenList manual MVP reviews candidates and cancels only a fresh server task', async ({
  context,
  extensionId,
  openListFixture,
}) => {
  const panel = await openManagementPanel(context, extensionId)
  const card = panel.locator('[data-testid="module-card"][data-module-id="dev.oneweb.send-to-openlist"]')
  await card.getByTestId('module-toggle').click()
  await expect(card.getByTestId('module-toggle')).toHaveAttribute('aria-checked', 'true')
  await card.getByTestId('send-openlist-profile-label').fill('Local fixture')
  await card.getByTestId('send-openlist-origin').fill(openListFixture.origin)
  await card.getByTestId('send-openlist-prepare').click()
  await expect(card.getByTestId('send-openlist-connection-review')).toContainText(openListFixture.origin)
  await panel.evaluate(token => window.prompt = () => token, openListFixture.token)
  await card.getByTestId('send-openlist-connect').click()
  await expect(card.getByTestId('send-openlist-manual-input')).toBeVisible()

  await card.getByTestId('send-openlist-manual-input').fill([
    'https://cdn.example/signed?b=2&a=a%2Bb#discard',
    'https://cdn.example/signed?b=2&a=a%2Bb#duplicate',
    'magnet:?xt=urn:btih:phase9c',
  ].join('\n'))
  await card.getByTestId('send-openlist-parse').click()
  await expect(card.locator('[data-testid="send-openlist-candidates"] li')).toHaveCount(2)
  await expect(card.getByText('https://cdn.example/signed?b=2&a=a%2Bb', { exact: true })).toBeVisible()
  await card.getByTestId('send-openlist-path').fill('/downloads')
  await card.getByTestId('send-openlist-tools').click()
  await expect(card.getByTestId('send-openlist-tool')).toHaveValue('SimpleHttp')
  expect(openListFixture.requests.add).toBe(0)
  await card.getByTestId('send-openlist-submit').click()
  await expect(card.locator('[data-testid="send-openlist-results"] li')).toHaveCount(2)
  await expect(card.getByTestId('send-openlist-results')).toContainText('已受理')
  expect(openListFixture.requests.add).toBe(2)

  await card.getByTestId('send-openlist-list-undone').click()
  const undone = card.getByTestId('send-openlist-undone')
  await expect(undone.locator('li')).toHaveCount(2)
  await expect(undone).toContainText('<img data-openlist-xss src=x> task 1')
  expect(await undone.locator('img[data-openlist-xss]').count()).toBe(0)
  await undone.locator('li').first().getByTestId('send-openlist-prepare-cancel').click()
  const review = card.getByTestId('send-openlist-cancel-review')
  await expect(review).toContainText('task-1')
  expect(openListFixture.requests.cancel).toBe(0)
  await review.getByTestId('send-openlist-confirm-cancel').click()
  await expect(card.getByTestId('send-openlist-message')).toContainText('task-1')
  expect(openListFixture.requests.cancel).toBe(1)
  expect(openListFixture.requests.undone).toBe(2)

  await card.getByTestId('send-openlist-list-done').click()
  await expect(card.getByTestId('send-openlist-done')).toContainText('task-1')
  expect(openListFixture.requests.done).toBe(1)
})

test('Send to OpenList discovers only reviewed top-frame browser resources without submitting', async ({
  context,
  extensionId,
  moduleFixtures,
  openListFixture,
}) => {
  const siteOrigin = new URL(moduleFixtures.primary.manifestUrl).origin
  const site = await context.newPage()
  await site.goto(`${siteOrigin}/journal-page-toolbox-poc`, { waitUntil: 'domcontentloaded' })
  const panel = await openManagementPanel(context, extensionId)
  const card = panel.locator('[data-testid="module-card"][data-module-id="dev.oneweb.send-to-openlist"]')
  await card.getByTestId('module-toggle').click()
  await card.getByTestId('send-openlist-profile-label').fill('Discovery fixture')
  await card.getByTestId('send-openlist-origin').fill(openListFixture.origin)
  await card.getByTestId('send-openlist-prepare').click()
  await panel.evaluate(token => window.prompt = () => token, openListFixture.token)
  await card.getByTestId('send-openlist-connect').click()
  await expect(card.getByTestId('send-openlist-scan-page')).toBeVisible()

  await site.bringToFront()
  const captured = await panel.evaluate(async () => (
    await chrome.runtime.sendMessage({
      channel: 'oneweb.send-to-openlist',
      version: 1,
      type: 'SEND_TO_OPENLIST_CAPTURE_CURRENT_PAGE',
    })
  ).result) as { ok: boolean, value: { candidates: Array<{ source: string, url: string }> } }
  expect(captured).toMatchObject({
    ok: true,
    value: { candidates: [{ source: 'current-page', url: `${siteOrigin}/journal-page-toolbox-poc` }] },
  })
  const scanned = await panel.evaluate(async () => (
    await chrome.runtime.sendMessage({
      channel: 'oneweb.send-to-openlist',
      version: 1,
      type: 'SEND_TO_OPENLIST_SCAN_CURRENT_PAGE',
    })
  ).result) as { ok: boolean, value: { candidates: Array<{ source: string, url: string }>, rejectedCount: number } }
  expect(scanned.ok).toBe(true)
  expect(scanned.value.candidates).toEqual(expect.arrayContaining([
    expect.objectContaining({ url: 'https://cdn.example/resource?sig=a%2Bb&part=1', source: 'page-scan' }),
    expect.objectContaining({ url: 'http://127.1/private', source: 'page-scan' }),
    expect.objectContaining({ url: 'https://cdn.example/video.mp4', source: 'page-scan' }),
  ]))
  expect(JSON.stringify(scanned)).not.toContain('javascript:void')

  await panel.bringToFront()
  await card.getByTestId('send-openlist-refresh-discovery').click()
  const candidates = card.getByTestId('send-openlist-candidates')
  await expect(candidates).toContainText('https://cdn.example/resource?sig=a%2Bb&part=1')
  await expect(candidates).toContainText('已阻止本地/私网目标')
  await expect(candidates).toContainText('<img data-discovery-xss src=x>')
  expect(await candidates.locator('img[data-discovery-xss]').count()).toBe(0)
  expect(await candidates.locator('input:disabled').count()).toBe(2)
  expect(openListFixture.requests.add).toBe(0)
  expect((await panel.evaluate(() => chrome.runtime.getManifest())).content_scripts)
    .toEqual([expect.objectContaining({ matches: ['https://github.com/*'], all_frames: false })])
})

test('Send to OpenList keeps OpenList and AList profiles, secrets and lifecycle isolated', async ({
  alistFixture,
  context,
  extensionId,
  moduleFixtures,
  openListFixture,
}) => {
  let panel = await openManagementPanel(context, extensionId)
  const moduleId = 'dev.oneweb.send-to-openlist'
  const protectedIds = [
    'dev.juck.repolens',
    'dev.oneweb.bookmark-doctor',
    'dev.oneweb.clash-control',
    'dev.oneweb.browser-journal',
    'dev.oneweb.page-toolbox',
    moduleFixtures.primary.manifest.id,
    moduleFixtures.secondary.manifest.id,
  ]
  const protectedBefore = Object.fromEntries(await Promise.all(protectedIds.map(async id => [
    id,
    await readStoredModule(panel, id),
  ])))
  const localIsolationIds = protectedIds.filter(id => id !== 'dev.oneweb.browser-journal')
  const localBefore = await seedModuleLocalState(panel, localIsolationIds)
  const card = panel.locator(`[data-testid="module-card"][data-module-id="${moduleId}"]`)
  await card.getByTestId('module-toggle').click()

  const connect = async (id: string, label: string, origin: string, token: string) => {
    const prepared = await panel.evaluate(async profile => (
      await chrome.runtime.sendMessage({
        channel: 'oneweb.send-to-openlist',
        version: 1,
        type: 'SEND_TO_OPENLIST_PREPARE',
        profile,
      })
    ).result, { schemaVersion: 1, id, label, controllerOrigin: origin }) as {
      ok: boolean
      value: unknown
    }
    expect(prepared.ok).toBe(true)
    const connected = await panel.evaluate(async input => (
      await chrome.runtime.sendMessage({
        channel: 'oneweb.send-to-openlist',
        version: 1,
        type: 'SEND_TO_OPENLIST_CONNECT',
        preparation: input.preparation,
        token: input.token,
      })
    ).result, { preparation: prepared.value, token }) as { ok: boolean }
    expect(connected.ok).toBe(true)
  }

  await connect('openlist', 'OpenList', openListFixture.origin, openListFixture.token)
  const openListTools = await panel.evaluate(async () => (
    await chrome.runtime.sendMessage({
      channel: 'oneweb.send-to-openlist',
      version: 1,
      type: 'SEND_TO_OPENLIST_DISCOVER_TOOLS',
      destinationPath: '/openlist-target',
    })
  ).result) as { ok: boolean, value: string[] }
  expect(openListTools).toEqual({ ok: true, value: openListFixture.tools })

  await connect('alist', 'AList', alistFixture.origin, alistFixture.token)
  const alistTools = await panel.evaluate(async () => (
    await chrome.runtime.sendMessage({
      channel: 'oneweb.send-to-openlist',
      version: 1,
      type: 'SEND_TO_OPENLIST_DISCOVER_TOOLS',
      destinationPath: '/alist-target',
    })
  ).result) as { ok: boolean, value: string[] }
  expect(alistTools).toEqual({ ok: true, value: alistFixture.tools })
  const alistSubmission = await panel.evaluate(async (tool) => {
    const url = 'https://cdn.example/alist-compatible?sig=a%2Bb'
    let hash = 0xCBF29CE484222325n
    for (let index = 0; index < url.length; index += 1) {
      hash ^= BigInt(url.charCodeAt(index))
      hash = BigInt.asUintN(64, hash * 0x100000001B3n)
    }
    return (await chrome.runtime.sendMessage({
      channel: 'oneweb.send-to-openlist',
      version: 1,
      type: 'SEND_TO_OPENLIST_SUBMIT',
      candidates: [{
        schemaVersion: 1,
        id: `resource-${hash.toString(16).padStart(16, '0')}`,
        url,
        kind: 'https',
        source: 'manual',
      }],
      destinationPath: '/alist-target',
      tool,
    })).result
  }, alistFixture.tools[0]) as { ok: boolean, value: { entries: Array<{ status: string }> } }
  expect(alistSubmission).toMatchObject({ ok: true, value: { entries: [{ status: 'accepted' }] } })
  const alistTasks = await panel.evaluate(async () => (
    await chrome.runtime.sendMessage({
      channel: 'oneweb.send-to-openlist',
      version: 1,
      type: 'SEND_TO_OPENLIST_LIST_TASKS',
      list: 'undone',
    })
  ).result) as { ok: boolean, value: { tasks: Array<{ id: string }> } }
  expect(alistTasks).toMatchObject({ ok: true, value: { tasks: [{ id: 'task-1' }] } })
  expect(openListFixture.requests.toolPaths).toEqual(['/openlist-target'])
  expect(alistFixture.requests.toolPaths).toEqual(['/alist-target'])
  expect(new Set(openListFixture.requests.clientIds).size).toBe(1)
  expect(new Set(alistFixture.requests.clientIds).size).toBe(1)
  expect(alistFixture.requests).toMatchObject({ me: 1, tools: 1, add: 1, undone: 1, unauthorized: 0 })

  const secretKeys = await panel.evaluate(async tokens => Object.entries(await chrome.storage.local.get(null))
    .filter(([, value]) => tokens.some(token => JSON.stringify(value).includes(token)))
    .map(([key]) => key)
    .sort(), [openListFixture.token, alistFixture.token])
  expect(secretKeys).toEqual([
    'oneweb.send-to-openlist.secret.v1.alist',
    'oneweb.send-to-openlist.secret.v1.openlist',
  ])
  expect(await card.textContent()).not.toContain(openListFixture.token)
  expect(await card.textContent()).not.toContain(alistFixture.token)
  expect(panel.url()).not.toContain(openListFixture.token)
  expect(panel.url()).not.toContain(alistFixture.token)

  expect(await panel.evaluate(origin => chrome.permissions.remove({ origins: [`${origin}/*`] }), openListFixture.origin)).toBe(true)
  await expect.poll(() => panel.evaluate(async () => (
    await chrome.storage.local.get('oneweb.send-to-openlist.secret.v1.openlist')
  )['oneweb.send-to-openlist.secret.v1.openlist'])).toBeUndefined()
  const stillConnected = await panel.evaluate(async () => (
    await chrome.runtime.sendMessage({ channel: 'oneweb.send-to-openlist', version: 1, type: 'SEND_TO_OPENLIST_STATUS' })
  ).result) as { value: { phase: string, profile: { id: string } } }
  expect(stillConnected.value).toMatchObject({ phase: 'connected', profile: { id: 'alist' } })
  expect(await panel.evaluate(async () => Boolean((
    await chrome.storage.local.get('oneweb.send-to-openlist.secret.v1.alist')
  )['oneweb.send-to-openlist.secret.v1.alist']))).toBe(true)

  const resourcePage = await context.newPage()
  await resourcePage.goto(`${new URL(moduleFixtures.primary.manifestUrl).origin}/journal-page-toolbox-poc`, {
    waitUntil: 'domcontentloaded',
  })
  await resourcePage.bringToFront()
  const discoveryBeforeRestart = await panel.evaluate(async () => (
    await chrome.runtime.sendMessage({
      channel: 'oneweb.send-to-openlist',
      version: 1,
      type: 'SEND_TO_OPENLIST_SCAN_CURRENT_PAGE',
    })
  ).result) as { ok: boolean, value: { candidates: unknown[] } }
  expect(discoveryBeforeRestart.ok).toBe(true)
  expect(discoveryBeforeRestart.value.candidates.length).toBeGreaterThan(0)

  const callsBeforeRestart = {
    openlist: { ...openListFixture.requests },
    alist: { ...alistFixture.requests },
  }
  let [background] = context.serviceWorkers()
  if (!background)
    background = await context.waitForEvent('serviceworker')
  const workerEvent = context.waitForEvent('serviceworker')
  await background.evaluate(() => chrome.runtime.reload()).catch(() => undefined)
  await panel.close().catch(() => undefined)
  await workerEvent
  panel = await openManagementPanel(context, extensionId)
  const restarted = await panel.evaluate(async () => (
    await chrome.runtime.sendMessage({ channel: 'oneweb.send-to-openlist', version: 1, type: 'SEND_TO_OPENLIST_STATUS' })
  ).result) as { value: { phase: string, profile: { id: string }, hasStoredToken: boolean } }
  expect(restarted.value).toMatchObject({ phase: 'disconnected', profile: { id: 'alist' }, hasStoredToken: true })
  const discoveryAfterRestart = await panel.evaluate(async () => (
    await chrome.runtime.sendMessage({ channel: 'oneweb.send-to-openlist', version: 1, type: 'SEND_TO_OPENLIST_DISCOVERY_STATUS' })
  ).result) as { value: { candidates: unknown[] } }
  expect(discoveryAfterRestart.value.candidates).toEqual([])
  expect(openListFixture.requests.me).toBe(callsBeforeRestart.openlist.me)
  expect(openListFixture.requests.tools).toBe(callsBeforeRestart.openlist.tools)
  expect(alistFixture.requests.me).toBe(callsBeforeRestart.alist.me)
  expect(alistFixture.requests.tools).toBe(callsBeforeRestart.alist.tools)

  const restartedCard = panel.locator(`[data-testid="module-card"][data-module-id="${moduleId}"]`)
  await restartedCard.getByTestId('module-toggle').click()
  await expect.poll(() => panel.evaluate(async tokens => JSON.stringify(await chrome.storage.local.get(null))
    .includes(tokens[0]) || JSON.stringify(await chrome.storage.local.get(null)).includes(tokens[1]), [openListFixture.token, alistFixture.token]))
    .toBe(false)
  const profileCollection = await panel.evaluate(async () => (
    await chrome.storage.local.get('oneweb.send-to-openlist.profiles.v1')
  )['oneweb.send-to-openlist.profiles.v1']) as { profiles: Array<{ id: string }> }
  expect(profileCollection.profiles.map(profile => profile.id)).toEqual(['openlist', 'alist'])

  const protectedAfter = Object.fromEntries(await Promise.all(protectedIds.map(async id => [
    id,
    await readStoredModule(panel, id),
  ])))
  expect(protectedAfter).toEqual(protectedBefore)
  expect(await readModuleLocalState(panel, localIsolationIds)).toEqual(localBefore)
  expect(moduleFixtures.primary.requests.count).toBe(0)
  expect(moduleFixtures.secondary.requests.count).toBe(0)
})

test('Page Toolbox injects one authenticated empty-tool runtime at an approved exact origin', async ({
  context,
  extensionId,
  moduleFixtures,
}) => {
  const siteOrigin = new URL(moduleFixtures.primary.manifestUrl).origin
  const site = await context.newPage()
  await site.goto(`${siteOrigin}/journal-page-toolbox`, { waitUntil: 'domcontentloaded' })
  const pristineHtml = await site.locator('html').evaluate(node => node.outerHTML)

  let panel = await openManagementPanel(context, extensionId)
  const toolboxCard = panel.locator('[data-testid="module-card"][data-module-id="dev.oneweb.page-toolbox"]')
  await expect(toolboxCard).toBeVisible()
  await expect(toolboxCard.getByTestId('module-toggle')).toHaveAttribute('aria-checked', 'false')

  const isolatedModuleIds = [
    'dev.juck.repolens',
    'dev.oneweb.bookmark-doctor',
    'dev.oneweb.clash-control',
    'dev.oneweb.browser-journal',
  ]
  const recordsBefore = Object.fromEntries(await Promise.all(isolatedModuleIds.map(async id => [
    id,
    await readStoredModule(panel, id),
  ])))
  const localIsolationIds = isolatedModuleIds.filter(id => id !== 'dev.oneweb.browser-journal')
  const localBefore = await seedModuleLocalState(panel, localIsolationIds)
  const permissionsBefore = await panel.evaluate(() => chrome.permissions.getAll())

  await toolboxCard.getByTestId('module-toggle').click()
  await expect(toolboxCard.getByTestId('module-toggle')).toHaveAttribute('aria-checked', 'true')
  await site.bringToFront()
  const prepared = await panel.evaluate(async () => chrome.runtime.sendMessage({
    channel: 'oneweb.page-toolbox.management',
    version: 1,
    type: 'PAGE_TOOLBOX_PREPARE_CURRENT_SITE',
  })) as {
    result: {
      ok: boolean
      preparation: { exactOrigin: string, originPattern: string, token: string }
    }
  }
  expect(prepared.result).toMatchObject({
    ok: true,
    preparation: { exactOrigin: siteOrigin, originPattern: `${siteOrigin}/*` },
  })
  expect(await panel.evaluate(origin => chrome.permissions.contains({ origins: [`${origin}/*`] }), siteOrigin)).toBe(true)
  const confirmed = await panel.evaluate(async token => chrome.runtime.sendMessage({
    channel: 'oneweb.page-toolbox.management',
    version: 1,
    type: 'PAGE_TOOLBOX_CONFIRM_CURRENT_SITE',
    token,
  }), prepared.result.preparation.token) as { result: { ok: boolean, changed: boolean, injected: boolean } }
  expect(confirmed.result).toEqual(expect.objectContaining({ ok: true, changed: true, injected: true }))

  const readStatus = () => panel.evaluate(async () => (
    await chrome.runtime.sendMessage({
      channel: 'oneweb.page-toolbox.management',
      version: 1,
      type: 'PAGE_TOOLBOX_STATUS',
    })
  ).result) as Promise<{
    ok: boolean
    snapshot: {
      approvedOrigins: string[]
      sessions: Array<{ generation: number, phase: string, tabId: number }>
    }
  }>
  await expect.poll(async () => (await readStatus()).snapshot.sessions[0]?.phase).toBe('ready')
  const firstStatus = await readStatus()
  expect(firstStatus.snapshot.approvedOrigins).toEqual([siteOrigin])
  const firstGeneration = firstStatus.snapshot.sessions[0].generation
  const controlHost = site.locator('[data-oneweb-page-toolbox-control]')
  await expect(controlHost).toHaveCount(1)
  expect(await controlHost.evaluate(node => node.shadowRoot === null)).toBe(true)
  expect(await site.locator('html').evaluate((node) => {
    const clone = node.cloneNode(true) as HTMLElement
    clone.querySelector('[data-oneweb-page-toolbox-control]')?.remove()
    return clone.outerHTML
  })).toBe(pristineHtml)
  expect(moduleFixtures.primary.requests.count).toBe(0)

  await site.goto(`${siteOrigin}/journal-page-toolbox-next`, { waitUntil: 'domcontentloaded' })
  await expect.poll(async () => {
    const session = (await readStatus()).snapshot.sessions[0]
    return session?.phase === 'ready' ? session.generation : 0
  }).toBeGreaterThan(firstGeneration)

  let [background] = context.serviceWorkers()
  if (!background)
    background = await context.waitForEvent('serviceworker')
  const workerEvent = context.waitForEvent('serviceworker')
  await background.evaluate(() => chrome.runtime.reload()).catch(() => undefined)
  await panel.close().catch(() => undefined)
  await workerEvent
  panel = await openManagementPanel(context, extensionId)
  const restartedStatus = () => panel.evaluate(async () => (
    await chrome.runtime.sendMessage({
      channel: 'oneweb.page-toolbox.management',
      version: 1,
      type: 'PAGE_TOOLBOX_STATUS',
    })
  ).result) as Promise<{
    snapshot: { approvedOrigins: string[], sessions: Array<{ phase: string }> }
  }>
  await expect.poll(async () => (await restartedStatus()).snapshot.sessions[0]?.phase).toBe('ready')
  expect((await restartedStatus()).snapshot.approvedOrigins).toEqual([siteOrigin])

  expect(await panel.evaluate(async origin => chrome.permissions.remove({ origins: [`${origin}/*`] }), siteOrigin)).toBe(true)
  await expect.poll(async () => (await restartedStatus()).snapshot.approvedOrigins).toEqual([])
  await expect.poll(async () => (await restartedStatus()).snapshot.sessions).toEqual([])
  await expect(site.locator('[data-oneweb-page-toolbox-control]')).toHaveCount(0)
  expect(await panel.evaluate(origin => chrome.permissions.contains({ origins: [`${origin}/*`] }), siteOrigin)).toBe(false)

  const recordsAfter = Object.fromEntries(await Promise.all(isolatedModuleIds.map(async id => [
    id,
    await readStoredModule(panel, id),
  ])))
  expect(recordsAfter).toEqual(recordsBefore)
  expect(await readModuleLocalState(panel, localIsolationIds)).toEqual(localBefore)
  const permissionsAfter = await panel.evaluate(() => chrome.permissions.getAll())
  expect(permissionsAfter.permissions).toEqual(permissionsBefore.permissions)
  expect((permissionsAfter.origins || []).filter(origin => origin !== `${siteOrigin}/*`).sort())
    .toEqual((permissionsBefore.origins || []).filter(origin => origin !== `${siteOrigin}/*`).sort())
  expect(moduleFixtures.primary.requests.count).toBe(0)
})

test('Page Toolbox runs three explicit reversible tools without crossing site or module authority', async ({
  context,
  extensionId,
  moduleFixtures,
}) => {
  const siteOrigin = new URL(moduleFixtures.primary.manifestUrl).origin
  const site = await context.newPage()
  await site.goto(`${siteOrigin}/journal-page-toolbox-poc`, { waitUntil: 'domcontentloaded' })
  const panel = await openManagementPanel(context, extensionId)
  await installFixtureModule(panel, moduleFixtures.primary.manifestUrl, moduleFixtures.primary.manifest.id)
  await installFixtureModule(panel, moduleFixtures.secondary.manifestUrl, moduleFixtures.secondary.manifest.id)
  const remoteRequestsBefore = {
    primary: moduleFixtures.primary.requests.count,
    secondary: moduleFixtures.secondary.requests.count,
  }

  const isolatedModuleIds = [
    'dev.juck.repolens',
    'dev.oneweb.bookmark-doctor',
    'dev.oneweb.clash-control',
    'dev.oneweb.browser-journal',
    moduleFixtures.primary.manifest.id,
    moduleFixtures.secondary.manifest.id,
  ]
  const recordsBefore = Object.fromEntries(await Promise.all(isolatedModuleIds.map(async id => [
    id,
    await readStoredModule(panel, id),
  ])))
  const protectedStateIds = isolatedModuleIds.filter(id => id !== 'dev.oneweb.browser-journal')
  const localBefore = await seedModuleLocalState(panel, protectedStateIds)
  const storageBefore = await panel.evaluate(async () => chrome.storage.local.get(null))
  const permissionsBefore = await panel.evaluate(async () => chrome.permissions.getAll())

  const toolboxCard = panel.locator('[data-testid="module-card"][data-module-id="dev.oneweb.page-toolbox"]')
  await toolboxCard.getByTestId('module-toggle').click()
  await expect(toolboxCard.getByTestId('module-toggle')).toHaveAttribute('aria-checked', 'true')
  await site.bringToFront()
  const prepared = await panel.evaluate(async () => (
    await chrome.runtime.sendMessage({
      channel: 'oneweb.page-toolbox.management',
      version: 1,
      type: 'PAGE_TOOLBOX_PREPARE_CURRENT_SITE',
    })
  ).result) as { ok: boolean, preparation: { token: string } }
  expect(prepared.ok).toBe(true)
  const confirmed = await panel.evaluate(async token => (
    await chrome.runtime.sendMessage({
      channel: 'oneweb.page-toolbox.management',
      version: 1,
      type: 'PAGE_TOOLBOX_CONFIRM_CURRENT_SITE',
      token,
    })
  ).result, prepared.preparation.token) as { ok: boolean, injected: boolean }
  expect(confirmed).toMatchObject({ ok: true, injected: true })

  const setTool = async (toolId: string, enabled: boolean, settings?: unknown) => {
    await site.bringToFront()
    return panel.evaluate(async input => (
      await chrome.runtime.sendMessage({
        channel: 'oneweb.page-toolbox.management',
        version: 1,
        type: 'PAGE_TOOLBOX_SET_CURRENT_SITE_TOOL',
        toolId: input.toolId,
        enabled: input.enabled,
        ...(input.enabled ? { settings: input.settings } : {}),
      })
    ).result, { toolId, enabled, settings }) as Promise<{
      ok: boolean
      changed: boolean
      synchronized: number
    }>
  }

  const readToolboxStatus = () => panel.evaluate(async () => (
    await chrome.runtime.sendMessage({
      channel: 'oneweb.page-toolbox.management',
      version: 1,
      type: 'PAGE_TOOLBOX_STATUS',
    })
  ).result) as Promise<{
    snapshot: { sessions: Array<{ generation: number, phase: string }> }
  }>

  await expect.poll(async () => (await readToolboxStatus()).snapshot.sessions[0]?.phase).toBe('ready')

  expect(await setTool('password-visibility', true, { gesture: 'double-click' }))
    .toMatchObject({ ok: true, changed: true, synchronized: 1 })
  const password = site.locator('#toolbox-password')
  await password.click({ clickCount: 2 })
  await expect(password).toHaveAttribute('type', 'text')
  await password.click({ clickCount: 2 })
  await expect(password).toHaveAttribute('type', 'password')
  await setTool('password-visibility', true, { gesture: 'triple-click' })
  await password.click({ clickCount: 2 })
  await expect(password).toHaveAttribute('type', 'password')
  await password.click({ clickCount: 3 })
  await expect(password).toHaveAttribute('type', 'text')
  await setTool('password-visibility', false)
  await expect(password).toHaveAttribute('type', 'password')
  await expect(site.frameLocator('#toolbox-child-frame').locator('#frame-password')).toHaveAttribute('type', 'password')
  await expect(password).toHaveValue('page-local-secret')

  await setTool('free-page-edit', true, { mode: 'rich-text' })
  await expect(site.locator('body')).toHaveAttribute('contenteditable', 'true')
  await setTool('free-page-edit', true, { mode: 'plain-text' })
  await expect(site.locator('body')).toHaveAttribute('contenteditable', 'plaintext-only')
  await site.locator('body').evaluate(body => body.setAttribute('contenteditable', 'false'))
  await setTool('free-page-edit', false)
  await expect(site.locator('body')).toHaveAttribute('contenteditable', 'false')

  await setTool('selection-copy-release', true, {
    selection: true,
    copy: true,
    contextMenu: true,
  })
  const allowedCopy = await site.locator('#toolbox-copy-target').evaluate((target) => {
    const event = new Event('copy', { bubbles: true, cancelable: true })
    target.dispatchEvent(event)
    return {
      defaultPrevented: event.defaultPrevented,
      text: target.textContent,
      blocks: (window as typeof window & { __pageToolboxFixture: { copyBlocks: number } })
        .__pageToolboxFixture
        .copyBlocks,
    }
  })
  expect(allowedCopy).toEqual({
    defaultPrevented: false,
    text: 'untrusted <script>page text</script>',
    blocks: 0,
  })
  expect((await site.locator('style').allTextContents()).some(text => text.includes('user-select:text'))).toBe(true)
  await setTool('selection-copy-release', true, {
    selection: false,
    copy: false,
    contextMenu: false,
  })
  const blockedCopy = await site.locator('#toolbox-copy-target').evaluate((target) => {
    const event = new Event('copy', { bubbles: true, cancelable: true })
    target.dispatchEvent(event)
    return {
      defaultPrevented: event.defaultPrevented,
      blocks: (window as typeof window & { __pageToolboxFixture: { copyBlocks: number } })
        .__pageToolboxFixture
        .copyBlocks,
    }
  })
  expect(blockedCopy).toEqual({ defaultPrevented: true, blocks: 1 })
  await setTool('selection-copy-release', false)
  expect((await site.locator('style').allTextContents()).some(text => text.includes('user-select:text'))).toBe(false)

  await setTool('free-page-edit', true, { mode: 'rich-text' })
  await setTool('password-visibility', true, { gesture: 'triple-click' })
  await setTool('selection-copy-release', true, {
    selection: true,
    copy: true,
    contextMenu: true,
  })
  await expect(site.locator('body')).toHaveAttribute('contenteditable', 'true')
  const generationBeforeNavigation = (await readToolboxStatus()).snapshot.sessions[0].generation
  await site.goto(`${siteOrigin}/journal-page-toolbox-poc?navigation=2`, { waitUntil: 'domcontentloaded' })
  await expect.poll(async () => {
    const session = (await readToolboxStatus()).snapshot.sessions[0]
    return session?.phase === 'ready' ? session.generation : 0
  }).toBeGreaterThan(generationBeforeNavigation)
  await expect(site.locator('body')).toHaveAttribute('contenteditable', 'true')
  expect((await site.locator('style').allTextContents()).filter(text => text.includes('user-select:text'))).toHaveLength(1)
  await site.locator('#toolbox-password').click({ clickCount: 3 })
  await expect(site.locator('#toolbox-password')).toHaveAttribute('type', 'text')
  await site.bringToFront()
  const revoked = await panel.evaluate(async () => (
    await chrome.runtime.sendMessage({
      channel: 'oneweb.page-toolbox.management',
      version: 1,
      type: 'PAGE_TOOLBOX_REVOKE_CURRENT_SITE',
    })
  ).result) as { ok: boolean, changed: boolean, releasedOrigin: boolean }
  expect(revoked).toEqual({ ok: true, operation: 'revoke', changed: true, releasedOrigin: false })
  await expect(site.locator('body')).toHaveAttribute('contenteditable', 'false')
  await expect(site.locator('#toolbox-password')).toHaveAttribute('type', 'password')
  expect((await site.locator('style').allTextContents()).some(text => text.includes('user-select:text'))).toBe(false)
  expect(await panel.evaluate(origin => chrome.permissions.contains({ origins: [`${origin}/*`] }), siteOrigin)).toBe(true)

  await site.bringToFront()
  const preparedAgain = await panel.evaluate(async () => (
    await chrome.runtime.sendMessage({
      channel: 'oneweb.page-toolbox.management',
      version: 1,
      type: 'PAGE_TOOLBOX_PREPARE_CURRENT_SITE',
    })
  ).result) as { preparation: { token: string } }
  await panel.evaluate(async token => chrome.runtime.sendMessage({
    channel: 'oneweb.page-toolbox.management',
    version: 1,
    type: 'PAGE_TOOLBOX_CONFIRM_CURRENT_SITE',
    token,
  }), preparedAgain.preparation.token)
  expect(await setTool('free-page-edit', true, { mode: 'rich-text' })).toMatchObject({ ok: true })
  await expect(site.locator('body')).toHaveAttribute('contenteditable', 'true')
  await toolboxCard.getByTestId('module-toggle').click()
  await expect(toolboxCard.getByTestId('module-toggle')).toHaveAttribute('aria-checked', 'false')
  await expect(site.locator('body')).toHaveAttribute('contenteditable', 'false')

  const recordsAfter = Object.fromEntries(await Promise.all(isolatedModuleIds.map(async id => [
    id,
    await readStoredModule(panel, id),
  ])))
  expect(recordsAfter).toEqual(recordsBefore)
  expect(await readModuleLocalState(panel, protectedStateIds)).toEqual(localBefore)
  const permissionsAfter = await panel.evaluate(async () => chrome.permissions.getAll())
  expect(permissionsAfter.permissions).toEqual(permissionsBefore.permissions)
  expect((permissionsAfter.origins || []).sort()).toEqual((permissionsBefore.origins || []).sort())
  const storageAfter = await panel.evaluate(async () => chrome.storage.local.get(null))
  for (const key of ['oneweb.modules.v1', 'oneweb.module-state.v1:dev.oneweb.page-toolbox']) {
    delete storageBefore[key]
    delete storageAfter[key]
  }
  expect(storageAfter).toEqual(storageBefore)
  expect(moduleFixtures.primary.requests.count).toBe(remoteRequestsBefore.primary)
  expect(moduleFixtures.secondary.requests.count).toBe(remoteRequestsBefore.secondary)
})

test('Page Toolbox keeps two exact origins and overlapping tool lifecycles fully isolated', async ({
  context,
  extensionId,
  moduleFixtures,
}) => {
  const alphaOrigin = new URL(moduleFixtures.primary.manifestUrl).origin
  const betaOrigin = new URL(moduleFixtures.secondary.manifestUrl).origin
  const alpha = await context.newPage()
  const beta = await context.newPage()
  await alpha.goto(`${alphaOrigin}/journal-page-toolbox-poc`, { waitUntil: 'domcontentloaded' })
  await beta.goto(`${betaOrigin}/journal-page-toolbox-poc`, { waitUntil: 'domcontentloaded' })
  const panel = await openManagementPanel(context, extensionId)
  await installFixtureModule(panel, moduleFixtures.primary.manifestUrl, moduleFixtures.primary.manifest.id)
  await installFixtureModule(panel, moduleFixtures.secondary.manifestUrl, moduleFixtures.secondary.manifest.id)
  const remoteRequestsBefore = {
    primary: moduleFixtures.primary.requests.count,
    secondary: moduleFixtures.secondary.requests.count,
  }

  const isolatedModuleIds = [
    'dev.juck.repolens',
    'dev.oneweb.bookmark-doctor',
    'dev.oneweb.clash-control',
    'dev.oneweb.browser-journal',
    moduleFixtures.primary.manifest.id,
    moduleFixtures.secondary.manifest.id,
  ]
  const recordsBefore = Object.fromEntries(await Promise.all(isolatedModuleIds.map(async id => [
    id,
    await readStoredModule(panel, id),
  ])))
  const protectedStateIds = isolatedModuleIds.filter(id => id !== 'dev.oneweb.browser-journal')
  const localBefore = await seedModuleLocalState(panel, protectedStateIds)
  const storageBefore = await panel.evaluate(async () => chrome.storage.local.get(null))
  const permissionsBefore = await panel.evaluate(async () => chrome.permissions.getAll())

  const toolboxCard = panel.locator('[data-testid="module-card"][data-module-id="dev.oneweb.page-toolbox"]')
  await toolboxCard.getByTestId('module-toggle').click()
  await expect(toolboxCard.getByTestId('module-toggle')).toHaveAttribute('aria-checked', 'true')

  const status = () => panel.evaluate(async () => (
    await chrome.runtime.sendMessage({
      channel: 'oneweb.page-toolbox.management',
      version: 1,
      type: 'PAGE_TOOLBOX_STATUS',
    })
  ).result) as Promise<{
    snapshot: {
      approvedOrigins: string[]
      sessions: Array<{
        exactOrigin: string
        generation: number
        phase: string
        planRevision: number
        tabId: number
      }>
    }
  }>
  const sessionFor = async (origin: string) => (
    (await status()).snapshot.sessions.find(session => session.exactOrigin === origin)
  )
  const approve = async (page: Page, origin: string) => {
    await page.bringToFront()
    const prepared = await panel.evaluate(async () => (
      await chrome.runtime.sendMessage({
        channel: 'oneweb.page-toolbox.management',
        version: 1,
        type: 'PAGE_TOOLBOX_PREPARE_CURRENT_SITE',
      })
    ).result) as { ok: boolean, preparation: { exactOrigin: string, token: string } }
    expect(prepared).toMatchObject({ ok: true, preparation: { exactOrigin: origin } })
    const confirmed = await panel.evaluate(async token => (
      await chrome.runtime.sendMessage({
        channel: 'oneweb.page-toolbox.management',
        version: 1,
        type: 'PAGE_TOOLBOX_CONFIRM_CURRENT_SITE',
        token,
      })
    ).result, prepared.preparation.token) as { ok: boolean, injected: boolean }
    expect(confirmed).toMatchObject({ ok: true, injected: true })
    await expect.poll(async () => (await sessionFor(origin))?.phase).toBe('ready')
  }
  const setTool = async (page: Page, toolId: string, enabled: boolean, settings?: unknown) => {
    await page.bringToFront()
    const result = await panel.evaluate(async input => (
      await chrome.runtime.sendMessage({
        channel: 'oneweb.page-toolbox.management',
        version: 1,
        type: 'PAGE_TOOLBOX_SET_CURRENT_SITE_TOOL',
        toolId: input.toolId,
        enabled: input.enabled,
        ...(input.enabled ? { settings: input.settings } : {}),
      })
    ).result, { toolId, enabled, settings }) as { ok: boolean, changed: boolean }
    expect(result.ok).toBe(true)
    return result
  }

  await approve(alpha, alphaOrigin)
  await approve(beta, betaOrigin)
  expect((await status()).snapshot.approvedOrigins).toEqual([alphaOrigin, betaOrigin].sort())

  await setTool(alpha, 'password-visibility', true, { gesture: 'double-click' })
  await setTool(alpha, 'free-page-edit', true, { mode: 'rich-text' })
  await setTool(alpha, 'selection-copy-release', true, {
    selection: true,
    copy: true,
    contextMenu: true,
  })
  await setTool(beta, 'password-visibility', true, { gesture: 'triple-click' })
  await setTool(beta, 'free-page-edit', true, { mode: 'plain-text' })
  await setTool(beta, 'selection-copy-release', true, {
    selection: true,
    copy: false,
    contextMenu: false,
  })
  await expect(alpha.locator('body')).toHaveAttribute('contenteditable', 'true')
  await expect(beta.locator('body')).toHaveAttribute('contenteditable', 'plaintext-only')
  expect((await alpha.locator('style').allTextContents()).filter(text => text.includes('user-select'))).toHaveLength(1)
  expect((await beta.locator('style').allTextContents()).filter(text => text.includes('user-select'))).toHaveLength(1)
  const alphaInitialSession = (await sessionFor(alphaOrigin))!
  const betaStableSession = structuredClone((await sessionFor(betaOrigin))!)

  await alpha.locator('#toolbox-password').click({ clickCount: 2 })
  await expect(alpha.locator('#toolbox-password')).toHaveAttribute('type', 'text')
  await expect(beta.locator('#toolbox-password')).toHaveAttribute('type', 'password')
  await alpha.locator('style').evaluateAll((styles) => {
    const style = styles.find(node => node.textContent?.includes('user-select'))
    if (!style)
      throw new Error('Page Toolbox owned style is missing')
    style.textContent = 'page-owned-alpha-style'
  })
  await setTool(alpha, 'selection-copy-release', true, {
    selection: false,
    copy: false,
    contextMenu: false,
  })
  expect(await alpha.locator('style').allTextContents()).toContain('page-owned-alpha-style')
  await setTool(alpha, 'password-visibility', true, { gesture: 'triple-click' })
  await expect(beta.locator('body')).toHaveAttribute('contenteditable', 'plaintext-only')
  await expect(beta.locator('#toolbox-password')).toHaveAttribute('type', 'password')
  expect(await sessionFor(betaOrigin)).toEqual(betaStableSession)

  await alpha.goto(`${alphaOrigin}/journal-page-toolbox-poc?isolated-navigation=2`, {
    waitUntil: 'domcontentloaded',
  })
  await expect.poll(async () => (await sessionFor(alphaOrigin))?.generation || 0)
    .toBeGreaterThan(alphaInitialSession.generation)
  await expect(alpha.locator('body')).toHaveAttribute('contenteditable', 'true')
  await alpha.locator('#toolbox-password').click({ clickCount: 2 })
  await expect(alpha.locator('#toolbox-password')).toHaveAttribute('type', 'password')
  await alpha.locator('#toolbox-password').click({ clickCount: 3 })
  await expect(alpha.locator('#toolbox-password')).toHaveAttribute('type', 'text')
  expect(await sessionFor(betaOrigin)).toEqual(betaStableSession)
  await expect(beta.locator('body')).toHaveAttribute('contenteditable', 'plaintext-only')

  await alpha.bringToFront()
  const revokedAlpha = await panel.evaluate(async () => (
    await chrome.runtime.sendMessage({
      channel: 'oneweb.page-toolbox.management',
      version: 1,
      type: 'PAGE_TOOLBOX_REVOKE_CURRENT_SITE',
    })
  ).result) as { ok: boolean, changed: boolean, releasedOrigin: boolean }
  expect(revokedAlpha).toEqual({
    ok: true,
    operation: 'revoke',
    changed: true,
    releasedOrigin: false,
  })
  await expect(alpha.locator('body')).toHaveAttribute('contenteditable', 'false')
  await expect(alpha.locator('#toolbox-password')).toHaveAttribute('type', 'password')
  await expect.poll(async () => sessionFor(alphaOrigin)).toBeUndefined()
  expect(await sessionFor(betaOrigin)).toEqual(betaStableSession)
  await beta.locator('#toolbox-password').click({ clickCount: 3 })
  await expect(beta.locator('#toolbox-password')).toHaveAttribute('type', 'text')

  await toolboxCard.getByTestId('module-toggle').click()
  await expect(toolboxCard.getByTestId('module-toggle')).toHaveAttribute('aria-checked', 'false')
  await expect(beta.locator('body')).toHaveAttribute('contenteditable', 'false')
  await expect(beta.locator('#toolbox-password')).toHaveAttribute('type', 'password')
  await expect.poll(async () => (await status()).snapshot.sessions).toEqual([])
  const toolboxState = await panel.evaluate(async () => (
    await chrome.storage.local.get('oneweb.module-state.v1:dev.oneweb.page-toolbox')
  )['oneweb.module-state.v1:dev.oneweb.page-toolbox']) as {
    settings: { sites: Record<string, unknown> }
    siteRevisions: Record<string, number>
  }
  expect(Object.keys(toolboxState.settings.sites)).toEqual([betaOrigin])
  expect(toolboxState.siteRevisions).toEqual({ [betaOrigin]: 3 })

  const recordsAfter = Object.fromEntries(await Promise.all(isolatedModuleIds.map(async id => [
    id,
    await readStoredModule(panel, id),
  ])))
  expect(recordsAfter).toEqual(recordsBefore)
  expect(await readModuleLocalState(panel, protectedStateIds)).toEqual(localBefore)
  const permissionsAfter = await panel.evaluate(async () => chrome.permissions.getAll())
  expect(permissionsAfter.permissions).toEqual(permissionsBefore.permissions)
  expect((permissionsAfter.origins || []).sort()).toEqual((permissionsBefore.origins || []).sort())
  const storageAfter = await panel.evaluate(async () => chrome.storage.local.get(null))
  for (const key of ['oneweb.modules.v1', 'oneweb.module-state.v1:dev.oneweb.page-toolbox']) {
    delete storageBefore[key]
    delete storageAfter[key]
  }
  expect(storageAfter).toEqual(storageBefore)
  expect(moduleFixtures.primary.requests.count).toBe(remoteRequestsBefore.primary)
  expect(moduleFixtures.secondary.requests.count).toBe(remoteRequestsBefore.secondary)
})

test('Page Toolbox trusted sidebar saves current-site settings with CAS and rejects a stale second editor', async ({
  context,
  extensionId,
  moduleFixtures,
}) => {
  const alphaOrigin = new URL(moduleFixtures.primary.manifestUrl).origin
  const betaOrigin = new URL(moduleFixtures.secondary.manifestUrl).origin
  const site = await context.newPage()
  await site.goto(`${alphaOrigin}/journal-page-toolbox-poc`, { waitUntil: 'domcontentloaded' })
  const panelA = await openManagementPanel(context, extensionId)
  const toolboxCardA = panelA.locator('[data-testid="module-card"][data-module-id="dev.oneweb.page-toolbox"]')
  const isolatedIds = [
    'dev.juck.repolens',
    'dev.oneweb.bookmark-doctor',
    'dev.oneweb.clash-control',
    'dev.oneweb.browser-journal',
  ]
  const recordsBefore = Object.fromEntries(await Promise.all(isolatedIds.map(async id => [
    id,
    await readStoredModule(panelA, id),
  ])))
  const stateBefore = await seedModuleLocalState(panelA, isolatedIds.filter(id => id !== 'dev.oneweb.browser-journal'))
  const permissionsBefore = await panelA.evaluate(() => chrome.permissions.getAll())

  await toolboxCardA.getByTestId('module-toggle').click()
  await expect(toolboxCardA.getByTestId('module-toggle')).toHaveAttribute('aria-checked', 'true')

  const refreshForActiveSite = async (panel: Page) => {
    await site.bringToFront()
    await panel.getByTestId('page-toolbox-refresh').evaluate(node => (node as HTMLButtonElement).click())
  }
  await refreshForActiveSite(panelA)
  await expect(toolboxCardA.getByTestId('page-toolbox-control')).toHaveAttribute('data-state', 'site-unapproved')

  await site.bringToFront()
  await toolboxCardA.getByTestId('page-toolbox-prepare-site').evaluate(node => (node as HTMLButtonElement).click())
  await expect(toolboxCardA.getByTestId('page-toolbox-site-review')).toBeVisible()
  await expect(toolboxCardA.getByTestId('page-toolbox-site-review')).toContainText(alphaOrigin)
  await expect(toolboxCardA.getByTestId('page-toolbox-site-review')).not.toContainText('a'.repeat(48))
  await toolboxCardA.getByTestId('page-toolbox-confirm-site').click()
  await expect(toolboxCardA.getByTestId('page-toolbox-control-message')).toContainText('当前站点已授权')

  await refreshForActiveSite(panelA)
  await expect(toolboxCardA.getByTestId('page-toolbox-control')).toHaveAttribute('data-state', 'ready')
  const enablePassword = toolboxCardA.locator('[data-tool-id="password-visibility"] input[data-page-toolbox-enabled]')
  await enablePassword.evaluate((node: HTMLInputElement) => {
    node.checked = true
    node.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await site.bringToFront()
  await toolboxCardA.getByTestId('page-toolbox-save').evaluate(node => (node as HTMLButtonElement).click())
  await expect(toolboxCardA.getByTestId('page-toolbox-control-message')).toContainText('原子保存')
  await site.locator('#toolbox-password').click({ clickCount: 2 })
  await expect(site.locator('#toolbox-password')).toHaveAttribute('type', 'text')
  await site.locator('#toolbox-password').click({ clickCount: 2 })
  await expect(site.locator('#toolbox-password')).toHaveAttribute('type', 'password')

  const panelB = await openManagementPanel(context, extensionId)
  const toolboxCardB = panelB.locator('[data-testid="module-card"][data-module-id="dev.oneweb.page-toolbox"]')
  await refreshForActiveSite(panelA)
  await refreshForActiveSite(panelB)
  await expect(toolboxCardA.getByTestId('page-toolbox-control')).toHaveAttribute('data-state', 'ready')
  await expect(toolboxCardB.getByTestId('page-toolbox-control')).toHaveAttribute('data-state', 'ready')

  const gestureA = toolboxCardA.locator('[data-tool-id="password-visibility"] select[data-page-toolbox-setting="gesture"]')
  await gestureA.evaluate((node: HTMLSelectElement) => {
    node.value = 'triple-click'
    node.dispatchEvent(new Event('change', { bubbles: true }))
  })
  const freeEditB = toolboxCardB.locator('[data-tool-id="free-page-edit"] input[data-page-toolbox-enabled]')
  await freeEditB.evaluate((node: HTMLInputElement) => {
    node.checked = true
    node.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await site.bringToFront()
  await toolboxCardB.getByTestId('page-toolbox-save').evaluate(node => (node as HTMLButtonElement).click())
  await expect(toolboxCardB.getByTestId('page-toolbox-control-message')).toContainText('原子保存')
  await expect(site.locator('body')).toHaveAttribute('contenteditable', 'true')

  await site.bringToFront()
  await toolboxCardA.getByTestId('page-toolbox-save').evaluate(node => (node as HTMLButtonElement).click())
  await expect(toolboxCardA.getByTestId('page-toolbox-control')).toHaveAttribute('data-state', 'stale')
  await expect(toolboxCardA.getByTestId('page-toolbox-control-message')).toContainText('其他位置变化')
  await expect(site.locator('body')).toHaveAttribute('contenteditable', 'true')
  await site.locator('#toolbox-password').click({ clickCount: 2 })
  await expect(site.locator('#toolbox-password')).toHaveAttribute('type', 'text')

  const storedAfterConflict = await panelB.evaluate(async () => (
    await chrome.storage.local.get('oneweb.module-state.v1:dev.oneweb.page-toolbox')
  )['oneweb.module-state.v1:dev.oneweb.page-toolbox']) as {
    settings: { sites: Record<string, { enabledToolIds: string[], toolSettings: Record<string, unknown> }> }
    siteRevisions: Record<string, number>
  }
  expect(storedAfterConflict.siteRevisions[alphaOrigin]).toBe(2)
  expect(storedAfterConflict.settings.sites[alphaOrigin].enabledToolIds).toEqual([
    'free-page-edit',
    'password-visibility',
  ])
  expect(storedAfterConflict.settings.sites[alphaOrigin].toolSettings['password-visibility'])
    .toEqual({ gesture: 'double-click' })

  await site.goto(`${betaOrigin}/journal-page-toolbox-poc`, { waitUntil: 'domcontentloaded' })
  await refreshForActiveSite(panelB)
  await expect(toolboxCardB.getByTestId('page-toolbox-control')).toHaveAttribute('data-state', 'site-unapproved')
  await expect(toolboxCardB.getByTestId('page-toolbox-control')).toContainText(betaOrigin)

  await site.goto(`${alphaOrigin}/journal-page-toolbox-poc?return=1`, { waitUntil: 'domcontentloaded' })
  await refreshForActiveSite(panelB)
  await expect(toolboxCardB.getByTestId('page-toolbox-control')).toHaveAttribute('data-state', 'ready')
  await site.bringToFront()
  await toolboxCardB.getByTestId('page-toolbox-revoke-site').evaluate(node => (node as HTMLButtonElement).click())
  await expect(toolboxCardB.getByTestId('page-toolbox-control')).toHaveAttribute('data-state', 'site-unapproved')
  await expect(site.locator('body')).toHaveAttribute('contenteditable', 'false')
  await expect(site.locator('#toolbox-password')).toHaveAttribute('type', 'password')

  const recordsAfter = Object.fromEntries(await Promise.all(isolatedIds.map(async id => [
    id,
    await readStoredModule(panelB, id),
  ])))
  expect(recordsAfter).toEqual(recordsBefore)
  expect(await readModuleLocalState(panelB, isolatedIds.filter(id => id !== 'dev.oneweb.browser-journal')))
    .toEqual(stateBefore)
  const permissionsAfter = await panelB.evaluate(() => chrome.permissions.getAll())
  expect(permissionsAfter.permissions).toEqual(permissionsBefore.permissions)
  expect((permissionsAfter.origins || []).filter(origin => origin !== `${alphaOrigin}/*`).sort())
    .toEqual((permissionsBefore.origins || []).filter(origin => origin !== `${alphaOrigin}/*`).sort())
})

test('Page Toolbox closed Shadow control stays generation-bound across two origins and teardown', async ({
  context,
  extensionId,
  moduleFixtures,
}) => {
  const alphaOrigin = new URL(moduleFixtures.primary.manifestUrl).origin
  const betaOrigin = new URL(moduleFixtures.secondary.manifestUrl).origin
  const alpha = await context.newPage()
  const beta = await context.newPage()
  await alpha.goto(`${alphaOrigin}/journal-page-toolbox-poc`, { waitUntil: 'domcontentloaded' })
  await beta.goto(`${betaOrigin}/journal-page-toolbox-poc`, { waitUntil: 'domcontentloaded' })
  let panel = await openManagementPanel(context, extensionId)
  await installFixtureModule(panel, moduleFixtures.primary.manifestUrl, moduleFixtures.primary.manifest.id)
  await installFixtureModule(panel, moduleFixtures.secondary.manifestUrl, moduleFixtures.secondary.manifest.id)
  let toolboxCard = panel.locator('[data-testid="module-card"][data-module-id="dev.oneweb.page-toolbox"]')

  const isolatedIds = [
    'dev.juck.repolens',
    'dev.oneweb.bookmark-doctor',
    'dev.oneweb.clash-control',
    'dev.oneweb.browser-journal',
    moduleFixtures.primary.manifest.id,
    moduleFixtures.secondary.manifest.id,
  ]
  const recordsBefore = Object.fromEntries(await Promise.all(isolatedIds.map(async id => [
    id,
    await readStoredModule(panel, id),
  ])))
  const protectedStateIds = isolatedIds.filter(id => id !== 'dev.oneweb.browser-journal')
  const localBefore = await seedModuleLocalState(panel, protectedStateIds)
  const storageBefore = await panel.evaluate(() => chrome.storage.local.get(null))
  const permissionsBefore = await panel.evaluate(() => chrome.permissions.getAll())
  const requestsBefore = {
    primary: moduleFixtures.primary.requests.count,
    secondary: moduleFixtures.secondary.requests.count,
  }

  const status = () => panel.evaluate(async () => (
    await chrome.runtime.sendMessage({
      channel: 'oneweb.page-toolbox.management',
      version: 1,
      type: 'PAGE_TOOLBOX_STATUS',
    })
  ).result) as Promise<{
    snapshot: {
      approvedOrigins: string[]
      sessions: Array<{ exactOrigin: string, generation: number, phase: string }>
    }
  }>
  const sessionForAlpha = async () => (
    (await status()).snapshot.sessions.find(session => session.exactOrigin === alphaOrigin)
  )
  const readAlphaTools = () => panel.evaluate(async (origin) => {
    const stored = await chrome.storage.local.get('oneweb.module-state.v1:dev.oneweb.page-toolbox')
    const state = stored['oneweb.module-state.v1:dev.oneweb.page-toolbox'] as {
      settings?: { sites?: Record<string, { enabledToolIds?: string[] }> }
    } | undefined
    return state?.settings?.sites?.[origin]?.enabledToolIds || []
  }, alphaOrigin)
  const approveAlpha = async () => {
    await alpha.bringToFront()
    await toolboxCard.getByTestId('page-toolbox-refresh').evaluate(node => (node as HTMLButtonElement).click())
    await toolboxCard.getByTestId('page-toolbox-prepare-site').evaluate(node => (node as HTMLButtonElement).click())
    await expect(toolboxCard.getByTestId('page-toolbox-site-review')).toContainText(alphaOrigin)
    await toolboxCard.getByTestId('page-toolbox-confirm-site').click()
    await expect(toolboxCard.getByTestId('page-toolbox-control')).toHaveAttribute('data-state', 'ready')
  }

  await toolboxCard.getByTestId('module-toggle').click()
  await expect(toolboxCard.getByTestId('module-toggle')).toHaveAttribute('aria-checked', 'true')
  await approveAlpha()
  const shadowHost = alpha.locator('[data-oneweb-page-toolbox-control]')
  await expect(shadowHost).toHaveCount(1)
  expect(await shadowHost.evaluate(node => ({
    closed: node.shadowRoot === null,
    lightText: node.textContent,
    pageSecretVisible: node.textContent?.includes('page-local-secret'),
    tabIndex: (node as HTMLElement).tabIndex,
  }))).toEqual({ closed: true, lightText: '', pageSecretVisible: false, tabIndex: 0 })
  await expect(beta.locator('[data-oneweb-page-toolbox-control]')).toHaveCount(0)

  await shadowHost.focus()
  await alpha.keyboard.press('Enter')
  await alpha.keyboard.press('Tab')
  await alpha.keyboard.press('Space')
  await expect.poll(readAlphaTools).toContain('password-visibility')
  await alpha.locator('#toolbox-password').click({ clickCount: 2 })
  await expect(alpha.locator('#toolbox-password')).toHaveAttribute('type', 'text')
  await alpha.locator('#toolbox-password').click({ clickCount: 2 })
  await expect(alpha.locator('#toolbox-password')).toHaveAttribute('type', 'password')

  await alpha.locator('#toolbox-copy-target').click()
  await shadowHost.focus()
  await alpha.keyboard.press('Tab')
  await alpha.keyboard.press('Tab')
  await alpha.keyboard.press('Space')
  await expect.poll(readAlphaTools).toContain('free-page-edit')
  await expect(alpha.locator('body')).toHaveAttribute('contenteditable', 'true')
  expect(await readAlphaTools()).toEqual(['free-page-edit', 'password-visibility'])
  await expect(beta.locator('body')).toHaveAttribute('contenteditable', 'false')
  await expect(beta.locator('#toolbox-password')).toHaveAttribute('type', 'password')

  await alpha.bringToFront()
  await toolboxCard.getByTestId('page-toolbox-refresh').evaluate(node => (node as HTMLButtonElement).click())
  await expect(toolboxCard.locator('[data-tool-id="password-visibility"] input[data-page-toolbox-enabled]'))
    .toBeChecked()
  await expect(toolboxCard.locator('[data-tool-id="free-page-edit"] input[data-page-toolbox-enabled]'))
    .toBeChecked()

  await shadowHost.evaluate((node) => {
    node.setAttribute('data-old-generation', 'page-owned-marker')
    node.remove()
    const replacement = document.createElement('div')
    replacement.setAttribute('data-oneweb-page-toolbox-control', 'page-owned-replacement')
    replacement.textContent = 'page-owned replacement'
    document.documentElement.append(replacement)
  })
  await expect(alpha.locator('[data-oneweb-page-toolbox-control="page-owned-replacement"]'))
    .toHaveText('page-owned replacement')
  await expect(alpha.locator('body')).toHaveAttribute('contenteditable', 'true')

  const generationBeforeNavigation = (await sessionForAlpha())!.generation
  await alpha.goto(`${alphaOrigin}/journal-page-toolbox-poc?shadow-navigation=2`, {
    waitUntil: 'domcontentloaded',
  })
  await expect.poll(async () => (await sessionForAlpha())?.generation || 0).toBeGreaterThan(generationBeforeNavigation)
  await expect(alpha.locator('[data-oneweb-page-toolbox-control]')).toHaveCount(1)
  await expect(alpha.locator('[data-oneweb-page-toolbox-control="page-owned-replacement"]')).toHaveCount(0)
  await expect(alpha.locator('body')).toHaveAttribute('contenteditable', 'true')

  const generationBeforeRestart = (await sessionForAlpha())!.generation
  await alpha.locator('[data-oneweb-page-toolbox-control]').evaluate(node => (
    node.setAttribute('data-old-generation', 'worker-restart')
  ))
  let [background] = context.serviceWorkers()
  if (!background)
    background = await context.waitForEvent('serviceworker')
  const workerEvent = context.waitForEvent('serviceworker')
  await background.evaluate(() => chrome.runtime.reload()).catch(() => undefined)
  await panel.close().catch(() => undefined)
  await workerEvent
  panel = await openManagementPanel(context, extensionId)
  toolboxCard = panel.locator('[data-testid="module-card"][data-module-id="dev.oneweb.page-toolbox"]')
  await expect.poll(async () => (await sessionForAlpha())?.phase).toBe('ready')
  expect((await sessionForAlpha())?.generation).not.toBe(generationBeforeRestart)
  await expect(alpha.locator('[data-oneweb-page-toolbox-control]')).toHaveCount(1)
  await expect(alpha.locator('[data-oneweb-page-toolbox-control][data-old-generation]')).toHaveCount(0)
  await expect(alpha.locator('body')).toHaveAttribute('contenteditable', 'true')

  await alpha.bringToFront()
  await toolboxCard.getByTestId('page-toolbox-refresh').evaluate(node => (node as HTMLButtonElement).click())
  await toolboxCard.getByTestId('page-toolbox-revoke-site').evaluate(node => (node as HTMLButtonElement).click())
  await expect(alpha.locator('[data-oneweb-page-toolbox-control]')).toHaveCount(0)
  await expect(alpha.locator('body')).toHaveAttribute('contenteditable', 'false')
  await expect(alpha.locator('#toolbox-password')).toHaveAttribute('type', 'password')
  await expect.poll(async () => sessionForAlpha()).toBeUndefined()

  await approveAlpha()
  await expect(alpha.locator('[data-oneweb-page-toolbox-control]')).toHaveCount(1)
  await toolboxCard.getByTestId('module-toggle').click()
  await expect(toolboxCard.getByTestId('module-toggle')).toHaveAttribute('aria-checked', 'false')
  await expect(alpha.locator('[data-oneweb-page-toolbox-control]')).toHaveCount(0)
  await expect.poll(async () => (await status()).snapshot.sessions).toEqual([])

  const recordsAfter = Object.fromEntries(await Promise.all(isolatedIds.map(async id => [
    id,
    await readStoredModule(panel, id),
  ])))
  expect(recordsAfter).toEqual(recordsBefore)
  expect(await readModuleLocalState(panel, protectedStateIds)).toEqual(localBefore)
  const permissionsAfter = await panel.evaluate(() => chrome.permissions.getAll())
  expect(permissionsAfter.permissions).toEqual(permissionsBefore.permissions)
  expect((permissionsAfter.origins || []).sort()).toEqual((permissionsBefore.origins || []).sort())
  const storageAfter = await panel.evaluate(() => chrome.storage.local.get(null))
  for (const key of ['oneweb.modules.v1', 'oneweb.module-state.v1:dev.oneweb.page-toolbox']) {
    delete storageBefore[key]
    delete storageAfter[key]
  }
  expect(storageAfter).toEqual(storageBefore)
  expect(moduleFixtures.primary.requests.count).toBe(requestsBefore.primary)
  expect(moduleFixtures.secondary.requests.count).toBe(requestsBefore.secondary)
})

test('GitHub SPA context reaches the 420px panel through the generic module host', async ({ context, extensionId, page }) => {
  const consoleProblems: string[] = []
  await page.goto('https://github.com/vuejs/core', { waitUntil: 'domcontentloaded' })
  await expect(page).toHaveURL(/github\.com\/vuejs\/core/)

  const panel = await context.newPage()
  panel.on('console', (message) => {
    if (message.type() === 'error')
      consoleProblems.push(`panel: ${message.text()}`)
  })
  await panel.setViewportSize({ width: 420, height: 900 })
  await panel.goto(`chrome-extension://${extensionId}/dist/sidebar/index.html`)
  await page.bringToFront()

  await expect(panel.locator('.brand div span')).toHaveText('vuejs/core', { timeout: 15_000 })
  await expect(panel.locator('.bridge-state')).toHaveAttribute('data-ready', 'true', { timeout: 15_000 })
  const embed = panel.frameLocator('[data-testid="oneweb-module-frame"]')
  await expect(embed.locator('#repo')).toHaveText('vuejs/core')
  await expect(embed.locator('#summary')).toBeVisible({ timeout: 15_000 })
  await expect(embed.locator('#state-text')).toContainText('缓存摘要')
  expect(await embed.locator('body').evaluate(() => ({
    contexts: (globalThis as unknown as { __onewebRuntimeContextCount: number }).__onewebRuntimeContextCount,
    status: (globalThis as unknown as { __onewebRuntimeClient: { status: string } }).__onewebRuntimeClient.status,
  }))).toEqual({ contexts: 1, status: 'connected' })

  const isolatedModuleIds = [
    'dev.juck.repolens',
    'dev.oneweb.bookmark-doctor',
    'dev.oneweb.clash-control',
    'dev.oneweb.browser-journal',
  ]
  const beforeRuntimeReload = await panel.evaluate(async (ids) => {
    const stored = await chrome.storage.local.get([
      'oneweb.modules.v1',
      ...ids.map(id => `oneweb.module-state.v1:${id}`),
    ])
    return structuredClone(stored)
  }, isolatedModuleIds)
  await embed.locator('body').evaluate(() => location.reload())
  await expect(embed.locator('#repo')).toHaveText('vuejs/core', { timeout: 15_000 })
  await expect(panel.locator('.bridge-state')).toHaveAttribute('data-ready', 'true', { timeout: 15_000 })
  expect(await embed.locator('body').evaluate(() => ({
    contexts: (globalThis as unknown as { __onewebRuntimeContextCount: number }).__onewebRuntimeContextCount,
    status: (globalThis as unknown as { __onewebRuntimeClient: { status: string } }).__onewebRuntimeClient.status,
  }))).toEqual({ contexts: 1, status: 'connected' })
  expect(await panel.evaluate(async (ids) => {
    const stored = await chrome.storage.local.get([
      'oneweb.modules.v1',
      ...ids.map(id => `oneweb.module-state.v1:${id}`),
    ])
    return structuredClone(stored)
  }, isolatedModuleIds)).toEqual(beforeRuntimeReload)

  const initialState = await embed.locator('#state-text').textContent()
  await page.evaluate(() => {
    history.replaceState({}, '', '/vuejs/core')
    window.dispatchEvent(new Event('turbo:load'))
    window.dispatchEvent(new Event('turbo:load'))
  })
  await page.waitForTimeout(350)
  await expect(embed.locator('#state-text')).toHaveText(initialState || '')

  await page.evaluate(() => {
    history.pushState({}, '', '/vuejs/core/issues')
    window.dispatchEvent(new Event('turbo:load'))
  })
  await expect(embed.locator('#meta')).toContainText('issues')

  await page.evaluate(() => {
    history.pushState({}, '', '/facebook/react/pulls')
    window.dispatchEvent(new Event('turbo:load'))
  })
  await expect(panel.locator('.brand div span')).toHaveText('facebook/react')
  await expect(embed.locator('#repo')).toHaveText('facebook/react')

  await page.evaluate(() => {
    history.pushState({}, '', '/vuejs/core')
    window.dispatchEvent(new Event('turbo:load'))
  })
  await expect(embed.locator('#repo')).toHaveText('vuejs/core')
  await expect(embed.locator('#state-text')).toContainText('缓存摘要')

  await page.evaluate(() => {
    history.pushState({}, '', '/settings/profile')
    window.dispatchEvent(new Event('turbo:load'))
  })
  await expect(panel.locator('.brand div span')).toHaveText('等待页面上下文')
  await expect(embed.locator('#waiting')).toBeVisible()

  await page.evaluate(() => {
    history.pushState({}, '', '/vuejs/core')
    window.dispatchEvent(new Event('turbo:load'))
  })
  await expect(embed.locator('#repo')).toHaveText('vuejs/core')
  await expect(embed.locator('#state-text')).toContainText('缓存摘要')

  const beforeAttack = await panel.locator('.bridge-state').textContent()
  await panel.evaluate((origin) => {
    const target = document.querySelector('iframe') as HTMLIFrameElement
    window.dispatchEvent(new MessageEvent('message', {
      origin: 'https://evil.example',
      source: target.contentWindow,
      data: { protocol: 'oneweb.module', version: 1, moduleId: 'dev.juck.repolens', type: 'MODULE_STATUS', state: 'owned' },
    }))
    window.postMessage({ protocol: 'oneweb.module', version: 1, moduleId: 'dev.juck.repolens', type: 'MODULE_STATUS', state: 'owned' }, origin)
  }, 'http://127.0.0.1:4747')
  await expect(panel.locator('.bridge-state')).toHaveText(beforeAttack || '')

  await embed.getByRole('button', { name: '深度分析' }).click()
  await expect(embed.locator('#state-text')).toHaveText(/深度分析完成|分析完成，部分外部数据不可用/, { timeout: 30_000 })

  const layout = await panel.evaluate(() => ({
    width: document.documentElement.clientWidth,
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    iframeOrigin: new URL((document.querySelector('iframe') as HTMLIFrameElement).src).origin,
    extensionHasRuntime: Boolean(globalThis.chrome?.runtime?.id),
  }))
  expect(layout).toEqual({
    width: 420,
    overflow: 0,
    iframeOrigin: 'http://127.0.0.1:4747',
    extensionHasRuntime: true,
  })
  expect(await embed.locator('body').evaluate(() => Boolean(globalThis.chrome?.runtime))).toBe(false)
  await panel.screenshot({ path: reportScreenshot, fullPage: true })
  expect(consoleProblems.filter(problem => !problem.includes('favicon'))).toEqual([])
})

test('typed capability client and dispatcher complete result, cancel and stable error across iframe reload', async ({ context, extensionId }) => {
  const panel = await context.newPage()
  await panel.goto(`chrome-extension://${extensionId}/dist/sidebar/index.html`)
  const before = await panel.evaluate(async () => ({
    permissions: await chrome.permissions.getAll(),
    storage: await chrome.storage.local.get(null),
  }))

  const rpcPage = await context.newPage()
  const browserErrors: string[] = []
  rpcPage.on('pageerror', error => browserErrors.push(error.message))
  await rpcPage.goto('http://127.0.0.1:4747/rpc-host')
  const rpcFrame = rpcPage.frameLocator('#rpc-frame')
  await expect(rpcPage.locator('#host-state')).toHaveText('ready')
  await expect(rpcFrame.locator('#rpc-result')).toHaveText('chromium')
  await expect(rpcFrame.locator('#rpc-cancel')).toHaveText('REQUEST_CANCELLED')
  await expect(rpcFrame.locator('#rpc-error')).toHaveText('CAPABILITY_UNAVAILABLE')
  await expect(rpcPage.locator('#host-cancelled')).toHaveText('aborted')
  await expect(rpcPage.locator('#rpc-generation')).toHaveText('1')
  const firstRequestId = await rpcFrame.locator('body').getAttribute('data-request-id')
  const firstCancelRequestId = await rpcFrame.locator('body').getAttribute('data-cancel-request-id')
  expect(firstRequestId).toMatch(/^request-[0-9a-f]{48}$/)
  expect(firstCancelRequestId).toMatch(/^request-[0-9a-f]{48}$/)
  expect(firstCancelRequestId).not.toBe(firstRequestId)

  await rpcPage.locator('#reload-rpc').click()
  await expect(rpcPage.locator('#rpc-generation')).toHaveText('2')
  await expect(rpcPage.locator('#host-state')).toHaveText('ready')
  await expect(rpcFrame.locator('#rpc-result')).toHaveText('chromium')
  await expect(rpcFrame.locator('#rpc-cancel')).toHaveText('REQUEST_CANCELLED')
  await expect(rpcFrame.locator('#rpc-error')).toHaveText('CAPABILITY_UNAVAILABLE')
  await expect(rpcPage.locator('#host-cancelled')).toHaveText('aborted')
  const secondRequestId = await rpcFrame.locator('body').getAttribute('data-request-id')
  expect(secondRequestId).toMatch(/^request-[0-9a-f]{48}$/)
  expect(secondRequestId).not.toBe(firstRequestId)

  expect(await panel.evaluate(async () => ({
    permissions: await chrome.permissions.getAll(),
    storage: await chrome.storage.local.get(null),
  }))).toEqual(before)
  expect(browserErrors).toEqual([])
})

test('two installed remote modules keep typed RPC failures, quotas and lifecycle authority isolated', async ({
  context,
  extensionId,
  moduleFixtures,
}) => {
  const panel = await openManagementPanel(context, extensionId)
  await installFixtureModule(panel, moduleFixtures.primary.manifestUrl, moduleFixtures.primary.manifest.id)
  await installFixtureModule(panel, moduleFixtures.secondary.manifestUrl, moduleFixtures.secondary.manifest.id)
  const isolatedModuleIds = [
    'dev.juck.repolens',
    'dev.oneweb.bookmark-doctor',
    'dev.oneweb.clash-control',
    'dev.oneweb.browser-journal',
    moduleFixtures.primary.manifest.id,
    moduleFixtures.secondary.manifest.id,
  ]
  await seedModuleLocalState(panel, isolatedModuleIds)
  const before = await panel.evaluate(async () => ({
    permissions: await chrome.permissions.getAll(),
    storage: await chrome.storage.local.get(null),
  }))

  const rpcPage = await context.newPage()
  const browserErrors: string[] = []
  rpcPage.on('pageerror', error => browserErrors.push(error.message))
  await rpcPage.goto('http://127.0.0.1:4747/rpc-isolation-host')
  const alphaFrame = rpcPage.frameLocator('#rpc-alpha')
  const betaFrame = rpcPage.frameLocator('#rpc-beta')
  await expect(rpcPage.locator('#alpha-state')).toHaveText('ready')
  await expect(rpcPage.locator('#beta-state')).toHaveText('ready')
  await expect(alphaFrame.locator('#state')).toHaveText('connected')
  await expect(betaFrame.locator('#state')).toHaveText('connected')

  const alphaSuccess = await alphaFrame.locator('body').evaluate(async () => (
    (globalThis as typeof globalThis & { __rpcFixture: RpcFixtureBrowserApi })
      .__rpcFixture
      .runSuccess('alpha-success')
  ))
  const betaSuccess = await betaFrame.locator('body').evaluate(async () => (
    (globalThis as typeof globalThis & { __rpcFixture: RpcFixtureBrowserApi })
      .__rpcFixture
      .runSuccess('beta-success')
  ))
  expect(alphaSuccess.result).toBe('alpha-success')
  expect(betaSuccess.result).toBe('beta-success')
  expect(alphaSuccess.requestId).toMatch(/^request-[0-9a-f]{48}$/)
  expect(betaSuccess.requestId).toMatch(/^request-[0-9a-f]{48}$/)
  expect(alphaSuccess.requestId).not.toBe(betaSuccess.requestId)
  expect(await Promise.all([
    alphaFrame.locator('body').evaluate(async () => (
      (globalThis as typeof globalThis & { __rpcFixture: RpcFixtureBrowserApi })
        .__rpcFixture
        .runFailure()
    )),
    betaFrame.locator('body').evaluate(async () => (
      (globalThis as typeof globalThis & { __rpcFixture: RpcFixtureBrowserApi })
        .__rpcFixture
        .runFailure()
    )),
  ])).toEqual(['OPERATION_FAILED', 'OPERATION_FAILED'])
  expect(await Promise.all([
    alphaFrame.locator('body').evaluate(async () => (
      (globalThis as typeof globalThis & { __rpcFixture: RpcFixtureBrowserApi })
        .__rpcFixture
        .runCancel()
    )),
    betaFrame.locator('body').evaluate(async () => (
      (globalThis as typeof globalThis & { __rpcFixture: RpcFixtureBrowserApi })
        .__rpcFixture
        .runCancel()
    )),
  ])).toEqual(['REQUEST_CANCELLED', 'REQUEST_CANCELLED'])

  const alphaFlood = alphaFrame.locator('body').evaluate(async () => (
    (globalThis as typeof globalThis & { __rpcFixture: RpcFixtureBrowserApi })
      .__rpcFixture
      .runFlood()
  ))
  const betaDuringFlood = betaFrame.locator('body').evaluate(async () => (
    (globalThis as typeof globalThis & { __rpcFixture: RpcFixtureBrowserApi })
      .__rpcFixture
      .runSuccess('beta-during-alpha-flood')
  ))
  expect(await alphaFlood).toBe('IN_FLIGHT_LIMIT_REACHED')
  expect((await betaDuringFlood).result).toBe('beta-during-alpha-flood')

  const heldRequestId = await alphaFrame.locator('body').evaluate(async () => (
    (globalThis as typeof globalThis & { __rpcFixture: RpcFixtureBrowserApi })
      .__rpcFixture
      .beginHold('hold-forged-response')
  ))
  await expect.poll(() => rpcPage.evaluate(() => (
    (globalThis as typeof globalThis & { __rpcHost: RpcHostBrowserApi })
      .__rpcHost
      .info('alpha')
      .lastRequestId
  ))).toBe(heldRequestId)
  expect(await rpcPage.evaluate(() => (
    (globalThis as typeof globalThis & { __rpcHost: RpcHostBrowserApi })
      .__rpcHost
      .forge('alpha')
  ))).toBe(true)
  expect(await alphaFrame.locator('body').evaluate(async () => (
    (globalThis as typeof globalThis & { __rpcFixture: RpcFixtureBrowserApi })
      .__rpcFixture
      .heldStatus()
  ))).toBe('pending')
  expect((await betaFrame.locator('body').evaluate(async () => (
    (globalThis as typeof globalThis & { __rpcFixture: RpcFixtureBrowserApi })
      .__rpcFixture
      .runSuccess('beta-after-alpha-forgery')
  ))).result).toBe('beta-after-alpha-forgery')
  expect(await alphaFrame.locator('body').evaluate(async () => (
    (globalThis as typeof globalThis & { __rpcFixture: RpcFixtureBrowserApi })
      .__rpcFixture
      .cancelHeld()
  ))).toBe('REQUEST_CANCELLED')

  expect(await rpcPage.evaluate(() => (
    (globalThis as typeof globalThis & { __rpcHost: RpcHostBrowserApi })
      .__rpcHost
      .reload('alpha')
  ))).toBe(true)
  await expect(rpcPage.locator('#alpha-generation')).toHaveText('2')
  await expect(rpcPage.locator('#alpha-state')).toHaveText('ready')
  await expect(alphaFrame.locator('#state')).toHaveText('connected')
  expect(await rpcPage.evaluate(() => (
    (globalThis as typeof globalThis & { __rpcHost: RpcHostBrowserApi })
      .__rpcHost
      .replay('alpha')
  ))).toBe(true)
  const [alphaAfterReplay, betaAfterReplay] = await Promise.all([
    alphaFrame.locator('body').evaluate(async () => (
      (globalThis as typeof globalThis & { __rpcFixture: RpcFixtureBrowserApi })
        .__rpcFixture
        .runSuccess('alpha-new-generation')
    )),
    betaFrame.locator('body').evaluate(async () => (
      (globalThis as typeof globalThis & { __rpcFixture: RpcFixtureBrowserApi })
        .__rpcFixture
        .runSuccess('beta-after-alpha-replay')
    )),
  ])
  expect(alphaAfterReplay.result).toBe('alpha-new-generation')
  expect(betaAfterReplay.result).toBe('beta-after-alpha-replay')
  expect(alphaAfterReplay.requestId).not.toBe(heldRequestId)
  expect(await rpcPage.evaluate(() => (
    (globalThis as typeof globalThis & { __rpcHost: RpcHostBrowserApi })
      .__rpcHost
      .info('beta')
      .generation
  ))).toBe(1)

  await alphaFrame.locator('body').evaluate(async () => (
    (globalThis as typeof globalThis & { __rpcFixture: RpcFixtureBrowserApi })
      .__rpcFixture
      .beginHold('hold-before-remove')
  ))
  await expect.poll(() => rpcPage.evaluate(() => (
    (globalThis as typeof globalThis & { __rpcHost: RpcHostBrowserApi })
      .__rpcHost
      .info('alpha')
      .lastRequestId
  ))).not.toBeNull()
  const alphaAbortsBeforeRemove = await rpcPage.evaluate(() => (
    (globalThis as typeof globalThis & { __rpcHost: RpcHostBrowserApi })
      .__rpcHost
      .info('alpha')
      .aborts
  ))
  expect(await rpcPage.evaluate(() => (
    (globalThis as typeof globalThis & { __rpcHost: RpcHostBrowserApi })
      .__rpcHost
      .remove('alpha')
  ))).toBe(true)
  await expect(rpcPage.locator('#alpha-state')).toHaveText('removed')
  await expect.poll(() => rpcPage.evaluate(() => (
    (globalThis as typeof globalThis & { __rpcHost: RpcHostBrowserApi })
      .__rpcHost
      .info('alpha')
      .aborts
  ))).toBe(alphaAbortsBeforeRemove + 1)
  expect((await betaFrame.locator('body').evaluate(async () => (
    (globalThis as typeof globalThis & { __rpcFixture: RpcFixtureBrowserApi })
      .__rpcFixture
      .runSuccess('beta-after-alpha-remove')
  ))).result).toBe('beta-after-alpha-remove')

  expect(await panel.evaluate(async () => ({
    permissions: await chrome.permissions.getAll(),
    storage: await chrome.storage.local.get(null),
  }))).toEqual(before)
  expect(browserErrors).toEqual([])
})

test('storage.module keeps CAS documents, lifecycle and two installed namespaces isolated', async ({
  context,
  extensionId,
  moduleFixtures,
}) => {
  let manager = await openManagementPanel(context, extensionId)
  await installFixtureModule(manager, moduleFixtures.primary.manifestUrl, moduleFixtures.primary.manifest.id)
  await installFixtureModule(manager, moduleFixtures.secondary.manifestUrl, moduleFixtures.secondary.manifest.id)
  await installFixtureModule(manager, moduleFixtures.storagePeer.manifestUrl, moduleFixtures.storagePeer.manifest.id)

  const protectedModuleIds = [
    'dev.juck.repolens',
    'dev.oneweb.bookmark-doctor',
    'dev.oneweb.clash-control',
    'dev.oneweb.browser-journal',
    moduleFixtures.primary.manifest.id,
  ]
  const protectedRecords = Object.fromEntries(await Promise.all(protectedModuleIds.map(async id => [
    id,
    await readStoredModule(manager, id),
  ])))
  const protectedStateModuleIds = protectedModuleIds.filter(id => id !== 'dev.oneweb.browser-journal')
  const protectedState = await seedModuleLocalState(manager, protectedStateModuleIds)
  const stableStorageBefore = await manager.evaluate(async () => {
    const stored = await chrome.storage.local.get(null)
    return Object.fromEntries(Object.entries(stored).filter(([key]) => (
      key !== 'oneweb.modules.v1' && !key.startsWith('oneweb.remote-storage.v1:')
    )))
  })
  const permissionsBefore = await manager.evaluate(() => chrome.permissions.getAll())
  const consoleMessages: string[] = []

  const openStoragePanel = async (moduleId: string) => {
    const panel = await context.newPage()
    panel.on('console', message => consoleMessages.push(message.text()))
    await panel.goto(
      `chrome-extension://${extensionId}/dist/sidebar/index.html?moduleId=${encodeURIComponent(moduleId)}`,
    )
    await expect(panel.locator('.bridge-state')).toHaveAttribute('data-ready', 'true', { timeout: 15_000 })
    const frame = panel.frameLocator('[data-testid="oneweb-module-frame"]')
    await expect(frame.locator('#state')).toHaveText('connected')
    return { frame, panel }
  }

  let secondarySurface = await openStoragePanel(moduleFixtures.secondary.manifest.id)
  let peerSurface = await openStoragePanel(moduleFixtures.storagePeer.manifest.id)
  expect(await secondarySurface.frame.locator('body').evaluate(() => (
    (globalThis as typeof globalThis & { __storageModuleFixture: StorageModuleFixtureBrowserApi })
      .__storageModuleFixture
      .info()
  ))).toEqual({
    extensionRuntime: false,
    moduleId: moduleFixtures.secondary.manifest.id,
    status: 'connected',
  })

  const [secondaryInitial, peerInitial] = await Promise.all([
    readStorageFixture(secondarySurface.frame),
    readStorageFixture(peerSurface.frame),
  ])
  expect(secondaryInitial).toMatchObject({ ok: true, result: { document: null } })
  expect(peerInitial).toMatchObject({ ok: true, result: { document: null } })
  const secondaryInitialRevision = secondaryInitial.result!.revision
  const peerInitialRevision = peerInitial.result!.revision
  expect(secondaryInitialRevision).not.toBe(peerInitialRevision)

  const secondaryDocument = {
    owner: 'secondary',
    text: '<storage-owner-secondary><img data-storage-xss src=x>',
  }
  const peerDocument = { owner: 'storage-peer', sequence: [1, 2, 3] }
  const [secondaryReplace, peerReplace] = await Promise.all([
    replaceStorageFixture(secondarySurface.frame, secondaryInitialRevision, secondaryDocument),
    replaceStorageFixture(peerSurface.frame, peerInitialRevision, peerDocument),
  ])
  expect(secondaryReplace.ok).toBe(true)
  expect(peerReplace.ok).toBe(true)
  expect(secondaryReplace.result!.revision).not.toBe(secondaryInitialRevision)
  expect(peerReplace.result!.revision).not.toBe(peerInitialRevision)

  expect(await replaceStorageFixture(
    secondarySurface.frame,
    secondaryInitialRevision,
    { staleWriter: true },
  )).toEqual({ ok: false, code: 'STORAGE_REVISION_CONFLICT' })
  expect(await readStorageFixture(secondarySurface.frame)).toMatchObject({
    ok: true,
    result: { document: secondaryDocument, revision: secondaryReplace.result!.revision },
  })
  expect(await readStorageFixture(peerSurface.frame)).toMatchObject({
    ok: true,
    result: { document: peerDocument, revision: peerReplace.result!.revision },
  })
  expect(await secondarySurface.frame.locator('#result').locator('img,script')).toHaveCount(0)
  expect(await peerSurface.frame.locator('body').textContent()).not.toContain('storage-owner-secondary')

  const peerClear = await clearStorageFixture(peerSurface.frame, peerReplace.result!.revision)
  expect(peerClear.ok).toBe(true)
  expect(await readStorageFixture(peerSurface.frame)).toMatchObject({
    ok: true,
    result: { document: null, revision: peerClear.result!.revision },
  })
  const peerRestored = await replaceStorageFixture(
    peerSurface.frame,
    peerClear.result!.revision,
    peerDocument,
  )
  expect(peerRestored.ok).toBe(true)

  const remoteStorageBeforeLifecycle = await manager.evaluate(async () => {
    const stored = await chrome.storage.local.get(null)
    return Object.fromEntries(Object.entries(stored).filter(([key]) => key.startsWith('oneweb.remote-storage.v1:')))
  })
  expect(Object.keys(remoteStorageBeforeLifecycle).sort()).toEqual([
    `oneweb.remote-storage.v1:${encodeURIComponent(moduleFixtures.secondary.manifest.id)}`,
    `oneweb.remote-storage.v1:${encodeURIComponent(moduleFixtures.storagePeer.manifest.id)}`,
  ].sort())
  const storedSecondaryRecord = await readStoredModule(manager, moduleFixtures.secondary.manifest.id)
  expect(JSON.stringify(storedSecondaryRecord)).not.toContain('storage-owner-secondary')
  expect(await manager.locator('body').textContent()).not.toContain('storage-owner-secondary')

  const peerRecordBeforeSecondaryDisable = await readStoredModule(manager, moduleFixtures.storagePeer.manifest.id)
  let secondaryCard = manager.locator(
    `[data-testid="module-card"][data-module-id="${moduleFixtures.secondary.manifest.id}"]`,
  )
  await secondaryCard.getByTestId('module-toggle').click()
  await expect(secondaryCard.getByTestId('module-toggle')).toHaveAttribute('aria-checked', 'false')
  expect(await readStorageFixture(secondarySurface.frame)).toEqual({ ok: false, code: 'SESSION_DESTROYED' })
  expect(await readStorageFixture(peerSurface.frame)).toMatchObject({
    ok: true,
    result: { document: peerDocument },
  })
  expect(await readStoredModule(manager, moduleFixtures.storagePeer.manifest.id))
    .toEqual(peerRecordBeforeSecondaryDisable)

  await secondaryCard.getByTestId('module-toggle').click()
  await expect(secondaryCard.getByTestId('module-toggle')).toHaveAttribute('aria-checked', 'true')
  await secondarySurface.panel.close()
  secondarySurface = await openStoragePanel(moduleFixtures.secondary.manifest.id)
  expect(await readStorageFixture(secondarySurface.frame)).toMatchObject({
    ok: true,
    result: { document: secondaryDocument, revision: secondaryReplace.result!.revision },
  })

  const secondaryBeforeRestart = await readStoredModule(manager, moduleFixtures.secondary.manifest.id)
  const peerBeforeRestart = await readStoredModule(manager, moduleFixtures.storagePeer.manifest.id)
  await Promise.all([manager.close(), secondarySurface.panel.close(), peerSurface.panel.close()])
  const background = context.serviceWorkers()[0]
  await background.evaluate(() => chrome.runtime.reload()).catch(() => undefined)
  await new Promise(resolve => setTimeout(resolve, 500))
  manager = await openManagementPanel(context, extensionId)
  secondarySurface = await openStoragePanel(moduleFixtures.secondary.manifest.id)
  peerSurface = await openStoragePanel(moduleFixtures.storagePeer.manifest.id)
  expect(await readStorageFixture(secondarySurface.frame)).toMatchObject({
    ok: true,
    result: { document: secondaryDocument, revision: secondaryReplace.result!.revision },
  })
  expect(await readStorageFixture(peerSurface.frame)).toMatchObject({
    ok: true,
    result: { document: peerDocument, revision: peerRestored.result!.revision },
  })
  expect(await readStoredModule(manager, moduleFixtures.secondary.manifest.id)).toEqual(secondaryBeforeRestart)
  expect(await readStoredModule(manager, moduleFixtures.storagePeer.manifest.id)).toEqual(peerBeforeRestart)

  moduleFixtures.secondary.setManifest({
    ...moduleFixtures.secondary.manifest,
    version: '0.2.0',
    capabilities: [],
  })
  secondaryCard = manager.locator(
    `[data-testid="module-card"][data-module-id="${moduleFixtures.secondary.manifest.id}"]`,
  )
  await secondaryCard.getByTestId('module-update-check').click()
  await expect(secondaryCard.getByTestId('module-update-state')).toHaveText('安全更新')
  await secondaryCard.getByTestId('module-update-apply').click()
  await expect(manager.getByTestId('module-manager-status')).toContainText('已更新至 0.2.0')
  expect(await readStorageFixture(secondarySurface.frame)).toEqual({ ok: false, code: 'SESSION_DESTROYED' })
  expect(await readStorageFixture(peerSurface.frame)).toMatchObject({
    ok: true,
    result: { document: peerDocument },
  })
  expect(await readStoredModule(manager, moduleFixtures.storagePeer.manifest.id)).toEqual(peerBeforeRestart)
  const secondaryAfterRevocation = await readStoredModule(manager, moduleFixtures.secondary.manifest.id)
  expect(secondaryAfterRevocation).toMatchObject({ grantedCapabilities: [], manifest: { capabilities: [] } })

  const peerCard = manager.locator(
    `[data-testid="module-card"][data-module-id="${moduleFixtures.storagePeer.manifest.id}"]`,
  )
  await peerCard.getByTestId('module-remove').click()
  await expect(manager.getByTestId('remove-module-dialog')).toBeVisible()
  await manager.locator('[data-confirm-remove]').click()
  await expect(peerCard).toHaveCount(0)
  expect(await readStorageFixture(peerSurface.frame)).toEqual({ ok: false, code: 'SESSION_DESTROYED' })
  expect(await readStoredModule(manager, moduleFixtures.secondary.manifest.id)).toEqual(secondaryAfterRevocation)

  const remoteStorageAfterRemoval = await manager.evaluate(async () => {
    const stored = await chrome.storage.local.get(null)
    return Object.fromEntries(Object.entries(stored).filter(([key]) => key.startsWith('oneweb.remote-storage.v1:')))
  })
  expect(Object.keys(remoteStorageAfterRemoval)).toEqual([
    `oneweb.remote-storage.v1:${encodeURIComponent(moduleFixtures.secondary.manifest.id)}`,
  ])
  expect(remoteStorageAfterRemoval).toMatchObject({
    [`oneweb.remote-storage.v1:${encodeURIComponent(moduleFixtures.secondary.manifest.id)}`]: {
      document: secondaryDocument,
    },
  })

  for (const id of protectedModuleIds)
    expect(await readStoredModule(manager, id)).toEqual(protectedRecords[id])
  expect(await readModuleLocalState(manager, protectedStateModuleIds)).toEqual(protectedState)
  expect(await manager.evaluate(async () => {
    const stored = await chrome.storage.local.get(null)
    return Object.fromEntries(Object.entries(stored).filter(([key]) => (
      key !== 'oneweb.modules.v1' && !key.startsWith('oneweb.remote-storage.v1:')
    )))
  })).toEqual(stableStorageBefore)
  expect(await hasFixtureOriginPermission(manager, moduleFixtures.primary.manifestUrl)).toBe(true)
  expect(await hasFixtureOriginPermission(manager, moduleFixtures.secondary.manifestUrl)).toBe(true)
  expect(await hasFixtureOriginPermission(manager, moduleFixtures.storagePeer.manifestUrl)).toBe(false)
  const permissionsAfter = await manager.evaluate(() => chrome.permissions.getAll())
  expect(permissionsAfter.permissions).toEqual(permissionsBefore.permissions)
  const peerOriginPattern = `${new URL(moduleFixtures.storagePeer.manifestUrl).origin}/*`
  expect((permissionsAfter.origins || []).filter(origin => origin !== peerOriginPattern).sort())
    .toEqual((permissionsBefore.origins || []).filter(origin => origin !== peerOriginPattern).sort())
  expect(JSON.stringify(consoleMessages)).not.toContain('storage-owner-secondary')
})

test('module management protects seeds and applies lifecycle changes through the background', async ({ context, extensionId, page }) => {
  await page.goto('https://github.com/vuejs/core', { waitUntil: 'domcontentloaded' })
  const panel = await context.newPage()
  await panel.setViewportSize({ width: 420, height: 900 })
  await panel.goto(`chrome-extension://${extensionId}/dist/sidebar/index.html`)
  await page.bringToFront()
  await expect(panel.locator('.bridge-state')).toHaveAttribute('data-ready', 'true', { timeout: 15_000 })

  await panel.getByTestId('manage-modules').click()
  await expect(panel.getByTestId('module-manager')).toBeVisible()
  const seedCard = panel.locator('[data-testid="module-card"][data-module-id="dev.juck.repolens"]')
  await expect(seedCard).toContainText('OneWeb 预置')
  await seedCard.getByText('权限与来源').click()
  await expect(seedCard).toContainText('GitHub 仓库：repo、url、pageType')
  await expect(seedCard.getByTestId('module-remove')).toBeDisabled()
  const bookmarkDoctorCard = panel.locator('[data-testid="module-card"][data-module-id="dev.oneweb.bookmark-doctor"]')
  await expect(bookmarkDoctorCard).toContainText('OneWeb 内置模块')
  await expect(bookmarkDoctorCard.getByTestId('module-toggle')).toHaveAttribute('aria-checked', 'false')
  await bookmarkDoctorCard.getByText('权限与来源').click()
  await expect(bookmarkDoctorCard).toContainText('只读访问书签')
  await expect(bookmarkDoctorCard.locator(
    'dt',
    { hasText: '已授权浏览器能力' },
  ).locator('xpath=following-sibling::dd[1]')).toHaveText('无')

  const seedToggle = seedCard.getByTestId('module-toggle')
  await seedToggle.click()
  await expect(seedToggle).toHaveAttribute('aria-checked', 'false')
  await expect(panel.getByTestId('module-manager-status')).toHaveText('RepoLens 已停用')
  await panel.getByTestId('close-module-manager').click()
  await expect(panel.getByTestId('module-unavailable')).toBeVisible()
  await expect(panel.getByTestId('oneweb-module-frame')).toBeHidden()

  await panel.getByTestId('manage-modules').click()
  await seedCard.getByTestId('module-toggle').click()
  await expect(seedCard.getByTestId('module-toggle')).toHaveAttribute('aria-checked', 'true')
  await panel.getByTestId('close-module-manager').click()
  await expect(panel.locator('.bridge-state')).toHaveAttribute('data-ready', 'true', { timeout: 15_000 })
  await expect(panel.frameLocator('[data-testid="oneweb-module-frame"]').locator('#repo')).toHaveText('vuejs/core')

  await panel.evaluate(async () => {
    interface StoredModule {
      manifest: Record<string, unknown>
      [key: string]: unknown
    }
    const storageKey = 'oneweb.modules.v1'
    const stored = await chrome.storage.local.get(storageKey)
    const records = stored[storageKey] as StoredModule[]
    const seed = records.find(record => record.manifest.id === 'dev.juck.repolens')!
    const timestamp = new Date().toISOString()
    await chrome.storage.local.set({
      [storageKey]: [
        ...records,
        {
          ...structuredClone(seed),
          manifest: {
            ...structuredClone(seed.manifest),
            id: 'dev.juck.fixture',
            name: 'Fixture Module',
            description: 'User module removal fixture',
          },
          source: 'user',
          sourceUrl: 'http://127.0.0.1:4747/.well-known/oneweb-module.json',
          installedAt: timestamp,
          updatedAt: timestamp,
        },
      ],
    })
  })

  await panel.getByTestId('manage-modules').click()
  const userCard = panel.locator('[data-testid="module-card"][data-module-id="dev.juck.fixture"]')
  await expect(userCard).toContainText('用户添加')
  await userCard.getByTestId('module-remove').click()
  await expect(panel.getByTestId('remove-module-dialog')).toBeVisible()
  await panel.locator('[data-cancel-remove]').click()
  await expect(panel.getByTestId('remove-module-dialog')).toBeHidden()
  await expect(userCard).toBeVisible()

  await userCard.getByTestId('module-remove').click()
  await panel.locator('[data-confirm-remove]').click()
  await expect(panel.getByTestId('remove-module-dialog')).toBeHidden()
  await expect(userCard).toHaveCount(0)
  await expect(panel.getByTestId('module-manager-status')).toHaveText('Fixture Module 已移除')
  await expect(seedCard).toBeVisible()
})

test('Browser Journal records only one explicit memory session and survives no worker restart', async ({
  context,
  extensionId,
  moduleFixtures,
}) => {
  let panel = await openManagementPanel(context, extensionId)
  await installFixtureModule(panel, moduleFixtures.primary.manifestUrl, moduleFixtures.primary.manifest.id)
  await installFixtureModule(panel, moduleFixtures.secondary.manifestUrl, moduleFixtures.secondary.manifest.id)

  const otherModuleIds = [
    'dev.juck.repolens',
    'dev.oneweb.bookmark-doctor',
    'dev.oneweb.clash-control',
    moduleFixtures.primary.manifest.id,
    moduleFixtures.secondary.manifest.id,
  ]
  const recordsBefore = Object.fromEntries(await Promise.all(otherModuleIds.map(async id => [
    id,
    await readStoredModule(panel, id),
  ])))
  const stateModuleIds = [...otherModuleIds]
  const stateBefore = await seedModuleLocalState(panel, stateModuleIds)
  const originPermissionsBefore = {
    primary: await hasFixtureOriginPermission(panel, moduleFixtures.primary.manifestUrl),
    secondary: await hasFixtureOriginPermission(panel, moduleFixtures.secondary.manifestUrl),
    bookmarks: await panel.evaluate(() => chrome.permissions.contains({ permissions: ['bookmarks'] })),
  }

  let journalCard = panel.locator(
    '[data-testid="module-card"][data-module-id="dev.oneweb.browser-journal"]',
  )
  await expect(journalCard.getByTestId('module-toggle')).toHaveAttribute('aria-checked', 'false')
  await journalCard.getByTestId('module-toggle').click()
  await expect(journalCard.getByTestId('module-toggle')).toHaveAttribute('aria-checked', 'true')
  await expect(journalCard.getByTestId('browser-journal-results')).toContainText('已停止 · 0 条')
  await journalCard.getByTestId('browser-journal-start').click()
  await expect(journalCard.getByTestId('browser-journal-results')).toContainText('记录中 · 0 条')

  const observed = await context.newPage()
  const primaryOrigin = new URL(moduleFixtures.primary.manifestUrl).origin
  const secondaryOrigin = new URL(moduleFixtures.secondary.manifestUrl).origin
  const untrustedTitle = '<img data-journal-e2e-xss src=x> <script>not-executed</script>'
  await observed.goto(moduleFixtures.primary.manifest.entry_url)
  await observed.goto(`${primaryOrigin}/journal-memory-only-marker`)
  await observed.goto(`${secondaryOrigin}/journal-second-marker`)
  await panel.bringToFront()

  await journalCard.getByTestId('browser-journal-stop').click()
  const stoppedResults = journalCard.getByTestId('browser-journal-results')
  await expect(stoppedResults).toHaveAttribute('data-state', 'stopped')
  await expect(stoppedResults).toContainText('journal-memory-only-marker')
  await expect(stoppedResults).toContainText('journal-second-marker')
  await expect(stoppedResults).toContainText(untrustedTitle)
  await expect(stoppedResults.locator('img,script')).toHaveCount(0)
  const stoppedText = await stoppedResults.textContent()

  const storageSurfaces = await panel.evaluate(async () => ({
    extensionStorage: JSON.stringify(await chrome.storage.local.get(null)),
    localStorage: JSON.stringify({ ...localStorage }),
    sessionStorage: JSON.stringify({ ...sessionStorage }),
  }))
  expect(JSON.stringify(storageSurfaces)).not.toContain('journal-memory-only-marker')
  expect(JSON.stringify(storageSurfaces)).not.toContain('journal-second-marker')
  expect(JSON.stringify(storageSurfaces)).not.toContain('data-journal-e2e-xss')

  await observed.goto(`${primaryOrigin}/journal-after-stop-marker`)
  await observed.waitForTimeout(200)
  await panel.bringToFront()
  await panel.getByTestId('close-module-manager').click()
  await panel.getByTestId('manage-modules').click()
  journalCard = panel.locator(
    '[data-testid="module-card"][data-module-id="dev.oneweb.browser-journal"]',
  )
  await expect(journalCard.getByTestId('browser-journal-results')).toHaveText(stoppedText || '')
  await expect(journalCard.getByTestId('browser-journal-results')).not.toContainText('journal-after-stop-marker')

  for (const id of otherModuleIds)
    expect(await readStoredModule(panel, id)).toEqual(recordsBefore[id])
  expect(await readModuleLocalState(panel, stateModuleIds)).toEqual(stateBefore)
  expect(await hasFixtureOriginPermission(panel, moduleFixtures.primary.manifestUrl)).toBe(originPermissionsBefore.primary)
  expect(await hasFixtureOriginPermission(panel, moduleFixtures.secondary.manifestUrl)).toBe(originPermissionsBefore.secondary)
  expect(await panel.evaluate(() => chrome.permissions.contains({ permissions: ['bookmarks'] }))).toBe(originPermissionsBefore.bookmarks)

  const background = context.serviceWorkers()[0]
  await background.evaluate(() => chrome.runtime.reload()).catch(() => undefined)
  await new Promise(resolve => setTimeout(resolve, 500))
  panel = await openManagementPanel(context, extensionId)
  journalCard = panel.locator(
    '[data-testid="module-card"][data-module-id="dev.oneweb.browser-journal"]',
  )
  await expect(journalCard.getByTestId('module-toggle')).toHaveAttribute('aria-checked', 'true')
  await expect(journalCard.getByTestId('browser-journal-results')).toHaveAttribute('data-state', 'stopped')
  await expect(journalCard.getByTestId('browser-journal-results')).toContainText('已停止 · 0 条')
  await expect(journalCard.getByTestId('browser-journal-results')).not.toContainText('journal-memory-only-marker')
  for (const id of otherModuleIds)
    expect(await readStoredModule(panel, id)).toEqual(recordsBefore[id])
  expect(await readModuleLocalState(panel, stateModuleIds)).toEqual(stateBefore)
  expect(await hasFixtureOriginPermission(panel, moduleFixtures.primary.manifestUrl)).toBe(originPermissionsBefore.primary)
  expect(await hasFixtureOriginPermission(panel, moduleFixtures.secondary.manifestUrl)).toBe(originPermissionsBefore.secondary)
})

test('Browser Journal saves only on request, survives restart and deletes retained sessions locally', async ({
  context,
  extensionId,
  moduleFixtures,
}) => {
  let panel = await openManagementPanel(context, extensionId)
  await installFixtureModule(panel, moduleFixtures.primary.manifestUrl, moduleFixtures.primary.manifest.id)
  await installFixtureModule(panel, moduleFixtures.secondary.manifestUrl, moduleFixtures.secondary.manifest.id)
  const otherModuleIds = [
    'dev.juck.repolens',
    'dev.oneweb.bookmark-doctor',
    'dev.oneweb.clash-control',
    moduleFixtures.primary.manifest.id,
    moduleFixtures.secondary.manifest.id,
  ]
  const recordsBefore = Object.fromEntries(await Promise.all(otherModuleIds.map(async id => [
    id,
    await readStoredModule(panel, id),
  ])))
  const stateBefore = await seedModuleLocalState(panel, otherModuleIds)
  const permissionsBefore = {
    primary: await hasFixtureOriginPermission(panel, moduleFixtures.primary.manifestUrl),
    secondary: await hasFixtureOriginPermission(panel, moduleFixtures.secondary.manifestUrl),
  }

  let journalCard = panel.locator(
    '[data-testid="module-card"][data-module-id="dev.oneweb.browser-journal"]',
  )
  await journalCard.getByTestId('module-toggle').click()
  await expect(journalCard.getByTestId('module-toggle')).toHaveAttribute('aria-checked', 'true')
  await journalCard.getByTestId('browser-journal-start').click()
  const observed = await context.newPage()
  const primaryOrigin = new URL(moduleFixtures.primary.manifestUrl).origin
  const secondaryOrigin = new URL(moduleFixtures.secondary.manifestUrl).origin
  await observed.goto(`${primaryOrigin}/journal-memory-only-marker`)
  await panel.bringToFront()
  await journalCard.getByTestId('browser-journal-stop').click()
  await expect(journalCard.getByTestId('browser-journal-results')).toContainText('journal-memory-only-marker')
  const journalStorageKey = 'oneweb.module-state.v1:dev.oneweb.browser-journal'
  expect(await panel.evaluate(async key => (await chrome.storage.local.get(key))[key] || null, journalStorageKey)).toBeNull()

  await journalCard.getByTestId('browser-journal-save').click()
  const savedArchive = journalCard.getByTestId('browser-journal-archive')
  await expect(savedArchive).toContainText('journal-memory-only-marker')
  await expect(savedArchive).toContainText('<img data-journal-e2e-xss src=x>')
  await expect(savedArchive.locator('img,script')).toHaveCount(0)
  const storedArchive = await panel.evaluate(async key => (await chrome.storage.local.get(key))[key], journalStorageKey)
  expect(storedArchive).toMatchObject({
    schemaVersion: 1,
    sessions: [{
      entries: expect.arrayContaining([expect.objectContaining({
        title: '<img data-journal-e2e-xss src=x> <script>not-executed</script>',
        url: `${primaryOrigin}/journal-memory-only-marker`,
      })]),
    }],
  })
  expect(JSON.stringify(storedArchive)).not.toContain('tabId')
  expect(JSON.stringify(storedArchive)).not.toContain('windowId')

  const background = context.serviceWorkers()[0]
  await background.evaluate(() => chrome.runtime.reload()).catch(() => undefined)
  await new Promise(resolve => setTimeout(resolve, 500))
  panel = await openManagementPanel(context, extensionId)
  journalCard = panel.locator(
    '[data-testid="module-card"][data-module-id="dev.oneweb.browser-journal"]',
  )
  await expect(journalCard.getByTestId('module-toggle')).toHaveAttribute('aria-checked', 'true')
  await expect(journalCard.getByTestId('browser-journal-results')).toContainText('已停止 · 0 条')
  await expect(journalCard.getByTestId('browser-journal-archive')).toContainText('journal-memory-only-marker')
  await expect(journalCard.getByTestId('browser-journal-saved-session-choice')).toHaveCount(1)
  await expect(journalCard.getByTestId('browser-journal-saved-session-choice')).toHaveAttribute('aria-pressed', 'true')
  const firstSavedSession = storedArchive.sessions[0]
  const firstExpiresAt = new Date(Date.parse(firstSavedSession.savedAt) + 7 * 24 * 60 * 60 * 1000).toISOString()
  await expect(journalCard.getByTestId('browser-journal-saved-session')).toContainText(`保留至 ${firstExpiresAt}`)

  await journalCard.getByTestId('browser-journal-start').click()
  await observed.goto(`${secondaryOrigin}/journal-second-marker`)
  await observed.bringToFront()
  await observed.reload()
  await panel.bringToFront()
  await journalCard.getByTestId('browser-journal-stop').click()
  await journalCard.getByTestId('browser-journal-save').click()
  const choices = journalCard.getByTestId('browser-journal-saved-session-choice')
  await expect(choices).toHaveCount(2)
  await expect(choices.first()).toHaveAttribute('aria-pressed', 'true')
  const detail = journalCard.getByTestId('browser-journal-saved-session')
  await expect(detail).toContainText('journal-second-marker')
  await expect(detail).not.toContainText('journal-memory-only-marker')

  const firstChoice = journalCard.locator(
    `[data-testid="browser-journal-saved-session-choice"][data-saved-session-id="${firstSavedSession.id}"]`,
  )
  await firstChoice.click()
  await expect(firstChoice).toHaveAttribute('aria-pressed', 'true')
  await expect(detail).toContainText('journal-memory-only-marker')
  await expect(detail).not.toContainText('journal-second-marker')

  const restartedBackground = context.serviceWorkers()[0]
  await restartedBackground.evaluate(() => chrome.runtime.reload()).catch(() => undefined)
  await new Promise(resolve => setTimeout(resolve, 500))
  panel = await openManagementPanel(context, extensionId)
  journalCard = panel.locator(
    '[data-testid="module-card"][data-module-id="dev.oneweb.browser-journal"]',
  )
  await expect(journalCard.getByTestId('browser-journal-saved-session-choice')).toHaveCount(2)
  await expect(journalCard.getByTestId('browser-journal-saved-session-choice').first()).toHaveAttribute('aria-pressed', 'true')
  await expect(journalCard.getByTestId('browser-journal-saved-session')).toContainText('journal-second-marker')

  await journalCard.locator(
    `[data-testid="browser-journal-saved-session-choice"][data-saved-session-id="${firstSavedSession.id}"]`,
  ).click()
  await journalCard.getByTestId('browser-journal-delete-saved').click()
  await expect(journalCard.getByTestId('browser-journal-saved-session-choice')).toHaveCount(1)
  await expect(journalCard.getByTestId('browser-journal-saved-session')).toContainText('journal-second-marker')
  await expect(journalCard.getByTestId('browser-journal-saved-session')).not.toContainText('journal-memory-only-marker')
  expect((await panel.evaluate(async key => (await chrome.storage.local.get(key))[key], journalStorageKey)).sessions).toHaveLength(1)

  await journalCard.getByTestId('module-toggle').click()
  await expect(journalCard.getByTestId('module-toggle')).toHaveAttribute('aria-checked', 'false')
  await expect(journalCard).toContainText('此前明确保存的记录仍保留')
  await expect(journalCard.getByTestId('browser-journal-archive')).toContainText('journal-second-marker')
  await journalCard.getByTestId('browser-journal-clear-saved').click()
  await expect(journalCard.getByTestId('browser-journal-message')).toContainText('必须明确确认')
  await journalCard.getByTestId('browser-journal-clear-confirmation').check()
  await journalCard.getByTestId('browser-journal-clear-saved').click()
  await expect(journalCard.getByTestId('browser-journal-saved-session')).toHaveCount(0)

  for (const id of otherModuleIds)
    expect(await readStoredModule(panel, id)).toEqual(recordsBefore[id])
  expect(await readModuleLocalState(panel, otherModuleIds)).toEqual(stateBefore)
  expect(await hasFixtureOriginPermission(panel, moduleFixtures.primary.manifestUrl)).toBe(permissionsBefore.primary)
  expect(await hasFixtureOriginPermission(panel, moduleFixtures.secondary.manifestUrl)).toBe(permissionsBefore.secondary)
})

test('cancelling a reviewed remote module releases its origin without persisting a record', async ({ context, extensionId, moduleFixture, page }) => {
  const { manifest, manifestUrl, requests } = moduleFixture
  await page.goto('https://github.com/vuejs/core', { waitUntil: 'domcontentloaded' })
  const panel = await context.newPage()
  await panel.setViewportSize({ width: 420, height: 900 })
  await panel.goto(`chrome-extension://${extensionId}/dist/sidebar/index.html`)
  await panel.getByTestId('manage-modules').click()
  await expect(panel.getByTestId('module-manager')).toBeVisible()

  await panel.getByTestId('add-module').click()
  await panel.locator('[data-manifest-url]').fill(manifestUrl)
  await panel.locator('[data-prepare-install]').click()
  await expect(panel.locator('[data-install-review]')).toBeVisible()
  await expect(panel.locator('[data-install-name]')).toHaveText(manifest.name)
  await expect(panel.locator('[data-install-access]')).toContainText(new URL(manifestUrl).origin)
  await expect(panel.locator('[data-install-grants] input:checked')).toHaveCount(4)
  await panel.locator('[data-cancel-install]').click()
  await expect(panel.getByTestId('install-module-dialog')).toBeHidden()
  await expect(panel.locator('[data-module-id="dev.juck.installable"]')).toHaveCount(0)
  expect(await panel.evaluate(async () => {
    const stored = await chrome.storage.local.get('oneweb.modules.v1')
    const records = stored['oneweb.modules.v1'] as Array<{ manifest: { id: string } }>
    return records.some(record => record.manifest.id === 'dev.juck.installable')
  })).toBe(false)
  await expect.poll(() => panel.evaluate(origin => chrome.permissions.contains({
    origins: [`${origin}/*`],
  }), new URL(manifestUrl).origin)).toBe(false)
  expect(requests.count).toBe(1)
})

test('remote module installation supports narrower grants and persists only after confirmation', async ({ context, extensionId, moduleFixture, page }) => {
  const { manifest, manifestUrl, requests } = moduleFixture
  await page.goto('https://github.com/vuejs/core', { waitUntil: 'domcontentloaded' })
  const panel = await context.newPage()
  await panel.setViewportSize({ width: 420, height: 900 })
  await panel.goto(`chrome-extension://${extensionId}/dist/sidebar/index.html`)
  await panel.getByTestId('manage-modules').click()
  await expect(panel.getByTestId('module-manager')).toBeVisible()

  await panel.getByTestId('add-module').click()
  await panel.locator('[data-manifest-url]').fill(manifestUrl)
  await panel.locator('[data-prepare-install]').click()
  await expect(panel.locator('[data-install-review]')).toBeVisible()
  await expect(panel.locator('[data-install-name]')).toHaveText(manifest.name)
  await expect(panel.locator('[data-install-access]')).toContainText(new URL(manifestUrl).origin)
  await expect(panel.locator('[data-install-grants] input:checked')).toHaveCount(4)
  await panel.locator('input[data-context-field="url"]').uncheck()
  await panel.locator('input[data-capability="tabs.open"]').uncheck()
  await panel.locator('[data-confirm-install]').click()

  const installedCard = panel.locator('[data-testid="module-card"][data-module-id="dev.juck.installable"]')
  await expect(installedCard).toBeVisible()
  await expect(panel.getByTestId('module-manager-status')).toHaveText('Installable Fixture 已安装')
  await installedCard.getByText('权限与来源').click()
  const grantedContexts = installedCard.locator('dt', { hasText: '已授权上下文' }).locator('xpath=following-sibling::dd[1]')
  const grantedCapabilities = installedCard.locator('dt', { hasText: '已授权浏览器能力' }).locator('xpath=following-sibling::dd[1]')
  await expect(grantedContexts).toHaveText('GitHub 仓库：repo、pageType')
  await expect(grantedCapabilities).toHaveText('无')
  await expect(panel.locator('[data-testid="module-card"][data-module-id="dev.juck.repolens"]')).toBeVisible()
  expect(requests.count).toBe(2)
})

test('manual safe update renders remote copy as text and applies only after confirmation', async ({
  context,
  extensionId,
  moduleFixture,
}) => {
  const panel = await openManagementPanel(context, extensionId)
  const card = await installFixtureModule(panel, moduleFixture.manifestUrl)
  moduleFixture.setManifest({
    ...moduleFixture.manifest,
    version: '0.2.0',
    name: '<img src=x onerror=alert(1)>',
    description: '<svg onload=alert(2)>',
  })

  await card.getByTestId('module-update-check').click()
  await expect(card.getByTestId('module-update-state')).toHaveText('安全更新')
  await expect(card.getByTestId('module-update')).toContainText('<img src=x onerror=alert(1)>')
  await expect(card.getByTestId('module-update').locator('img')).toHaveCount(0)
  await expect(card.getByTestId('module-update-approve')).toHaveCount(0)
  await card.getByTestId('module-update-apply').click()

  await expect(card.locator('.module-card-name')).toHaveText('<img src=x onerror=alert(1)>')
  await expect(card.locator('.module-card-description')).toHaveText('<svg onload=alert(2)>')
  await expect(panel.getByTestId('module-manager-status')).toContainText('已更新至 0.2.0')
  expect(moduleFixture.requests.count).toBe(4)
})

test('expanded update keeps approval and application separate with selected grants only', async ({
  context,
  extensionId,
  moduleFixture,
}) => {
  const panel = await openManagementPanel(context, extensionId)
  const card = await installFixtureModule(panel, moduleFixture.manifestUrl)
  const candidate = {
    ...moduleFixture.manifest,
    version: '0.2.0',
    matches: [...moduleFixture.manifest.matches, 'https://example.com/*'],
    contexts: [...moduleFixture.manifest.contexts, 'page.metadata' as const],
    context_fields: {
      ...moduleFixture.manifest.context_fields,
      'page.metadata': ['title', 'description'],
    },
    capabilities: [...moduleFixture.manifest.capabilities, 'clipboard.write' as const],
    activation: 'suggest' as const,
  }
  moduleFixture.setManifest(candidate)

  await card.getByTestId('module-update-check').click()
  await expect(card.getByTestId('module-update-state')).toHaveText('需要审批')
  await expect(card.getByTestId('module-update')).toContainText('https://example.com/*')
  await expect(card.getByTestId('module-update')).toContainText('页面元数据')
  await expect(card.getByTestId('module-update')).toContainText('手动启用 → 页面建议')
  const title = card.locator('input[data-update-context-field="title"]')
  const description = card.locator('input[data-update-context-field="description"]')
  const clipboard = card.locator('input[data-update-capability="clipboard.write"]')
  await expect(title).not.toBeChecked()
  await expect(description).not.toBeChecked()
  await expect(clipboard).not.toBeChecked()
  await title.check()
  await clipboard.check()
  await card.getByTestId('module-update-approve').click()

  await expect(card.getByTestId('module-update-state')).toHaveText('已审批，等待应用')
  await expect(card.getByTestId('module-update-approve')).toHaveCount(0)
  await expect(card.getByTestId('module-update-apply')).toBeVisible()
  expect(await panel.evaluate(async () => {
    const stored = await chrome.storage.local.get('oneweb.modules.v1')
    const records = stored['oneweb.modules.v1'] as Array<{ manifest: { id: string, version: string } }>
    return records.find(record => record.manifest.id === 'dev.juck.installable')?.manifest.version
  })).toBe('0.1.0')

  await card.getByTestId('module-update-apply').click()
  await expect(panel.getByTestId('module-manager-status')).toContainText('已更新至 0.2.0')
  expect(await panel.evaluate(async () => {
    const stored = await chrome.storage.local.get('oneweb.modules.v1')
    const records = stored['oneweb.modules.v1'] as Array<{
      manifest: { id: string, version: string }
      grantedContextFields: Record<string, string[]>
      grantedCapabilities: string[]
    }>
    const record = records.find(candidate => candidate.manifest.id === 'dev.juck.installable')!
    return {
      version: record.manifest.version,
      metadata: record.grantedContextFields['page.metadata'],
      capabilities: record.grantedCapabilities,
    }
  })).toEqual({
    version: '0.2.0',
    metadata: ['title'],
    capabilities: ['tabs.open', 'clipboard.write'],
  })
  expect(moduleFixture.requests.count).toBe(4)
})

test('malicious immutable-boundary update is diagnostic-only', async ({
  context,
  extensionId,
  moduleFixture,
}) => {
  const panel = await openManagementPanel(context, extensionId)
  const card = await installFixtureModule(panel, moduleFixture.manifestUrl)
  moduleFixture.setManifest({
    ...moduleFixture.manifest,
    id: 'dev.evil.replacement',
    name: '<img src=x onerror=alert(1)>',
  })

  await card.getByTestId('module-update-check').click()
  await expect(card.getByTestId('module-update-state')).toHaveText('已拒绝')
  await expect(card.getByTestId('module-update')).toContainText('模块 ID 发生变化')
  await expect(card.getByTestId('module-update')).not.toContainText('<img src=x onerror=alert(1)>')
  await expect(card.getByTestId('module-update').locator('img')).toHaveCount(0)
  await expect(card.getByTestId('module-update-approve')).toHaveCount(0)
  await expect(card.getByTestId('module-update-apply')).toHaveCount(0)
  expect(moduleFixture.requests.count).toBe(3)
})

test('application-time remote replacement expires the checked candidate', async ({
  context,
  extensionId,
  moduleFixture,
}) => {
  const panel = await openManagementPanel(context, extensionId)
  const card = await installFixtureModule(panel, moduleFixture.manifestUrl)
  moduleFixture.setManifest({ ...moduleFixture.manifest, version: '0.2.0' })

  await card.getByTestId('module-update-check').click()
  await expect(card.getByTestId('module-update-state')).toHaveText('安全更新')
  moduleFixture.setManifest({ ...moduleFixture.manifest, version: '0.3.0' })
  await card.getByTestId('module-update-apply').click()

  await expect(card.getByTestId('module-update-state')).toHaveText('候选已过期')
  await expect(card.getByTestId('module-update-message')).toHaveText('候选已过期，请重新检查并审查')
  await expect(card.getByTestId('module-update-apply')).toHaveCount(0)
  await expect(card.getByTestId('module-update-check')).toBeVisible()
  await card.getByText('权限与来源').click()
  await expect(card.locator('dt', { hasText: '版本' }).locator('xpath=following-sibling::dd[1]')).toHaveText('0.1.0')
  expect(moduleFixture.requests.count).toBe(4)
})

test('two origins keep installation, updates, approvals, grants and removal isolated', async ({
  context,
  extensionId,
  moduleFixtures,
}) => {
  const { primary, secondary } = moduleFixtures
  const panel = await openManagementPanel(context, extensionId)
  const alphaCard = await installFixtureModule(panel, primary.manifestUrl, primary.manifest.id)
  const betaCard = await installFixtureModule(panel, secondary.manifestUrl, secondary.manifest.id)

  expect(new URL(primary.manifestUrl).origin).not.toBe(new URL(secondary.manifestUrl).origin)
  expect(await hasFixtureOriginPermission(panel, primary.manifestUrl)).toBe(true)
  expect(await hasFixtureOriginPermission(panel, secondary.manifestUrl)).toBe(true)

  const alphaCandidate = {
    ...primary.manifest,
    version: '0.2.0',
    description: 'Safe alpha update',
  }
  const betaCandidate = {
    ...secondary.manifest,
    version: '0.2.0',
    matches: [...secondary.manifest.matches, 'https://news.example.com/*'],
    contexts: [...secondary.manifest.contexts, 'page.selection' as const],
    context_fields: {
      ...secondary.manifest.context_fields,
      'page.selection': ['text'],
    },
    capabilities: [
      ...secondary.manifest.capabilities,
      'clipboard.write' as const,
      'notifications.show' as const,
    ],
    activation: 'suggest' as const,
  }
  primary.setManifest(alphaCandidate)
  secondary.setManifest(betaCandidate)
  await alphaCard.getByTestId('module-update-check').click()
  await expect(alphaCard.getByTestId('module-update-state')).toHaveText('安全更新')
  await betaCard.getByTestId('module-update-check').click()
  await expect(betaCard.getByTestId('module-update-state')).toHaveText('需要审批')

  const betaBeforeAlphaApply = await readStoredModule(panel, secondary.manifest.id)
  await alphaCard.getByTestId('module-update-apply').click()
  await expect(alphaCard.locator('.module-card-description')).toHaveText('Safe alpha update')
  expect(await readStoredModule(panel, secondary.manifest.id)).toEqual(betaBeforeAlphaApply)

  const alphaAfterApply = await readStoredModule(panel, primary.manifest.id)
  const selection = betaCard.locator('input[data-update-context-field="text"]')
  const clipboard = betaCard.locator('input[data-update-capability="clipboard.write"]')
  const notifications = betaCard.locator('input[data-update-capability="notifications.show"]')
  await expect(selection).not.toBeChecked()
  await expect(clipboard).not.toBeChecked()
  await expect(notifications).not.toBeChecked()
  await selection.check()
  await clipboard.check()
  await betaCard.getByTestId('module-update-approve').click()
  await expect(betaCard.getByTestId('module-update-state')).toHaveText('已审批，等待应用')
  expect(await readStoredModule(panel, primary.manifest.id)).toEqual(alphaAfterApply)

  await betaCard.getByTestId('module-update-apply').click()
  await expect(panel.getByTestId('module-manager-status')).toContainText('已更新至 0.2.0')
  expect(await readStoredModule(panel, secondary.manifest.id)).toMatchObject({
    manifest: { version: '0.2.0' },
    grantedContexts: ['page.metadata', 'page.selection'],
    grantedContextFields: {
      'page.metadata': ['title', 'description'],
      'page.selection': ['text'],
    },
    grantedCapabilities: ['storage.module', 'clipboard.write'],
    update: null,
  })
  expect(await readStoredModule(panel, primary.manifest.id)).toEqual(alphaAfterApply)

  const betaAfterApply = await readStoredModule(panel, secondary.manifest.id)
  primary.setManifest({ ...alphaCandidate, id: 'dev.evil.cross-module-replacement' })
  await alphaCard.getByTestId('module-update-check').click()
  await expect(alphaCard.getByTestId('module-update-state')).toHaveText('已拒绝')
  expect(await readStoredModule(panel, secondary.manifest.id)).toEqual(betaAfterApply)

  await alphaCard.getByTestId('module-remove').click()
  await panel.locator('[data-confirm-remove]').click()
  await expect(alphaCard).toHaveCount(0)
  expect(await readStoredModule(panel, secondary.manifest.id)).toEqual(betaAfterApply)
  await expect.poll(() => hasFixtureOriginPermission(panel, primary.manifestUrl)).toBe(false)
  expect(await hasFixtureOriginPermission(panel, secondary.manifestUrl)).toBe(true)
  await expect(betaCard).toBeVisible()
})

test('Clash Control passes the complete principal, permission and secret isolation gate', async ({
  clashControllerFixture,
  context,
  extensionId,
  moduleFixtures,
}) => {
  const consoleMessages: string[] = []
  let panel = await openManagementPanel(context, extensionId)
  panel.on('console', message => consoleMessages.push(message.text()))
  const primaryCard = await installFixtureModule(
    panel,
    moduleFixtures.primary.manifestUrl,
    moduleFixtures.primary.manifest.id,
  )
  const secondaryCard = await installFixtureModule(
    panel,
    moduleFixtures.secondary.manifestUrl,
    moduleFixtures.secondary.manifest.id,
  )

  const bookmarkCard = panel.locator(
    '[data-testid="module-card"][data-module-id="dev.oneweb.bookmark-doctor"]',
  )
  await bookmarkCard.getByTestId('module-toggle').click()
  await expect(bookmarkCard.getByTestId('module-toggle')).toHaveAttribute('aria-checked', 'true')
  await bookmarkCard.getByTestId('bookmark-authorize').click()
  await expect(bookmarkCard.getByTestId('bookmark-prepare')).toBeVisible()
  expect(await panel.evaluate(() => chrome.permissions.contains({ permissions: ['bookmarks'] }))).toBe(true)

  moduleFixtures.primary.setManifest({
    ...moduleFixtures.primary.manifest,
    version: '0.2.0',
    description: 'Primary pending candidate retained by Clash PoC',
  })
  moduleFixtures.secondary.setManifest({
    ...moduleFixtures.secondary.manifest,
    version: '0.2.0',
    description: 'Secondary pending candidate retained by Clash PoC',
    matches: [...moduleFixtures.secondary.manifest.matches, 'https://news.example.com/*'],
    contexts: [...moduleFixtures.secondary.manifest.contexts, 'page.selection'],
    context_fields: {
      ...moduleFixtures.secondary.manifest.context_fields,
      'page.selection': ['text'],
    },
    capabilities: [...moduleFixtures.secondary.manifest.capabilities, 'clipboard.write'],
    activation: 'suggest',
  })
  await primaryCard.getByTestId('module-update-check').click()
  await secondaryCard.getByTestId('module-update-check').click()
  await expect(primaryCard.getByTestId('module-update-state')).toHaveText('安全更新')
  await expect(secondaryCard.getByTestId('module-update-state')).toHaveText('需要审批')
  await secondaryCard.locator('input[data-update-context-field="text"]').check()
  await secondaryCard.locator('input[data-update-capability="clipboard.write"]').check()
  await secondaryCard.getByTestId('module-update-approve').click()
  await expect(secondaryCard.getByTestId('module-update-state')).toHaveText('已审批，等待应用')

  const untouchedModuleIds = [
    'dev.juck.repolens',
    'dev.oneweb.bookmark-doctor',
    moduleFixtures.primary.manifest.id,
    moduleFixtures.secondary.manifest.id,
  ]
  const recordsBefore = Object.fromEntries(await Promise.all(untouchedModuleIds.map(async id => [
    id,
    await readStoredModule(panel, id),
  ])))
  const stateModuleIds = [
    'dev.juck.repolens',
    moduleFixtures.primary.manifest.id,
    moduleFixtures.secondary.manifest.id,
    'dev.oneweb.clash-control',
  ]
  const localStateBefore = await seedModuleLocalState(panel, stateModuleIds)
  const bookmarkStateKey = 'oneweb.module-state.v1:dev.oneweb.bookmark-doctor'
  const bookmarkStateBefore = {
    schemaVersion: 2,
    lastResult: null,
    ignoredBookmarks: [{
      bookmarkId: 'private-e2e-bookmark',
      title: 'Private E2E bookmark',
      url: 'https://private.example/',
      ignoredAt: '2026-08-29T05:00:00.000Z',
    }],
    deletionBackups: [],
  }
  await panel.evaluate(({ key, value }) => chrome.storage.local.set({ [key]: value }), {
    key: bookmarkStateKey,
    value: bookmarkStateBefore,
  })

  let clashCard = panel.locator(
    '[data-testid="module-card"][data-module-id="dev.oneweb.clash-control"]',
  )
  await expect(clashCard.getByTestId('module-toggle')).toHaveAttribute('aria-checked', 'false')
  await clashCard.getByTestId('module-toggle').click()
  await expect(clashCard.getByTestId('module-toggle')).toHaveAttribute('aria-checked', 'true')
  await clashCard.getByTestId('clash-controller-url').fill(clashControllerFixture.origin)
  await clashCard.getByTestId('clash-prepare').click()
  await expect(clashCard.getByTestId('clash-control-review')).toContainText(clashControllerFixture.origin)
  panel.once('dialog', dialog => dialog.accept(clashControllerFixture.secret))
  await clashCard.getByTestId('clash-connect').click()

  const status = clashCard.getByTestId('clash-control-status')
  await expect(status).toContainText('Clash.Meta')
  await expect(status).toContainText('1.19.0-e2e')
  await expect(status).toContainText('rule')
  expect(clashControllerFixture.requests).toEqual({ version: 1, configs: 1, proxies: 0, unauthorized: 0 })
  expect(await readStoredModule(panel, 'dev.oneweb.clash-control')).toMatchObject({
    enabled: true,
    grantedCapabilities: ['clash.status.read'],
    update: null,
  })

  await clashCard.getByTestId('clash-refresh').click()
  const readState = clashCard.getByTestId('clash-read-state')
  await expect(readState).toHaveAttribute('data-state', 'ready')
  await expect(readState).toContainText(clashControllerFixture.proxyGroupName)
  await expect(readState).toContainText('Node A')
  await expect(readState).toContainText('可用')
  await expect(readState.locator('img')).toHaveCount(0)
  expect(clashControllerFixture.requests).toEqual({ version: 2, configs: 2, proxies: 1, unauthorized: 0 })

  const switchTarget = readState.getByTestId('clash-switch-target')
  await expect(switchTarget).toHaveValue('Node B')
  await readState.getByTestId('clash-switch-prepare').click()
  const switchReview = readState.getByTestId('clash-switch-review')
  await expect(switchReview).toHaveAttribute('data-state', 'ready')
  await expect(switchReview).toContainText(clashControllerFixture.proxyGroupName)
  await expect(switchReview).toContainText('Node A')
  await expect(switchReview).toContainText('Node B')
  await expect(clashCard.getByTestId('clash-control-message')).toContainText('节点尚未切换')
  expect(clashControllerFixture.switches).toEqual({
    attempts: 0,
    successful: 0,
    lastPath: null,
    lastBody: null,
  })
  expect(clashControllerFixture.requests).toEqual({ version: 2, configs: 2, proxies: 1, unauthorized: 0 })
  await switchReview.getByTestId('clash-switch-confirm').click()
  await expect(switchReview).toHaveCount(0)
  await expect(readState).toHaveAttribute('data-state', 'empty')
  await expect(clashCard.getByTestId('clash-control-message')).toContainText('旧快照已失效')
  expect(clashControllerFixture.switches).toEqual({
    attempts: 1,
    successful: 1,
    lastPath: `/proxies/${encodeURIComponent(clashControllerFixture.proxyGroupName)}`,
    lastBody: { name: 'Node B' },
  })
  expect(clashControllerFixture.requests).toEqual({ version: 2, configs: 2, proxies: 2, unauthorized: 0 })
  const requestsAfterSwitch = structuredClone(clashControllerFixture.requests)
  await panel.waitForTimeout(100)
  expect(clashControllerFixture.requests).toEqual(requestsAfterSwitch)

  clashControllerFixture.setMode('global')
  await clashCard.getByTestId('clash-refresh').click()
  await expect(readState).toContainText('global')
  await expect(readState).toContainText('当前选择：Node B')
  expect(clashControllerFixture.requests).toEqual({ version: 3, configs: 3, proxies: 3, unauthorized: 0 })

  await expect(readState.getByTestId('clash-switch-target')).toHaveValue('Node A')
  await readState.getByTestId('clash-switch-prepare').click()
  await expect(readState.getByTestId('clash-switch-review')).toContainText('Node B')
  await expect(readState.getByTestId('clash-switch-review')).toContainText('Node A')

  const secretSurfaces = await panel.evaluate(async () => ({
    document: document.documentElement.outerHTML,
    extensionLocalStorage: JSON.stringify({ ...localStorage }),
    extensionSessionStorage: JSON.stringify({ ...sessionStorage }),
    extensionStorage: JSON.stringify(await chrome.storage.local.get(null)),
    resourceUrls: performance.getEntriesByType('resource').map(entry => entry.name),
  }))
  expect(JSON.stringify(secretSurfaces)).not.toContain(clashControllerFixture.secret)
  expect(secretSurfaces.extensionStorage).not.toContain(clashControllerFixture.proxyGroupName)
  expect(secretSurfaces.extensionLocalStorage).not.toContain(clashControllerFixture.proxyGroupName)
  expect(secretSurfaces.extensionSessionStorage).not.toContain(clashControllerFixture.proxyGroupName)
  const frameUrls = JSON.stringify(context.pages().flatMap(page => page.frames().map(frame => frame.url())))
  expect(frameUrls).not.toContain(clashControllerFixture.secret)
  expect(frameUrls).not.toContain(moduleFixtures.primary.manifest.entry_url)
  expect(frameUrls).not.toContain(moduleFixtures.secondary.manifest.entry_url)
  expect(consoleMessages.join('\n')).not.toContain(clashControllerFixture.secret)

  const remoteFrame = panel.frameLocator('[data-testid="oneweb-module-frame"]')
  expect(await remoteFrame.locator('body').evaluate((_body, secret) => ({
    hasExtensionRuntime: Boolean(globalThis.chrome?.runtime),
    hasExtensionStorage: Boolean(globalThis.chrome?.storage),
    containsSecret: document.documentElement.outerHTML.includes(secret),
  }), clashControllerFixture.secret)).toEqual({
    hasExtensionRuntime: false,
    hasExtensionStorage: false,
    containsSecret: false,
  })

  const profileBeforeRestart = await panel.evaluate(async () => (
    chrome.storage.local.get('oneweb.clash-control.profile.v1')
  ))
  expect(profileBeforeRestart).toEqual({
    'oneweb.clash-control.profile.v1': {
      version: 1,
      controllerOrigin: clashControllerFixture.origin,
    },
  })
  expect(JSON.stringify(profileBeforeRestart)).not.toContain(clashControllerFixture.secret)

  const background = context.serviceWorkers()[0]
  await background.evaluate(() => chrome.runtime.reload()).catch(() => undefined)
  await new Promise(resolve => setTimeout(resolve, 500))
  panel = await openManagementPanel(context, extensionId)
  panel.on('console', message => consoleMessages.push(message.text()))
  clashCard = panel.locator(
    '[data-testid="module-card"][data-module-id="dev.oneweb.clash-control"]',
  )
  await expect(clashCard.getByTestId('clash-control-status')).toHaveCount(0)
  await expect(clashCard.getByTestId('clash-controller-url')).toHaveValue(clashControllerFixture.origin)
  await expect(clashCard.getByTestId('clash-switch-review')).toHaveCount(0)
  expect(await readStoredModule(panel, 'dev.oneweb.clash-control')).toMatchObject({
    enabled: true,
    grantedCapabilities: [],
  })
  expect(clashControllerFixture.requests).toEqual({ version: 3, configs: 3, proxies: 3, unauthorized: 0 })

  await clashCard.getByTestId('clash-prepare').click()
  panel.once('dialog', dialog => dialog.accept(clashControllerFixture.secret))
  await clashCard.getByTestId('clash-connect').click()
  await expect(clashCard.getByTestId('clash-control-status')).toContainText('1.19.0-e2e')
  expect(clashControllerFixture.requests).toEqual({ version: 4, configs: 4, proxies: 3, unauthorized: 0 })

  await clashCard.getByTestId('clash-refresh').click()
  await expect(clashCard.getByTestId('clash-read-state')).toHaveAttribute('data-state', 'ready')
  expect(clashControllerFixture.requests).toEqual({ version: 5, configs: 5, proxies: 4, unauthorized: 0 })

  await clashCard.getByTestId('clash-disconnect').click()
  await expect(clashCard.getByTestId('clash-control-status')).toHaveCount(0)
  await expect(clashCard.getByTestId('clash-controller-url')).toBeVisible()
  expect(await readStoredModule(panel, 'dev.oneweb.clash-control')).toMatchObject({
    enabled: true,
    grantedCapabilities: [],
  })

  await clashCard.getByTestId('clash-controller-url').fill(clashControllerFixture.origin)
  await clashCard.getByTestId('clash-prepare').click()
  panel.once('dialog', dialog => dialog.accept('wrong-e2e-secret'))
  await clashCard.getByTestId('clash-connect').click()
  await expect(clashCard.getByTestId('clash-control-message')).toContainText('拒绝了认证')
  expect(clashControllerFixture.requests).toEqual({ version: 5, configs: 5, proxies: 4, unauthorized: 1 })
  const storedClashRecord = JSON.stringify(await readStoredModule(panel, 'dev.oneweb.clash-control'))
  expect(storedClashRecord).not.toContain('wrong-e2e-secret')

  await clashCard.getByTestId('clash-prepare').click()
  panel.once('dialog', dialog => dialog.accept(clashControllerFixture.secret))
  await clashCard.getByTestId('clash-connect').click()
  await expect(clashCard.getByTestId('clash-control-status')).toContainText('1.19.0-e2e')
  await clashCard.getByTestId('clash-refresh').click()
  await expect(clashCard.getByTestId('clash-read-state')).toHaveAttribute('data-state', 'ready')
  expect(clashControllerFixture.requests).toEqual({ version: 7, configs: 7, proxies: 5, unauthorized: 1 })

  expect(await panel.evaluate(async (origin) => {
    return chrome.permissions.remove({ origins: [`${origin}/*`] })
  }, clashControllerFixture.origin)).toBe(true)
  await expect(clashCard.getByTestId('clash-control-status')).toHaveCount(0)
  expect(await readStoredModule(panel, 'dev.oneweb.clash-control')).toMatchObject({
    enabled: true,
    grantedCapabilities: [],
  })
  expect(clashControllerFixture.requests).toEqual({ version: 7, configs: 7, proxies: 5, unauthorized: 1 })

  for (const id of untouchedModuleIds)
    expect(await readStoredModule(panel, id)).toEqual(recordsBefore[id])
  expect(await readModuleLocalState(panel, stateModuleIds)).toEqual(localStateBefore)
  expect(await readModuleLocalState(panel, ['dev.oneweb.bookmark-doctor'])).toEqual({
    [bookmarkStateKey]: bookmarkStateBefore,
  })
  expect(await panel.evaluate(() => chrome.permissions.contains({ permissions: ['bookmarks'] }))).toBe(true)
  expect(await hasFixtureOriginPermission(panel, moduleFixtures.primary.manifestUrl)).toBe(true)
  expect(await hasFixtureOriginPermission(panel, moduleFixtures.secondary.manifestUrl)).toBe(true)
})

test('Clash Control rejects stale races and recovers ambiguous writes only after manual refresh', async ({
  clashControllerFixture,
  context,
  extensionId,
  moduleFixtures,
}) => {
  const panel = await openManagementPanel(context, extensionId)
  await installFixtureModule(panel, moduleFixtures.primary.manifestUrl, moduleFixtures.primary.manifest.id)
  await installFixtureModule(panel, moduleFixtures.secondary.manifestUrl, moduleFixtures.secondary.manifest.id)
  const bookmarkCard = panel.locator(
    '[data-testid="module-card"][data-module-id="dev.oneweb.bookmark-doctor"]',
  )
  await bookmarkCard.getByTestId('module-toggle').click()
  await bookmarkCard.getByTestId('bookmark-authorize').click()
  await expect(bookmarkCard.getByTestId('bookmark-prepare')).toBeVisible()
  const isolatedModuleIds = [
    'dev.juck.repolens',
    'dev.oneweb.bookmark-doctor',
    moduleFixtures.primary.manifest.id,
    moduleFixtures.secondary.manifest.id,
  ]
  const recordsBefore = Object.fromEntries(await Promise.all(isolatedModuleIds.map(async id => [
    id,
    await readStoredModule(panel, id),
  ])))
  const stateModuleIds = [...isolatedModuleIds, 'dev.oneweb.clash-control']
  const localStateBefore = await seedModuleLocalState(panel, stateModuleIds)
  const clashCard = panel.locator(
    '[data-testid="module-card"][data-module-id="dev.oneweb.clash-control"]',
  )
  await clashCard.getByTestId('module-toggle').click()
  await expect(clashCard.getByTestId('module-toggle')).toHaveAttribute('aria-checked', 'true')
  await clashCard.getByTestId('clash-controller-url').fill(clashControllerFixture.origin)
  await clashCard.getByTestId('clash-prepare').click()
  panel.once('dialog', dialog => dialog.accept(clashControllerFixture.secret))
  await clashCard.getByTestId('clash-connect').click()
  await expect(clashCard.getByTestId('clash-control-status')).toContainText('1.19.0-e2e')
  await clashCard.getByTestId('clash-refresh').click()
  const readState = clashCard.getByTestId('clash-read-state')
  await expect(readState).toHaveAttribute('data-state', 'ready')
  await expect(readState).toContainText('当前选择：Node A')

  await readState.getByTestId('clash-switch-prepare').click()
  await expect(readState.getByTestId('clash-switch-review')).toHaveAttribute('data-state', 'ready')
  clashControllerFixture.setSelectedNode('Node B')
  await readState.getByTestId('clash-switch-confirm').click()
  await expect(clashCard.getByTestId('clash-control-message')).toContainText('已经变化')
  await expect(readState).toHaveAttribute('data-state', 'empty')
  expect(clashControllerFixture.switches).toEqual({
    attempts: 0,
    successful: 0,
    lastPath: null,
    lastBody: null,
  })

  await clashCard.getByTestId('clash-refresh').click()
  await expect(readState).toHaveAttribute('data-state', 'ready')
  await expect(readState).toContainText('当前选择：Node B')

  await readState.getByTestId('clash-switch-prepare').click()
  await expect(readState.getByTestId('clash-switch-review')).toContainText('Node A')
  clashControllerFixture.lifecycle.applyNextWriteWithoutResponse()
  await readState.getByTestId('clash-switch-confirm').click()
  await expect.poll(() => clashControllerFixture.lifecycle.ambiguousWrites).toBe(1)
  await expect(clashCard.getByTestId('clash-control-message')).toContainText('无法确认是否执行', {
    timeout: 10_000,
  })
  await expect(readState).toHaveAttribute('data-state', 'empty')
  expect(clashControllerFixture.switches).toMatchObject({
    attempts: 1,
    successful: 1,
    lastBody: { name: 'Node A' },
  })
  const requestsAfterAmbiguousWrite = structuredClone(clashControllerFixture.requests)
  await panel.waitForTimeout(100)
  expect(clashControllerFixture.requests).toEqual(requestsAfterAmbiguousWrite)

  await clashCard.getByTestId('clash-refresh').click()
  await expect(readState).toHaveAttribute('data-state', 'ready')
  await expect(readState).toContainText('当前选择：Node A')

  await readState.getByTestId('clash-switch-prepare').click()
  await expect(readState.getByTestId('clash-switch-review')).toContainText('Node B')
  clashControllerFixture.lifecycle.blockNextPreflight()
  await readState.getByTestId('clash-switch-confirm').click()
  await expect.poll(() => clashControllerFixture.lifecycle.pendingPreflights).toBe(1)
  expect(await panel.evaluate(async origin => (
    chrome.permissions.remove({ origins: [`${origin}/*`] })
  ), clashControllerFixture.origin)).toBe(true)

  await expect(clashCard.getByTestId('clash-control-status')).toHaveCount(0)
  await expect(clashCard.getByTestId('clash-switch-review')).toHaveCount(0)
  await expect.poll(() => clashControllerFixture.lifecycle.pendingPreflights).toBe(0)
  expect(clashControllerFixture.lifecycle.abortedPreflights).toBe(1)
  expect(clashControllerFixture.switches.attempts).toBe(1)
  expect(await readStoredModule(panel, 'dev.oneweb.clash-control')).toMatchObject({
    enabled: true,
    grantedCapabilities: [],
  })
  const requestsAfterRevocation = structuredClone(clashControllerFixture.requests)
  await panel.waitForTimeout(100)
  expect(clashControllerFixture.requests).toEqual(requestsAfterRevocation)
  for (const id of isolatedModuleIds)
    expect(await readStoredModule(panel, id)).toEqual(recordsBefore[id])
  expect(await readModuleLocalState(panel, stateModuleIds)).toEqual(localStateBefore)
  expect(await panel.evaluate(() => chrome.permissions.contains({ permissions: ['bookmarks'] }))).toBe(true)
  expect(await hasFixtureOriginPermission(panel, moduleFixtures.primary.manifestUrl)).toBe(true)
  expect(await hasFixtureOriginPermission(panel, moduleFixtures.secondary.manifestUrl)).toBe(true)
})

test('Bookmark Doctor scans real bookmarks with bounded work, stop and module isolation', async ({
  bookmarkProbeFixture,
  context,
  extensionId,
  moduleFixtures,
}) => {
  const panel = await openManagementPanel(context, extensionId)
  await installFixtureModule(panel, moduleFixtures.primary.manifestUrl, moduleFixtures.primary.manifest.id)
  await installFixtureModule(panel, moduleFixtures.secondary.manifestUrl, moduleFixtures.secondary.manifest.id)
  const remoteBefore = {
    repoLens: await readStoredModule(panel, 'dev.juck.repolens'),
    primary: await readStoredModule(panel, moduleFixtures.primary.manifest.id),
    secondary: await readStoredModule(panel, moduleFixtures.secondary.manifest.id),
  }

  const bookmarkCard = panel.locator('[data-testid="module-card"][data-module-id="dev.oneweb.bookmark-doctor"]')
  await bookmarkCard.getByTestId('module-toggle').click()
  await expect(bookmarkCard.getByTestId('module-toggle')).toHaveAttribute('aria-checked', 'true')
  await bookmarkCard.getByTestId('bookmark-authorize').click()
  await expect(bookmarkCard.getByTestId('bookmark-prepare')).toBeVisible()

  const firstFolderId = await panel.evaluate(async (urls) => {
    const folder = await chrome.bookmarks.create({ title: 'OneWeb Bookmark Doctor E2E' })
    for (const [index, url] of urls.entries()) {
      await chrome.bookmarks.create({
        parentId: folder.id,
        title: `<fixture-${index}>`,
        url,
      })
    }
    return folder.id
  }, [
    bookmarkProbeFixture.urls.ok,
    bookmarkProbeFixture.urls.error,
    bookmarkProbeFixture.urls.timeout,
    bookmarkProbeFixture.urls.failure,
  ])

  await bookmarkCard.getByTestId('bookmark-prepare').click()
  await expect(bookmarkCard.getByTestId('bookmark-doctor-plan')).toContainText('准备检查 4 条链接')
  await bookmarkCard.getByTestId('bookmark-start').click()
  const firstResults = bookmarkCard.getByTestId('bookmark-doctor-results')
  await expect(firstResults).toContainText('扫描完成', { timeout: 15_000 })
  await expect(firstResults).toContainText('可访问 1')
  await expect(firstResults).toContainText('HTTP 错误 1')
  await expect(firstResults).toContainText('超时 1')
  await expect(firstResults).toContainText('网络失败 1')
  await expect(firstResults.locator('img')).toHaveCount(0)
  await firstResults.locator('[data-filter="reachable"]').click()
  await expect(firstResults).toContainText('<fixture-0>')
  await expect(firstResults).not.toContainText('<fixture-1>')
  await firstResults.locator('[data-filter="all"]').click()
  await expect(firstResults.locator('.bookmark-doctor-result')).toHaveCount(4)

  await panel.evaluate(folderId => chrome.bookmarks.removeTree(folderId), firstFolderId)
  await panel.evaluate(async (urls) => {
    const folder = await chrome.bookmarks.create({ title: 'OneWeb Bookmark Doctor Slow E2E' })
    for (const [index, url] of urls.entries())
      await chrome.bookmarks.create({ parentId: folder.id, title: `Slow ${index}`, url })
  }, Array.from({ length: 8 }, (_, index) => bookmarkProbeFixture.urls.slow(index)))

  const abortedBeforeStop = bookmarkProbeFixture.requests.aborted
  await bookmarkCard.getByTestId('bookmark-prepare').click()
  await expect(bookmarkCard.getByTestId('bookmark-doctor-plan')).toContainText('准备检查 8 条链接')
  await bookmarkCard.getByTestId('bookmark-start').click()
  await expect(bookmarkCard.getByTestId('bookmark-stop')).toBeVisible({ timeout: 5_000 })
  await bookmarkCard.getByTestId('bookmark-stop').click()
  await expect(bookmarkCard.getByTestId('bookmark-doctor-results')).toContainText('已停止')
  await expect.poll(() => bookmarkProbeFixture.requests.active).toBe(0)
  expect(bookmarkProbeFixture.requests.aborted).toBeGreaterThan(abortedBeforeStop)
  expect(bookmarkProbeFixture.requests.maximum).toBeLessThanOrEqual(4)

  await bookmarkCard.getByTestId('bookmark-prepare').click()
  await expect(bookmarkCard.getByTestId('bookmark-start')).toBeVisible()
  await bookmarkCard.getByTestId('bookmark-start').click()
  await expect(bookmarkCard.getByTestId('bookmark-stop')).toBeVisible({ timeout: 5_000 })
  await bookmarkCard.getByTestId('module-toggle').click()
  await expect(bookmarkCard.getByTestId('module-toggle')).toHaveAttribute('aria-checked', 'false')
  await expect.poll(() => bookmarkProbeFixture.requests.active).toBe(0)

  await bookmarkCard.getByTestId('module-toggle').click()
  await expect(bookmarkCard.getByTestId('module-toggle')).toHaveAttribute('aria-checked', 'true')
  await bookmarkCard.getByTestId('bookmark-prepare').click()
  await expect(bookmarkCard.getByTestId('bookmark-start')).toBeVisible()
  await bookmarkCard.getByTestId('bookmark-start').click()
  await expect(bookmarkCard.getByTestId('bookmark-stop')).toBeVisible({ timeout: 5_000 })
  await bookmarkCard.getByTestId('bookmark-revoke').click()
  await expect(bookmarkCard.getByTestId('bookmark-authorize')).toBeVisible()
  await expect.poll(() => bookmarkProbeFixture.requests.active).toBe(0)
  expect(await panel.evaluate(() => chrome.permissions.contains({ permissions: ['bookmarks'] }))).toBe(false)
  expect(await readStoredModule(panel, 'dev.oneweb.bookmark-doctor')).toMatchObject({
    enabled: true,
    grantedCapabilities: [],
  })

  expect(await readStoredModule(panel, 'dev.juck.repolens')).toEqual(remoteBefore.repoLens)
  expect(await readStoredModule(panel, moduleFixtures.primary.manifest.id)).toEqual(remoteBefore.primary)
  expect(await readStoredModule(panel, moduleFixtures.secondary.manifest.id)).toEqual(remoteBefore.secondary)
  expect(await hasFixtureOriginPermission(panel, moduleFixtures.primary.manifestUrl)).toBe(true)
  expect(await hasFixtureOriginPermission(panel, moduleFixtures.secondary.manifestUrl)).toBe(true)
})

test('Bookmark Doctor reviews safe repairs, rejects stale targets and isolates remote modules', async ({
  bookmarkProbeFixture,
  context,
  extensionId,
  moduleFixtures,
}) => {
  const panel = await openManagementPanel(context, extensionId)
  await installFixtureModule(panel, moduleFixtures.primary.manifestUrl, moduleFixtures.primary.manifest.id)
  await installFixtureModule(panel, moduleFixtures.secondary.manifestUrl, moduleFixtures.secondary.manifest.id)
  const remoteBefore = {
    repoLens: await readStoredModule(panel, 'dev.juck.repolens'),
    primary: await readStoredModule(panel, moduleFixtures.primary.manifest.id),
    secondary: await readStoredModule(panel, moduleFixtures.secondary.manifest.id),
  }
  const isolatedModuleIds = ['dev.juck.repolens', moduleFixtures.primary.manifest.id, moduleFixtures.secondary.manifest.id]
  const moduleStateBefore = await seedModuleLocalState(panel, isolatedModuleIds)
  const bookmarkCard = panel.locator('[data-testid="module-card"][data-module-id="dev.oneweb.bookmark-doctor"]')
  await bookmarkCard.getByTestId('module-toggle').click()
  await bookmarkCard.getByTestId('bookmark-authorize').click()
  await bookmarkCard.getByTestId('bookmark-authorize-repairs').click()

  const fixture = await panel.evaluate(async (urls) => {
    const source = await chrome.bookmarks.create({ title: 'OneWeb Repair Source' })
    const destination = await chrome.bookmarks.create({ title: 'OneWeb Repair Destination' })
    const create = (title: string, url: string) => chrome.bookmarks.create({
      parentId: source.id,
      title,
      url,
    })
    const [update, move, ignore, deletion, stale] = await Promise.all([
      create('Update', urls[0]),
      create('Move', urls[1]),
      create('Ignore', urls[2]),
      create('Delete', urls[3]),
      create('Stale', urls[4]),
    ])
    return {
      sourceId: source.id,
      destinationId: destination.id,
      updateId: update.id,
      moveId: move.id,
      ignoreId: ignore.id,
      deleteId: deletion.id,
      staleId: stale.id,
    }
  }, [
    bookmarkProbeFixture.urls.error,
    bookmarkProbeFixture.urls.failure,
    bookmarkProbeFixture.urls.error,
    bookmarkProbeFixture.urls.failure,
    bookmarkProbeFixture.urls.error,
  ])

  await bookmarkCard.getByTestId('bookmark-prepare').click()
  await expect(bookmarkCard.getByTestId('bookmark-start')).toBeVisible()
  await bookmarkCard.getByTestId('bookmark-start').click()
  await expect(bookmarkCard.getByTestId('bookmark-doctor-results')).toContainText('扫描完成', { timeout: 15_000 })

  const prepareRepair = async (
    operation: 'update' | 'move' | 'ignore' | 'delete',
    title: string,
    fields: { title?: string, url?: string, parentId?: string, index?: string } = {},
  ) => {
    const row = bookmarkCard.locator('.bookmark-doctor-result').filter({ hasText: title })
    await expect(row).toHaveCount(1)
    await row.getByTestId(`bookmark-result-${operation}`).click()
    await expect(bookmarkCard.getByTestId('bookmark-repair-draft')).toBeVisible()
    if (fields.title !== undefined)
      await bookmarkCard.getByTestId('bookmark-repair-title').fill(fields.title)
    if (fields.url !== undefined)
      await bookmarkCard.getByTestId('bookmark-repair-url').fill(fields.url)
    if (fields.parentId !== undefined)
      await bookmarkCard.getByTestId('bookmark-repair-parent').fill(fields.parentId)
    if (fields.index !== undefined)
      await bookmarkCard.getByTestId('bookmark-repair-index').fill(fields.index)
    await bookmarkCard.getByTestId('bookmark-repair-prepare').click()
    await expect(bookmarkCard.getByTestId('bookmark-repair-review')).toBeVisible()
  }
  const confirmRepair = async () => {
    await bookmarkCard.getByTestId('bookmark-repair-confirm').click()
    await expect(bookmarkCard.getByTestId('bookmark-doctor-message')).toContainText('修复已执行')
    await expect(bookmarkCard.getByTestId('bookmark-repair-review')).toHaveCount(0)
  }

  await prepareRepair('update', 'Update', {
    title: '<reviewed-title>',
    url: 'https://fixed.example/path',
  })
  await expect(bookmarkCard.getByTestId('bookmark-repair-review')).toContainText('<reviewed-title>')
  await expect(bookmarkCard.getByTestId('bookmark-repair-review').locator('script,img')).toHaveCount(0)
  await confirmRepair()
  expect(await panel.evaluate(async id => (await chrome.bookmarks.get(id))[0], fixture.updateId)).toMatchObject({
    title: '<reviewed-title>',
    url: 'https://fixed.example/path',
  })

  await prepareRepair('move', 'Move', { parentId: fixture.destinationId, index: '0' })
  await confirmRepair()
  expect(await panel.evaluate(async id => (await chrome.bookmarks.get(id))[0], fixture.moveId)).toMatchObject({
    parentId: fixture.destinationId,
    index: 0,
  })

  await prepareRepair('ignore', 'Ignore')
  await confirmRepair()
  await expect(bookmarkCard.locator('.bookmark-doctor-result').filter({ hasText: 'Ignore' })).toHaveCount(0)
  await expect.poll(() => panel.evaluate(async (id) => {
    const key = 'oneweb.module-state.v1:dev.oneweb.bookmark-doctor'
    const state = (await chrome.storage.local.get(key))[key]
    return state?.ignoredBookmarks?.some((entry: { bookmarkId: string }) => entry.bookmarkId === id) || false
  }, fixture.ignoreId)).toBe(true)

  await prepareRepair('delete', 'Delete')
  await bookmarkCard.getByTestId('bookmark-repair-confirm').click()
  await expect(bookmarkCard.getByTestId('bookmark-doctor-message')).toContainText('必须勾选')
  expect(await panel.evaluate(async id => (await chrome.bookmarks.get(id)).length, fixture.deleteId)).toBe(1)
  await bookmarkCard.getByTestId('bookmark-repair-delete-confirmation').check()
  await confirmRepair()
  expect(await panel.evaluate(async (id) => {
    try {
      return (await chrome.bookmarks.get(id)).length
    }
    catch {
      return 0
    }
  }, fixture.deleteId)).toBe(0)
  await expect.poll(() => panel.evaluate(async (id) => {
    const key = 'oneweb.module-state.v1:dev.oneweb.bookmark-doctor'
    const state = (await chrome.storage.local.get(key))[key]
    return state?.deletionBackups?.some((entry: { bookmarkId: string }) => entry.bookmarkId === id) || false
  }, fixture.deleteId)).toBe(true)

  const deleteBackup = bookmarkCard.locator('.bookmark-local-item').filter({ hasText: 'Delete' })
  await deleteBackup.getByTestId('bookmark-restore-prepare').click()
  await expect(bookmarkCard.getByTestId('bookmark-restore-review')).toContainText('Delete')
  await bookmarkCard.getByTestId('bookmark-restore-confirm').click()
  await expect(bookmarkCard.getByTestId('bookmark-doctor-message')).toContainText('书签已恢复')
  await expect.poll(() => panel.evaluate(async () => (
    await chrome.bookmarks.search({ title: 'Delete' })
  ).some(bookmark => bookmark.url?.endsWith('/failure')))).toBe(true)

  const ignoredItem = bookmarkCard.locator('.bookmark-local-item').filter({ hasText: 'Ignore' })
  await ignoredItem.getByTestId('bookmark-unignore').click()
  await expect(bookmarkCard.locator('.bookmark-doctor-result').filter({ hasText: 'Ignore' })).toHaveCount(1)

  await prepareRepair('ignore', 'Move')
  await confirmRepair()
  await bookmarkCard.getByTestId('bookmark-local-clear').click()
  await expect(bookmarkCard.getByTestId('bookmark-doctor-message')).toContainText('必须明确确认')
  await bookmarkCard.getByTestId('bookmark-local-clear-confirmation').check()
  await bookmarkCard.getByTestId('bookmark-local-clear').click()
  await expect(bookmarkCard.getByTestId('bookmark-local-diagnostics')).toContainText('忽略 0 · 恢复 0')
  await expect(bookmarkCard.locator('.bookmark-doctor-result').filter({ hasText: 'Move' })).toHaveCount(1)

  await prepareRepair('update', 'Stale', { title: 'Reviewed stale title' })
  await panel.evaluate(id => chrome.bookmarks.update(id, { title: 'Concurrent browser change' }), fixture.staleId)
  await bookmarkCard.getByTestId('bookmark-repair-confirm').click()
  await expect(bookmarkCard.getByTestId('bookmark-doctor-message')).toContainText('确认前已变化')
  expect(await panel.evaluate(async id => (await chrome.bookmarks.get(id))[0].title, fixture.staleId)).toBe('Concurrent browser change')

  expect(await readStoredModule(panel, 'dev.juck.repolens')).toEqual(remoteBefore.repoLens)
  expect(await readStoredModule(panel, moduleFixtures.primary.manifest.id)).toEqual(remoteBefore.primary)
  expect(await readStoredModule(panel, moduleFixtures.secondary.manifest.id)).toEqual(remoteBefore.secondary)
  expect(await readModuleLocalState(panel, isolatedModuleIds)).toEqual(moduleStateBefore)
  await panel.evaluate(async ({ sourceId, destinationId }) => {
    await chrome.bookmarks.removeTree(sourceId)
    await chrome.bookmarks.removeTree(destinationId)
  }, fixture)
})
