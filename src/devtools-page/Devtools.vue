<script setup lang="ts">
import axios from 'axios';
import {
  Filter,
  Switch,
} from '@element-plus/icons-vue';
import {clashSecret, switchToLeftTab } from '~/logic';

const info = ref('');
const currentSelector = ref('');
const currentProxy = ref('');
const proxies = ref([]);
const selectorList = ref([]);
const proxyList = ref([]);
function openOptionsPage() {
  browser.runtime.openOptionsPage();
}
function reload() {
  browser.runtime.reload();
}

onMounted(() => {
  



// browser.runtime.onInstalled.addListener((): void => {
//   // eslint-disable-next-line no-console
//   console.log('Extension installed');
//   browser.contextMenus.create({
//     id: 'openSidePanel',
//     title: 'Open side panel',
//     contexts: ['all'],
//   });
// });

// let previousTabId = 0;

// console.log('chrome', chrome, chrome.devtools);
// chrome.devtools.panels.create("Font Picker",
//   "FontPicker.png",
//   "Panel.html",
//   function(panel: any) {
//     console.log('panel', panel);
//   });

// console.error('onHeadersReceived');
// browser.webRequest.onHeadersReceived.addListener(
//   function(details) {
//     console.error('deaseasf');
//     let requestHeaderValue = null;
//     // 获取请求头中的某个字段
//     browser.webRequest.onBeforeSendHeaders.addListener(
//       function(details) {
//         const requestHeaders = details.requestHeaders;
//         console.error(JSON.stringify(requestHeaders));
//         if (!requestHeaders)
//           return;
//         for (const header of requestHeaders) {
//           if (header.name.toLowerCase() === 'example-header') {
//             requestHeaderValue = header.value;
//             break;
//           }
//         }
//         requestHeaders.push({ name: 'bbb', value: 'juck' || '111' });

//       },
//       { urls: ['<all_urls>'] },
//       ['requestHeaders']
//     );

//     // 修改响应头
//     const responseHeaders = details.responseHeaders;
//     if (!responseHeaders)
//       return;
//     responseHeaders.push({ name: 'aaa', value: requestHeaderValue || '111' });
//     return { responseHeaders };
//   },
//   {urls: ['<all_urls>']},
//   ['blocking', 'responseHeaders']
// );
});
</script>

<template>
  <main class="w-[400px] h-[800px] px-4 py-5 text-center text-gray-700">
    <Logo />

    <SharedSubtitle />

    <div>{{ info }} </div>

    <input
      v-model="clashSecret"
      class="border border-gray-400 rounded px-2 py-1 mt-2"
    >

    <div>
      <button
        class="btn mt-2 mr-2"
        @click="switchToLeftTab"
      >
        Go to left
      </button>
      <button
        class="btn mt-2"
        @click="reload"
      >
        Reload
      </button>
    </div>

    <button
      class="btn mt-2"
      @click="openOptionsPage"
    >
      Open Options
    </button>
  </main>
</template>
