import type { RemoteFrameModuleManifest } from '../types'
import {
  createConformanceModulePair,
  deferredManifestResponse,
  snapshotModule,
} from './fixtures/conformance-module-pair'

describe('cross-module conformance isolation', () => {
  it('keeps exact-origin permission, enabled state, timestamps and removal module-local', async () => {
    const harness = createConformanceModulePair()
    const alpha = await harness.install(harness.primary)
    const beta = await harness.install(harness.secondary)
    const betaBefore = snapshotModule(beta)

    expect(await harness.permissions.contains({ origins: [harness.primary.originPattern] })).toBe(true)
    expect(await harness.permissions.contains({ origins: [harness.secondary.originPattern] })).toBe(true)

    harness.setNow('2026-08-28T09:00:00.000Z')
    await expect(harness.manager.setEnabled(alpha.manifest.id, false)).resolves.toMatchObject({
      ok: true,
      changed: true,
      record: { enabled: false, updatedAt: '2026-08-28T09:00:00.000Z' },
    })
    expect(await harness.registry.get(beta.manifest.id)).toEqual(betaBefore)

    harness.setNow('2026-08-28T10:00:00.000Z')
    await expect(harness.manager.remove(alpha.manifest.id)).resolves.toMatchObject({
      ok: true,
      changed: true,
    })
    expect(await harness.registry.get(alpha.manifest.id)).toBeNull()
    expect(await harness.registry.get(beta.manifest.id)).toEqual(betaBefore)
    expect(await harness.permissions.contains({ origins: [harness.primary.originPattern] })).toBe(false)
    expect(await harness.permissions.contains({ origins: [harness.secondary.originPattern] })).toBe(true)
  })

  it('checks concurrently, applies a safe update and grants only the other module approved additions', async () => {
    const harness = createConformanceModulePair()
    const alpha = await harness.install(harness.primary)
    const beta = await harness.install(harness.secondary)
    const alphaInstalledAt = alpha.installedAt
    const betaInstalledAt = beta.installedAt
    const alphaCandidate = { ...harness.primary.manifest, version: '0.2.0', description: 'Safe alpha copy' }
    const betaCandidate: RemoteFrameModuleManifest = {
      ...harness.secondary.manifest,
      version: '0.2.0',
      matches: [...harness.secondary.manifest.matches, 'https://news.example.com/*'],
      contexts: [...harness.secondary.manifest.contexts, 'page.selection'],
      context_fields: {
        ...harness.secondary.manifest.context_fields,
        'page.selection': ['text'],
      },
      capabilities: [...harness.secondary.manifest.capabilities, 'clipboard.write', 'notifications.show'],
      activation: 'suggest',
    }
    harness.primary.setManifest(alphaCandidate)
    harness.secondary.setManifest(betaCandidate)

    harness.setNow('2026-08-28T09:00:00.000Z')
    const [alphaChecked, betaChecked] = await Promise.all([
      harness.manager.checkUpdate(alpha.manifest.id),
      harness.manager.checkUpdate(beta.manifest.id),
    ])
    expect(alphaChecked).toMatchObject({
      ok: true,
      record: { update: { approvalStatus: 'not-required' } },
    })
    expect(betaChecked).toMatchObject({
      ok: true,
      record: { update: { approvalStatus: 'pending' } },
    })

    const alphaBeforeApproval = snapshotModule(await harness.registry.get(alpha.manifest.id))
    const betaRecord = await harness.registry.get(beta.manifest.id)
    if (!betaRecord?.update)
      throw new Error('Expected beta update candidate')
    harness.setNow('2026-08-28T10:00:00.000Z')
    await expect(harness.manager.approveUpdate(
      beta.manifest.id,
      betaRecord.update.normalizedManifestDigest,
      {
        approvedContextFields: { 'page.selection': ['text'] },
        approvedCapabilities: ['clipboard.write'],
      },
    )).resolves.toMatchObject({
      ok: true,
      record: {
        update: {
          approvalStatus: 'approved',
          approvalSnapshot: {
            approvedContextFields: { 'page.selection': ['text'] },
            approvedCapabilities: ['clipboard.write'],
          },
        },
      },
    })
    expect(await harness.registry.get(alpha.manifest.id)).toEqual(alphaBeforeApproval)

    harness.setNow('2026-08-28T11:00:00.000Z')
    const [alphaApplied, betaApplied] = await Promise.all([
      harness.manager.applyUpdate(alpha.manifest.id),
      harness.manager.applyUpdate(beta.manifest.id),
    ])
    expect(alphaApplied).toMatchObject({
      ok: true,
      record: {
        manifest: { version: '0.2.0' },
        grantedContextFields: { 'github.repository': ['repo', 'url'] },
        grantedCapabilities: ['tabs.open'],
        installedAt: alphaInstalledAt,
        updatedAt: '2026-08-28T11:00:00.000Z',
      },
    })
    expect(betaApplied).toMatchObject({
      ok: true,
      record: {
        manifest: { version: '0.2.0' },
        grantedContextFields: {
          'page.metadata': ['title', 'description'],
          'page.selection': ['text'],
        },
        grantedCapabilities: ['storage.module', 'clipboard.write'],
        installedAt: betaInstalledAt,
        updatedAt: '2026-08-28T11:00:00.000Z',
      },
    })
    if (betaApplied.operation !== 'update-apply' || !betaApplied.ok)
      throw new Error('Expected beta update to apply')
    expect(betaApplied.record.grantedCapabilities).not.toContain('notifications.show')
  })

  it('removes reduced grants from only the updated module', async () => {
    const harness = createConformanceModulePair()
    const alpha = await harness.install(harness.primary)
    const beta = await harness.install(harness.secondary)
    const betaBefore = snapshotModule(beta)
    harness.primary.setManifest({
      ...harness.primary.manifest,
      version: '0.2.0',
      context_fields: { 'github.repository': ['repo'] },
      capabilities: [],
    })

    await harness.manager.checkUpdate(alpha.manifest.id)
    harness.setNow('2026-08-28T09:00:00.000Z')
    await expect(harness.manager.applyUpdate(alpha.manifest.id)).resolves.toMatchObject({
      ok: true,
      record: {
        grantedContextFields: { 'github.repository': ['repo'] },
        grantedCapabilities: [],
      },
    })
    expect(await harness.registry.get(beta.manifest.id)).toEqual(betaBefore)
  })

  it('does not let rejection, fetch failure or remote replacement invalidate another approval', async () => {
    const harness = createConformanceModulePair()
    const alpha = await harness.install(harness.primary)
    const beta = await harness.install(harness.secondary)
    const betaCandidate: RemoteFrameModuleManifest = {
      ...harness.secondary.manifest,
      version: '0.2.0',
      capabilities: [...harness.secondary.manifest.capabilities, 'clipboard.write'],
    }
    harness.secondary.setManifest(betaCandidate)
    const betaChecked = await harness.manager.checkUpdate(beta.manifest.id)
    if (betaChecked.operation !== 'update-check' || !betaChecked.ok || !betaChecked.record.update)
      throw new Error('Expected beta update candidate')
    await harness.manager.approveUpdate(
      beta.manifest.id,
      betaChecked.record.update.normalizedManifestDigest,
      { approvedContextFields: {}, approvedCapabilities: ['clipboard.write'] },
    )
    const approvedBeta = snapshotModule(await harness.registry.get(beta.manifest.id))

    harness.primary.setManifest({ ...harness.primary.manifest, id: 'dev.evil.alpha-replacement' })
    await expect(harness.manager.checkUpdate(alpha.manifest.id)).resolves.toMatchObject({
      ok: true,
      record: { update: { approvalStatus: 'rejected' } },
    })
    expect(await harness.registry.get(beta.manifest.id)).toEqual(approvedBeta)

    harness.primary.failNextFetch()
    await expect(harness.manager.checkUpdate(alpha.manifest.id)).resolves.toMatchObject({
      ok: false,
      reason: 'fetch-failed',
    })
    expect(await harness.registry.get(beta.manifest.id)).toEqual(approvedBeta)

    const checkedAlpha = { ...harness.primary.manifest, version: '0.2.0' }
    harness.primary.setManifest(checkedAlpha)
    await harness.manager.checkUpdate(alpha.manifest.id)
    harness.primary.setManifest({ ...checkedAlpha, version: '0.3.0' })
    await expect(harness.manager.applyUpdate(alpha.manifest.id)).resolves.toMatchObject({
      ok: false,
      reason: 'update-candidate-changed',
    })
    expect(await harness.registry.get(beta.manifest.id)).toEqual(approvedBeta)
  })

  it('keeps another candidate intact when removal wins a concurrent application race', async () => {
    const harness = createConformanceModulePair()
    const alpha = await harness.install(harness.primary)
    const beta = await harness.install(harness.secondary)
    const alphaCandidate = { ...harness.primary.manifest, version: '0.2.0' }
    harness.primary.setManifest(alphaCandidate)
    await harness.manager.checkUpdate(alpha.manifest.id)

    const deferred = deferredManifestResponse()
    harness.fetch.mockImplementationOnce(async () => deferred.promise)
    const alphaApplying = harness.manager.applyUpdate(alpha.manifest.id)
    await vi.waitFor(() => expect(harness.fetch).toHaveBeenCalledTimes(6))

    harness.secondary.setManifest({ ...harness.secondary.manifest, version: '0.2.0' })
    await harness.manager.checkUpdate(beta.manifest.id)
    const betaChecked = snapshotModule(await harness.registry.get(beta.manifest.id))
    await harness.manager.remove(alpha.manifest.id)
    deferred.resolve(deferred.response(alphaCandidate, harness.primary.manifestUrl))

    await expect(alphaApplying).resolves.toMatchObject({ ok: false, reason: 'not-found' })
    expect(await harness.registry.get(alpha.manifest.id)).toBeNull()
    expect(await harness.registry.get(beta.manifest.id)).toEqual(betaChecked)
    expect(await harness.permissions.contains({ origins: [harness.primary.originPattern] })).toBe(false)
    expect(await harness.permissions.contains({ origins: [harness.secondary.originPattern] })).toBe(true)
  })
})
