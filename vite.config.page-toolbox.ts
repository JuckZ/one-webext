import { defineConfig } from 'vite'
import packageJson from './package.json'
import { isDev, isFirefox, r } from './scripts/utils'
import { sharedConfig } from './vite.config'

export default defineConfig({
  ...sharedConfig,
  define: {
    '__DEV__': isDev,
    '__FIREFOX__': isFirefox,
    '__NAME__': JSON.stringify(packageJson.name),
    'process.env.NODE_ENV': JSON.stringify(isDev ? 'development' : 'production'),
  },
  build: {
    watch: isDev ? {} : undefined,
    outDir: r('extension/dist/pageToolbox'),
    cssCodeSplit: false,
    emptyOutDir: false,
    sourcemap: isDev ? 'inline' : false,
    lib: {
      entry: r('src/pageToolboxContent/index.ts'),
      name: 'onewebPageToolbox',
      formats: ['iife'],
    },
    rollupOptions: {
      output: {
        entryFileNames: 'index.global.js',
        extend: true,
      },
    },
  },
})
