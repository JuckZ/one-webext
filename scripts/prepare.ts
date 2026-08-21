// generate stub index.html files for dev entry
import { execSync } from 'node:child_process'
import chokidar from 'chokidar'
import fs from 'fs-extra'
import { isDev, log, port, r } from './utils'

/**
 * Generates development HTML stubs for each extension view.
 *
 * Each stub references the Vite development server and displays a fallback message until the server starts.
 */
async function stubIndexHtml() {
  const views = [
    'home',
    'sidebar',
    'options',
    'popup',
    'background',
    'devtools',
    'devtools-page',
  ]

  for (const view of views) {
    await fs.ensureDir(r(`extension/dist/${view}`))
    let data = await fs.readFile(r(`src/${view}/index.html`), 'utf-8')
    data = data
      .replace('"./main.ts"', `"http://localhost:${port}/${view}/main.ts"`)
      .replace('<div id="app"></div>', '<div id="app">Vite server did not start</div>')
    await fs.writeFile(r(`extension/dist/${view}/index.html`), data, 'utf-8')
    log('PRE', `stub ${view}`)
  }
}

/**
 * Generates the project manifest.
 */
function writeManifest() {
  execSync('pnpm exec esno ./scripts/manifest.ts', { stdio: 'inherit' })
}

writeManifest()

if (isDev) {
  stubIndexHtml()
  chokidar.watch(r('src/**/*.html'))
    .on('change', () => {
      stubIndexHtml()
    })
  chokidar.watch([r('src/manifest.ts'), r('package.json')])
    .on('change', () => {
      writeManifest()
    })
}
