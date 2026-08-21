import { dirname, relative } from 'node:path'
import Vue from '@vitejs/plugin-vue'
import UnoCSS from 'unocss/vite'
import AutoImport from 'unplugin-auto-import/vite'
import ElementPlus from 'unplugin-element-plus'
import IconsResolver from 'unplugin-icons/resolver'
import Icons from 'unplugin-icons/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'
import Components from 'unplugin-vue-components/vite'
import { coverageConfigDefaults, defineConfig } from 'vitest/config'
import packageJson from './package.json'
import { isDev, r } from './scripts/utils'

export default defineConfig({
  root: r('src'),
  resolve: {
    alias: {
      '~/': `${r('src')}/`,
    },
  },
  define: {
    __DEV__: isDev,
    __NAME__: JSON.stringify(packageJson.name),
  },
  plugins: [
    Vue(),
    AutoImport({
      resolvers: [ElementPlusResolver()],
      imports: [
        'vue',
        {
          'webextension-polyfill': [
            ['=', 'browser'],
          ],
        },
        {
          '~/utils/logger': [
            'log',
          ],
        },
      ],
      dts: r('src/auto-imports.d.ts'),
    }),
    Components({
      dirs: [r('src/components')],
      dts: r('src/components.d.ts'),
      resolvers: [
        ElementPlusResolver(),
        IconsResolver({
          prefix: '',
        }),
      ],
    }),
    ElementPlus.vite({}),
    Icons(),
    UnoCSS(),
    {
      name: 'assets-rewrite',
      enforce: 'post',
      apply: 'build',
      transformIndexHtml(html, { path }) {
        return html.replace(/"\/assets\//g, `"${relative(dirname(path), '/assets')}/`)
      },
    },
  ],
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['**/*.{test,spec}.{ts,tsx,js,jsx,vue}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      reportsDirectory: '../coverage',
      exclude: [
        ...coverageConfigDefaults.exclude,
        '**/main.ts',
        '**/*.d.ts',
        'auto-imports.d.ts',
        'components.d.ts',
        'manifest.ts',
      ],
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 60,
        statements: 70,
      },
    },
  },
})
