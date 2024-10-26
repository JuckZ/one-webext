/// <reference types="chrome"/>
/// <reference path="./loglevel.d.ts" />

declare const __DEV__: boolean
/** Extension name, defined in packageJson.name */
declare const __NAME__: string

declare module '*.vue' {
  const component: any
  export default component
}
