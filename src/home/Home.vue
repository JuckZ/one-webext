<script setup lang="ts">
import {
  Delete,
  Edit,
  More,
  Search,
  Star,
} from '@element-plus/icons-vue'
import type { History, Sessions } from 'webextension-polyfill'
import type { TabsPaneContext } from 'element-plus'
import { switchToLeftTab } from '~/logic'
import native from '~/utils/native'
import type { Bookmark } from '~/interface'

const searchKeyword = ref('')
const searchEngine = ref('1')
const activeName = ref('first')

const handleClick = (tab: TabsPaneContext, event: Event) => {
  console.error(tab, event)
}
const recentlyClosedTabs: Sessions.Session[] = ref<Tab[]>([])
const historyList: History.HistoryItem[] = ref<Tab[]>([])
const bookmarks: History.HistoryItem[] = ref<Tab[]>([])

function openOptionsPage() {
  browser.runtime.openOptionsPage()
}
function reload() {
  browser.runtime.reload()
}
function goTo(url: string) {
  browser.tabs.create({ url })
}
async function getHistoryList() {
  return browser.history.search({ text: '', maxResults: 20 })
}
async function getRecentlyClosedTabs() {
  return browser.sessions.getRecentlyClosed()
}
function rmRecently(session: Sessions.Session) {
  browser.sessions.forgetClosedTab(session.tab.windowId, session.tab.sessionId).then(async () => {
    recentlyClosedTabs.value = await getRecentlyClosedTabs()
  })
}
function rmHistory(history: History.HistoryItem) {
  browser.history.deleteUrl({ url: history.url }).then(async () => {
    historyList.value = await getHistoryList()
  })
}
function rmBookmark(bookmark: Bookmark[]) {
  browser.bookmarks.remove(bookmark.id).then(async () => {
    bookmarks.value = (await native.getBookmarks()).slice(0, 20)
  })
}
function handleSearch() {
  const url = (() => {
    switch (searchEngine.value) {
      case '1':
        return `https://www.google.com/search?q=${searchKeyword.value}`
      case '2':
        return `https://www.baidu.com/s?wd=${searchKeyword.value}`
      case '3':
        return `https://cn.bing.com/search?q=${searchKeyword.value}`
      case '4':
        return `https://www.sogou.com/web?query=${searchKeyword.value}`
      case '5':
        return `https://duckduckgo.com/?q=${searchKeyword.value}`
      default:
        return `https://www.google.com/search?q=${searchKeyword.value}`
    }
  })()
  goTo(url)
}
onMounted(async () => {
  recentlyClosedTabs.value = await getRecentlyClosedTabs()
  historyList.value = await getHistoryList()
  bookmarks.value = (await native.getBookmarks()).slice(0, 20)
})
</script>

<template>
  <el-container>
    <el-header>
      <div class="flex">
        <Logo class="w10 mr-4" />
        <SharedSubtitle />
      </div>
    </el-header>
    <el-container>
      <el-aside width="200px">
        <div class="mt-2">
          <button class="btn mr-2" @click="switchToLeftTab">
            Go to left
          </button>
          <button class="btn" @click="reload">
            Reload
          </button>
        </div>
      </el-aside>
      <el-container>
        <el-main>
          <!-- class="absolute top-4 left-1/2 transform -translate-x-1/2" -->
          <el-tabs v-model="activeName" class="demo-tabs" @tab-click="handleClick">
            <el-tab-pane label="Search" name="first">
              <el-input
                v-model="searchKeyword"
                placeholder="请输入关键词"
                @keydown.enter="handleSearch"
              >
                <template #prepend>
                  <el-select v-model="searchEngine" placeholder="选择搜索引擎" size="large" style="width: 125px" class="bg-white">
                    <el-option label="Google" value="1" />
                    <el-option label="Baidu" value="2" />
                    <el-option label="Bing" value="3" />
                    <el-option label="Sogou" value="4" />
                    <el-option label="DuckDuckGo" value="5" />
                  </el-select>
                </template>
                <template #append>
                  <el-button :icon="Search" @click="handleSearch" />
                </template>
              </el-input>
            </el-tab-pane>
            <el-tab-pane label="History" name="second">
              <!-- 历史记录 -->
              <el-row>
                <el-col
                  v-for="history in historyList"
                  :key="history.id"
                  :span="6"
                >
                  <el-card shadow="hover">
                    <template #header>
                      <div class="card-header">
                        <span>historyList</span>
                        <el-popover
                          :width="180"
                          popper-style="box-shadow: rgb(14 18 22 / 35%) 0px 10px 38px -10px, rgb(14 18 22 / 20%) 0px 10px 20px -15px; padding: 20px;"
                        >
                          <template #reference>
                            <el-icon><More /></el-icon>
                          </template>
                          <template #default>
                            <el-button type="primary" :icon="Edit" circle @click="rmHistory(history)" />
                            <el-button type="warning" :icon="Star" circle @click="rmHistory(history)" />
                            <el-button type="danger" :icon="Delete" circle @click="rmHistory(history)" />
                          </template>
                        </el-popover>
                      </div>
                    </template>
                    <div>
                      <div>
                        <el-link :href="history.url" target="_blank">
                          <el-tooltip
                            :content="history.title"
                            placement="bottom-end"
                          >
                            <div class="line-clamp-1">
                              {{ history.title }}
                            </div>
                          </el-tooltip>
                        </el-link>
                        <div class="color-black">
                          <time>{{ history.lastVisitTime }}</time>
                          <span> {{ history.visitCount }}</span>
                        </div>
                      </div>
                    </div>
                  </el-card>
                </el-col>
              </el-row>
            </el-tab-pane>
            <el-tab-pane label="Bookmarks" name="third">
              <!-- 书签 -->
              <el-row>
                <el-col
                  v-for="bookmark in bookmarks"
                  :key="bookmark.id"
                  :span="6"
                >
                  <el-card shadow="hover">
                    <template #header>
                      <div class="card-header">
                        <span>bookmarks</span>
                        <el-popover
                          :width="180"
                          popper-style="box-shadow: rgb(14 18 22 / 35%) 0px 10px 38px -10px, rgb(14 18 22 / 20%) 0px 10px 20px -15px; padding: 20px;"
                        >
                          <template #reference>
                            <el-icon><More /></el-icon>
                          </template>
                          <template #default>
                            <el-button type="primary" :icon="Edit" circle @click="rmBookmark(bookmark)" />
                            <el-button type="warning" :icon="Star" circle @click="rmBookmark(bookmark)" />
                            <el-button type="danger" :icon="Delete" circle @click="rmBookmark(bookmark)" />
                          </template>
                        </el-popover>
                      </div>
                    </template>
                    <div>
                      <div>
                        <el-link :href="bookmark.url" target="_blank">
                          <el-tooltip
                            :content="bookmark.title"
                            placement="bottom-end"
                          >
                            <div class="line-clamp-1">
                              {{ bookmark.title }}
                            </div>
                          </el-tooltip>
                        </el-link>
                        <div class="color-black">
                          <time>{{ bookmark.lastVisitTime }}</time>
                          <span> {{ bookmark.visitCount }}</span>
                        </div>
                      </div>
                    </div>
                  </el-card>
                </el-col>
              </el-row>
            </el-tab-pane>
            <el-tab-pane label="RecentlyClosedTabs" name="forth">
              <!-- 最近关闭 -->
              <el-row>
                <el-col
                  v-for="session in recentlyClosedTabs"
                  :key="session.tab.id"
                  :span="6"
                >
                  <el-card shadow="hover">
                    <template #header>
                      <div class="card-header">
                        <span>recentlyClosedTabs</span>
                        <el-popover
                          :width="180"
                          popper-style="box-shadow: rgb(14 18 22 / 35%) 0px 10px 38px -10px, rgb(14 18 22 / 20%) 0px 10px 20px -15px; padding: 20px;"
                        >
                          <template #reference>
                            <el-icon><More /></el-icon>
                          </template>
                          <template #default>
                            <el-button type="primary" :icon="Edit" circle @click="rmRecently(session)" />
                            <el-button type="warning" :icon="Star" circle @click="rmRecently(session)" />
                            <el-button type="danger" :icon="Delete" circle @click="rmRecently(session)" />
                          </template>
                        </el-popover>
                      </div>
                    </template>
                    <div>
                      <el-image
                        style="width: 60px; height: 60px"
                        :src="session.tab.favIconUrl"
                        :zoom-rate="1.2"
                        :max-scale="7"
                        :min-scale="0.2"
                        :preview-src-list="[session.tab.favIconUrl]"
                        fit="cover"
                      />
                      <div>
                        <el-link :href="session.tab.url" target="_blank">
                          <el-tooltip
                            :content="session.tab.title"
                            placement="bottom-end"
                          >
                            <div class="line-clamp-1">
                              {{ session.tab.title }}
                            </div>
                          </el-tooltip>
                        </el-link>
                        <div class="color-black flex flex-col">
                          <time>{{ `上次编辑: ${session.tab.lastModified}` }}</time>
                          <time>{{ `上次访问: ${session.tab.lastAccessed}` }}</time>
                        </div>
                      </div>
                    </div>
                  </el-card>
                </el-col>
              </el-row>
            </el-tab-pane>
            <el-tab-pane label="Task" name="fifth">
              <!-- TODO 待办事项 -->
            </el-tab-pane>
          </el-tabs>
        </el-main>
        <el-footer>
          <el-backtop :right="100" :bottom="100" />
        </el-footer>
      </el-container>
    </el-container>
  </el-container>
</template>

<style lang="less" scoped>
.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;

  .el-icon {
    cursor: pointer;
  }
}
</style>
