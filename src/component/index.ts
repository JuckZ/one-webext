import type { App } from 'vue'
import { Delete, Edit, Minus, Refresh, Remove } from '@element-plus/icons-vue'
import {
  ElButton,
  ElConfigProvider,
  ElForm,
  ElFormItem,
  ElIcon,
  ElInput,
  ElInputNumber,
  ElLink,
  ElLoading,
  ElPagination,
  ElPopconfirm,
  ElProgress,
  ElSpace,
  ElTable,
  ElTableColumn,
  ElTooltip,
} from 'element-plus'

export default {
  install(app: App) {
    app.use(ElConfigProvider)
    app.use(ElForm)
    app.use(ElFormItem)
    app.use(ElLoading)
    app.use(ElTable)
    app.use(ElTableColumn)
    app.use(ElPagination)
    app.use(ElButton)
    app.use(ElProgress)
    app.use(ElPopconfirm)
    app.use(ElInput)
    app.use(ElInputNumber)
    app.use(ElLink)
    app.use(ElTooltip)
    app.use(ElIcon)
    app.use(ElSpace)
    app.component(Edit.name, Edit)
    app.component(Delete.name, Delete)
    app.component(Remove.name, Remove)
    app.component(Refresh.name, Refresh)
    app.component(Minus.name, Minus)
  },
}
