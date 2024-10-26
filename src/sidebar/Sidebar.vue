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
    <div class="absolute left-1/2 top-4 transform -translate-x-1/2">
      <div class="flex">
        <Logo class="mr-4 w10" />
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
    <iframe src="https://limestart.cn/" class="h-100vh w-100vw border-none" frameborder="0" />
  </main>
</template>
