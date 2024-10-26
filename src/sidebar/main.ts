import { createApp } from 'vue'
import { setupApp } from '~/logic/common-setup'
import App from './Sidebar.vue'
import '../styles'

const app = createApp(App)
setupApp(app)
app.mount('#app')
