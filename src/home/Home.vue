<script setup lang="ts">
import { switchToLeftTab } from '~/logic'

function openOptionsPage() {
  browser.runtime.openOptionsPage()
}
function reload() {
  browser.runtime.reload()
}
</script>

<template>
  <main>
    <div class="absolute top-4 left-1/2 transform -translate-x-1/2">
      <div class="flex">
        <Logo class="w10 mr-4" />
        <SharedSubtitle />
      </div>
      <div class="mt-2">
        <button class="btn mr-2" @click="switchToLeftTab">
          Go to left
        </button>
        <button class="btn" @click="reload">
          Reload
        </button>
      </div>
    </div>
    <iframe src="https://limestart.cn/" class="border-none w-100vw h-100vh" frameborder="0" />
  </main>
</template>
