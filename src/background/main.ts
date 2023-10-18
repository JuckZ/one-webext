import { onMessage, sendMessage } from 'webext-bridge/background';
import type { Tabs } from 'webextension-polyfill';
import { switchToLeftTab } from '~/logic';

// only on dev mode
if (import.meta.hot) {
  // @ts-expect-error for background HMR
  // eslint-disable-next-line import/no-unresolved
  import('/@vite/client');
  // load latest content script
  import('./contentScriptHMR');
}

browser.runtime.onInstalled.addListener((): void => {
  // eslint-disable-next-line no-console
  console.log('Extension installed');
  browser.contextMenus.create({
    id: 'openSidePanel',
    title: 'Open side panel',
    contexts: ['all'],
  });
});

let previousTabId = 0;

const GOOGLE_ORIGIN = 'https://google.com';
browser.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (!tab.url)
    return;
  const url = new URL(tab.url);
  if (url.origin === GOOGLE_ORIGIN) {
    await browser.sidePanel.setOptions({
      tabId,
      enabled: false,
    });
  }
  else {
    await browser.sidePanel.setOptions({
      tabId,
      path: './dist/sidebar/index.html',
      enabled: true,
    });
  }
});

// communication example: send previous tab title from background page
// see shim.d.ts for type declaration
browser.tabs.onActivated.addListener(async ({ tabId }) => {
  if (!previousTabId) {
    previousTabId = tabId;
    return;
  }

  let tab: Tabs.Tab;

  try {
    tab = await browser.tabs.get(previousTabId);
    previousTabId = tabId;
  }
  catch {
    return;
  }

  // eslint-disable-next-line no-console
  console.log('previous tab', tab);
  sendMessage('tab-prev', { title: tab.title }, { context: 'content-script', tabId });
});

browser.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'openSidePanel') {
    // This will open the panel in all the pages on the current window.
    browser.sidePanel.open({ tabId: tab.id });
  }
});

browser.commands.onCommand.addListener((command) => {
  if (command === 'switchToLeftTab')
    switchToLeftTab();
});

onMessage('get-current-tab', async () => {
  try {
    const tab = await browser.tabs.get(previousTabId);
    return {
      title: tab?.title,
    };
  }
  catch {
    return {
      title: undefined,
    };
  }
});
