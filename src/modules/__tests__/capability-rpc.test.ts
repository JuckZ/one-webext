import {
  CAPABILITY_RPC_MAX_IN_FLIGHT,
  CAPABILITY_RPC_MAX_REQUESTS_PER_SESSION,
  CAPABILITY_RPC_REQUEST_TIMEOUT_MS,
  capabilityRpcSchema,
  createCapabilityRpcCancelEnvelope,
  createCapabilityRpcErrorEnvelope,
  createCapabilityRpcLifecycleState,
  createCapabilityRpcRequestEnvelope,
  createCapabilityRpcResultEnvelope,
  defineCapabilityRpcCatalog,
  reduceCapabilityRpcLifecycle,
  validateCapabilityRpcCancelEnvelope,
  validateCapabilityRpcErrorEnvelope,
  validateCapabilityRpcRequestEnvelope,
  validateCapabilityRpcRequestReference,
  validateCapabilityRpcResultEnvelope,
} from '../../../packages/module-sdk/src/capability-rpc'

const conformanceCatalog = defineCapabilityRpcCatalog({
  'conformance.echo': {
    operations: {
      echo: {
        request: capabilityRpcSchema.object({
          text: capabilityRpcSchema.string({ maximumLength: 20_000 }),
        }),
        result: capabilityRpcSchema.object({
          echoed: capabilityRpcSchema.string({ maximumLength: 65_536 }),
        }),
      },
      sum: {
        request: capabilityRpcSchema.object({
          values: capabilityRpcSchema.array(
            capabilityRpcSchema.number({ minimum: -1000, maximum: 1000 }),
            { maximumItems: 32 },
          ),
          label: capabilityRpcSchema.string({ maximumLength: 32 }),
        }, { optional: ['label'] as const }),
        result: capabilityRpcSchema.object({
          total: capabilityRpcSchema.number(),
        }),
      },
    },
  },
} as const)

const binding = Object.freeze({
  moduleId: 'dev.oneweb.conformance.rpc',
  sessionId: 'session_123456789012345678901234',
  generation: 7,
})

function identity(requestId = 'request_12345678') {
  return { ...binding, requestId }
}

function echoRequest(requestId = 'request_12345678', text = 'hello') {
  return createCapabilityRpcRequestEnvelope(
    conformanceCatalog,
    identity(requestId),
    'conformance.echo',
    'echo',
    { text },
  )
}

function expectFailure(result: { ok: boolean, code?: string }, code: string) {
  expect(result).toEqual({ ok: false, code })
}

describe('typed capability RPC schema and envelopes', () => {
  it('constructs and validates canonical request, result, error and cancel envelopes', () => {
    const request = echoRequest()
    const validatedRequest = validateCapabilityRpcRequestEnvelope(
      conformanceCatalog,
      request,
      binding,
      ['conformance.echo'],
    )
    expect(validatedRequest).toEqual({ ok: true, value: request })

    const result = createCapabilityRpcResultEnvelope(
      conformanceCatalog,
      request,
      { echoed: 'hello' },
    )
    expect(validateCapabilityRpcResultEnvelope(conformanceCatalog, result, request)).toEqual({
      ok: true,
      value: result,
    })

    const error = createCapabilityRpcErrorEnvelope(request, 'OPERATION_FAILED')
    expect(validateCapabilityRpcErrorEnvelope(error, request)).toEqual({ ok: true, value: error })

    const cancel = createCapabilityRpcCancelEnvelope(request)
    expect(validateCapabilityRpcCancelEnvelope(cancel, request)).toEqual({ ok: true, value: cancel })
  })

  it('keeps canonical identity outside payload and rejects envelope field replacement', () => {
    expect(() => createCapabilityRpcRequestEnvelope(
      conformanceCatalog,
      identity(),
      'conformance.echo',
      'echo',
      { text: 'safe', moduleId: 'attacker.module.value' } as never,
    )).toThrow('PAYLOAD_INVALID')

    const request = echoRequest()
    const reference = validateCapabilityRpcRequestReference(request, binding)
    expect(reference).toEqual({
      ok: true,
      value: {
        protocol: 'oneweb.capability',
        version: 1,
        type: 'CAPABILITY_REQUEST',
        ...identity(),
        capability: 'conformance.echo',
        operation: 'echo',
      },
    })
    if (reference.ok) {
      expect(Object.isFrozen(reference.value)).toBe(true)
      expect('payload' in reference.value).toBe(false)
    }
    const forged = {
      ...request,
      moduleId: 'attacker.module.value',
      sessionId: 'session_aaaaaaaaaaaaaaaaaaaaaaaa',
      generation: 8,
    }
    expectFailure(
      validateCapabilityRpcRequestEnvelope(
        conformanceCatalog,
        forged,
        binding,
        ['conformance.echo'],
      ),
      'SESSION_MISMATCH',
    )
  })

  it('requires both manifest declaration and a static catalog entry', () => {
    const request = echoRequest()
    expectFailure(
      validateCapabilityRpcRequestEnvelope(conformanceCatalog, request, binding, []),
      'CAPABILITY_NOT_DECLARED',
    )

    const unknownCapability = { ...request, capability: 'unknown.capability' }
    expectFailure(
      validateCapabilityRpcRequestEnvelope(
        conformanceCatalog,
        unknownCapability,
        binding,
        ['unknown.capability'],
      ),
      'CAPABILITY_NOT_ALLOWED',
    )
  })

  it('rejects operations outside the capability-specific descriptor', () => {
    const request = { ...echoRequest(), operation: 'arbitrary-method' }
    expectFailure(
      validateCapabilityRpcRequestEnvelope(
        conformanceCatalog,
        request,
        binding,
        ['conformance.echo'],
      ),
      'OPERATION_NOT_ALLOWED',
    )
  })

  it('rejects oversized request payloads and results before they can land', () => {
    const oversizedRequest = {
      ...echoRequest(),
      payload: { text: 'x'.repeat(16 * 1024) },
    }
    expectFailure(
      validateCapabilityRpcRequestEnvelope(
        conformanceCatalog,
        oversizedRequest,
        binding,
        ['conformance.echo'],
      ),
      'PAYLOAD_TOO_LARGE',
    )

    const request = echoRequest()
    const oversizedResult = {
      ...createCapabilityRpcResultEnvelope(conformanceCatalog, request, { echoed: 'safe' }),
      result: { echoed: 'x'.repeat(65_536) },
    }
    expectFailure(
      validateCapabilityRpcResultEnvelope(conformanceCatalog, oversizedResult, request),
      'RESULT_TOO_LARGE',
    )
  })

  it.each([
    ['function', { text: () => 'unsafe' }],
    ['bigint', { text: 1n }],
    ['non-finite number', { text: Number.NaN }],
    ['class instance', new (class Payload { text = 'unsafe' })()],
  ])('rejects %s request data', (_label, payload) => {
    const request = { ...echoRequest(), payload }
    expectFailure(
      validateCapabilityRpcRequestEnvelope(
        conformanceCatalog,
        request,
        binding,
        ['conformance.echo'],
      ),
      'PAYLOAD_INVALID',
    )
  })

  it('rejects cycles, accessors, symbol keys, excessive depth and excessive nodes', () => {
    const cycle: Record<string, unknown> = { text: 'unsafe' }
    cycle.self = cycle
    const accessor = {}
    Object.defineProperty(accessor, 'text', { enumerable: true, get: () => 'unsafe' })
    const symbol = { text: 'unsafe', [Symbol('hidden')]: true }
    let deep: unknown = 'end'
    for (let index = 0; index < 10; index += 1)
      deep = { child: deep }
    const manyNodes = { text: 'safe', values: Array.from({ length: 512 }, () => 1) }

    for (const payload of [cycle, accessor, symbol, deep, manyNodes]) {
      expectFailure(
        validateCapabilityRpcRequestEnvelope(
          conformanceCatalog,
          { ...echoRequest(), payload },
          binding,
          ['conformance.echo'],
        ),
        'PAYLOAD_INVALID',
      )
    }
  })

  it('returns recursively frozen clones without mutating caller input', () => {
    const values = [1, 2, 3]
    const input = createCapabilityRpcRequestEnvelope(
      conformanceCatalog,
      identity(),
      'conformance.echo',
      'sum',
      { values },
    )
    values[0] = 99
    expect(input.payload.values).toEqual([1, 2, 3])
    expect(Object.isFrozen(input)).toBe(true)
    expect(Object.isFrozen(input.payload)).toBe(true)
    expect(Object.isFrozen(input.payload.values)).toBe(true)

    const wireInput = { ...input, payload: { values: [4, 5] } }
    const validated = validateCapabilityRpcRequestEnvelope(
      conformanceCatalog,
      wireInput,
      binding,
      ['conformance.echo'],
    )
    expect(validated.ok).toBe(true)
    wireInput.payload.values[0] = 100
    if (validated.ok && validated.value.operation === 'sum')
      expect(validated.value.payload.values).toEqual([4, 5])
  })

  it('rejects response replacement, raw error details and malformed cancellation', () => {
    const request = echoRequest()
    const result = createCapabilityRpcResultEnvelope(conformanceCatalog, request, { echoed: 'safe' })
    const cyclicResult: Record<string, unknown> = { echoed: 'unsafe' }
    cyclicResult.self = cyclicResult
    expectFailure(
      validateCapabilityRpcResultEnvelope(
        conformanceCatalog,
        { ...result, result: cyclicResult },
        request,
      ),
      'RESULT_INVALID',
    )
    expectFailure(
      validateCapabilityRpcResultEnvelope(
        conformanceCatalog,
        { ...result, protocol: 'arbitrary.protocol' },
        request,
      ),
      'INVALID_ENVELOPE',
    )
    expectFailure(
      validateCapabilityRpcResultEnvelope(
        conformanceCatalog,
        { ...result, operation: 'sum' },
        request,
      ),
      'RESPONSE_MISMATCH',
    )
    expectFailure(
      validateCapabilityRpcResultEnvelope(
        conformanceCatalog,
        { ...result, sessionId: 'session_aaaaaaaaaaaaaaaaaaaaaaaa' },
        request,
      ),
      'SESSION_MISMATCH',
    )
    expectFailure(
      validateCapabilityRpcErrorEnvelope(
        { ...createCapabilityRpcErrorEnvelope(request, 'OPERATION_FAILED'), details: 'secret stack' },
        request,
      ),
      'INVALID_ENVELOPE',
    )
    expectFailure(
      validateCapabilityRpcCancelEnvelope(
        { ...createCapabilityRpcCancelEnvelope(request), reason: 'free form' },
        request,
      ),
      'INVALID_ENVELOPE',
    )
  })

  it('clones catalog descriptors so later caller mutation cannot expand operations', () => {
    const fields = { text: capabilityRpcSchema.string({ maximumLength: 32 }) }
    const source = {
      'conformance.mutable': {
        operations: {
          echo: {
            request: capabilityRpcSchema.object(fields),
            result: capabilityRpcSchema.object(fields),
          },
        },
      },
    }
    const catalog = defineCapabilityRpcCatalog(source)
    fields.text = capabilityRpcSchema.string({ maximumLength: 1024 })
    expect(Object.isFrozen(catalog)).toBe(true)
    expect(Object.isFrozen(catalog['conformance.mutable'].operations)).toBe(true)
    expect(catalog['conformance.mutable'].operations.echo.request.fields.text.maximumLength).toBe(32)
  })
})

describe('typed capability RPC lifecycle reducer', () => {
  it('registers a bounded request and completes it exactly once', () => {
    const request = echoRequest()
    const initial = createCapabilityRpcLifecycleState(binding)
    const registered = reduceCapabilityRpcLifecycle(initial, { type: 'register', request, now: 100 })
    expect(registered.ok).toBe(true)
    expect(initial.requests).toEqual([])
    expect(registered.state.requests[0]).toMatchObject({
      status: 'pending',
      deadlineAt: 100 + CAPABILITY_RPC_REQUEST_TIMEOUT_MS,
    })

    const result = createCapabilityRpcResultEnvelope(conformanceCatalog, request, { echoed: 'hello' })
    const completed = reduceCapabilityRpcLifecycle(registered.state, { type: 'result', response: result, now: 200 })
    expect(completed.ok).toBe(true)
    expect(completed.state.requests[0]).toMatchObject({ status: 'succeeded', completedAt: 200 })

    const duplicate = reduceCapabilityRpcLifecycle(completed.state, { type: 'result', response: result, now: 201 })
    expect(duplicate.ok).toBe(false)
    expect(duplicate).toMatchObject({ code: 'REQUEST_ALREADY_TERMINAL' })
    expect(duplicate.state).toBe(completed.state)

    const cancelAfterResult = reduceCapabilityRpcLifecycle(completed.state, {
      type: 'cancel',
      response: createCapabilityRpcCancelEnvelope(request),
      now: 202,
    })
    expect(cancelAfterResult).toMatchObject({ ok: false, code: 'REQUEST_ALREADY_TERMINAL' })
    expect(cancelAfterResult.state).toBe(completed.state)
  })

  it('retains completed request IDs and rejects replay', () => {
    const request = echoRequest()
    const registered = reduceCapabilityRpcLifecycle(
      createCapabilityRpcLifecycleState(binding),
      { type: 'register', request, now: 0 },
    )
    const cancelled = reduceCapabilityRpcLifecycle(registered.state, {
      type: 'cancel',
      response: createCapabilityRpcCancelEnvelope(request),
      now: 1,
    })
    const replay = reduceCapabilityRpcLifecycle(cancelled.state, { type: 'register', request, now: 2 })
    expect(replay).toMatchObject({ ok: false, code: 'REQUEST_ID_REUSED' })
  })

  it('binds every transition to module, session and generation', () => {
    const request = echoRequest()
    const initial = createCapabilityRpcLifecycleState(binding)
    for (const replacement of [
      { moduleId: 'dev.oneweb.another.module' },
      { sessionId: 'session_aaaaaaaaaaaaaaaaaaaaaaaa' },
      { generation: 8 },
    ]) {
      const forged = { ...request, ...replacement }
      expect(reduceCapabilityRpcLifecycle(initial, {
        type: 'register',
        request: forged,
        now: 0,
      })).toMatchObject({ ok: false, code: 'SESSION_MISMATCH' })
    }
  })

  it('rejects capability or operation replacement on a response', () => {
    const request = echoRequest()
    const registered = reduceCapabilityRpcLifecycle(
      createCapabilityRpcLifecycleState(binding),
      { type: 'register', request, now: 0 },
    )
    const result = createCapabilityRpcResultEnvelope(conformanceCatalog, request, { echoed: 'safe' })
    for (const replacement of [
      { capability: 'conformance.other' },
      { operation: 'sum' },
    ]) {
      const transition = reduceCapabilityRpcLifecycle(registered.state, {
        type: 'result',
        response: { ...result, ...replacement },
        now: 1,
      })
      expect(transition).toMatchObject({ ok: false, code: 'RESPONSE_MISMATCH' })
      expect(transition.state).toBe(registered.state)
    }
  })

  it('makes the first terminal event win cancellation/result and error/result races', () => {
    const request = echoRequest()
    const registered = reduceCapabilityRpcLifecycle(
      createCapabilityRpcLifecycleState(binding),
      { type: 'register', request, now: 0 },
    )
    const cancelled = reduceCapabilityRpcLifecycle(registered.state, {
      type: 'cancel',
      response: createCapabilityRpcCancelEnvelope(request),
      now: 1,
    })
    const resultAfterCancel = reduceCapabilityRpcLifecycle(cancelled.state, {
      type: 'result',
      response: createCapabilityRpcResultEnvelope(conformanceCatalog, request, { echoed: 'late' }),
      now: 2,
    })
    expect(cancelled.state.requests[0].status).toBe('cancelled')
    expect(resultAfterCancel).toMatchObject({ ok: false, code: 'REQUEST_ALREADY_TERMINAL' })

    const failed = reduceCapabilityRpcLifecycle(registered.state, {
      type: 'error',
      response: createCapabilityRpcErrorEnvelope(request, 'OPERATION_FAILED'),
      now: 1,
    })
    const resultAfterError = reduceCapabilityRpcLifecycle(failed.state, {
      type: 'result',
      response: createCapabilityRpcResultEnvelope(conformanceCatalog, request, { echoed: 'late' }),
      now: 2,
    })
    expect(failed.state.requests[0]).toMatchObject({
      status: 'failed',
      errorCode: 'OPERATION_FAILED',
    })
    expect(resultAfterError).toMatchObject({ ok: false, code: 'REQUEST_ALREADY_TERMINAL' })
  })

  it('times out at the fixed deadline and invalidates late results', () => {
    const request = echoRequest()
    const registered = reduceCapabilityRpcLifecycle(
      createCapabilityRpcLifecycleState(binding),
      { type: 'register', request, now: 10 },
    )
    const early = reduceCapabilityRpcLifecycle(registered.state, {
      type: 'timeout',
      identity: request,
      now: 10 + CAPABILITY_RPC_REQUEST_TIMEOUT_MS - 1,
    })
    expect(early).toMatchObject({ ok: false, code: 'TIMEOUT_NOT_REACHED' })
    expect(early.state).toBe(registered.state)

    const late = reduceCapabilityRpcLifecycle(registered.state, {
      type: 'result',
      response: createCapabilityRpcResultEnvelope(conformanceCatalog, request, { echoed: 'late' }),
      now: 10 + CAPABILITY_RPC_REQUEST_TIMEOUT_MS,
    })
    expect(late).toMatchObject({ ok: false, code: 'REQUEST_TIMED_OUT' })
    expect(late.state.requests[0].status).toBe('timed-out')

    const later = reduceCapabilityRpcLifecycle(late.state, {
      type: 'timeout',
      identity: request,
      now: 20 + CAPABILITY_RPC_REQUEST_TIMEOUT_MS,
    })
    expect(later).toMatchObject({ ok: false, code: 'REQUEST_ALREADY_TERMINAL' })
  })

  it('enforces the per-session in-flight limit without mutating rejected state', () => {
    let state = createCapabilityRpcLifecycleState(binding)
    for (let index = 0; index < CAPABILITY_RPC_MAX_IN_FLIGHT; index += 1) {
      const transition = reduceCapabilityRpcLifecycle(state, {
        type: 'register',
        request: echoRequest(`request_${String(index).padStart(8, '0')}`),
        now: index,
      })
      expect(transition.ok).toBe(true)
      state = transition.state
    }
    const rejected = reduceCapabilityRpcLifecycle(state, {
      type: 'register',
      request: echoRequest('request_overflow'),
      now: 100,
    })
    expect(rejected).toMatchObject({ ok: false, code: 'IN_FLIGHT_LIMIT_REACHED' })
    expect(rejected.state).toBe(state)
  })

  it('enforces the total request ID limit even when all earlier requests completed', () => {
    let state = createCapabilityRpcLifecycleState(binding)
    for (let index = 0; index < CAPABILITY_RPC_MAX_REQUESTS_PER_SESSION; index += 1) {
      const request = echoRequest(`request_${String(index).padStart(8, '0')}`)
      const registered = reduceCapabilityRpcLifecycle(state, { type: 'register', request, now: index * 2 })
      expect(registered.ok).toBe(true)
      const completed = reduceCapabilityRpcLifecycle(registered.state, {
        type: 'result',
        response: createCapabilityRpcResultEnvelope(conformanceCatalog, request, { echoed: 'ok' }),
        now: index * 2 + 1,
      })
      expect(completed.ok).toBe(true)
      state = completed.state
    }
    const rejected = reduceCapabilityRpcLifecycle(state, {
      type: 'register',
      request: echoRequest('request_total_overflow'),
      now: 10_000,
    })
    expect(rejected).toMatchObject({ ok: false, code: 'SESSION_REQUEST_LIMIT_REACHED' })
    expect(rejected.state).toBe(state)
  })

  it('destroys pending authority and rejects every late event without revival', () => {
    const request = echoRequest()
    const registered = reduceCapabilityRpcLifecycle(
      createCapabilityRpcLifecycleState(binding),
      { type: 'register', request, now: 0 },
    )
    const destroyed = reduceCapabilityRpcLifecycle(registered.state, { type: 'destroy', now: 10 })
    expect(destroyed.ok).toBe(true)
    expect(destroyed.state).toMatchObject({ status: 'destroyed', destroyedAt: 10 })
    expect(destroyed.state.requests[0]).toMatchObject({
      status: 'session-destroyed',
      errorCode: 'SESSION_DESTROYED',
    })

    for (const event of [
      {
        type: 'result' as const,
        response: createCapabilityRpcResultEnvelope(conformanceCatalog, request, { echoed: 'late' }),
        now: 11,
      },
      { type: 'register' as const, request: echoRequest('request_new_after_destroy'), now: 12 },
    ]) {
      const late = reduceCapabilityRpcLifecycle(destroyed.state, event)
      expect(late).toMatchObject({ ok: false, code: 'SESSION_DESTROYED' })
      expect(late.state).toBe(destroyed.state)
    }
  })

  it('keeps lifecycle instances isolated and all returned state immutable', () => {
    const first = createCapabilityRpcLifecycleState(binding)
    const secondBinding = {
      moduleId: 'dev.oneweb.conformance.other',
      sessionId: 'session_aaaaaaaaaaaaaaaaaaaaaaaa',
      generation: 1,
    }
    const second = createCapabilityRpcLifecycleState(secondBinding)
    const registered = reduceCapabilityRpcLifecycle(first, {
      type: 'register',
      request: echoRequest(),
      now: 0,
    })
    const sameRequestIdInSecondSession = createCapabilityRpcRequestEnvelope(
      conformanceCatalog,
      { ...secondBinding, requestId: 'request_12345678' },
      'conformance.echo',
      'echo',
      { text: 'isolated' },
    )
    const secondRegistered = reduceCapabilityRpcLifecycle(second, {
      type: 'register',
      request: sameRequestIdInSecondSession,
      now: 0,
    })
    expect(registered.ok).toBe(true)
    expect(secondRegistered.ok).toBe(true)
    expect(first.requests).toEqual([])
    expect(second.requests).toEqual([])
    expect(registered.state.requests[0].moduleId).toBe(binding.moduleId)
    expect(secondRegistered.state.requests[0].moduleId).toBe(secondBinding.moduleId)
    expect(Object.isFrozen(registered.state)).toBe(true)
    expect(Object.isFrozen(registered.state.binding)).toBe(true)
    expect(Object.isFrozen(registered.state.requests)).toBe(true)
    expect(Object.isFrozen(registered.state.requests[0])).toBe(true)
  })
})
