import antfu from '@antfu/eslint-config'

export default antfu({
  ignores: ["dist","**/dist/**","node_modules","**/node_modules/**","public","**/public/**","pnpm-lock.yaml","**/pnpm-lock.yaml/**","package.json","**/package.json/**","tsconfig.json","**/tsconfig.json/**"],
  unocss: true,
  vue: true,
})
