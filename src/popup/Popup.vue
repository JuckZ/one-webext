<script setup lang="ts">
import {
  Filter,
  Switch,
} from '@element-plus/icons-vue'
import axios from 'axios'
import { clashHost, clashPort, clashSecret, switchToLeftTab } from '~/logic'

const info = ref('')
const currentSelector = ref('')
const currentProxy = ref('')
const proxies = ref([])
const selectorList = ref([])
const proxyList = ref([])
function openOptionsPage() {
  browser.runtime.openOptionsPage()
}
function reload() {
  browser.runtime.reload()
}

function loadClashConfig(clashHost: string, clashPort: string, clashSecret: string) {
  const url = `http://${clashHost}:${clashPort}/proxies`
  return axios.get(url, {
    headers: {
      Authorization: `Bearer ${clashSecret}`,
    },
  })
}

function changeSelector(selectorName: string) {
  proxyList.value = proxies.value[selectorName].all
}

function changeProxy() {
  const url = `http://${clashHost.value}:${clashPort.value}/proxies/${encodeURIComponent(currentSelector.value)}`
  return axios.put(
    url,
    {
      name: currentProxy.value,
    },
    {
      headers: {
        Authorization: `Bearer ${clashSecret.value}`,
      },
    },
  ).then((res) => {
    console.error(res)
  }).catch((err) => {
    console.error(err)
  })
}

// TODO 优化，为什么同样在onMounted中写如下逻辑，dev可以获取到clashSecret的值，但是build之后就获取不到了
watch(clashSecret, async (newValue, oldValue) => {
  if (newValue) {
    initialClash(clashHost.value, clashPort.value, clashSecret.value)
  }
})

function initialClash(clashHost: string, clashPort: string, clashSecret: string) {
  console.error(clashHost, clashPort, clashSecret)
  loadClashConfig(clashHost, clashPort, clashSecret).then((res) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    proxies.value = (res.data as any).proxies
    Object.keys(proxies.value).forEach((key) => {
      const item = proxies.value[key]
      if (item.type === 'Selector') {
        selectorList.value.push(item)
      }
    })
    info.value = `当前节点数${proxies.value.GLOBAL.all.length}个`
  }).catch((err) => {
    console.error(JSON.stringify(err))
    info.value = 'Clash未正确配置，配置一般在~/.config/clash/config.yaml中'
  })
}

onMounted(() => {
  if (clashSecret.value) {
    initialClash(clashHost.value, clashPort.value, clashSecret.value)
  } else {
    // TODO 提示用户配置clash
  }
})
</script>

<template>
  <main class="h-[800px] w-[400px] px-4 py-5 text-center text-gray-700">
    <Logo />

    <SharedSubtitle />

    <div>{{ info }} </div>

    <el-select
      v-model="currentSelector"
      class="m-2"
      placeholder="Select"
      @change="changeSelector"
    >
      <template #prefix>
        <el-icon>
          <Filter />
        </el-icon>
      </template>
      <el-option
        v-for="selector in selectorList"
        :key="selector.name"
        :label="selector.name"
        :value="selector.name"
      />
    </el-select>

    <el-select
      v-model="currentProxy"
      class="m-2"
      placeholder="Select"
      @change="changeProxy"
    >
      <template #prefix>
        <el-icon>
          <Switch />
        </el-icon>
      </template>
      <el-option
        v-for="proxy in proxyList"
        :key="proxy"
        :label="proxy"
        :value="proxy"
      />
    </el-select>

    <input
      v-model="clashSecret"
      class="mt-2 border border-gray-400 rounded px-2 py-1"
    >

    <div>
      <button
        class="btn mr-2 mt-2"
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
