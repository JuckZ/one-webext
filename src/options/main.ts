import { createApp } from 'vue';
import myComponents from '../component';
import myDirectives from '../directives';
import App from './Options.vue';
import { setupApp } from '~/logic/common-setup';
import '../styles';

const app = createApp(App);
app.use(myComponents);
app.use(myDirectives);
setupApp(app);

app.mount('#app');
