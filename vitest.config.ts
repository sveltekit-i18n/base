import { fileURLToPath } from 'node:url';

import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';

import pkg from './package.json' with { type: 'json' };

type Generate = 'server' | 'client';

// The `imports` map points into dist/, where the consumer's bundler picks a
// target by condition. The suite resolves each to the source it is built from,
// by the conditions of the compile it runs in.
const sourceImports = (generate: Generate) => Object.entries(pkg.imports).map(([find, { browser, default: fallback }]) => ({
  find,
  replacement: fileURLToPath(new URL((generate === 'client' ? browser : fallback).replace(/^\.\/dist\//, './src/').replace(/\.js$/, '.ts'), import.meta.url)),
}));

// A suite runs once per way a consumer's bundler compiles the rune modules:
// for the server, and for the browser, where deep `$state` hands back proxies
// in place of the objects it was given, and `svelte` resolves to the runtime
// that runs effects and tracks reads. Both module graphs are set, since a spec
// in a DOM environment resolves through the client one.
export const compiled = (test: { include: string[]; exclude?: string[] }, { source = true } = {}) => (['server', 'client'] as const).map((generate) => ({
  resolve: {
    ...(generate === 'client' ? { conditions: ['browser'] } : {}),
    ...(source ? { alias: sourceImports(generate) } : {}),
  },
  ...(generate === 'client' ? { ssr: { resolve: { conditions: ['browser'] } } } : {}),
  plugins: [
    // Compiles the `.svelte.ts` rune modules the core is written in.
    svelte({ dynamicCompileOptions: () => ({ generate }) }),
    // Workaround for vite-plugin-svelte 7.3 on rolldown-vite 8: the plugin
    // assigns its module-compile `transform.filter` in `configResolved`, which
    // the native filter pipeline snapshots too early — rune modules then reach
    // the runtime uncompiled ("$state is not defined"). A filter-less transform
    // forces the JS plugin pipeline, where the late-bound filter is honoured.
    // Remove once the plugin registers its filter statically.
    { name: 'force-js-plugin-pipeline', transform() {} },
  ],
  test: { name: generate, environment: 'node', ...test },
}));

export default defineConfig({
  test: {
    projects: compiled({
      include: ['tests/specs/**/*.spec.ts'],
      // The dist spec needs a fresh build first; it runs via `npm run test:dist`.
      exclude: ['tests/specs/dist.spec.ts'],
    }),
  },
});
