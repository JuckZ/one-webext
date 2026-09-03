import {
  CAPABILITY_RPC_MAX_IN_FLIGHT,
  CAPABILITY_RPC_MAX_REQUESTS_PER_SESSION,
  CAPABILITY_RPC_REQUEST_TIMEOUT_MS,
  CapabilityRpcClientError,
  createCapabilityRpcCancelEnvelope,
  createCapabilityRpcErrorEnvelope,
  createCapabilityRpcResultEnvelope,
} from '@oneweb/module-sdk'
import {
  conformanceRpcCatalog,
  createConformanceRpcPair,
  settleConformanceRpc,
} from './fixtures/capability-rpc-pair'

describe('two-module typed capability RPC conformance isolation', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('isolates successful results, stable failures and explicit cancellation', async () => {
    const alpha = createConformanceRpcPair('dev.oneweb.conformance.rpc-alpha', 1)
    const beta = createConformanceRpcPair('dev.oneweb.conformance.rpc-beta', 7)

    const unsafeText = '<img src=x onerror=owned> untrusted text'
    await expect(alpha.client.request('conformance.echo', 'echo', { text: unsafeText }).result)
      .resolves
      .toEqual({ echoed: unsafeText })
    await expect(beta.client.request('conformance.echo', 'sum', { values: [2, 3, 5] }).result)
      .resolves
      .toEqual({ total: 10 })

    await expect(alpha.client.request('conformance.echo', 'echo', { text: 'fail' }).result)
      .rejects
      .toMatchObject({ code: 'OPERATION_FAILED' })
    await expect(alpha.client.request('conformance.echo', 'echo', { text: 'invalid-result' }).result)
      .rejects
      .toMatchObject({ code: 'OPERATION_FAILED' })
    await expect(beta.client.request('conformance.echo', 'echo', { text: 'beta-still-live' }).result)
      .resolves
      .toEqual({ echoed: 'beta-still-live' })

    const cancelled = alpha.client.request('conformance.echo', 'echo', { text: 'hold-cancel' })
    const cancelledResult = expect(cancelled.result).rejects.toMatchObject({ code: 'REQUEST_CANCELLED' })
    await settleConformanceRpc()
    expect(cancelled.cancel()).toBe(true)
    await cancelledResult
    await settleConformanceRpc()
    expect(alpha.aborts).toBe(1)
    expect(beta.aborts).toBe(0)
    await expect(beta.client.request('conformance.echo', 'sum', { values: [8, 13] }).result)
      .resolves
      .toEqual({ total: 21 })

    alpha.destroy()
    beta.destroy()
  })

  it('contains in-flight and total-ID exhaustion within one session', async () => {
    const alpha = createConformanceRpcPair('dev.oneweb.conformance.quota-alpha', 1)
    const beta = createConformanceRpcPair('dev.oneweb.conformance.quota-beta', 1)
    const held = Array.from({ length: CAPABILITY_RPC_MAX_IN_FLIGHT }, (_, index) => (
      alpha.client.request('conformance.echo', 'echo', { text: `hold-${index}` })
    ))
    await settleConformanceRpc()
    expect(() => alpha.client.request('conformance.echo', 'echo', { text: 'overflow' }))
      .toThrowError(new CapabilityRpcClientError('IN_FLIGHT_LIMIT_REACHED'))
    await expect(beta.client.request('conformance.echo', 'sum', { values: [20, 22] }).result)
      .resolves
      .toEqual({ total: 42 })

    const heldRejections = held.map(handle => expect(handle.result).rejects.toMatchObject({
      code: 'REQUEST_CANCELLED',
    }))
    for (const handle of held)
      expect(handle.cancel()).toBe(true)
    await Promise.all(heldRejections)
    await settleConformanceRpc()

    for (let index = CAPABILITY_RPC_MAX_IN_FLIGHT; index < CAPABILITY_RPC_MAX_REQUESTS_PER_SESSION; index += 1) {
      await expect(alpha.client.request('conformance.echo', 'sum', { values: [index, -index] }).result)
        .resolves
        .toEqual({ total: 0 })
    }
    expect(() => alpha.client.request('conformance.echo', 'sum', { values: [1] }))
      .toThrowError(new CapabilityRpcClientError('SESSION_REQUEST_LIMIT_REACHED'))
    await expect(beta.client.request('conformance.echo', 'echo', { text: 'quota-isolated' }).result)
      .resolves
      .toEqual({ echoed: 'quota-isolated' })

    alpha.destroy()
    beta.destroy()
  })

  it('drops cross-principal, replaced, malformed, duplicate and late envelopes', async () => {
    const alpha = createConformanceRpcPair('dev.oneweb.conformance.hostile-alpha', 3)
    const beta = createConformanceRpcPair('dev.oneweb.conformance.hostile-beta', 9)
    const alphaHandle = alpha.client.request('conformance.echo', 'echo', { text: 'hold-alpha' })
    const betaHandle = beta.client.request('conformance.echo', 'echo', { text: 'hold-beta' })
    await settleConformanceRpc()
    const alphaRequest = alpha.requests().at(-1)!
    const betaRequest = beta.requests().at(-1)!
    const alphaResult = createCapabilityRpcResultEnvelope(
      conformanceRpcCatalog,
      alphaRequest as never,
      { echoed: 'forged' },
    )
    const betaResult = createCapabilityRpcResultEnvelope(
      conformanceRpcCatalog,
      betaRequest as never,
      { echoed: 'beta-result' },
    )
    for (const forged of [
      { ...alphaResult, moduleId: beta.binding.moduleId },
      { ...alphaResult, sessionId: beta.binding.sessionId },
      { ...alphaResult, generation: alpha.binding.generation + 1 },
      { ...alphaResult, requestId: betaRequest.requestId },
      { ...alphaResult, capability: 'conformance.replaced' },
      { ...alphaResult, operation: 'sum' },
      { ...alphaResult, result: { echoed: 'x'.repeat(65_536) } },
      { ...alphaResult, result: { echoed: 42 } },
      { ...alphaResult, extra: 'not allowed' },
      betaResult,
    ])
      alpha.injectHost(forged)
    await settleConformanceRpc()

    let alphaSettled = false
    void alphaHandle.result.then(
      () => { alphaSettled = true },
      () => { alphaSettled = true },
    )
    await Promise.resolve()
    expect(alphaSettled).toBe(false)
    beta.completeHeld('beta-result')
    await expect(betaHandle.result).resolves.toEqual({ echoed: 'beta-result' })
    beta.injectHost(betaResult)

    const alphaCancellation = expect(alphaHandle.result).rejects.toMatchObject({ code: 'REQUEST_CANCELLED' })
    alphaHandle.cancel()
    await alphaCancellation
    for (const late of [
      alphaResult,
      createCapabilityRpcErrorEnvelope(alphaRequest, 'OPERATION_FAILED'),
      createCapabilityRpcCancelEnvelope(alphaRequest),
    ])
      alpha.injectHost(late)
    await settleConformanceRpc()
    await expect(beta.client.request('conformance.echo', 'sum', { values: [1, 1] }).result)
      .resolves
      .toEqual({ total: 2 })

    alpha.destroy()
    beta.destroy()
  })

  it('contains timeout, destroy, port failure and stale-generation replay', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-30T00:00:00.000Z'))
    const alpha = createConformanceRpcPair('dev.oneweb.conformance.lifecycle-alpha', 1)
    const beta = createConformanceRpcPair('dev.oneweb.conformance.lifecycle-beta', 1)
    const timedOut = alpha.client.request('conformance.echo', 'echo', { text: 'hold-timeout' })
    const timeoutResult = expect(timedOut.result).rejects.toMatchObject({ code: 'REQUEST_TIMED_OUT' })
    await settleConformanceRpc()
    await vi.advanceTimersByTimeAsync(CAPABILITY_RPC_REQUEST_TIMEOUT_MS)
    await timeoutResult
    expect(alpha.aborts).toBe(1)
    await expect(beta.client.request('conformance.echo', 'sum', { values: [34, 55] }).result)
      .resolves
      .toEqual({ total: 89 })

    const destroyed = alpha.client.request('conformance.echo', 'echo', { text: 'hold-destroy' })
    const destroyedResult = expect(destroyed.result).rejects.toMatchObject({ code: 'SESSION_DESTROYED' })
    await settleConformanceRpc()
    alpha.destroy()
    await destroyedResult
    expect(alpha.aborts).toBe(2)

    const failed = createConformanceRpcPair('dev.oneweb.conformance.lifecycle-failed', 4)
    const failedHandle = failed.client.request('conformance.echo', 'echo', { text: 'hold-port' })
    const failedResult = expect(failedHandle.result).rejects.toMatchObject({ code: 'SESSION_DESTROYED' })
    await settleConformanceRpc()
    const oldRequest = failed.requests().at(-1)!
    const staleResult = createCapabilityRpcResultEnvelope(
      conformanceRpcCatalog,
      oldRequest as never,
      { echoed: 'stale' },
    )
    failed.failPort()
    await failedResult

    const replacement = createConformanceRpcPair('dev.oneweb.conformance.lifecycle-failed', 5)
    const replacementHandle = replacement.client.request('conformance.echo', 'echo', { text: 'hold-new' })
    await settleConformanceRpc()
    replacement.injectHost(staleResult)
    await settleConformanceRpc()
    let replacementSettled = false
    void replacementHandle.result.then(
      () => { replacementSettled = true },
      () => { replacementSettled = true },
    )
    await Promise.resolve()
    expect(replacementSettled).toBe(false)
    replacement.completeHeld('new-generation')
    await expect(replacementHandle.result).resolves.toEqual({ echoed: 'new-generation' })
    await expect(beta.client.request('conformance.echo', 'echo', { text: 'lifecycle-isolated' }).result)
      .resolves
      .toEqual({ echoed: 'lifecycle-isolated' })

    failed.destroy()
    replacement.destroy()
    beta.destroy()
  })
})
