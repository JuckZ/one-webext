import { createApp } from 'vue'
import { onMessage } from 'webext-bridge/content-script'
import { setupApp } from '~/logic/common-setup'
import { mountContentScriptOnce } from './mount-sentinel'
import App from './views/App.vue'

/**
 * Mounts the content script application and registers its message handlers.
 */
function mountContentScript() {
  mountContentScriptOnce((registerCleanup) => {
    log.info('Hello world from content script')

    registerCleanup(onMessage('tab-prev', ({ data }) => {
      log.info(`Navigate from page "${data.title}"`)
    }))

    registerCleanup(onMessage('console-log', ({ data }) => {
      log.info(`background: ${data.message}`)
    }))

    const container = document.createElement('div')
    container.id = __NAME__

    const root = document.createElement('div')
    const styleEl = document.createElement('link')
    const shadowDOM = container.attachShadow?.({ mode: __DEV__ ? 'open' : 'closed' }) || container

    styleEl.setAttribute('rel', 'stylesheet')
    styleEl.setAttribute('href', browser.runtime.getURL('dist/contentScripts/style.css'))
    shadowDOM.appendChild(styleEl)
    shadowDOM.appendChild(root)
    document.body.appendChild(container)
    registerCleanup(() => container.remove())

    const app = createApp(App)
    setupApp(app)
    app.mount(root)
    registerCleanup(() => app.unmount())
  })
}

mountContentScript()
