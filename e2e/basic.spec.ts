import process from 'node:process'
import { expect, extensionPath, test } from './fixtures'

const browserLabel = process.env.PW_BROWSER_CHANNEL === 'msedge' ? 'edge' : (process.env.PW_BROWSER_CHANNEL === 'chrome' ? 'chrome' : 'chromium')
const reportScreenshot = `/home/juck/Projects/repolens-starter/data/one-webext-${browserLabel}-side-panel.png`

test('built artifact exposes a least-privilege RepoLens side panel', async ({ extensionId }) => {
  const manifest = await import(`${extensionPath}/manifest.json`, { with: { type: 'json' } }).then(module => module.default)
  expect(extensionId).toMatch(/^[a-p]{32}$/)
  expect(manifest.side_panel.default_path).toBe('dist/sidebar/index.html')
  expect(manifest.permissions).toEqual(['activeTab', 'storage', 'tabs', 'sidePanel'])
  expect(manifest.host_permissions).toEqual(['https://github.com/*', 'http://127.0.0.1:4747/*'])
  expect(manifest.content_scripts[0].matches).toEqual(['https://github.com/*'])
})

test('GitHub SPA context reaches the 420px panel through the secure iframe bridge', async ({ context, extensionId, page }) => {
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
  const embed = panel.frameLocator('[data-testid="repolens-embed"]')
  await expect(embed.locator('#repo')).toHaveText('vuejs/core')
  await expect(embed.locator('#summary')).toBeVisible({ timeout: 15_000 })
  await expect(embed.locator('#state-text')).toContainText('缓存摘要')

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

  const beforeAttack = await panel.locator('.bridge-state').textContent()
  await panel.evaluate((origin) => {
    const target = document.querySelector('iframe') as HTMLIFrameElement
    window.dispatchEvent(new MessageEvent('message', {
      origin: 'https://evil.example',
      source: target.contentWindow,
      data: { protocol: 'repolens.bridge', version: 1, type: 'ANALYSIS_STATE', state: 'owned' },
    }))
    window.postMessage({ protocol: 'repolens.bridge', version: 1, type: 'ANALYSIS_STATE', state: 'owned' }, origin)
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
