import { createGitHubRouteObserver } from '~/repolens/github-route-observer'
import type { GitHubContextMessage } from '~/repolens/protocol'

if (window.top === window) {
  createGitHubRouteObserver({
    window,
    emit: async (context) => {
      const message: GitHubContextMessage = {
        channel: 'repolens.extension',
        version: 1,
        type: 'GITHUB_CONTEXT',
        context,
      }
      await browser.runtime.sendMessage(message)
    },
  })
}
