# OneWeb brand archive

## Active identity

- **Name:** OneWeb
- **Subtitle:** 你的浏览器伴侣
- **Positioning:** 浏览器里的个人侧边工作台
- **Promise:** 把搜索、整理、浏览器工具和智能分析收进一个入口。
- **Slogan:** 一侧，搞定浏览日常。
- **Icon idea:** The numeral `1` represents the unified entry point; the three stacked tiles
  represent independent modules living in the side workspace.

`OneWeb` is the product brand. Features such as RepoLens keep their own module names and icons.
The root project/package is `one-web`, and the stable Firefox development/self-distribution ID is
`one-web@juckz.local`. The canonical repository is `JuckZ/one-web`; the product-facing name remains
OneWeb.

## Archived concepts

Every concept includes the editable SVG source and ready-to-use PNGs at 16, 48, 128 and 512px.

### OneDeck

- **Status:** Archived because an existing product already uses the name.
- **Subtitle:** 你的浏览器伴侣
- **Positioning:** 浏览器里的个人侧边工作台。
- **Slogan:** 一侧，搞定浏览日常。
- **Note:** Its `1 + modules` visual direction was retained for OneWeb.

### OneMate

- **Subtitle:** 懂你的浏览搭子
- **Positioning:** 住在浏览器侧边栏里的日常伙伴，帮你找、理、切、查，也能按场景提供智能能力。
- **Slogan:** 每一次浏览，都有个搭子。
- **Character:** Friendly and consumer-facing; preserves the panda mascot direction.
- **Trade-off:** May be mistaken for a pure AI assistant without a concrete store description.

### One WebExt

- **Subtitle:** 一个插件，连接你的浏览日常
- **Positioning:** 可扩展的一站式浏览器工具集合，以统一入口承载多个相对独立的功能模块。
- **Slogan:** One extension. More possibilities.
- **Character:** Keeps the original developer-facing identity and has the lowest naming migration
  cost.
- **Trade-off:** `WebExt` is technical language that many regular browser users do not recognize.

### OneNest

- **Subtitle:** 你的个人浏览空间
- **Positioning:** 把零散的搜索、书签、历史、工具和分析安放在一处，强调长期整理与个人沉淀。
- **Slogan:** 把浏览，安放在一处。
- **Character:** Warm and personal; best if bookmarks, knowledge organization and personal
  workflows become the long-term center of the product.
- **Trade-off:** Communicates developer and network utilities less directly.

## Asset layout

```text
docs/brand/concepts/
  oneweb/        # active
  onedeck/       # archived: name conflict
  onemate/       # archived alternative
  one-webext/    # archived alternative
  onenest/       # archived alternative
    icon.svg
    icons/
      icon-16.png
      icon-48.png
      icon-128.png
      icon-512.png
```

The active runtime copies live in `extension/assets/`. The 512px source used by extension pages
also lives at `src/assets/icon.png`.

## Switching to another concept

1. Update `displayName` and `description` in `package.json`.
2. Copy the selected concept's PNG files into `extension/assets/`, keeping the runtime filenames.
3. Copy its `icon-512.png` to both `extension/assets/icon.png` and `src/assets/icon.png`.
4. Update visible product-level copy, while leaving module names such as RepoLens unchanged.
5. Run `pnpm build`, `pnpm typecheck`, `pnpm test` and `pnpm manifest:validate`.

Before a public launch, check browser stores, domains and trademarks for the selected name.
