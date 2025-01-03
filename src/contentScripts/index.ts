import { createApp } from 'vue'
import { onMessage } from 'webext-bridge/content-script'
import { setupApp } from '~/logic/common-setup'
import App from './views/App.vue'

// Firefox `browser.tabs.executeScript()` requires scripts return a primitive value
(() => {
  // TODO 需要在用户点击插件图标时，探测页面中的 content_scripts 是否存在（发送消息是否有响应/出错），再提示用户刷新页面，或者执行如下脚本，或者弹窗让用户确认后执行如下脚本
  // browser.tabs.executeScript({
  //   file: 'content.js',
  // })
  log.info(`Hello world from content script`)

  // communication example: send previous tab title from background page
  onMessage('tab-prev', ({ data }) => {
    log.info(`Navigate from page "${data.title}"`)
  })

  onMessage('console-log', ({ data }) => {
    log.info(`background: ${data.message}`)
  })

  // mount component to context window
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
})()
