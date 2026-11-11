// Optional peers: Playwright is lazy-loaded by verify_ui only when installed.
declare module 'playwright' {
  export const chromium: any;
  const _default: any;
  export default _default;
}
declare module 'playwright-core' {
  export const chromium: any;
  const _default: any;
  export default _default;
}
