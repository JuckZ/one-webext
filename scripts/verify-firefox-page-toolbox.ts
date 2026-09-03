/* eslint-disable no-template-curly-in-string -- embedded scripts execute inside Firefox extension/chrome contexts */
import type { ChildProcess } from 'node:child_process'
import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import net, { type AddressInfo, type Socket } from 'node:net'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import fs from 'fs-extra'

const EXTENSION_ID = 'one-web@juckz.local'
const EXTENSION_SIDEBAR_IDENTITY = EXTENSION_ID.split('@')[0]
const PAGE_TOOLBOX_ID = 'dev.oneweb.page-toolbox'
const COMMAND_TIMEOUT_MS = 30_000
const STARTUP_TIMEOUT_MS = 45_000
const POLL_INTERVAL_MS = 100

type JsonRecord = Record<string, unknown>

export function encodeLengthPrefixedJson(value: unknown) {
  const payload = JSON.stringify(value)
  return Buffer.from(`${Buffer.byteLength(payload)}:${payload}`)
}

export class LengthPrefixedJsonDecoder {
  private buffer = Buffer.alloc(0)

  push(chunk: Buffer | string) {
    this.buffer = Buffer.concat([this.buffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)])
    const messages: unknown[] = []
    while (true) {
      const separator = this.buffer.indexOf(58)
      if (separator < 1)
        break
      const lengthText = this.buffer.subarray(0, separator).toString()
      if (!/^\d+$/.test(lengthText))
        throw new TypeError('Invalid length-prefixed JSON header')
      const length = Number(lengthText)
      const end = separator + 1 + length
      if (!Number.isSafeInteger(length) || length < 0)
        throw new TypeError('Invalid length-prefixed JSON size')
      if (this.buffer.length < end)
        break
      messages.push(JSON.parse(this.buffer.subarray(separator + 1, end).toString()))
      this.buffer = this.buffer.subarray(end)
    }
    return messages
  }
}

export class FirefoxProcessLog {
  private output = ''
  private rdpPort: number | null = null

  push(chunk: Buffer | string) {
    this.output += chunk.toString()
    const matches = [...this.output.matchAll(/Firefox args:[^\n]*-start-debugger-server\s+(\d+)/g)]
    const ports = new Set(matches.map(match => Number(match[1])))
    if (ports.size > 1)
      throw new Error('Firefox launch output contains conflicting RDP ports')
    const [port] = ports
    if (port !== undefined) {
      if (!Number.isSafeInteger(port) || port < 1 || port > 65_535)
        throw new Error('Firefox launch output contains an invalid RDP port')
      this.rdpPort = port
    }
    if (this.output.length > 256 * 1024)
      this.output = this.output.slice(-128 * 1024)
    return this.rdpPort
  }

  get port() { return this.rdpPort }
  get tail() { return this.output.slice(-8_192) }
}

export function firefoxAddonOrigin(response: unknown, extensionId = EXTENSION_ID) {
  if (!response || typeof response !== 'object' || Array.isArray(response))
    return null
  const addons = (response as JsonRecord).addons
  if (!Array.isArray(addons))
    return null
  const addon = addons.find((candidate) => {
    return candidate && typeof candidate === 'object' && !Array.isArray(candidate)
      && (candidate as JsonRecord).id === extensionId
  }) as JsonRecord | undefined
  if (!addon || addon.temporarilyInstalled !== true || typeof addon.manifestURL !== 'string')
    return null
  let manifestUrl: URL
  try {
    manifestUrl = new URL(addon.manifestURL)
  }
  catch {
    return null
  }
  return manifestUrl.protocol === 'moz-extension:' && manifestUrl.hostname && manifestUrl.pathname === '/manifest.json'
    ? `moz-extension://${manifestUrl.host}`
    : null
}

export function validateFirefoxArtifactManifest(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('Firefox artifact manifest is invalid')
  const manifest = value as JsonRecord
  const gecko = manifest.browser_specific_settings as JsonRecord | undefined
  const geckoSettings = gecko?.gecko as JsonRecord | undefined
  const sidebar = manifest.sidebar_action as JsonRecord | undefined
  if (manifest.manifest_version !== 3
    || geckoSettings?.id !== EXTENSION_ID
    || sidebar?.default_panel !== 'dist/sidebar/index.html'
    || Object.hasOwn(manifest, 'side_panel')) {
    throw new TypeError('Firefox artifact does not expose the expected production sidebar boundary')
  }
  const permissions = manifest.permissions
  const optionalOrigins = manifest.optional_host_permissions
  if (!Array.isArray(permissions)
    || permissions.includes('<all_urls>')
    || !Array.isArray(optionalOrigins)
    || !optionalOrigins.includes('http://*/*')
    || !optionalOrigins.includes('https://*/*')) {
    throw new TypeError('Firefox artifact permission boundary is invalid')
  }
  return true
}

export async function terminateProcessGroup(
  pid: number | undefined,
  kill: (_pid: number, _signal: NodeJS.Signals) => void = process.kill,
  wait: (_milliseconds: number) => Promise<void> = delay,
) {
  if (!Number.isSafeInteger(pid) || !pid || pid < 1)
    return [] as NodeJS.Signals[]
  const signals: NodeJS.Signals[] = []
  for (const signal of ['SIGTERM', 'SIGKILL'] as const) {
    try {
      kill(-pid, signal)
      signals.push(signal)
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH')
        break
      throw error
    }
    if (signal === 'SIGTERM')
      await wait(750)
  }
  return signals
}

function delay(milliseconds: number) {
  return new Promise<void>(resolve => setTimeout(resolve, milliseconds))
}

function asRecord(value: unknown, label: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError(`${label} is invalid`)
  return value as JsonRecord
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition)
    throw new Error(message)
}

class MarionetteClient {
  private readonly decoder = new LengthPrefixedJsonDecoder()
  private readonly pending = new Map<number, {
    reject: (_error: Error) => void
    resolve: (_value: unknown) => void
    timer: ReturnType<typeof setTimeout>
  }>()

  private sequence = 0
  private socket: Socket | null = null
  private handshake: JsonRecord | null = null

  async connect(port: number) {
    const socket = net.createConnection({ host: '127.0.0.1', port })
    this.socket = socket
    socket.on('data', chunk => this.accept(chunk))
    socket.on('error', error => this.failAll(error))
    socket.on('close', () => this.failAll(new Error('Marionette connection closed')))
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve)
      socket.once('error', reject)
    })
    await pollUntil(() => this.handshake, STARTUP_TIMEOUT_MS, 'Marionette handshake')
    assert(this.handshake?.applicationType === 'gecko', 'Unexpected Marionette application type')
  }

  private accept(chunk: Buffer) {
    for (const message of this.decoder.push(chunk)) {
      if (!Array.isArray(message)) {
        this.handshake = asRecord(message, 'Marionette handshake')
        continue
      }
      const [, id, error, result] = message
      if (typeof id !== 'number')
        continue
      const deferred = this.pending.get(id)
      if (!deferred)
        continue
      clearTimeout(deferred.timer)
      this.pending.delete(id)
      if (error)
        deferred.reject(new Error(`Marionette command failed: ${JSON.stringify(error)}`))
      else
        deferred.resolve(result)
    }
  }

  private failAll(error: Error) {
    for (const deferred of this.pending.values()) {
      clearTimeout(deferred.timer)
      deferred.reject(error)
    }
    this.pending.clear()
  }

  command(name: string, parameters: JsonRecord = {}) {
    if (!this.socket)
      return Promise.reject(new Error('Marionette is not connected'))
    const id = ++this.sequence
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Marionette command timed out: ${name}`))
      }, COMMAND_TIMEOUT_MS)
      this.pending.set(id, { reject, resolve, timer })
      this.socket!.write(encodeLengthPrefixedJson([0, id, name, parameters]))
    })
  }

  close() {
    this.socket?.destroy()
    this.socket = null
    this.failAll(new Error('Marionette connection closed'))
  }
}

class RdpClient {
  private readonly decoder = new LengthPrefixedJsonDecoder()
  private pending: {
    reject: (_error: Error) => void
    resolve: (_value: unknown) => void
    timer: ReturnType<typeof setTimeout>
  } | null = null

  private rootReady = false
  private socket: Socket | null = null

  async connect(port: number) {
    const socket = net.createConnection({ host: '127.0.0.1', port })
    this.socket = socket
    socket.on('data', chunk => this.accept(chunk))
    socket.on('error', error => this.fail(error))
    socket.on('close', () => this.fail(new Error('Firefox RDP connection closed')))
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve)
      socket.once('error', reject)
    })
    await pollUntil(() => this.rootReady, STARTUP_TIMEOUT_MS, 'Firefox RDP root actor')
  }

  private accept(chunk: Buffer) {
    for (const message of this.decoder.push(chunk)) {
      const record = asRecord(message, 'Firefox RDP response')
      if (!this.rootReady && record.from === 'root') {
        this.rootReady = true
        continue
      }
      if (!this.pending || record.from !== 'root')
        continue
      const deferred = this.pending
      this.pending = null
      clearTimeout(deferred.timer)
      if (record.error)
        deferred.reject(new Error(`Firefox RDP request failed: ${JSON.stringify(record)}`))
      else
        deferred.resolve(record)
    }
  }

  private fail(error: Error) {
    if (!this.pending)
      return
    clearTimeout(this.pending.timer)
    this.pending.reject(error)
    this.pending = null
  }

  request(type: string) {
    if (!this.socket || this.pending)
      return Promise.reject(new Error('Firefox RDP client is unavailable'))
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending = null
        reject(new Error(`Firefox RDP request timed out: ${type}`))
      }, COMMAND_TIMEOUT_MS)
      this.pending = { reject, resolve, timer }
      this.socket!.write(encodeLengthPrefixedJson({ to: 'root', type }))
    })
  }

  close() {
    this.socket?.destroy()
    this.socket = null
    this.fail(new Error('Firefox RDP connection closed'))
  }
}

async function pollUntil<T>(
  read: () => T | Promise<T>,
  timeout: number,
  label: string,
  accept: (_value: T) => boolean = Boolean,
) {
  const deadline = Date.now() + timeout
  let latest: T
  while (Date.now() < deadline) {
    latest = await read()
    if (accept(latest))
      return latest
    await delay(POLL_INTERVAL_MS)
  }
  throw new Error(`${label} did not become ready within ${timeout} ms`)
}

function renderPageToolboxFixture(label: string) {
  return [
    '<!doctype html><html><head><meta charset="utf-8"><title>Firefox Page Toolbox ',
    label,
    '</title></head><body contenteditable="false">',
    '<input id="toolbox-password" type="password" value="page-local-secret">',
    '<p id="toolbox-copy-target">untrusted &lt;script&gt;page text&lt;/script&gt;</p>',
    '<iframe id="toolbox-child-frame" src="/frame"></iframe>',
    '<script>',
    'window.__pageToolboxFixture={copyBlocks:0};',
    'document.body.addEventListener("copy",event=>{window.__pageToolboxFixture.copyBlocks++;event.preventDefault()});',
    '</script></body></html>',
  ].join('')
}

async function startFixtures() {
  const server = createServer((request, response) => {
    const url = new URL(request.url || '/', 'http://127.0.0.1')
    if (url.pathname === '/frame') {
      response.writeHead(200, { 'cache-control': 'no-store', 'content-type': 'text/html; charset=utf-8' })
        .end('<!doctype html><body><input id="frame-password" type="password" value="frame-secret"></body>')
      return
    }
    if (url.pathname === '/favicon.ico') {
      response.writeHead(204, { 'cache-control': 'no-store' }).end()
      return
    }
    const label = request.headers.host?.startsWith('localhost') ? 'beta' : 'alpha'
    response.writeHead(200, { 'cache-control': 'no-store', 'content-type': 'text/html; charset=utf-8' })
      .end(renderPageToolboxFixture(label))
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(80, '127.0.0.1', resolve)
  })
  return {
    alphaOrigin: 'http://127.0.0.1',
    betaOrigin: 'http://localhost',
    close: () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
    server,
  }
}

async function availablePort() {
  const server = net.createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const port = (server.address() as AddressInfo).port
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  return port
}

async function waitForRdpPort(child: ChildProcess, log: FirefoxProcessLog) {
  return new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Firefox did not publish an RDP port.\n${log.tail}`)), STARTUP_TIMEOUT_MS)
    const accept = (chunk: Buffer) => {
      try {
        const port = log.push(chunk)
        if (port) {
          clearTimeout(timer)
          resolve(port)
        }
      }
      catch (error) {
        clearTimeout(timer)
        reject(error)
      }
    }
    child.stdout?.on('data', accept)
    child.stderr?.on('data', accept)
    child.once('exit', (code, signal) => {
      clearTimeout(timer)
      reject(new Error(`Firefox exited before startup (code ${code}, signal ${signal}).\n${log.tail}`))
    })
  })
}

async function connectRdp(port: number) {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS
  let latest: unknown
  while (Date.now() < deadline) {
    const client = new RdpClient()
    try {
      await client.connect(port)
      return client
    }
    catch (error) {
      latest = error
      client.close()
      await delay(150)
    }
  }
  throw new Error(`Unable to connect to Firefox RDP: ${String(latest)}`)
}

async function discoverExtensionOrigin(rdp: RdpClient) {
  return pollUntil(async () => firefoxAddonOrigin(await rdp.request('listAddons')), STARTUP_TIMEOUT_MS, 'temporary OneWeb add-on origin')
}

function unwrapValue<T>(value: unknown) {
  const record = asRecord(value, 'Marionette value')
  return record.value as T
}

async function execute(
  client: MarionetteClient,
  script: string,
  args: unknown[] = [],
  newSandbox = false,
) {
  return unwrapValue(await client.command('WebDriver:ExecuteScript', {
    args,
    newSandbox,
    script,
    scriptTimeout: COMMAND_TIMEOUT_MS,
  }))
}

async function executeAsync(
  client: MarionetteClient,
  script: string,
  args: unknown[] = [],
  newSandbox = false,
) {
  return unwrapValue(await client.command('WebDriver:ExecuteAsyncScript', {
    args,
    newSandbox,
    script,
    scriptTimeout: COMMAND_TIMEOUT_MS,
  }))
}

async function setContext(client: MarionetteClient, value: 'chrome' | 'content') {
  await client.command('Marionette:SetContext', { value })
}

async function switchWindow(client: MarionetteClient, handle: string) {
  await client.command('WebDriver:SwitchToWindow', { handle })
}

async function navigate(client: MarionetteClient, url: string) {
  await client.command('WebDriver:Navigate', { url })
}

async function newTab(client: MarionetteClient, url: string) {
  const created = asRecord(await client.command('WebDriver:NewWindow', { type: 'tab' }), 'new Firefox tab')
  assert(typeof created.handle === 'string', 'Firefox did not return a tab handle')
  await switchWindow(client, created.handle)
  await navigate(client, url)
  return created.handle
}

async function waitForPage(client: MarionetteClient, predicate: string, label: string) {
  return pollUntil(
    () => execute(client, `return Boolean(${predicate})`),
    COMMAND_TIMEOUT_MS,
    label,
  )
}

async function grantExactOrigin(client: MarionetteClient, originPattern: string) {
  await setContext(client, 'chrome')
  const result = asRecord(await executeAsync(client, [
    'const pattern=arguments[0],done=arguments[arguments.length-1];',
    '(async()=>{',
    'const {ExtensionPermissions}=ChromeUtils.importESModule("resource://gre/modules/ExtensionPermissions.sys.mjs");',
    `const policy=WebExtensionPolicy.getByID(${JSON.stringify(EXTENSION_ID)});`,
    'if(!policy?.extension)throw new Error("temporary OneWeb policy missing");',
    'await ExtensionPermissions.add(policy.id,{permissions:[],origins:[pattern]},policy.extension);',
    'const uri=Services.io.newURI(pattern.slice(0,-1));',
    'for(let attempt=0;attempt<100&&!policy.allowedOrigins.matches(uri.spec);attempt++)await new Promise(resolve=>setTimeout(resolve,50));',
    'return {ok:true,allowed:policy.allowedOrigins.matches(uri.spec),activeOrigins:policy.extension.activePermissions.origins};',
    '})().then(done,error=>done({ok:false,error:String(error)}));',
  ].join(''), [originPattern]), 'Firefox exact-origin grant')
  assert(result.ok === true, `Firefox exact-origin grant failed: ${String(result.error)}`)
  assert(result.allowed === true, `Firefox exact-origin grant did not update policy: ${JSON.stringify(result)}`)
  await setContext(client, 'content')
}

async function activateAndApprove(client: MarionetteClient, driverHandle: string, origin: string) {
  await switchWindow(client, driverHandle)
  const result = asRecord(await executeAsync(client, [
    'const input=arguments[0],done=arguments[arguments.length-1];',
    '(async()=>{',
    'const tabs=await browser.tabs.query({});',
    'const tab=tabs.find(candidate=>candidate.url&&candidate.url.startsWith(`${input.origin}/`));',
    'if(!tab)throw new Error(`site tab missing: ${input.origin}`);',
    'await browser.tabs.update(tab.id,{active:true});',
    'await new Promise(resolve=>setTimeout(resolve,100));',
    'const send=async message=>(await browser.runtime.sendMessage(message)).result;',
    'const base={channel:"oneweb.page-toolbox.management",version:1};',
    'const prepared=await send({...base,type:"PAGE_TOOLBOX_PREPARE_CURRENT_SITE"});',
    'if(!prepared?.ok)throw new Error(`prepare failed: ${JSON.stringify(prepared)}`);',
    'const confirmed=await send({...base,type:"PAGE_TOOLBOX_CONFIRM_CURRENT_SITE",token:prepared.preparation.token});',
    'if(!confirmed?.ok)throw new Error(`confirm failed: ${JSON.stringify(confirmed)}`);',
    'return {prepared,confirmed};',
    '})().then(value=>done({ok:true,value}),error=>done({ok:false,error:String(error)}));',
  ].join(''), [{ origin }]), 'Firefox Page Toolbox approval')
  assert(result.ok === true, `Firefox Page Toolbox approval failed: ${String(result.error)}`)
  return asRecord(result.value, 'Firefox Page Toolbox approval value')
}

async function activateAndRunSidebarSave(client: MarionetteClient, driverHandle: string, origin: string) {
  await switchWindow(client, driverHandle)
  const result = asRecord(await executeAsync(client, [
    'const input=arguments[0],done=arguments[arguments.length-1];',
    '(async()=>{',
    'const delay=milliseconds=>new Promise(resolve=>setTimeout(resolve,milliseconds));',
    'const tabs=await browser.tabs.query({});',
    'const tab=tabs.find(candidate=>candidate.url&&candidate.url.startsWith(`${input.origin}/`));',
    'if(!tab)throw new Error("site tab missing");',
    'await browser.tabs.update(tab.id,{active:true});',
    'await delay(100);',
    'document.querySelector("[data-testid=page-toolbox-refresh]").click();',
    'for(let attempt=0;attempt<100;attempt++){',
    'const control=document.querySelector("[data-testid=page-toolbox-control]");',
    'if(control?.dataset.state==="ready")break;',
    'await delay(50);',
    '}',
    'const control=document.querySelector("[data-testid=page-toolbox-control]");',
    'if(control?.dataset.state!=="ready")throw new Error(`sidebar not ready: ${control?.dataset.state}`);',
    'for(const toolId of ["free-page-edit","selection-copy-release"]){',
    'const checkbox=document.querySelector(`[data-tool-id="${toolId}"] input[data-page-toolbox-enabled]`);',
    'if(!(checkbox instanceof HTMLInputElement))throw new Error(`checkbox missing: ${toolId}`);',
    'checkbox.checked=true;',
    'checkbox.dispatchEvent(new Event("change",{bubbles:true}));',
    '}',
    'document.querySelector("[data-testid=page-toolbox-save]").click();',
    'for(let attempt=0;attempt<100;attempt++){',
    'const stored=await browser.storage.local.get("oneweb.module-state.v1:dev.oneweb.page-toolbox");',
    'const enabled=stored["oneweb.module-state.v1:dev.oneweb.page-toolbox"]?.settings?.sites?.[input.origin]?.enabledToolIds||[];',
    'if(enabled.includes("free-page-edit")&&enabled.includes("selection-copy-release"))return enabled;',
    'await delay(50);',
    '}',
    'throw new Error("trusted sidebar save did not settle");',
    '})().then(value=>done({ok:true,value}),error=>done({ok:false,error:String(error)}));',
  ].join(''), [{ origin }]), 'Firefox trusted sidebar save')
  assert(result.ok === true, `Firefox trusted sidebar save failed: ${String(result.error)}`)
  return result.value
}

async function toggleBuiltin(client: MarionetteClient, driverHandle: string, expected: boolean) {
  await switchWindow(client, driverHandle)
  await execute(client, [
    `const card=document.querySelector('[data-testid="module-card"][data-module-id="${PAGE_TOOLBOX_ID}"]');`,
    'const toggle=card?.querySelector("[data-testid=module-toggle]");',
    'if(!toggle)throw new Error("Page Toolbox toggle missing");',
    `if(toggle.getAttribute('aria-checked')!==${JSON.stringify(String(expected))})toggle.click();`,
    'return true;',
  ].join(''))
  await pollUntil(async () => {
    await switchWindow(client, driverHandle)
    return execute(client, `return document.querySelector('[data-testid="module-card"][data-module-id="${PAGE_TOOLBOX_ID}"] [data-testid="module-toggle"]')?.getAttribute('aria-checked')`)
  }, COMMAND_TIMEOUT_MS, `Page Toolbox enabled=${expected}`, value => value === String(expected))
}

async function runFirefoxScenario(
  client: MarionetteClient,
  extensionOrigin: string,
  alphaOrigin: string,
  betaOrigin: string,
) {
  await client.command('WebDriver:NewSession', { capabilities: { alwaysMatch: {} } })
  const handles = await client.command('WebDriver:GetWindowHandles')
  assert(Array.isArray(handles) && typeof handles[0] === 'string', 'Firefox did not expose an initial tab')
  const alphaHandle = handles[0]
  await navigate(client, `${alphaOrigin}/toolbox`)
  const betaHandle = await newTab(client, `${betaOrigin}/toolbox`)
  const sidebarUrl = `${extensionOrigin}/dist/sidebar/index.html`
  const driverHandle = await newTab(client, sidebarUrl)
  await waitForPage(client, 'document.readyState==="complete"&&document.querySelector("[data-testid=manage-modules]")', 'trusted Firefox sidebar page')

  await setContext(client, 'chrome')
  const actualSidebar = asRecord(await execute(client, [
    'const win=Services.wm.getMostRecentWindow("navigator:browser");',
    'const controller=win.SidebarController;',
    'const child=controller?.browser?.contentDocument?.querySelector("#webext-panels-browser");',
    'return {current:controller?.currentID||null,uri:child?.currentURI?.spec||null,remote:child?.isRemoteBrowser===true};',
  ].join('')), 'real Firefox sidebar')
  assert(actualSidebar.uri === sidebarUrl && actualSidebar.remote === true, 'Firefox did not load the packaged OneWeb sidebar')
  assert(typeof actualSidebar.current === 'string' && actualSidebar.current.includes(EXTENSION_SIDEBAR_IDENTITY), 'Firefox sidebar identity is invalid')
  await setContext(client, 'content')
  await switchWindow(client, driverHandle)

  await execute(client, 'document.querySelector("[data-testid=manage-modules]").click();return true')
  await waitForPage(client, `document.querySelector('[data-testid="module-card"][data-module-id="${PAGE_TOOLBOX_ID}"]')`, 'Page Toolbox module card')

  const protectedIds = [
    'dev.juck.repolens',
    'dev.oneweb.bookmark-doctor',
    'dev.oneweb.clash-control',
  ]
  const baseline = asRecord(await executeAsync(client, [
    'const ids=arguments[0],done=arguments[arguments.length-1];',
    '(async()=>{',
    'const sentinels=Object.fromEntries(ids.map((id,index)=>[`oneweb.module-state.v1:${id}`,{sentinel:id,index}]));',
    'await browser.storage.local.set(sentinels);',
    'return {permissions:await browser.permissions.getAll(),storage:await browser.storage.local.get(null)};',
    '})().then(done,error=>done({error:String(error)}));',
  ].join(''), [protectedIds]), 'Firefox isolation baseline')
  assert(!baseline.error, `Unable to capture Firefox isolation baseline: ${String(baseline.error)}`)

  await toggleBuiltin(client, driverHandle, true)
  await grantExactOrigin(client, `${alphaOrigin}/*`)
  const approval = await activateAndApprove(client, driverHandle, alphaOrigin)
  const confirmation = asRecord(approval.confirmed, 'Firefox Page Toolbox confirmation')
  assert(confirmation.injected === true, `Firefox Page Toolbox confirmation did not inject: ${JSON.stringify(approval)}`)
  await activateAndRunSidebarSave(client, driverHandle, alphaOrigin)

  await switchWindow(client, alphaHandle)
  await pollUntil(() => execute(client, 'return document.querySelectorAll("[data-oneweb-page-toolbox-control]").length'), COMMAND_TIMEOUT_MS, 'Firefox Page Toolbox injection', value => value === 1)
  const closedControl = asRecord(await execute(client, [
    'const host=document.querySelector("[data-oneweb-page-toolbox-control]");',
    'return {closed:host?.shadowRoot===null,lightText:host?.textContent??null,tabIndex:host?.tabIndex};',
  ].join('')), 'Firefox closed Shadow control')
  assert(closedControl.closed === true && closedControl.lightText === '' && closedControl.tabIndex === 0, `Firefox Shadow control boundary is invalid: ${JSON.stringify(closedControl)}`)

  await execute(client, 'document.querySelector("[data-oneweb-page-toolbox-control]").focus();return true')
  await client.command('WebDriver:PerformActions', {
    actions: [{
      actions: [
        { type: 'keyDown', value: '\uE007' },
        { type: 'keyUp', value: '\uE007' },
        { type: 'keyDown', value: '\uE004' },
        { type: 'keyUp', value: '\uE004' },
        { type: 'keyDown', value: ' ' },
        { type: 'keyUp', value: ' ' },
      ],
      id: 'page-toolbox-keyboard',
      type: 'key',
    }],
  })
  await client.command('WebDriver:ReleaseActions')
  await pollUntil(async () => {
    const result = asRecord(await execute(client, [
      'const input=document.querySelector("#toolbox-password");',
      'input.dispatchEvent(new MouseEvent("click",{bubbles:true,detail:2}));',
      'return {body:document.body.getAttribute("contenteditable"),password:input.getAttribute("type"),selection:[...document.querySelectorAll("style")].some(style=>style.textContent.includes("user-select:text"))};',
    ].join('')), 'Firefox Page Toolbox state')
    return result.body === 'true' && result.password === 'text' && result.selection === true
  }, COMMAND_TIMEOUT_MS, 'three Firefox Page Toolbox tools')
  await execute(client, 'document.querySelector("#toolbox-password").dispatchEvent(new MouseEvent("click",{bubbles:true,detail:2}));return true')

  await switchWindow(client, betaHandle)
  const betaState = asRecord(await execute(client, [
    'return {body:document.body.getAttribute("contenteditable"),password:document.querySelector("#toolbox-password").getAttribute("type"),control:document.querySelectorAll("[data-oneweb-page-toolbox-control]").length,selection:[...document.querySelectorAll("style")].some(style=>style.textContent.includes("user-select:text"))};',
  ].join('')), 'Firefox second-origin state')
  assert(betaState.body === 'false' && betaState.password === 'password' && betaState.control === 0 && betaState.selection === false, 'Firefox second origin was modified')

  await switchWindow(client, driverHandle)
  const reflected = asRecord(await executeAsync(client, [
    'const origin=arguments[0],done=arguments[arguments.length-1];',
    '(async()=>{',
    'const delay=milliseconds=>new Promise(resolve=>setTimeout(resolve,milliseconds));',
    'const tabs=await browser.tabs.query({});const tab=tabs.find(candidate=>candidate.url?.startsWith(`${origin}/`));',
    'await browser.tabs.update(tab.id,{active:true});await delay(100);',
    'document.querySelector("[data-testid=page-toolbox-refresh]").click();',
    'for(let attempt=0;attempt<100;attempt++){',
    'const ids=[...document.querySelectorAll("[data-page-toolbox-enabled]:checked")].map(node=>node.closest("[data-tool-id]")?.dataset.toolId).filter(Boolean).sort();',
    'if(ids.length===3)return ids;await delay(50);',
    '}',
    'throw new Error("sidebar did not reflect Shadow update");',
    '})().then(value=>done({ok:true,value}),error=>done({ok:false,error:String(error)}));',
  ].join(''), [alphaOrigin]), 'Firefox sidebar reflection')
  assert(reflected.ok === true, `Firefox sidebar did not reflect Shadow update: ${String(reflected.error)}`)

  await toggleBuiltin(client, driverHandle, false)
  await switchWindow(client, alphaHandle)
  await pollUntil(() => execute(client, 'return document.querySelectorAll("[data-oneweb-page-toolbox-control]").length'), COMMAND_TIMEOUT_MS, 'Firefox disable cleanup', value => value === 0)
  const disabledState = asRecord(await execute(client, 'return {body:document.body.getAttribute("contenteditable"),password:document.querySelector("#toolbox-password").getAttribute("type"),selection:[...document.querySelectorAll("style")].some(style=>style.textContent.includes("user-select:text"))}'), 'Firefox disabled state')
  assert(disabledState.body === 'false' && disabledState.password === 'password' && disabledState.selection === false, 'Firefox disable did not clean Page Toolbox resources')

  await toggleBuiltin(client, driverHandle, true)
  await switchWindow(client, alphaHandle)
  await pollUntil(() => execute(client, 'return document.querySelectorAll("[data-oneweb-page-toolbox-control]").length'), COMMAND_TIMEOUT_MS, 'Firefox re-enable injection', value => value === 1)
  await switchWindow(client, driverHandle)
  const revoked = asRecord(await executeAsync(client, [
    'const origin=arguments[0],done=arguments[arguments.length-1];',
    '(async()=>{',
    'const tabs=await browser.tabs.query({});const tab=tabs.find(candidate=>candidate.url?.startsWith(`${origin}/`));',
    'await browser.tabs.update(tab.id,{active:true});await new Promise(resolve=>setTimeout(resolve,100));',
    'return (await browser.runtime.sendMessage({channel:"oneweb.page-toolbox.management",version:1,type:"PAGE_TOOLBOX_REVOKE_CURRENT_SITE"})).result;',
    '})().then(value=>done({ok:true,value}),error=>done({ok:false,error:String(error)}));',
  ].join(''), [alphaOrigin]), 'Firefox Page Toolbox revoke')
  assert(revoked.ok === true && asRecord(revoked.value, 'Firefox revoke result').ok === true, `Firefox revoke failed: ${String(revoked.error)}`)
  await switchWindow(client, alphaHandle)
  await pollUntil(() => execute(client, 'return document.querySelectorAll("[data-oneweb-page-toolbox-control]").length'), COMMAND_TIMEOUT_MS, 'Firefox revoke cleanup', value => value === 0)

  await toggleBuiltin(client, driverHandle, false)
  const finalState = asRecord(await executeAsync(client, [
    'const done=arguments[arguments.length-1];',
    'Promise.all([browser.permissions.getAll(),browser.storage.local.get(null)]).then(([permissions,storage])=>done({permissions,storage}),error=>done({error:String(error)}));',
  ].join('')), 'Firefox isolation final state')
  assert(!finalState.error, `Unable to capture final Firefox state: ${String(finalState.error)}`)

  const normalize = (snapshot: JsonRecord) => {
    const clone = structuredClone(snapshot)
    const storage = asRecord(clone.storage, 'Firefox storage snapshot')
    const records = Array.isArray(storage['oneweb.modules.v1']) ? storage['oneweb.modules.v1'] as JsonRecord[] : []
    const unrelatedRecords = records.filter(record => (record.manifest as JsonRecord | undefined)?.id !== PAGE_TOOLBOX_ID)
    delete storage['oneweb.modules.v1']
    delete storage[`oneweb.module-state.v1:${PAGE_TOOLBOX_ID}`]
    return { permissions: clone.permissions, storage, unrelatedRecords }
  }
  assert(JSON.stringify(normalize(finalState)) === JSON.stringify(normalize(baseline)), 'Firefox Page Toolbox changed unrelated permissions, Registry records or module state')
  process.stdout.write('Firefox Page Toolbox gate: 1/1 passed (two origins, three tools, sidebar + closed Shadow, disable + revoke, isolation)\n')
}

async function main() {
  const projectDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
  const extensionDir = path.join(projectDir, 'extension')
  const manifest = await fs.readJson(path.join(extensionDir, 'manifest.json'))
  validateFirefoxArtifactManifest(manifest)
  const fixtures = await startFixtures()
  const marionettePort = await availablePort()
  const webExtCli = path.join(projectDir, 'node_modules/web-ext/bin/web-ext.js')
  const firefoxBinary = process.env.FIREFOX_BINARY || '/usr/bin/firefox'
  const log = new FirefoxProcessLog()
  let child: ChildProcess | null = null
  let marionette: MarionetteClient | null = null
  let rdp: RdpClient | null = null
  try {
    child = spawn(process.execPath, [
      webExtCli,
      'run',
      '--verbose',
      '--source-dir',
      extensionDir,
      '--target',
      'firefox-desktop',
      '--firefox',
      firefoxBinary,
      '--no-reload',
      '--no-input',
      '--start-url',
      'about:blank',
      '--arg=--headless',
      '--arg=--marionette',
      '--arg=--remote-allow-system-access',
      `--pref=marionette.port=${marionettePort}`,
    ], {
      cwd: projectDir,
      detached: true,
      env: { ...process.env, NO_COLOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const rdpPort = await waitForRdpPort(child, log)
    rdp = await connectRdp(rdpPort)
    const extensionOrigin = await discoverExtensionOrigin(rdp)
    assert(extensionOrigin, 'Temporary OneWeb extension origin is missing')
    marionette = new MarionetteClient()
    await marionette.connect(marionettePort)
    await runFirefoxScenario(marionette, extensionOrigin, fixtures.alphaOrigin, fixtures.betaOrigin)
  }
  catch (error) {
    const detail = log.tail ? `\nFirefox output:\n${log.tail}` : ''
    throw new Error(`${error instanceof Error ? error.stack || error.message : String(error)}${detail}`)
  }
  finally {
    marionette?.close()
    rdp?.close()
    await Promise.allSettled([
      terminateProcessGroup(child?.pid),
      fixtures.close(),
    ])
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
