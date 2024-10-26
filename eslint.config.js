import antfu from '@antfu/eslint-config'

export default antfu(
  {
    // JZTODO 该配置的实际效果对比与性能损失权衡 TypeScript and Vue are autodetected, you can also explicitly enable them:
    // typescript: {
    //   tsconfigPath: 'tsconfig.json',
    // },
    typescript: true,
    unocss: true,
    vue: true,
    // customize the stylistic rules
    stylistic: {
      indent: 2, // 4, or 'tab'
      quotes: 'single', // or 'double'
    },
    formatters: {
    /**
     * Format CSS, LESS, SCSS files, also the `<style>` blocks in Vue
     * By default uses Prettier
     */
      css: true,
      /**
       * Format HTML files
       * By default uses Prettier
       */
      html: true,
      /**
       * Format Markdown files
       * Supports Prettier and dprint
       * By default uses Prettier
       */
      markdown: 'prettier',
    },
    // `.eslintignore` is no longer supported in Flat config, use `ignores` instead
    ignores: ['**/fixtures', 'dist', '**/dist/**', 'node_modules', '**/node_modules/**', 'public', '**/public/**', 'pnpm-lock.yaml', '**/pnpm-lock.yaml/**', 'package.json', '**/package.json/**', 'tsconfig.json', '**/tsconfig.json/**'],
  },
  {
    files: ['**/*.{js,jsx,ts,tsx,vue}'],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrors: 'all',
          caughtErrorsIgnorePattern: '^_',
        },
      ],

      'unused-imports/no-unused-vars': [
        'warn',
        {
          vars: 'all',
          varsIgnorePattern: '^_',
          args: 'after-used',
          argsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      // JZTODO 开启如下规则
      'no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrors: 'all',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
        },
      ],
      'no-shadow': 'off',
      'style/quote-props': 'error',
      'no-console': 'off',
    },
  },
)
