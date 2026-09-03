import { createContextSnapshotMessage, isContextRuntimeMessage } from '../context-protocol'

describe('context runtime protocol', () => {
  it('accepts only versioned allowlisted messages and supported provider IDs', () => {
    const update = {
      channel: 'oneweb.context',
      version: 1,
      type: 'CONTEXT_PROVIDER_UPDATE',
      contextId: 'github.repository',
      value: { repo: 'vuejs/core' },
    }
    expect(isContextRuntimeMessage(update)).toBe(true)
    expect(isContextRuntimeMessage({ ...update, version: 2 })).toBe(false)
    expect(isContextRuntimeMessage({ ...update, contextId: 'page.body' })).toBe(false)
    expect(isContextRuntimeMessage({ ...update, type: 'EXECUTE_SCRIPT' })).toBe(false)
    expect(isContextRuntimeMessage({
      channel: 'oneweb.context',
      version: 1,
      type: 'CONTEXT_SNAPSHOT',
      tabId: 1,
      revision: '1',
      contexts: [],
    })).toBe(false)
  })

  it('creates a generic snapshot envelope', () => {
    expect(createContextSnapshotMessage({
      tabId: 4,
      revision: '2',
      contexts: { 'github.repository': { repo: 'vuejs/core' } },
    })).toEqual({
      channel: 'oneweb.context',
      version: 1,
      type: 'CONTEXT_SNAPSHOT',
      tabId: 4,
      revision: '2',
      contexts: { 'github.repository': { repo: 'vuejs/core' } },
    })
  })
})
