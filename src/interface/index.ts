import type { ElTable } from 'element-plus'
import type { Bookmarks } from 'webextension-polyfill'

export interface Bookmark extends Bookmarks.BookmarkTreeNode {
  path: Array<string>
  editing: boolean
}

export interface InvalidBookmark extends Bookmark {
  error: Error
}

export type ElTableInstance = InstanceType<typeof ElTable>
