declare const __COMICODE_VERSION__: string | undefined;

export const VERSION =
  typeof __COMICODE_VERSION__ === 'string' ? __COMICODE_VERSION__ : '0.1.0-dev';

export const GITHUB_REPOSITORY = 'https://github.com/YOUR_USERNAME/comicode';
