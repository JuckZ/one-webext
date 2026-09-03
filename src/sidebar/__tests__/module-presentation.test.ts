import { createRepoLensSeed } from '~/modules/seeds/repolens'
import type { InstalledModuleRecord } from '~/modules/types'
import { presentModuleAccess } from '../module-presentation'

function repoLensRecord(): InstalledModuleRecord {
  const seed = createRepoLensSeed('https://repolens.example')
  return {
    manifest: {
      ...seed.manifest,
      capabilities: ['tabs.open', 'clipboard.write'],
    },
    enabled: true,
    source: 'user',
    sourceUrl: 'https://repolens.example/.well-known/oneweb-module.json',
    grantedContexts: ['github.repository'],
    grantedContextFields: { 'github.repository': ['repo'] },
    grantedCapabilities: ['tabs.open'],
    update: null,
    installedAt: '2026-08-27T00:00:00.000Z',
    updatedAt: '2026-08-27T00:00:00.000Z',
  }
}

describe('module access presentation', () => {
  it('keeps requested and granted access visibly separate', () => {
    const access = presentModuleAccess(repoLensRecord())

    expect(access).toEqual({
      source: '用户添加',
      runtime: '沙箱网页模块',
      origin: 'https://repolens.example',
      requestedContexts: ['GitHub 仓库：repo、url、pageType'],
      grantedContexts: ['GitHub 仓库：repo'],
      requestedCapabilities: ['打开新标签页', '写入剪贴板'],
      grantedCapabilities: ['打开新标签页'],
    })
  })
})
