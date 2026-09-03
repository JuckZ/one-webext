import type { ModuleOriginPermissions } from '../../installer'
import type { ModuleStorageArea } from '../../registry'
import type {
  InstalledModuleRecord,
  ModuleCapabilityId,
  ModuleContextFieldGrants,
  SeededModuleDefinition,
} from '../../types'
import type { RemoteFrameModuleManifest } from '@oneweb/module-sdk'
import {
  defineRemoteFrameModuleManifest,
  ONEWEB_MODULE_MANIFEST_VERSION,
  ONEWEB_MODULE_PROTOCOL,
  ONEWEB_MODULE_PROTOCOL_VERSION,
  REMOTE_FRAME_RUNTIME,
} from '@oneweb/module-sdk'
import { ModuleInstaller } from '../../installer'
import { ModuleManager } from '../../manager'
import { getModuleOriginPattern } from '../../module-origin'
import { ModuleRegistry } from '../../registry'

class MemoryStorage implements ModuleStorageArea {
  state: Record<string, unknown> = {}

  async get(_key: string) {
    return structuredClone(this.state)
  }

  async set(items: Record<string, unknown>) {
    this.state = { ...this.state, ...structuredClone(items) }
  }
}

class MemoryPermissions implements ModuleOriginPermissions {
  readonly granted = new Set<string>()

  readonly contains = vi.fn(async ({ origins }: { origins: string[] }) => (
    origins.every(origin => this.granted.has(origin))
  ))

  readonly remove = vi.fn(async ({ origins }: { origins: string[] }) => {
    const removed = origins.some(origin => this.granted.has(origin))
    origins.forEach(origin => this.granted.delete(origin))
    return removed
  })
}

export interface ConformanceModuleSource {
  manifest: RemoteFrameModuleManifest
  manifestUrl: string
  originPattern: string
  setManifest: (_manifest: RemoteFrameModuleManifest) => void
  failNextFetch: () => void
}

function manifestResponse(manifest: unknown, url: string) {
  const response = new Response(JSON.stringify(manifest), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
  Object.defineProperty(response, 'url', { value: url })
  return response
}

function createSource(
  origin: string,
  manifest: RemoteFrameModuleManifest,
  routes: Map<string, () => Promise<Response>>,
): ConformanceModuleSource {
  const manifestUrl = `${origin}/.well-known/oneweb-module.json`
  const originPattern = getModuleOriginPattern(manifestUrl)
  if (!originPattern)
    throw new Error('Expected a valid conformance origin')

  let remoteManifest = structuredClone(manifest)
  let failNext = false
  routes.set(manifestUrl, async () => {
    if (failNext) {
      failNext = false
      throw new Error('Synthetic conformance fetch failure')
    }
    return manifestResponse(remoteManifest, manifestUrl)
  })
  return {
    manifest: structuredClone(manifest),
    manifestUrl,
    originPattern,
    setManifest(candidate) {
      remoteManifest = structuredClone(candidate)
    },
    failNextFetch() {
      failNext = true
    },
  }
}

function createManifest(
  origin: string,
  input: Pick<RemoteFrameModuleManifest, 'id' | 'name' | 'matches' | 'contexts' | 'context_fields' | 'capabilities'>,
): RemoteFrameModuleManifest {
  return defineRemoteFrameModuleManifest({
    manifest_version: ONEWEB_MODULE_MANIFEST_VERSION,
    runtime: REMOTE_FRAME_RUNTIME,
    id: input.id,
    name: input.name,
    version: '0.1.0',
    description: `${input.name} conformance fixture`,
    icon_url: `${origin}/icon.png`,
    entry_url: `${origin}/embed`,
    matches: input.matches,
    contexts: input.contexts,
    context_fields: input.context_fields,
    capabilities: input.capabilities,
    activation: 'manual',
    min_host_version: '0.0.1',
    bridge: {
      protocol: ONEWEB_MODULE_PROTOCOL,
      version: ONEWEB_MODULE_PROTOCOL_VERSION,
    },
  })
}

function inputUrl(input: RequestInfo | URL) {
  if (typeof input === 'string')
    return input
  if (input instanceof URL)
    return input.href
  return input.url
}

export function deferredManifestResponse() {
  let resolve!: (_response: Response) => void
  const promise = new Promise<Response>((done) => {
    resolve = done
  })
  return { promise, resolve, response: manifestResponse }
}

export function snapshotModule(record: InstalledModuleRecord | null) {
  return record ? structuredClone(record) : null
}

export function createConformanceModulePair(seeds: SeededModuleDefinition[] = []) {
  const routes = new Map<string, () => Promise<Response>>()
  const primaryOrigin = 'https://alpha.modules.example'
  const secondaryOrigin = 'https://beta.modules.example'
  const primary = createSource(primaryOrigin, createManifest(primaryOrigin, {
    id: 'dev.oneweb.conformance.alpha',
    name: 'Alpha Conformance',
    matches: ['https://github.com/*/*'],
    contexts: ['github.repository'],
    context_fields: { 'github.repository': ['repo', 'url'] },
    capabilities: ['tabs.open'],
  }), routes)
  const secondary = createSource(secondaryOrigin, createManifest(secondaryOrigin, {
    id: 'dev.oneweb.conformance.beta',
    name: 'Beta Conformance',
    matches: ['https://example.com/*'],
    contexts: ['page.metadata'],
    context_fields: { 'page.metadata': ['title', 'description'] },
    capabilities: ['storage.module'],
  }), routes)

  const storage = new MemoryStorage()
  const permissions = new MemoryPermissions()
  permissions.granted.add(primary.originPattern)
  permissions.granted.add(secondary.originPattern)
  let now = '2026-08-28T08:00:00.000Z'
  const registry = new ModuleRegistry({ storage, seeds, now: () => now })
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    const route = routes.get(inputUrl(input))
    if (!route)
      throw new Error('Unexpected conformance URL')
    return route()
  })
  const installer = new ModuleInstaller({
    registry,
    permissions,
    hostVersion: '0.1.0',
    fetch,
    now: () => now,
  })
  const manager = new ModuleManager(registry, installer)

  async function install(
    source: ConformanceModuleSource,
    grantedContextFields: ModuleContextFieldGrants = source.manifest.context_fields,
    grantedCapabilities: ModuleCapabilityId[] = source.manifest.capabilities,
  ) {
    const prepared = await installer.prepare(source.manifestUrl)
    if (!prepared.ok)
      throw new Error(`Expected install review, received ${prepared.reason}`)
    const confirmed = await installer.confirm(source.manifestUrl, prepared.review.manifestDigest, {
      grantedContextFields,
      grantedCapabilities,
    })
    if (!confirmed.ok)
      throw new Error(`Expected installed module, received ${confirmed.reason}`)
    return confirmed.record
  }

  return {
    fetch,
    install,
    installer,
    manager,
    permissions,
    primary,
    registry,
    secondary,
    setNow(value: string) {
      now = value
    },
    storage,
  }
}
