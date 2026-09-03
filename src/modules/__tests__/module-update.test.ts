import type { ModuleUpdateCandidate, OneWebModuleManifest, RemoteFrameModuleManifest } from '../types'
import {
  classifyModuleUpdate,
  expectedModuleUpdateApprovalStatus,
  isNormalizedManifestDigest,
} from '../module-update'
import { createRepoLensSeed } from '../seeds/repolens'

function baseManifest(): RemoteFrameModuleManifest {
  const manifest = createRepoLensSeed('https://modules.example').manifest
  if (manifest.runtime !== 'remote-frame')
    throw new Error('Expected a remote-frame fixture')
  return manifest
}

function candidate(
  candidateManifest: OneWebModuleManifest,
  overrides: Partial<ModuleUpdateCandidate> = {},
): ModuleUpdateCandidate {
  return {
    candidateManifest,
    candidateSourceUrl: 'https://modules.example/.well-known/oneweb-module.json',
    normalizedManifestDigest: 'a'.repeat(64),
    checkedAt: '2026-08-27T12:00:00.000Z',
    ...overrides,
  }
}

function classify(
  candidateManifest: OneWebModuleManifest,
  overrides: Partial<ModuleUpdateCandidate> = {},
) {
  return classifyModuleUpdate({
    manifest: baseManifest(),
    sourceUrl: 'https://modules.example/.well-known/oneweb-module.json',
  }, candidate(candidateManifest, overrides))
}

describe('module update classification', () => {
  it('treats unchanged access with copy, version and same-origin path changes as safe', () => {
    const base = baseManifest()
    const result = classify({
      ...base,
      name: 'RepoLens Next',
      version: '0.2.0',
      description: 'Updated product copy',
      entry_url: 'https://modules.example/v2/embed',
      icon_url: 'https://modules.example/v2/icon.png',
    }, {
      candidateSourceUrl: 'https://modules.example/releases/stable.json',
    })

    expect(result).toMatchObject({
      outcome: 'safe',
      approvalReasons: [],
      rejectionReasons: [],
    })
  })

  it('treats match, context, field, capability and activation reductions as safe', () => {
    const base = baseManifest()
    const installed = {
      ...base,
      matches: [...base.matches, 'https://example.com/*'],
      contexts: [...base.contexts, 'page.metadata'] as RemoteFrameModuleManifest['contexts'],
      context_fields: {
        ...base.context_fields,
        'github.repository': ['repo', 'url', 'pageType'],
        'page.metadata': ['title'],
      },
      capabilities: ['tabs.open'] as RemoteFrameModuleManifest['capabilities'],
      activation: 'suggest' as const,
    }
    const result = classifyModuleUpdate({
      manifest: installed,
      sourceUrl: 'https://modules.example/.well-known/oneweb-module.json',
    }, candidate({
      ...base,
      context_fields: { 'github.repository': ['repo'] },
    }))

    expect(result.outcome).toBe('safe')
    expect(result.permissionDiff.matches.removed).toEqual(['https://example.com/*'])
    expect(result.permissionDiff.contexts.removed).toEqual(['page.metadata'])
    expect(result.permissionDiff.capabilities.removed).toEqual(['tabs.open'])
  })

  it('requires approval for every expanded-access dimension', () => {
    const base = baseManifest()
    const result = classify({
      ...base,
      matches: [...base.matches, 'https://example.com/*'],
      contexts: [...base.contexts, 'page.metadata'],
      context_fields: {
        ...base.context_fields,
        'page.metadata': ['title'],
      },
      capabilities: ['tabs.open'],
      activation: 'suggest',
    })

    expect(result.outcome).toBe('approval-required')
    expect(result.approvalReasons).toEqual([
      'match-pattern',
      'context',
      'context-field',
      'capability',
      'activation',
    ])
    expect(result.rejectionReasons).toEqual([])
  })

  it.each([
    ['manifest version', (manifest: RemoteFrameModuleManifest) => ({ ...manifest, manifest_version: 2 }), 'manifest-version'],
    ['module ID', (manifest: RemoteFrameModuleManifest) => ({ ...manifest, id: 'dev.evil.module' }), 'module-id'],
    ['runtime', (manifest: RemoteFrameModuleManifest) => ({
      ...manifest,
      runtime: 'builtin',
      icon_path: '/assets/evil.png',
      entry_id: 'evil-module',
    }), 'runtime'],
    ['entry origin', (manifest: RemoteFrameModuleManifest) => ({
      ...manifest,
      entry_url: 'https://evil.example/embed',
      icon_url: 'https://evil.example/icon.png',
    }), 'entry-origin'],
    ['bridge protocol', (manifest: RemoteFrameModuleManifest) => ({
      ...manifest,
      bridge: { protocol: 'evil.module', version: 2 },
    }), 'bridge-protocol'],
  ])('rejects an immutable %s change', (_label, mutate, reason) => {
    const result = classify(mutate(baseManifest()) as OneWebModuleManifest)

    expect(result.outcome).toBe('rejected')
    expect(result.rejectionReasons).toContain(reason)
  })

  it('rejects a candidate source-origin change', () => {
    const result = classify(baseManifest(), {
      candidateSourceUrl: 'https://evil.example/manifest.json',
    })

    expect(result.outcome).toBe('rejected')
    expect(result.rejectionReasons).toContain('source-origin')
  })

  it('derives approval status from classification and preserves approval only for expanded access', () => {
    const base = baseManifest()
    const safe = classify(base)
    const expanded = classify({ ...base, capabilities: ['tabs.open'] })
    const rejected = classify({ ...base, id: 'dev.evil.module' })
    const digest = 'a'.repeat(64)

    expect(expectedModuleUpdateApprovalStatus(safe, 'approved', digest, digest)).toBe('not-required')
    expect(expectedModuleUpdateApprovalStatus(expanded, 'rejected', digest, null)).toBe('pending')
    expect(expectedModuleUpdateApprovalStatus(expanded, 'approved', digest, digest)).toBe('approved')
    expect(expectedModuleUpdateApprovalStatus(expanded, 'approved', digest, 'b'.repeat(64))).toBe('pending')
    expect(expectedModuleUpdateApprovalStatus(rejected, 'approved', digest, digest)).toBe('rejected')
  })

  it('accepts only normalized lowercase SHA-256 digests', () => {
    expect(isNormalizedManifestDigest('a'.repeat(64))).toBe(true)
    expect(isNormalizedManifestDigest('A'.repeat(64))).toBe(false)
    expect(isNormalizedManifestDigest('a'.repeat(63))).toBe(false)
  })
})
