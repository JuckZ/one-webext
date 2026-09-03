export interface BookmarkMutationBoundary {
  get: (_bookmarkId: string) => Promise<unknown>
  getChildren: (_bookmarkId: string) => Promise<unknown>
  create: (_bookmark: { parentId: string, index?: number, title: string, url: string }) => Promise<unknown>
  update: (_bookmarkId: string, _changes: { title?: string, url?: string }) => Promise<unknown>
  move: (_bookmarkId: string, _destination: { parentId: string, index?: number }) => Promise<unknown>
  remove: (_bookmarkId: string) => Promise<void>
}

export interface BrowserBookmarksMutationApi {
  get: (_bookmarkId: string) => Promise<unknown>
  getChildren: (_bookmarkId: string) => Promise<unknown>
  create: (_bookmark: { parentId: string, index?: number, title: string, url: string }) => Promise<unknown>
  update: (_bookmarkId: string, _changes: { title?: string, url?: string }) => Promise<unknown>
  move: (_bookmarkId: string, _destination: { parentId: string, index?: number }) => Promise<unknown>
  remove: (_bookmarkId: string) => Promise<void>
}

export function createBrowserBookmarkMutationBoundary(
  api: BrowserBookmarksMutationApi,
): BookmarkMutationBoundary {
  return {
    get: bookmarkId => api.get(bookmarkId),
    getChildren: bookmarkId => api.getChildren(bookmarkId),
    create: bookmark => api.create(bookmark),
    update: (bookmarkId, changes) => api.update(bookmarkId, changes),
    move: (bookmarkId, destination) => api.move(bookmarkId, destination),
    remove: bookmarkId => api.remove(bookmarkId),
  }
}
