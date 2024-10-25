<script setup lang="ts">
import { clashSecret } from '~/logic';

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
    </div>
  </main>
</template>
