import type { Tabs } from 'webextension-polyfill'
import { onMessage, sendMessage } from 'webext-bridge/background'
import { reloadThisExtension, setBadge, switchToLeftTab } from '~/logic'

// only on dev mode
if (import.meta.hot) {
  // @ts-expect-error for background HMR

  import('/@vite/client')
  // load latest content script
  import('./contentScriptHMR')
}

// remove or turn this off if you don't use side panel
// const USE_SIDE_PANEL = true

// to toggle the sidepanel with the action button in chromium:
// if (USE_SIDE_PANEL) {
//   // @ts-expect-error missing types
//   browser.sidePanel
//     .setPanelBehavior({ openPanelOnActionClick: true })
//     .catch((error: unknown) => console.error(error))
// }

let tabId = 0

function consoleLog(message: string) {
  sendMessage('console-log', { message }, { context: 'content-script', tabId })
}

browser.runtime.onInstalled.addListener((): void => {
  updateRules()

  console.log('Extension installed')
  browser.contextMenus.create({
    id: 'openSidePanel',
    title: 'Open side panel',
    contexts: ['all'],
  })

  browser.contextMenus.create({
    id: 'reloadThisExtension',
    title: 'Reload this extension',
    contexts: ['all'],
  })

  browser.contextMenus.create({
    id: 'wsInspector',
    title: 'WebSocket Inspector',
    contexts: ['all'],
  })

  // browser.devtools.panels.create('test', '', 'xx.html').then((panel) => {
  //   console.log('panel', panel);
  // });
})

// on activate plugin, update rules.
browser.runtime.onStartup.addListener(() => {
  updateRules()
  console.log('Extension started.')
})

// on update plugin, update rules.
browser.runtime.onUpdateAvailable.addListener(() => {
  updateRules()
  console.log('Extension updated.')
})

let previousTabId = 0

const GOOGLE_ORIGIN = 'https://google.com'
browser.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (!tab.url)
    return
  const url = new URL(tab.url)
  if (url.origin === GOOGLE_ORIGIN) {
    browser.sidePanel.setOptions({
      tabId,
      enabled: false,
    })
  }
  else {
    browser.sidePanel.setOptions({
      tabId,
      path: './dist/sidebar/index.html',
      enabled: true,
    })
  }
})

/**
 * manifest.json 中 action 的点击事件，没有default_popup时，点击时会触发
 */
chrome.action.onClicked.addListener(() => {
  console.log('onClicked')
  consoleLog('onClicked')
})

// communication example: send previous tab title from background page
// see shim.d.ts for type declaration
browser.tabs.onActivated.addListener(async ({ tabId }) => {
  if (!previousTabId) {
    previousTabId = tabId
    return
  }

  let tab: Tabs.Tab

  try {
    tab = await browser.tabs.get(previousTabId)
    previousTabId = tabId
  }
  catch {
    return
  }

  console.log('previous tab', tab)
  sendMessage('tab-prev', { title: tab.title }, { context: 'content-script', tabId })
})

browser.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'openSidePanel') {
    // This will open the panel in all the pages on the current window.
    browser.sidePanel.open({ tabId: tab?.id })
  }
  if (info.menuItemId === 'reloadThisExtension') {
    setBadge({ text: 'OK', color: '#4cb749' })
    setTimeout(() => {
      reloadThisExtension()
    }, 200)
  }

  if (info.menuItemId === 'wsInspector') {
    tabId = tab?.id || 0
    startDebugging()
  }
})

// browser.webRequest.onHeadersReceived.addListener(
//   function (details) {
//     let requestHeaderValue = null;
//     // chrome.declarativeWebRequest.onRequest.addListener(() => {
//     //   console.log(123)
//     // })
//     // 获取请求头中的某个字段
//     chrome.webRequest.onBeforeSendHeaders.addListener(
//       (details) => {
//         const requestHeaders = details.requestHeaders;
//         console.error(JSON.stringify(requestHeaders));
//         if (!requestHeaders)
//           return;
//         for (const header of requestHeaders) {
//           if (header.name.toLowerCase() === 'example-header') {
//             requestHeaderValue = header.value;
//             break;
//           }
//         }
//         requestHeaders.push({ name: 'bbb', value: 'juck' || '111' });
//         return undefined;
//       },
//       { urls: ['<all_urls>'] },
//       ['requestHeaders']
//     );

//     // 修改响应头
//     const responseHeaders = details.responseHeaders;
//     if (!responseHeaders)
//       return;
//     responseHeaders.push({ name: 'aaa', value: requestHeaderValue || '111' });
//     return { responseHeaders };
//   },
//   { urls: ['<all_urls>'] },
//   ['blocking', 'responseHeaders']
// );

browser.commands.onCommand.addListener((command, tab) => {
  if (command === 'switchToLeftTab') {
    switchToLeftTab()
  }
  if (command === 'reloadThisExtension') {
    setBadge({ text: 'OK', color: '#4cb749' })
    setTimeout(() => {
      reloadThisExtension()
    }, 200)
  }
  if (command === 'openDevtools') {
    setBadge({ text: 'Dev', color: '#4cb749' })
    setTimeout(() => {
      chrome.runtime.openOptionsPage()
    }, 200)
  }
  if (command === 'wsInspector') {
    setBadge({ text: 'WS', color: '#4cb749' })
    setTimeout(() => {
      // tabId更新
      tabId = tab?.id || 0
      startDebugging()
    }, 200)
  }
})

chrome.debugger.onEvent.addListener((debuggee, message, params) => {
  console.log(debuggee, message, params)
  sendMessage('on-bg-event', { message, params: JSON.stringify(params) }, { context: 'content-script', tabId: debuggee.tabId! })
})

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log(message)
  if (message.type === 'updateRules') {
    updateRules(JSON.parse(message.customHeaders))
  }
  if (message.message === 'reattach' && message.tabId === tabId) {
    startDebugging()
  }
})

onMessage('get-current-tab', async () => {
  try {
    const tab = await browser.tabs.get(previousTabId)
    return {
      title: tab?.title,
    }
  }
  catch {
    return {
      title: undefined,
    }
  }
})

function updateRules(customHeaders?: string) {
  console.log('Updating rules...')

  browser.storage.sync.get(['customHeaders', 'disablePlugin']).then((data) => {
    try {
      // Check if the plugin is disabled.
      if (data.disablePlugin) {
        chrome.declarativeNetRequest.updateDynamicRules({
          removeRuleIds: [1], // Ensure this matches the IDs you intend to remove
          addRules: [],
        }, () => {
          if (chrome.runtime.lastError) {
            console.error('Error updating rules:', chrome.runtime.lastError)
          }
          else {
            console.log('Rules updated successfully.')
          }
        })

        // set icon to disabled.
        chrome.action.setIcon({ path: 'icons/icon-disabled48.png' })
      }
      else {
        // Create headers array.
        const headers = [{
          name: 'example-header',
          value: 'example-value',
          enabled: true,
        }]
        const requestHeaders = headers
          .filter(header => header.enabled)
          .map(header => ({ header: header.name.trim(), operation: 'set', value: header.value }))

        console.log(requestHeaders)

        // Clear existing rules and set new ones.
        chrome.declarativeNetRequest.updateDynamicRules({
          removeRuleIds: [1], // Ensure this matches the IDs you intend to remove
          addRules: requestHeaders.length
            ? [{
                id: 1,
                priority: 1,
                action: {
                  type: chrome.declarativeNetRequest.RuleActionType.MODIFY_HEADERS,
                  requestHeaders: requestHeaders as any,
                },
                condition: {
                  urlFilter: '|http*://*/*', // Matches all HTTP and HTTPS URLs
                  resourceTypes: [chrome.declarativeNetRequest.ResourceType.MAIN_FRAME, chrome.declarativeNetRequest.ResourceType.SUB_FRAME, chrome.declarativeNetRequest.ResourceType.XMLHTTPREQUEST],
                },
              }]
            : [],
        }, () => {
          if (chrome.runtime.lastError) {
            console.error(`Error updating rules:${chrome.runtime.lastError}`)
          }
          else {
            console.log('Rules updated successfully.')
          }
        })
      }
    }
    catch (error) {
      console.error('Error parsing custom headers:', error)
    }
  })
}

function startDebugging() {
  chrome.debugger.attach({ tabId }, '1.2', () => {
    if (chrome.runtime.lastError) {
      console.error('附加调试器失败:', chrome.runtime.lastError.message)
      consoleLog(`附加调试器失败:${chrome.runtime.lastError.message}`)
      return
    }

    console.log('调试器已成功附加')

    chrome.debugger.sendCommand({ tabId }, 'Network.enable', null, () => {
      if (chrome.runtime.lastError) {
        console.error('启用网络功能失败:', chrome.runtime.lastError.message)
        consoleLog(`启用网络功能失败:${chrome.runtime.lastError.message}`)
      }
      else {
        console.log('网络功能已启用')
        consoleLog('网络功能已启用')
      }
    })
  })

  chrome.tabs.get(tabId, (tab) => {
    console.log('当前标签页信息:', tab)
    consoleLog(`当前标签页信息:${JSON.stringify(tab)}`)
  })
}
