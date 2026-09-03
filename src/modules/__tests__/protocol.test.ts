import type { InstalledModuleRecord } from '../types'
import { createModuleEnvelope, isTrustedModuleHello, validateModulePortMessage } from '../protocol'
import { createRepoLensSeed } from '../seeds/repolens'

function repoLensRecord(): InstalledModuleRecord {
  const seed = createRepoLensSeed()
  return {
    manifest: seed.manifest,
    enabled: true,
    source: 'seeded',
    grantedContexts: seed.grantedContexts,
    grantedContextFields: seed.grantedContextFields,
    grantedCapabilities: seed.grantedCapabilities,
    update: null,
    installedAt: '2026-08-26T00:00:00.000Z',
    updatedAt: '2026-08-26T00:00:00.000Z',
  }
}

describe('module bridge protocol', () => {
  it('accepts a hello only from the installed frame and exact origin', () => {
    const record = repoLensRecord()
    const source = {} as Window
    const hello = {
      protocol: 'oneweb.module',
      version: 1,
      moduleId: 'dev.juck.repolens',
      type: 'MODULE_HELLO',
      challenge: 'challenge-123',
    }
    expect(isTrustedModuleHello({ origin: 'http://127.0.0.1:4747', source, data: hello }, record, source)).toBe(true)
    expect(isTrustedModuleHello({ origin: 'https://evil.example', source, data: hello }, record, source)).toBe(false)
    expect(isTrustedModuleHello({ origin: 'http://127.0.0.1:4747', source: {} as Window, data: hello }, record, source)).toBe(false)
    expect(isTrustedModuleHello({ origin: 'http://127.0.0.1:4747', source, data: { ...hello, moduleId: 'dev.evil.module' } }, record, source)).toBe(false)
  })

  it('validates port messages with module ID, nonce and an allowlisted type', () => {
    const record = repoLensRecord()
    const ready = {
      protocol: 'oneweb.module',
      version: 1,
      moduleId: 'dev.juck.repolens',
      type: 'MODULE_READY',
      sessionNonce: 'nonce-123',
    }
    expect(validateModulePortMessage(ready, record, 'nonce-123')).toEqual(ready)
    expect(validateModulePortMessage({ ...ready, sessionNonce: 'forged' }, record, 'nonce-123')).toBeNull()
    expect(validateModulePortMessage({ ...ready, type: 'EVAL' }, record, 'nonce-123')).toBeNull()
    expect(createModuleEnvelope(record, 'CONTEXT_UPDATE', { sessionNonce: 'nonce-123' })).toEqual({
      protocol: 'oneweb.module',
      version: 1,
      moduleId: 'dev.juck.repolens',
      type: 'CONTEXT_UPDATE',
      sessionNonce: 'nonce-123',
    })
    expect(createModuleEnvelope(record, 'CONTEXT_UPDATE', {
      protocol: 'forged',
      moduleId: 'dev.evil.module',
      type: 'EVAL',
    })).toMatchObject({
      protocol: 'oneweb.module',
      moduleId: 'dev.juck.repolens',
      type: 'CONTEXT_UPDATE',
    })
  })
})
