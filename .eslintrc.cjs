module.exports = {
  env: {
    es6: true,
    browser: true,
  },
  extends: [
    'plugin:vue/base',
    'eslint:recommended',
    'plugin:import/recommended',
    'plugin:vue/vue3-recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:@typescript-eslint/eslint-recommended',
    'plugin:import/typescript',
    './.eslintrc-auto-import.json',
  ],
  globals: {
    Atomics: 'readonly',
    SharedArrayBuffer: 'readonly',
    activeDocument: 'readonly',
    app: 'readonly',
    module: 'readonly',
    // chrome: 'readonly',
  },
  parser: 'vue-eslint-parser',
  parserOptions: {
    parser: '@typescript-eslint/parser',
    extraFileExtensions: ['.vue'],
    ecmaVersion: 6,
    sourceType: 'module',
    jsx: true,
  },
  plugins: ['vue', '@typescript-eslint', 'import'],
  rules: {
    'vue/multi-word-component-names': 1,
    'vue/no-v-model-argument': 'off',
    'linebreak-style': ['error', 'unix'],
    quotes: ['error', 'single', { avoidEscape: true }],
    '@typescript-eslint/no-unused-vars': 0,
    'no-unused-vars': 0,
    indent: ['error', 2],
    semi: ['error', 'always'],
    'import/order': 'error',
    'sort-imports': [
      'error',
      {
        ignoreDeclarationSort: true,
      },
    ],
  },
  settings: {
    'import/parsers': {
      '@typescript-eslint/parser': ['.ts', '.tsx'],
    },
    'import/resolver': {
      typescript: {
        alwaysTryTypes: true,
        project: ['tsconfig.json', 'other-packages/*/tsconfig.json'],
      },
    },
  },
};
