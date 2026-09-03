import {
  capabilityRpcErrorCodes,
  type CapabilityRpcSessionBinding,
  createCapabilityRpcCancelEnvelope,
  createCapabilityRpcLifecycleState,
  createStorageModuleClearRequestEnvelope,
  createStorageModuleMutationResultEnvelope,
  createStorageModuleReadRequestEnvelope,
  createStorageModuleReadResultEnvelope,
  createStorageModuleReplaceRequestEnvelope,
  createStorageModuleRevision,
  createStorageModuleState,
  isStorageModuleRevision,
  reduceCapabilityRpcLifecycle,
  reduceStorageModuleState,
  STORAGE_MODULE_DOCUMENT_MAX_BYTES,
  STORAGE_MODULE_DOCUMENT_MAX_DEPTH,
  STORAGE_MODULE_DOCUMENT_MAX_NODES,
  STORAGE_MODULE_REVISION_ENTROPY_BYTES,
  storageModuleCapabilityCatalog,
  storageModuleContractDescriptor,
  storageModuleOperations,
  validateStorageModuleDocument,
  validateStorageModuleRequestEnvelope,
} from '@oneweb/module-sdk'

const alphaBinding = Object.freeze({
  moduleId: 'dev.oneweb.storage.alpha',
  sessionId: 'session_storage_alpha_123456789012345678901234',
  generation: 3,
})
const betaBinding = Object.freeze({
  moduleId: 'dev.oneweb.storage.beta',
  sessionId: 'session_storage_beta_123456789012345678901234',
  generation: 9,
})

function revision(byte: number) {
  return createStorageModuleRevision(new Uint8Array(STORAGE_MODULE_REVISION_ENTROPY_BYTES).fill(byte))
}

function identity(
  binding: CapabilityRpcSessionBinding = alphaBinding,
  requestId = 'request_storage_12345678',
) {
  return { ...binding, requestId }
}

function expectFailure(result: { ok: boolean, code?: string }, code: string) {
  expect(result).toEqual({ ok: false, code })
}

describe('storage.module pure catalog and canonical envelopes', () => {
  it('fixes only read, whole-document replace and clear with bounded public limits', () => {
    expect(Object.keys(storageModuleCapabilityCatalog)).toEqual(['storage.module'])
    expect(Object.keys(storageModuleCapabilityCatalog['storage.module'].operations)).toEqual([
      'read',
      'replace',
      'clear',
    ])
    expect(storageModuleContractDescriptor).toEqual({
      operations: storageModuleOperations,
      document: {
        maximumBytes: 12 * 1024,
        maximumDepth: 6,
        maximumNodes: 256,
      },
      revisionEntropyBytes: 24,
    })
    expect(Object.isFrozen(storageModuleCapabilityCatalog)).toBe(true)
    expect(Object.isFrozen(storageModuleContractDescriptor)).toBe(true)
  })

  it('constructs canonical read, replace, clear and result envelopes', () => {
    const firstRevision = revision(1)
    const secondRevision = revision(2)
    const read = createStorageModuleReadRequestEnvelope(identity())
    const replace = createStorageModuleReplaceRequestEnvelope(
      identity(alphaBinding, 'request_storage_replace'),
      firstRevision,
      { enabled: true },
    )
    const clear = createStorageModuleClearRequestEnvelope(
      identity(alphaBinding, 'request_storage_clear'),
      secondRevision,
    )
    expect(read).toMatchObject({
      capability: 'storage.module',
      operation: 'read',
      payload: null,
      ...alphaBinding,
    })
    expect(replace.payload).toEqual({
      expectedRevision: firstRevision,
      document: { enabled: true },
    })
    expect(clear.payload).toEqual({ expectedRevision: secondRevision })
    expect(createStorageModuleReadResultEnvelope(read, firstRevision, { local: 'only' }).result)
      .toEqual({ revision: firstRevision, document: { local: 'only' } })
    expect(createStorageModuleMutationResultEnvelope(replace, secondRevision).result)
      .toEqual({ revision: secondRevision })
    expect(createStorageModuleMutationResultEnvelope(clear, revision(3)).result)
      .toEqual({ revision: revision(3) })
  })

  it('derives opaque revisions only from exactly 24 host entropy bytes', () => {
    const value = revision(0xAB)
    expect(value).toBe(`storage-revision-${'ab'.repeat(24)}`)
    expect(isStorageModuleRevision(value)).toBe(true)
    expect(isStorageModuleRevision(value.toUpperCase())).toBe(false)
    expect(isStorageModuleRevision('storage-revision-short')).toBe(false)
    expect(() => createStorageModuleRevision(new Uint8Array(23))).toThrow(/24 bytes/)
    expect(() => createStorageModuleRevision([] as never)).toThrow(/24 bytes/)
  })

  it('keeps identity, physical key, namespace, area and next revision outside caller data', () => {
    const request = createStorageModuleReplaceRequestEnvelope(
      identity(),
      revision(1),
      { safe: true },
    )
    for (const field of [
      'moduleId',
      'storageArea',
      'key',
      'namespace',
      'browserMethod',
      'nextRevision',
    ]) {
      const forged = {
        ...request,
        payload: { ...request.payload, [field]: 'attacker-controlled' },
      }
      expectFailure(validateStorageModuleRequestEnvelope(forged, alphaBinding), 'PAYLOAD_INVALID')
    }
    expect(Object.keys(request.payload)).toEqual(['expectedRevision', 'document'])
  })

  it('rejects forged module, session, generation, operation and capability identity', () => {
    const request = createStorageModuleReadRequestEnvelope(identity())
    for (const replacement of [
      { moduleId: betaBinding.moduleId },
      { sessionId: betaBinding.sessionId },
      { generation: alphaBinding.generation + 1 },
    ]) {
      expectFailure(
        validateStorageModuleRequestEnvelope({ ...request, ...replacement }, alphaBinding),
        'SESSION_MISMATCH',
      )
    }
    expectFailure(
      validateStorageModuleRequestEnvelope({ ...request, operation: 'get' }, alphaBinding),
      'OPERATION_NOT_ALLOWED',
    )
    expectFailure(
      validateStorageModuleRequestEnvelope({ ...request, capability: 'storage.other' }, alphaBinding),
      'CAPABILITY_NOT_DECLARED',
    )
  })
})

describe('storage.module JSON document boundary', () => {
  it('returns recursively frozen canonical clones without mutating caller input', () => {
    const input = {
      z: [{ z: 3, a: 1 }],
      a: 'first',
    }
    const validated = validateStorageModuleDocument(input)
    expect(validated.ok).toBe(true)
    if (!validated.ok)
      throw new Error('Expected canonical storage document')
    expect(Object.keys(validated.value as object)).toEqual(['a', 'z'])
    const value = validated.value as { readonly z: readonly { readonly a: number, readonly z: number }[] }
    expect(Object.keys(value.z[0])).toEqual(['a', 'z'])
    expect(Object.isFrozen(validated.value)).toBe(true)
    expect(Object.isFrozen(value.z)).toBe(true)
    expect(Object.isFrozen(value.z[0])).toBe(true)
    input.a = 'changed'
    input.z[0].a = 99
    expect(validated.value).toEqual({ a: 'first', z: [{ a: 1, z: 3 }] })
  })

  it('accepts the exact byte ceiling and rejects one additional UTF-8 byte', () => {
    const exact = 'x'.repeat(STORAGE_MODULE_DOCUMENT_MAX_BYTES - 2)
    const oversized = 'x'.repeat(STORAGE_MODULE_DOCUMENT_MAX_BYTES - 1)
    expect(validateStorageModuleDocument(exact).ok).toBe(true)
    expectFailure(validateStorageModuleDocument(oversized), 'PAYLOAD_TOO_LARGE')
    expect(() => createStorageModuleReplaceRequestEnvelope(
      identity(),
      revision(1),
      oversized,
    )).toThrow('PAYLOAD_TOO_LARGE')
  })

  it('enforces document-specific depth and node quotas below generic RPC ceilings', () => {
    let exactDepth: unknown = 'leaf'
    for (let index = 0; index < STORAGE_MODULE_DOCUMENT_MAX_DEPTH; index += 1)
      exactDepth = { child: exactDepth }
    let tooDeep: unknown = exactDepth
    tooDeep = { child: tooDeep }
    expect(validateStorageModuleDocument(exactDepth).ok).toBe(true)
    expectFailure(validateStorageModuleDocument(tooDeep), 'PAYLOAD_INVALID')

    const exactNodes = Array.from({ length: STORAGE_MODULE_DOCUMENT_MAX_NODES - 1 }, () => null)
    const tooManyNodes = [...exactNodes, null]
    expect(validateStorageModuleDocument(exactNodes).ok).toBe(true)
    expectFailure(validateStorageModuleDocument(tooManyNodes), 'PAYLOAD_INVALID')
  })

  it.each([
    ['undefined', undefined],
    ['bigint', 1n],
    ['function', () => 'unsafe'],
    ['non-finite number', Number.NaN],
    ['class instance', new (class DocumentValue { value = 'unsafe' })()],
  ])('rejects malformed %s values', (_label, value) => {
    expectFailure(validateStorageModuleDocument(value), 'PAYLOAD_INVALID')
  })

  it('rejects cycles, accessors, symbols and sparse or decorated arrays', () => {
    const cycle: Record<string, unknown> = {}
    cycle.self = cycle
    const accessor = {}
    Object.defineProperty(accessor, 'secret', { enumerable: true, get: () => 'unsafe' })
    const symbol = { safe: true, [Symbol('hidden')]: 'unsafe' }
    const sparse: unknown[] = []
    sparse.length = 2
    sparse[1] = 'unsafe'
    const decorated = ['safe'] as unknown[] & { extra?: string }
    decorated.extra = 'unsafe'
    for (const value of [cycle, accessor, symbol, sparse, decorated])
      expectFailure(validateStorageModuleDocument(value), 'PAYLOAD_INVALID')
  })
})

describe('storage.module revision and lifecycle reducer', () => {
  it('reads, replaces and clears a single document with revision rotation', () => {
    const first = revision(1)
    const second = revision(2)
    const third = revision(3)
    const initial = createStorageModuleState(alphaBinding, first)
    const read = reduceStorageModuleState(initial, {
      type: 'read',
      request: createStorageModuleReadRequestEnvelope(identity()),
    })
    expect(read).toEqual({
      ok: true,
      state: initial,
      result: { revision: first, document: null },
    })

    const replace = reduceStorageModuleState(initial, {
      type: 'replace',
      request: createStorageModuleReplaceRequestEnvelope(
        identity(alphaBinding, 'request_storage_replace'),
        first,
        { count: 1 },
      ),
      nextRevision: second,
    })
    expect(replace.ok).toBe(true)
    expect(replace.state).toMatchObject({ revision: second, document: { count: 1 } })
    expect(initial).toMatchObject({ revision: first, document: null })

    const clear = reduceStorageModuleState(replace.state, {
      type: 'clear',
      request: createStorageModuleClearRequestEnvelope(
        identity(alphaBinding, 'request_storage_clear'),
        second,
      ),
      nextRevision: third,
    })
    expect(clear).toMatchObject({
      ok: true,
      state: { revision: third, document: null },
      result: { revision: third },
    })
  })

  it('rotates revision for a successful clear even when already empty', () => {
    const state = createStorageModuleState(alphaBinding, revision(1))
    const cleared = reduceStorageModuleState(state, {
      type: 'clear',
      request: createStorageModuleClearRequestEnvelope(identity(), revision(1)),
      nextRevision: revision(2),
    })
    expect(cleared).toMatchObject({
      ok: true,
      state: { revision: revision(2), document: null },
    })
  })

  it('rejects stale compare-and-swap without changing document or revision', () => {
    const state = createStorageModuleState(alphaBinding, revision(2), { current: true })
    const conflict = reduceStorageModuleState(state, {
      type: 'replace',
      request: createStorageModuleReplaceRequestEnvelope(identity(), revision(1), { stale: true }),
      nextRevision: revision(3),
    })
    expect(conflict).toEqual({
      ok: false,
      code: 'STORAGE_REVISION_CONFLICT',
      state,
    })
    expect(capabilityRpcErrorCodes).toContain('STORAGE_REVISION_CONFLICT')
  })

  it('rejects an invalid or reused host revision before mutation', () => {
    const state = createStorageModuleState(alphaBinding, revision(1), { safe: true })
    const request = createStorageModuleClearRequestEnvelope(identity(), revision(1))
    expect(() => reduceStorageModuleState(state, {
      type: 'clear',
      request,
      nextRevision: revision(1),
    })).toThrow(/must differ/)
    expect(() => reduceStorageModuleState(state, {
      type: 'clear',
      request,
      nextRevision: 'caller-revision',
    })).toThrow('PAYLOAD_INVALID')
    expect(state).toMatchObject({ revision: revision(1), document: { safe: true } })
  })

  it('rejects stale generation and cross-module requests without exposing state', () => {
    const state = createStorageModuleState(alphaBinding, revision(1), { private: 'alpha' })
    for (const binding of [
      { ...alphaBinding, generation: alphaBinding.generation - 1 },
      betaBinding,
    ]) {
      const request = createStorageModuleReadRequestEnvelope(identity(binding))
      const result = reduceStorageModuleState(state, { type: 'read', request })
      expect(result).toEqual({ ok: false, code: 'SESSION_MISMATCH', state })
      expect(JSON.stringify(result)).not.toContain('storage.beta')
    }
  })

  it('makes grant revocation immediate while retaining inaccessible local data', () => {
    const state = createStorageModuleState(alphaBinding, revision(1), { retained: true })
    const revoked = reduceStorageModuleState(state, { type: 'revoke', binding: alphaBinding })
    expect(revoked).toMatchObject({
      ok: true,
      state: {
        status: 'revoked',
        lifecycleReason: 'grant-revoked',
        document: { retained: true },
      },
    })
    const denied = reduceStorageModuleState(revoked.state, {
      type: 'read',
      request: createStorageModuleReadRequestEnvelope(identity()),
    })
    expect(denied).toEqual({ ok: false, code: 'CAPABILITY_NOT_ALLOWED', state: revoked.state })

    const resumed = reduceStorageModuleState(revoked.state, {
      type: 'resume',
      binding: { ...alphaBinding, sessionId: 'session_storage_alpha_regranted_123456789012345' },
    })
    expect(resumed).toMatchObject({
      ok: true,
      state: { status: 'active', document: { retained: true }, revision: revision(1) },
    })
  })

  it.each(['disabled', 'session-destroyed', 'worker-restart'] as const)(
    'destroys the current session on %s while allowing a fresh session to restore retained data',
    (reason) => {
      const state = createStorageModuleState(alphaBinding, revision(1), { retained: reason })
      const destroyed = reduceStorageModuleState(state, {
        type: 'destroy',
        binding: alphaBinding,
        reason,
      })
      expect(destroyed).toMatchObject({
        ok: true,
        state: { status: 'destroyed', lifecycleReason: reason, document: { retained: reason } },
      })
      const late = reduceStorageModuleState(destroyed.state, {
        type: 'read',
        request: createStorageModuleReadRequestEnvelope(identity()),
      })
      expect(late).toEqual({ ok: false, code: 'SESSION_DESTROYED', state: destroyed.state })
      const resumed = reduceStorageModuleState(destroyed.state, {
        type: 'resume',
        binding: {
          ...alphaBinding,
          sessionId: `session_storage_alpha_${reason.replace('-', '_')}_fresh_123456789012`,
        },
      })
      expect(resumed).toMatchObject({
        ok: true,
        state: { status: 'active', document: { retained: reason }, revision: revision(1) },
      })
    },
  )

  it('removes data and requires reinstall to start empty with unrelated authority', () => {
    const state = createStorageModuleState(alphaBinding, revision(1), { mustDisappear: true })
    const removed = reduceStorageModuleState(state, { type: 'remove', binding: alphaBinding })
    expect(removed).toMatchObject({
      ok: true,
      state: { status: 'removed', lifecycleReason: 'removed', document: null },
    })
    expect(reduceStorageModuleState(removed.state, {
      type: 'resume',
      binding: { ...alphaBinding, sessionId: 'session_storage_alpha_invalid_resume_123456789' },
    })).toEqual({ ok: false, code: 'SESSION_DESTROYED', state: removed.state })

    const reinstalled = reduceStorageModuleState(removed.state, {
      type: 'reinstall',
      binding: {
        ...alphaBinding,
        sessionId: 'session_storage_alpha_reinstalled_123456789012345',
        generation: 1,
      },
      revision: revision(9),
    })
    expect(reinstalled).toMatchObject({
      ok: true,
      state: { status: 'active', revision: revision(9), document: null },
    })
  })

  it('rejects same-session and cross-module resume or reinstall without throwing', () => {
    const revoked = reduceStorageModuleState(
      createStorageModuleState(alphaBinding, revision(1), { owner: 'alpha' }),
      { type: 'revoke', binding: alphaBinding },
    ).state
    for (const binding of [alphaBinding, betaBinding]) {
      expect(reduceStorageModuleState(revoked, { type: 'resume', binding })).toEqual({
        ok: false,
        code: 'SESSION_MISMATCH',
        state: revoked,
      })
    }

    const removed = reduceStorageModuleState(revoked, {
      type: 'remove',
      binding: alphaBinding,
    }).state
    for (const binding of [alphaBinding, betaBinding]) {
      expect(reduceStorageModuleState(removed, {
        type: 'reinstall',
        binding,
        revision: revision(9),
      })).toEqual({
        ok: false,
        code: 'SESSION_MISMATCH',
        state: removed,
      })
    }
  })

  it('contains mutation and lifecycle races within each module principal', () => {
    const alpha = createStorageModuleState(alphaBinding, revision(1), { owner: 'alpha' })
    const beta = createStorageModuleState(betaBinding, revision(4), { owner: 'beta' })
    const alphaReplaced = reduceStorageModuleState(alpha, {
      type: 'replace',
      request: createStorageModuleReplaceRequestEnvelope(identity(), revision(1), { owner: 'new-alpha' }),
      nextRevision: revision(2),
    })
    const alphaRevoked = reduceStorageModuleState(alphaReplaced.state, {
      type: 'revoke',
      binding: alphaBinding,
    })
    const alphaLate = reduceStorageModuleState(alphaRevoked.state, {
      type: 'clear',
      request: createStorageModuleClearRequestEnvelope(
        identity(alphaBinding, 'request_storage_late'),
        revision(2),
      ),
      nextRevision: revision(3),
    })
    expect(alphaLate).toEqual({
      ok: false,
      code: 'CAPABILITY_NOT_ALLOWED',
      state: alphaRevoked.state,
    })
    expect(beta).toMatchObject({ revision: revision(4), document: { owner: 'beta' }, status: 'active' })
    expect(reduceStorageModuleState(beta, {
      type: 'remove',
      binding: alphaBinding,
    })).toEqual({ ok: false, code: 'SESSION_MISMATCH', state: beta })
  })

  it('keeps state and results immutable', () => {
    const state = createStorageModuleState(alphaBinding, revision(1), { nested: { value: 1 } })
    const read = reduceStorageModuleState(state, {
      type: 'read',
      request: createStorageModuleReadRequestEnvelope(identity()),
    })
    expect(Object.isFrozen(state)).toBe(true)
    expect(Object.isFrozen(state.binding)).toBe(true)
    expect(Object.isFrozen(state.document)).toBe(true)
    expect(Object.isFrozen(read)).toBe(true)
    if (!read.ok)
      throw new Error('Expected immutable read result')
    expect(Object.isFrozen(read.result)).toBe(true)
  })
})

describe('storage.module RPC terminal ordering', () => {
  it('makes the first result terminal and rejects duplicate or cancel-after-result', () => {
    const request = createStorageModuleReadRequestEnvelope(identity())
    const registered = reduceCapabilityRpcLifecycle(
      createCapabilityRpcLifecycleState(alphaBinding),
      { type: 'register', request, now: 0 },
    )
    const result = createStorageModuleReadResultEnvelope(request, revision(1), { safe: true })
    const completed = reduceCapabilityRpcLifecycle(registered.state, {
      type: 'result',
      response: result,
      now: 1,
    })
    expect(completed).toMatchObject({ ok: true, state: { requests: [{ status: 'succeeded' }] } })
    expect(reduceCapabilityRpcLifecycle(completed.state, {
      type: 'result',
      response: result,
      now: 2,
    })).toMatchObject({ ok: false, code: 'REQUEST_ALREADY_TERMINAL' })
    expect(reduceCapabilityRpcLifecycle(completed.state, {
      type: 'cancel',
      response: createCapabilityRpcCancelEnvelope(request),
      now: 3,
    })).toMatchObject({ ok: false, code: 'REQUEST_ALREADY_TERMINAL' })
  })

  it('drops late storage results after session destruction', () => {
    const request = createStorageModuleClearRequestEnvelope(identity(), revision(1))
    const registered = reduceCapabilityRpcLifecycle(
      createCapabilityRpcLifecycleState(alphaBinding),
      { type: 'register', request, now: 0 },
    )
    const destroyed = reduceCapabilityRpcLifecycle(registered.state, { type: 'destroy', now: 1 })
    const late = reduceCapabilityRpcLifecycle(destroyed.state, {
      type: 'result',
      response: createStorageModuleMutationResultEnvelope(request, revision(2)),
      now: 2,
    })
    expect(late).toMatchObject({ ok: false, code: 'SESSION_DESTROYED' })
    expect(late.state.requests[0]).toMatchObject({
      status: 'session-destroyed',
      errorCode: 'SESSION_DESTROYED',
    })
  })
})
