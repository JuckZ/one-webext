declare const __DEV__: boolean;
/** Extension name, defined in packageJson.name */
declare const __NAME__: string;

declare module '*.vue' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const component: any;
  export default component;
}
