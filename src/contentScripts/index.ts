import type { ContextProviderUpdateMessage } from '~/modules/context-protocol'
import { createGitHubRepositoryObserver } from '~/modules/providers/github-repository-observer'

if (window.top === window) {
  createGitHubRepositoryObserver({
    window,
    emit: async (context) => {
      const message: ContextProviderUpdateMessage = {
        channel: 'oneweb.context',
        version: 1,
        type: 'CONTEXT_PROVIDER_UPDATE',
        contextId: 'github.repository',
        value: context,
      }
      await browser.runtime.sendMessage(message)
    },
  })
}
