import type {
  InstalledModuleRecord,
  ModuleCapabilityId,
  ModuleContextId,
  OneWebModuleManifest,
} from '~/modules/types'

const contextLabels: Record<ModuleContextId, string> = {
  'tab.basic': '当前标签页',
  'github.repository': 'GitHub 仓库',
  'page.selection': '页面选区',
  'page.metadata': '页面元数据',
}

const capabilityLabels: Record<ModuleCapabilityId, string> = {
  'tabs.open': '打开新标签页',
  'storage.module': '模块独立存储',
  'bookmarks.read': '只读访问书签',
  'bookmarks.write': '审查后修改书签',
  'clash.status.read': '读取本地 Clash 状态',
  'resources.openlist.submit': '提交资源到 OpenList/AList',
  'clipboard.write': '写入剪贴板',
  'downloads.create': '创建下载',
  'notifications.show': '显示通知',
  'auth.start': '启动登录流程',
}

export function presentModuleContext(contextId: ModuleContextId) {
  return contextLabels[contextId]
}

export function presentModuleCapability(capabilityId: ModuleCapabilityId) {
  return capabilityLabels[capabilityId]
}

export interface ModuleAccessPresentation {
  source: string
  runtime: string
  origin: string
  requestedContexts: string[]
  grantedContexts: string[]
  requestedCapabilities: string[]
  grantedCapabilities: string[]
}

export interface ModuleRequestedAccessPresentation {
  runtime: string
  origin: string
  contexts: string[]
  capabilities: string[]
}

function contextAccess(contextId: ModuleContextId, fields: string[]) {
  return `${presentModuleContext(contextId)}：${fields.join('、')}`
}

export function presentRequestedModuleAccess(manifest: OneWebModuleManifest): ModuleRequestedAccessPresentation {
  return {
    runtime: manifest.runtime === 'remote-frame' ? '沙箱网页模块' : 'OneWeb 内置模块',
    origin: manifest.runtime === 'remote-frame' ? new URL(manifest.entry_url).origin : 'OneWeb 扩展包',
    contexts: manifest.contexts.map(contextId => contextAccess(
      contextId,
      manifest.context_fields[contextId] || [],
    )),
    capabilities: manifest.capabilities.map(presentModuleCapability),
  }
}

export function presentModuleAccess(record: InstalledModuleRecord): ModuleAccessPresentation {
  const requested = presentRequestedModuleAccess(record.manifest)
  const grantedContexts = record.grantedContexts.map(contextId => contextAccess(
    contextId,
    record.grantedContextFields[contextId] || [],
  ))

  return {
    source: record.source === 'seeded' ? 'OneWeb 预置' : '用户添加',
    runtime: requested.runtime,
    origin: requested.origin,
    requestedContexts: requested.contexts,
    grantedContexts,
    requestedCapabilities: requested.capabilities,
    grantedCapabilities: record.grantedCapabilities.map(presentModuleCapability),
  }
}
