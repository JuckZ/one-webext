<script setup lang="ts">
import { clashSecret } from '~/logic';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';

const info = ref('');
const errorMsg = ref();

const test = () => {
  try {
    info.value = JSON.stringify(browser.webRequest.onHeadersReceived);
  }
  catch (e) {
    errorMsg.value = e;
  }
};

const isDownloading = ref(false);
const downloadSourceCode = () => {
  isDownloading.value = true;
  chrome.devtools.inspectedWindow.getResources(
        (resources) => {
            var c = 0;
            var zip = new JSZip();
            const total = resources.length;
            for (const resource of resources) {                
                resource.getContent((content, encoding)=> {
                    zip.file(resource.url, content, {base64: encoding == 'base64'});
                    c = c + 1;
                    if (c == total){
                        zip.generateAsync({type:"blob"})
                        .then(function(zipContent) {                    
                            saveAs(zipContent, "sources.zip");
                        });
                        isDownloading.value = false;
                    }
                });
            }
        }
    )
};

onMounted(() => {
  
});
</script>

<template>
  <main class="w-[400px] h-[800px] px-4 py-5 text-center text-gray-700">
    <Logo />

    <SharedSubtitle />

    <div>{{ info }} </div>
    <div text-red>{{ errorMsg }} </div>

    <input v-model="clashSecret" class="border border-gray-400 rounded px-2 py-1 mt-2">

    <div>
      <button class="btn mt-2 mr-2" @click="test">
        Test
      </button>
      <button :disabled="isDownloading" class="btn mt-2 mr-2" @click="downloadSourceCode">
        Download sourcecode
      </button>
    </div>
  </main>
</template>
