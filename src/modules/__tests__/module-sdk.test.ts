import {
  createModuleEnvelope,
  defineRemoteFrameModuleManifest,
  hostToModulePortMessageTypes,
  isModuleHelloEnvelope,
  moduleActivationModes,
  moduleContextFieldIds,
  moduleContextIds,
  moduleToHostPortMessageTypes,
  ONEWEB_MODULE_MANIFEST_VERSION,
  ONEWEB_MODULE_PROTOCOL,
  ONEWEB_MODULE_PROTOCOL_VERSION,
  REMOTE_FRAME_RUNTIME,
  remoteModuleCapabilityIds,
  storageModuleContractDescriptor,
  validateHostInitEnvelope,
  validateHostPortEnvelope,
  validateModulePortEnvelope,
  validateRemoteFrameModuleManifest,
} from '@oneweb/module-sdk'
import contract from '../../../packages/module-sdk/contract.json'

function manifest(overrides: Record<string, unknown> = {}) {
  return {
    manifest_version: ONEWEB_MODULE_MANIFEST_VERSION,
    runtime: REMOTE_FRAME_RUNTIME,
    id: 'dev.oneweb.sdk.fixture',
    name: ' SDK Fixture ',
    version: '1.0.0',
    description: ' Contract fixture ',
    icon_url: 'https://sdk.example/icon.png',
    entry_url: 'https://sdk.example/embed',
    matches: ['https://example.com/*', 'https://example.com/*'],
    contexts: ['tab.basic', 'tab.basic'],
    context_fields: { 'tab.basic': ['url', 'url'] },
    capabilities: ['tabs.open', 'tabs.open'],
    activation: 'manual',
    min_host_version: '0.0.1',
    bridge: {
      protocol: ONEWEB_MODULE_PROTOCOL,
      version: ONEWEB_MODULE_PROTOCOL_VERSION,
    },
    ...overrides,
  }
}

describe('public module SDK contract', () => {
  it('keeps the checked-in contract lock aligned with public catalogs', () => {
    expect(contract).toEqual({
      schemaVersion: 1,
      manifestVersion: ONEWEB_MODULE_MANIFEST_VERSION,
      protocol: {
        name: ONEWEB_MODULE_PROTOCOL,
        version: ONEWEB_MODULE_PROTOCOL_VERSION,
      },
      runtime: REMOTE_FRAME_RUNTIME,
      activationModes: moduleActivationModes,
      contexts: moduleContextFieldIds,
      capabilities: remoteModuleCapabilityIds,
      typedCapabilities: {
        'storage.module': storageModuleContractDescriptor,
      },
      moduleToHostPortMessages: moduleToHostPortMessageTypes,
      hostToModulePortMessages: hostToModulePortMessageTypes,
    })
    expect(moduleContextIds).toEqual(Object.keys(moduleContextFieldIds))
    for (const catalog of [
      moduleActivationModes,
      moduleContextIds,
      remoteModuleCapabilityIds,
      moduleToHostPortMessageTypes,
      hostToModulePortMessageTypes,
      moduleContextFieldIds,
      ...Object.values(moduleContextFieldIds),
    ]) {
      expect(Object.isFrozen(catalog)).toBe(true)
    }
  })

  it('normalizes a valid remote manifest and rejects reserved or unknown access', () => {
    const result = validateRemoteFrameModuleManifest(manifest())
    expect(result).toMatchObject({
      ok: true,
      manifest: {
        name: 'SDK Fixture',
        description: 'Contract fixture',
        matches: ['https://example.com/*'],
        contexts: ['tab.basic'],
        context_fields: { 'tab.basic': ['url'] },
        capabilities: ['tabs.open'],
      },
    })
    if (!result.ok)
      throw new Error('Expected valid SDK fixture')
    expect(defineRemoteFrameModuleManifest(result.manifest)).toEqual(result.manifest)

    const rejected = validateRemoteFrameModuleManifest(manifest({
      capabilities: ['bookmarks.read', 'browser.call'],
    }))
    expect(rejected).toMatchObject({ ok: false })
    if (!rejected.ok) {
      expect(rejected.issues).toContain('capabilities contains unsupported value: bookmarks.read')
      expect(rejected.issues).toContain('capabilities contains unsupported value: browser.call')
    }
  })

  it('creates authoritative envelopes and validates each public handshake boundary', () => {
    const hello = createModuleEnvelope('dev.oneweb.sdk.fixture', 'MODULE_HELLO', {
      challenge: 'challenge-123',
      moduleId: 'dev.evil.module',
      protocol: 'forged',
      type: 'EVAL',
      version: 99,
    })
    expect(hello).toMatchObject({
      protocol: ONEWEB_MODULE_PROTOCOL,
      version: ONEWEB_MODULE_PROTOCOL_VERSION,
      moduleId: 'dev.oneweb.sdk.fixture',
      type: 'MODULE_HELLO',
    })
    expect(isModuleHelloEnvelope(hello, 'dev.oneweb.sdk.fixture')).toBe(true)
    expect(isModuleHelloEnvelope({ ...hello, challenge: 'short' }, 'dev.oneweb.sdk.fixture')).toBe(false)

    const nonce = '0123456789abcdefghijklmnop'
    const init = createModuleEnvelope('dev.oneweb.sdk.fixture', 'MODULE_INIT', {
      challenge: 'challenge-123',
      sessionNonce: nonce,
    })
    expect(validateHostInitEnvelope(init, 'dev.oneweb.sdk.fixture', 'challenge-123')).toEqual(init)
    expect(validateHostInitEnvelope({ ...init, sessionNonce: 'short' }, 'dev.oneweb.sdk.fixture', 'challenge-123')).toBeNull()

    const ready = createModuleEnvelope('dev.oneweb.sdk.fixture', 'MODULE_READY', { sessionNonce: nonce })
    expect(validateModulePortEnvelope(ready, 'dev.oneweb.sdk.fixture', nonce)).toEqual(ready)
    expect(validateModulePortEnvelope({ ...ready, type: 'EVAL' }, 'dev.oneweb.sdk.fixture', nonce)).toBeNull()

    const context = createModuleEnvelope('dev.oneweb.sdk.fixture', 'CONTEXT_UPDATE', {
      contexts: { 'tab.basic': { url: 'https://example.com/' } },
      revision: 'revision-1',
      sessionNonce: nonce,
    })
    expect(validateHostPortEnvelope(context, 'dev.oneweb.sdk.fixture', nonce)).toEqual(context)
    expect(validateHostPortEnvelope({ ...context, revision: 1 }, 'dev.oneweb.sdk.fixture', nonce)).toBeNull()
  })
})
