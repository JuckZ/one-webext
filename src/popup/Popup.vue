<script setup lang="ts">
import { storageDemo, switchToLeftTab } from '~/logic'

function openOptionsPage() {
  browser.runtime.openOptionsPage()
}
function reload() {
  browser.runtime.reload()
}
</script>

<template>
  <main class="w-[300px] px-4 py-5 text-center text-gray-700">
    <Logo />

    <SharedSubtitle />

    <div>
      <button class="btn mt-2 mr-2" @click="switchToLeftTab">
        Go to left
      </button>
      <button class="btn mt-2" @click="reload">
        Reload
      </button>
    </div>

    <button class="btn mt-2" @click="openOptionsPage">
      Open Options
    </button>
    <div class="mt-2">
      <span class="opacity-50">Storage:</span> {{ storageDemo }}
    </div>
  </main>
</template>
