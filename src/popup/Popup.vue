<script setup lang="ts">
import axios from 'axios';
import { clashHost, clashPort, clashSecret, switchToLeftTab } from '~/logic';

const info = ref('');
const currentProxy = ref('');
const proxies = ref([]);
function openOptionsPage() {
  browser.runtime.openOptionsPage();
}
function reload() {
  browser.runtime.reload();
}

function loadClashConfig() {
  const url = `http://${clashHost.value}:${clashPort.value}/proxies`;
  return axios.get(url, {
    headers: {
      Authorization: `Bearer ${clashSecret.value}`,
    },
  });
}

// TODO 优化，为什么同样在onMounted中写如下逻辑，dev可以获取到clashSecret的值，但是build之后就获取不到了
watch(clashSecret, async (newValue, oldValue) => {
  if (newValue) {
    loadClashConfig().then((res) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
      proxies.value = (res.data as any).proxies.GLOBAL.all;
    }).catch((err) => {
      console.error(JSON.stringify(err));
      info.value = 'Clash未正确配置，配置一般在~/.config/clash/config.yaml中';
    });
  } else {
    info.value = 'Clash未配置，配置一般在~/.config/clash/config.yaml中';
  }
});


onMounted(() => {
});
</script>

<template>
  <main class="w-[400px] h-[800px] px-4 py-5 text-center text-gray-700">
    <Logo />

    <SharedSubtitle />

    <div>{{ info }} </div>

    <el-select
      v-model="currentProxy"
      class="m-2"
      placeholder="Select"
    >
      <el-option
        v-for="item in proxies"
        :key="item"
        :label="item"
        :value="item"
      />
    </el-select>

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
    <div class="mt-2">
      <div class="opacity-50">
        storageDemo: {{ storageDemo }}
      </div> {{ storageDemo }}
      <div class="opacity-50">
        clashHost: {{ clashHost }}
      </div> {{ storageDemo }}
      <div class="opacity-50">
        clashPort: {{ clashPort }}
      </div> {{ storageDemo }}
      <div class="opacity-50">
        clashSecret: {{ clashSecret }}
      </div> {{ storageDemo }}
    </div>
  </main>
</template>
