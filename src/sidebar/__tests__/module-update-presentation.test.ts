import { createRepoLensSeed } from '~/modules/seeds/repolens'
import type {
  InstalledModuleRecord,
  ModuleUpdateApprovalSnapshot,
  RemoteFrameModuleManifest,
} from '~/modules/types'
import {
  isRemotelyUpdateable,
  presentModuleUpdate,
} from '../module-update-presentation'

const sourceUrl = 'https://modules.example/.well-known/oneweb-module.json'
const digest = 'a'.repeat(64)

function manifest(): RemoteFrameModuleManifest {
  const value = createRepoLensSeed('https://modules.example').manifest
  if (value.runtime !== 'remote-frame')
    throw new Error('Expected remote frame fixture')
  return {
    ...value,
    id: 'dev.juck.update-view',
    name: 'Update view fixture',
    capabilities: ['tabs.open'],
  }
}

function recordWithCandidate(
  candidate: RemoteFrameModuleManifest,
  approvalSnapshot: ModuleUpdateApprovalSnapshot | null = null,
): InstalledModuleRecord {
  const installedManifest = manifest()
  return {
    manifest: installedManifest,
    enabled: true,
    source: 'user',
    sourceUrl,
    grantedContexts: ['github.repository'],
    grantedContextFields: { 'github.repository': ['repo'] },
    grantedCapabilities: ['tabs.open'],
    update: {
      candidateManifest: candidate,
      candidateSourceUrl: sourceUrl,
      normalizedManifestDigest: digest,
      checkedAt: '2026-08-27T09:00:00.000Z',
      approvalStatus: approvalSnapshot ? 'approved' : 'pending',
      approvedManifestDigest: approvalSnapshot ? digest : null,
      approvalSnapshot,
    },
    installedAt: '2026-08-27T08:00:00.000Z',
    updatedAt: '2026-08-27T08:00:00.000Z',
  }
}

describe('module update presentation', () => {
  it('presents safe copy and access reductions as directly applicable', () => {
    const installed = manifest()
    const record = recordWithCandidate({
      ...installed,
      version: '0.2.0',
      name: '<img src=x onerror=alert(1)>',
      description: 'Safer copy',
      capabilities: [],
    })

    expect(presentModuleUpdate(record)).toMatchObject({
      outcome: 'safe',
      state: 'safe',
      statusLabel: '安全更新',
      currentVersion: '0.1.0',
      candidateVersion: '0.2.0',
      copyChanges: [
        { field: 'name', next: '<img src=x onerror=alert(1)>' },
        { field: 'description', next: 'Safer copy' },
      ],
      removedCapabilities: ['打开新标签页'],
      canApprove: false,
      canApply: true,
    })
  })

  it('presents expanded access as candidate-wide review plus unselected fine-grained choices', () => {
    const installed = manifest()
    const record = recordWithCandidate({
      ...installed,
      version: '0.2.0',
      matches: [...installed.matches, 'https://example.com/*'],
      contexts: [...installed.contexts, 'page.metadata'],
      context_fields: {
        ...installed.context_fields,
        'page.metadata': ['title', 'description'],
      },
      capabilities: ['tabs.open', 'clipboard.write'],
      activation: 'suggest',
    })

    expect(presentModuleUpdate(record)).toMatchObject({
      outcome: 'approval-required',
      state: 'pending',
      addedMatches: ['https://example.com/*'],
      addedContexts: ['页面元数据'],
      activationChange: '手动启用 → 页面建议',
      contextFieldChoices: [
        { contextId: 'page.metadata', field: 'title', selected: false },
        { contextId: 'page.metadata', field: 'description', selected: false },
      ],
      capabilityChoices: [
        { capabilityId: 'clipboard.write', label: '写入剪贴板', selected: false },
      ],
      canApprove: true,
      canApply: false,
    })
  })

  it('restores only the approved fine-grained selections before explicit application', () => {
    const installed = manifest()
    const candidate: RemoteFrameModuleManifest = {
      ...installed,
      contexts: [...installed.contexts, 'page.metadata'],
      context_fields: {
        ...installed.context_fields,
        'page.metadata': ['title'],
      },
      capabilities: ['tabs.open', 'clipboard.write'],
    }
    const snapshot: ModuleUpdateApprovalSnapshot = {
      approvedManifestDigest: digest,
      approvedMatches: candidate.matches,
      approvedActivation: candidate.activation,
      approvedContextFields: { 'page.metadata': ['title'] },
      approvedCapabilities: [],
      approvedAt: '2026-08-27T10:00:00.000Z',
    }

    expect(presentModuleUpdate(recordWithCandidate(candidate, snapshot))).toMatchObject({
      state: 'approved',
      contextFieldChoices: [{ field: 'title', selected: true }],
      capabilityChoices: [{ capabilityId: 'clipboard.write', selected: false }],
      canApprove: false,
      canApply: true,
    })
  })

  it('shows only immutable-boundary diagnostics for a rejected candidate', () => {
    const installed = manifest()
    const record = recordWithCandidate({
      ...installed,
      id: 'dev.evil.replacement',
      entry_url: 'https://evil.example/embed',
      icon_url: 'https://evil.example/icon.png',
    })
    record.update!.candidateSourceUrl = 'https://evil.example/manifest.json'

    expect(presentModuleUpdate(record)).toMatchObject({
      state: 'rejected',
      rejectionReasons: [
        '模块 ID 发生变化',
        'Manifest 来源 origin 发生变化',
        '模块入口 origin 发生变化',
      ],
      canApprove: false,
      canApply: false,
    })
  })

  it('disables stale candidates until a fresh manual check and excludes seeded modules', () => {
    const record = recordWithCandidate({ ...manifest(), version: '0.2.0' })
    expect(presentModuleUpdate(record, digest)).toMatchObject({
      state: 'stale',
      requiresFreshCheck: true,
      canApprove: false,
      canApply: false,
    })
    expect(isRemotelyUpdateable(record)).toBe(true)
    expect(isRemotelyUpdateable({ ...record, source: 'seeded', sourceUrl: undefined })).toBe(false)
  })
})
