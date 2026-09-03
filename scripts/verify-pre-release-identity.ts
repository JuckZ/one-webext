import { promises as fs } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

export const ONEWEB_ROOT_PACKAGE_NAME = 'one-web' as const
export const ONEWEB_DISPLAY_NAME = 'OneWeb' as const
export const ONEWEB_FIREFOX_ID = 'one-web@juckz.local' as const
export const ONEWEB_HOMEPAGE = 'https://github.com/JuckZ/one-web' as const
export const ONEWEB_RELEASE_VERSION = '0.1.0' as const

type JsonRecord = Record<string, unknown>

const forbiddenRuntimeMarkers = Object.freeze([
  ['one-tampermonkey identity', /one-tampermonkey/i],
  ['Tampermonkey runtime', /tampermonkey/i],
  ['GM API', /\bGM_[A-Za-z]/],
  ['userscript build dependency', /vite-plugin-monkey/i],
  ['remote spacing implementation', /spacingjs/i],
  ['unpkg CDN', /unpkg\.com/i],
  ['jsDelivr CDN', /(?:cdn\.)?jsdelivr\.net/i],
  ['dynamic eval', /\beval\s*\(/],
  ['local package dependency', /(?:file|link):(?:\.\.?\/|\/|[a-z]:\\)/i],
  ['absolute Unix home path', /\/(?:home|Users)\/[^/\s"']+/],
  ['absolute Windows user path', /[a-z]:\\Users\\[^\\\s"']+/i],
  ['hard-coded private IPv4 URL', /https?:\/\/(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/],
] as const)

function asRecord(value: unknown, label: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError(`${label} is invalid`)
  return value as JsonRecord
}

export function validateOneWebIdentity(packageManifest: unknown, extensionManifest: unknown) {
  const pkg = asRecord(packageManifest, 'root package manifest')
  const manifest = asRecord(extensionManifest, 'extension manifest')
  const browserSettings = asRecord(manifest.browser_specific_settings, 'browser-specific settings')
  const gecko = asRecord(browserSettings.gecko, 'Firefox settings')

  if (pkg.name !== ONEWEB_ROOT_PACKAGE_NAME || pkg.displayName !== ONEWEB_DISPLAY_NAME)
    throw new TypeError('Root package identity is not canonical OneWeb')
  if (pkg.version !== ONEWEB_RELEASE_VERSION || manifest.version !== ONEWEB_RELEASE_VERSION)
    throw new TypeError('Package and extension versions are not the canonical release candidate')
  if (pkg.homepage !== ONEWEB_HOMEPAGE)
    throw new TypeError('Root package homepage is not the canonical OneWeb repository')
  if (manifest.name !== ONEWEB_DISPLAY_NAME)
    throw new TypeError('Built extension display name is not canonical OneWeb')
  if (gecko.id !== ONEWEB_FIREFOX_ID)
    throw new TypeError('Firefox add-on identity is not canonical OneWeb')

  return {
    displayName: ONEWEB_DISPLAY_NAME,
    firefoxId: ONEWEB_FIREFOX_ID,
    homepage: ONEWEB_HOMEPAGE,
    packageName: ONEWEB_ROOT_PACKAGE_NAME,
    version: ONEWEB_RELEASE_VERSION,
  }
}

export function findForbiddenRuntimeMarker(filePath: string, text: string) {
  for (const [label, pattern] of forbiddenRuntimeMarkers) {
    if (pattern.test(text))
      return { filePath, label }
  }
  return null
}

export function validateRuntimeTexts(entries: readonly Readonly<{ filePath: string, text: string }>[]) {
  for (const entry of entries) {
    const issue = findForbiddenRuntimeMarker(entry.filePath, entry.text)
    if (issue)
      throw new TypeError(`Legacy runtime marker rejected (${issue.label}): ${issue.filePath}`)
  }
  return entries.length
}

async function collectTextFiles(target: string): Promise<string[]> {
  const stat = await fs.stat(target)
  if (stat.isFile())
    return [target]
  const files: string[] = []
  for (const entry of await fs.readdir(target, { withFileTypes: true })) {
    const child = path.join(target, entry.name)
    if (entry.isDirectory() && entry.name !== '__tests__')
      files.push(...await collectTextFiles(child))
    else if (entry.isFile() && /\.(?:css|html|js|json|mjs|ts)$/.test(entry.name))
      files.push(child)
  }
  return files
}

async function main() {
  const projectDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
  const packageManifest = JSON.parse(await fs.readFile(path.join(projectDir, 'package.json'), 'utf8'))
  const extensionManifest = JSON.parse(await fs.readFile(path.join(projectDir, 'extension/manifest.json'), 'utf8'))
  const identity = validateOneWebIdentity(packageManifest, extensionManifest)
  const targets = [
    path.join(projectDir, 'package.json'),
    path.join(projectDir, 'pnpm-lock.yaml'),
    path.join(projectDir, 'src/modules/builtin/page-toolbox'),
    path.join(projectDir, 'src/pageToolboxContent'),
    path.join(projectDir, 'vite.config.page-toolbox.ts'),
    path.join(projectDir, 'extension/manifest.json'),
    path.join(projectDir, 'extension/dist'),
  ]
  const files = (await Promise.all(targets.map(collectTextFiles))).flat().sort()
  const entries = await Promise.all(files.map(async filePath => ({
    filePath: path.relative(projectDir, filePath),
    text: await fs.readFile(filePath, 'utf8'),
  })))
  validateRuntimeTexts(entries)
  process.stdout.write(`OneWeb pre-release identity verified (${identity.packageName}, ${identity.firefoxId}, ${entries.length} production files).\n`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
