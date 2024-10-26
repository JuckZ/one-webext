<script setup lang="ts">
import { saveAs } from 'file-saver'
import JSZip from 'jszip'
import { clashSecret } from '~/logic'

const info = ref('')
const errorMsg = ref()

function test() {
  try {
    info.value = JSON.stringify(browser.webRequest.onHeadersReceived)
  }
  catch (e) {
    errorMsg.value = e
  }
}

const isDownloading = ref(false)
function downloadSourceCode() {
  isDownloading.value = true
  chrome.devtools.inspectedWindow.getResources(
    (resources) => {
      let c = 0
      const zip = new JSZip()
      const total = resources.length
      for (const resource of resources) {
        resource.getContent((content, encoding) => {
          zip.file(resource.url, content, { base64: encoding === 'base64' })
          c = c + 1
          if (c === total) {
            zip.generateAsync({ type: 'blob' })
              .then((zipContent) => {
                saveAs(zipContent, 'sources.zip')
              })
            isDownloading.value = false
          }
        })
      }
    },
  )
}

onMounted(() => {

})
</script>

<template>
  <main class="h-[800px] w-[400px] px-4 py-5 text-center text-gray-700">
    <Logo />

    <SharedSubtitle />

    <div>{{ info }} </div>
    <div text-red>
      {{ errorMsg }}
    </div>

    <input v-model="clashSecret" class="mt-2 border border-gray-400 rounded px-2 py-1">

    <div>
      <button class="btn mr-2 mt-2" @click="test">
        Test
      </button>
      <button :disabled="isDownloading" class="btn mr-2 mt-2" @click="downloadSourceCode">
        Download sourcecode
      </button>
    </div>
  </main>
</template>
