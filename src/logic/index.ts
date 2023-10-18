import type { BrowsingData } from 'webextension-polyfill';
export * from './storage';

export function switchToLeftTab() {
  console.error(browser, browser.tabs);
  browser.tabs.query({ currentWindow: true }).then((tabs) => {
    const activeTab = null;
    browser.tabs.query({ active: true })
      .then((tab) => { console.error(tab); });
    console.error(activeTab);
    // if (activeTab && activeTab.index > 0)
    //   browser.tabs.update(activeTab.index - 1, { active: true })
  });
}

export function cleanHistory(options: BrowsingData.RemovalOptions, dataToRemove: BrowsingData.DataTypeSet, callback: () => void) {
  if (Object.keys(options).length === 0) {
    const millisecondsPerWeek = 1000 * 60 * 60 * 24 * 7;
    const oneWeekAgo = (new Date()).getTime() - millisecondsPerWeek;
    options = {
      since: oneWeekAgo,
    };
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
    };
  }
  browser.browsingData.remove(options, dataToRemove).then(callback);
}
