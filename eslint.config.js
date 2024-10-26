import antfu from "@antfu/eslint-config"

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
      quotes: "single", // or 'double'
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
    ignores: ["**/fixtures", "dist","**/dist/**","node_modules","**/node_modules/**","public","**/public/**","pnpm-lock.yaml","**/pnpm-lock.yaml/**","package.json","**/package.json/**","tsconfig.json","**/tsconfig.json/**"]
  },
  {
    files: ["**/*.{js,jsx,ts,tsx,vue}"],
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrors: "all",
          caughtErrorsIgnorePattern: "^_",
        },
      ],

      "unused-imports/no-unused-vars": [
        "error",
        {
          vars: "all",
          varsIgnorePattern: "^_",
          args: "after-used",
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      // JZTODO 开启如下规则
      "no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrors: "all",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],
      "vue/multiline-html-element-content-newline": "off",
      "style/quote-props": "off",
      "style/lines-between-class-members": "off",
      "style/jsx-curly-brace-presence": "off",
      "style/brace-style": "off",
      "style/operator-linebreak": "off",
      "ts/no-use-before-define": "off",
      "vue/attributes-order": "off",
      "vue/block-order": "off",
      "vue/singleline-html-element-content-newline": "off",
      "style/arrow-parens": "off",
      "antfu/if-newline": "off",
      "antfu/top-level-function": "off",
      "vue/prefer-separate-static-class": "off",
      "style/quotes": "off",
      "no-shadow": "off",
      eqeqeq: "off",
      "no-console": "off",
      "vue/eqeqeq": "off",
      "unicorn/prefer-number-properties": "off",
      "prefer-arrow-callback": "off",
      "vue/prefer-template": "off",

      // 新添加的规则
      "style/multiline-ternary": "off",
      "style/indent-binary-ops": "off",
      "prefer-template": "off",
      "style/member-delimiter-style": "off",
      "regexp/prefer-range": "off",
      "regexp/confusing-quantifier": "off",
      "regexp/control-character-escape": "off",
      "regexp/letter-case": "off",
      "regexp/prefer-d": "off",
      "regexp/negation": "off",
      "vue/custom-event-name-casing": "off",
      "ts/ban-ts-comment": "off",
      "regexp/prefer-w": "off",
      "regexp/no-super-linear-backtracking": "off",
      "regexp/no-useless-lazy": "off",
      "regexp/no-unused-capturing-group": "off",
      "no-useless-return": "off",
      "regexp/prefer-character-class": "off",
      "vue/operator-linebreak": "off",
      "vue/define-macros-order": "off",
      "vue/padding-line-between-blocks": "off",
      "ts/consistent-type-definitions": "off",
      "vue/no-useless-v-bind": "off",
      "vue/component-name-in-template-casing": "off",
      "prefer-exponentiation-operator": "off",
      "antfu/consistent-chaining": "off",
      "style/jsx-one-expression-per-line": "off",
      "dot-notation": "off",
      "vue/attribute-hyphenation": "off",
      "array-callback-return": "off",
      "no-useless-computed-key": "off",
      "unicorn/prefer-includes": "off",
      "antfu/curly": "off",
      "vue/no-unused-refs": "off",
      "node/prefer-global/process": "off",
    },
  },
)