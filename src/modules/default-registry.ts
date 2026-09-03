import browser from 'webextension-polyfill'
import { createBookmarkDoctorSeed } from './builtin/bookmark-doctor/manifest'
import { createBrowserJournalSeed } from './builtin/browser-journal/manifest'
import { createClashControlSeed } from './builtin/clash-control/manifest'
import { createPageToolboxSeed } from './builtin/page-toolbox/manifest'
import { ModuleRegistry } from './registry'
import { createRepoLensSeed } from './seeds/repolens'

export const defaultModuleRegistry = new ModuleRegistry({
  storage: browser.storage.local,
  seeds: [
    createRepoLensSeed(),
    createBookmarkDoctorSeed(),
    createClashControlSeed(),
    createBrowserJournalSeed(),
    createPageToolboxSeed(),
  ],
})

export async function initializeDefaultModuleRegistry() {
  return defaultModuleRegistry.list()
}
