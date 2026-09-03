import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const distRoot = path.join(packageRoot, 'dist')
const expectedFiles = [
  'capability-client.d.ts',
  'capability-client.js',
  'capability-rpc.d.ts',
  'capability-rpc.js',
  'catalog.d.ts',
  'catalog.js',
  'index.d.ts',
  'index.js',
  'manifest.d.ts',
  'manifest.js',
  'protocol.d.ts',
  'protocol.js',
  'runtime-client.d.ts',
  'runtime-client.js',
  'runtime-state.d.ts',
  'runtime-state.js',
  'storage-module.d.ts',
  'storage-module.js',
]
const capabilityRpcForbiddenContent = [
  'MessagePort',
  'ModuleFrameHost',
  'ModuleRegistry',
  'XMLHttpRequest',
  'browser.',
  'chrome.',
  'fetch(',
  'http://',
  'https://',
  'postMessage',
]
const capabilityClientForbiddenContent = [
  'ModuleFrameHost',
  'ModuleRegistry',
  'XMLHttpRequest',
  'browser.',
  'chrome.',
  'fetch(',
  'http://',
  'https://',
]
const storageModuleForbiddenContent = [
  'ModuleFrameHost',
  'ModuleRegistry',
  'XMLHttpRequest',
  'browser.',
  'chrome.',
  'fetch(',
  'http://',
  'https://',
  'postMessage',
  'oneweb.module-state.v1:',
]
const forbiddenContent = [
  '/home/',
  'bookmarks.read',
  'bookmarks.write',
  'clash.status.read',
  'oneweb.modules.v1',
  'ModuleRegistry',
  'ModuleUpdateApproval',
  'chrome.permissions',
  'src/modules/',
]

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: packageRoot,
    encoding: 'utf8',
    env: process.env,
  })
  if (result.stdout)
    process.stdout.write(result.stdout)
  if (result.stderr)
    process.stderr.write(result.stderr)
  assert.equal(result.status, 0, `${command} ${args.join(' ')} failed`)
}

function snapshotDist() {
  const files = fs.readdirSync(distRoot, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => path.relative(distRoot, path.join(entry.parentPath, entry.name)).replaceAll(path.sep, '/'))
    .sort()
  assert.deepEqual(files, expectedFiles)
  return Object.fromEntries(files.map((file) => {
    const content = fs.readFileSync(path.join(distRoot, file))
    const text = content.toString('utf8')
    for (const forbidden of forbiddenContent)
      assert.equal(text.includes(forbidden), false, `${file} contains forbidden package content: ${forbidden}`)
    if (file.startsWith('capability-rpc.')) {
      for (const forbidden of capabilityRpcForbiddenContent)
        assert.equal(text.includes(forbidden), false, `${file} crosses the pure RPC boundary: ${forbidden}`)
    }
    if (file.startsWith('capability-client.')) {
      for (const forbidden of capabilityClientForbiddenContent)
        assert.equal(text.includes(forbidden), false, `${file} crosses the SDK client boundary: ${forbidden}`)
    }
    if (file.startsWith('storage-module.')) {
      for (const forbidden of storageModuleForbiddenContent)
        assert.equal(text.includes(forbidden), false, `${file} crosses the pure storage boundary: ${forbidden}`)
    }
    return [file, crypto.createHash('sha256').update(content).digest('hex')]
  }))
}

const packageJson = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'))
assert.equal(packageJson.private, true)
assert.deepEqual(packageJson.files, ['contract.json', 'dist'])
assert.deepEqual(Object.keys(packageJson.exports), [
  '.',
  './runtime',
  './capability-rpc',
  './capability-client',
  './storage-module',
  './contract.json',
])

run('pnpm', ['run', 'build'])
const first = snapshotDist()
run('pnpm', ['run', 'build'])
const second = snapshotDist()
assert.deepEqual(second, first, 'Module SDK package output changed between two clean builds')
const pack = spawnSync('npm', ['pack', '--dry-run', '--json', '--loglevel=error'], {
  cwd: packageRoot,
  encoding: 'utf8',
  env: process.env,
})
if (pack.stderr)
  process.stderr.write(pack.stderr)
assert.equal(pack.status, 0, 'npm pack --dry-run failed')
const [packResult] = JSON.parse(pack.stdout)
assert.deepEqual(
  packResult.files.map(file => file.path).sort(),
  [
    'contract.json',
    'package.json',
    ...expectedFiles.map(file => `dist/${file}`),
  ].sort(),
  'Packed SDK file list differs from the reviewed allowlist',
)
run(process.execPath, ['scripts/consumer-smoke.mjs'])
run('pnpm', [
  '--dir',
  '../..',
  'exec',
  'tsc',
  '-p',
  'packages/module-sdk/scripts/tsconfig.consumer.json',
])

console.log(`Module SDK package is reproducible (${packResult.files.length} packed files).`)
