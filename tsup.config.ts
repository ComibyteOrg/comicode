import { defineConfig } from 'tsup';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

export default defineConfig({
  entry: { cli: 'src/cli.ts' },
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  splitting: false,
  sourcemap: true,
  clean: true,
  dts: false,
  external: [
    'ink',
    'react',
    'chalk',
    'commander',
    'zod',
    'ignore',
    // Keep the node: prefix; older esbuild builtin tables can rewrite it to
    // the bare package name "sqlite".
    'node:sqlite',
  ],
  define: {
    __COMICODE_VERSION__: JSON.stringify(pkg.version),
  },
  banner: {
    js: '#!/usr/bin/env node',
  },
});
