import { createApp } from 'vue'
import { onMessage } from 'webext-bridge/content-script'
import { setupApp } from '~/logic/common-setup'
import App from './views/App.vue'

function mountContentScript() {
  if (document.getElementById(__NAME__))
    return

  log.info('Hello world from content script')

  onMessage('tab-prev', ({ data }) => {
    log.info(`Navigate from page "${data.title}"`)
  })

  onMessage('console-log', ({ data }) => {
    log.info(`background: ${data.message}`)
  })

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

  const app = createApp(App)
  setupApp(app)
  app.mount(root)
}

mountContentScript()
