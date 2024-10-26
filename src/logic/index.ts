import type { BrowsingData, Management, Tabs } from 'webextension-polyfill'

export * from './storage'

/**
 * @deprecated 不推荐使用，还未开发完成
 * @description 切换到左边的标签页
 */
export function switchToLeftTab() {
  browser.tabs.query({ currentWindow: true }).then((tabs) => {
    const activeTabList: Tabs.Tab[] = []
    browser.tabs.query({ active: true })
      .then((tabs) => { activeTabList.push(...tabs) })
      .then(() => {
        if (activeTabList.length > 0) {
          browser.tabs.update(activeTabList[0].index - 1, { active: true })
        }
      })
  })
}

export function openOptionsPage() {
  browser.runtime.openOptionsPage()
}

export function cleanHistory(options: BrowsingData.RemovalOptions, dataToRemove: BrowsingData.DataTypeSet, callback: () => void) {
  if (Object.keys(options).length === 0) {
    const millisecondsPerWeek = 1000 * 60 * 60 * 24 * 7
    const oneWeekAgo = (new Date()).getTime() - millisecondsPerWeek
    options = {
      since: oneWeekAgo,
    }
  }
  if (Object.keys(dataToRemove).length === 0) {
    dataToRemove = {
      cache: true,
      cookies: true,
      downloads: true,
      formData: true,
      history: true,
      indexedDB: true,
      localStorage: true,
      passwords: true,
      serviceWorkers: true,
    }
  }
  browser.browsingData.remove(options, dataToRemove).then(callback)
}

export function setBadge({ text, color }: { text: string, color: string }) {
  chrome.action.setBadgeText({ text })
  chrome.action.setBadgeBackgroundColor({ color })
}

export function setSwitchBadge(switchValue: boolean) {
  chrome.action.setBadgeText({ text: switchValue ? 'ON' : 'OFF' })
  chrome.action.setBadgeTextColor({ color: switchValue ? '#ffffff' : '#333333' })
  chrome.action.setBadgeBackgroundColor({ color: switchValue ? '#4480f7' : '#bfbfbf' })
}

export function reloadThisExtension() {
  browser.runtime.reload()
}

/**
 * @deprecated 不推荐使用，还未开发完成
 * @description 重新加载所有未打包的扩展
 */
export function reloadExtensions() {
  // find all unpacked extensions and reload them
  browser.management.getAll().then(async (extensions) => {
    for (const ext of extensions) {
      if ((ext.installType === 'development')
        && (ext.enabled === true)
        && (ext.name !== 'Extensions Reloader')) {
        const extensionId = ext.id
        const extensionType = ext.type
        await browser.management.setEnabled(extensionId, false)
        await browser.management.setEnabled(extensionId, true)
        // re-launch packaged app
        if (extensionType === 'packaged_app' as Management.ExtensionType) {
          chrome.management.launchApp(extensionId)
        }
        console.log(`${ext.name} reloaded`)
      }
    }
  })
}
