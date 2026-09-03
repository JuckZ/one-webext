export const PAGE_TOOLBOX_CONTENT_SCRIPT_FILE = '/dist/pageToolbox/index.global.js' as const

export interface PageToolboxScriptingApi {
  executeScript: (_injection: {
    target: { tabId: number, frameIds: [0] }
    files: [typeof PAGE_TOOLBOX_CONTENT_SCRIPT_FILE]
  }) => Promise<unknown>
}

export interface PageToolboxInjectionBoundary {
  inject: (_tabId: number) => Promise<void>
}

export function createPageToolboxInjectionAdapter(
  scripting: PageToolboxScriptingApi,
): PageToolboxInjectionBoundary {
  return Object.freeze({
    async inject(tabId: number) {
      if (!Number.isSafeInteger(tabId) || tabId < 0)
        throw new TypeError('Page Toolbox injection requires a valid tab ID')
      await scripting.executeScript({
        target: { tabId, frameIds: [0] },
        files: [PAGE_TOOLBOX_CONTENT_SCRIPT_FILE],
      })
    },
  })
}
