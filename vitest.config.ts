import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';

export type Generate = 'server' | 'client';

export const SRC = fileURLToPath(new URL('./src/', import.meta.url));

// The `imports` map points into dist/, where the consumer's bundler picks a
// target by condition. The suite resolves each to the source it is built from,
// by the conditions of the compile it runs in. The map is the one of the tree
// `src` belongs to: a tree the benchmark measures against this one may name
// its files otherwise.
export const sourceImports = (generate: Generate, src: string) => {
  const { imports } = JSON.parse(readFileSync(resolve(src, '../package.json'), 'utf8')) as { imports: Record<string, { browser: string; default: string }> };

  return Object.entries(imports).map(([find, { browser, default: fallback }]) => ({
    find,
    replacement: resolve(src, (generate === 'client' ? browser : fallback).replace(/^\.\/dist\//, '').replace(/\.js$/, '.ts')),
  }));
};

// A suite runs once per way a consumer's bundler compiles the rune modules:
// for the server, and for the browser, where deep `$state` hands back proxies
// in place of the objects it was given, and `svelte` resolves to the runtime
// that runs effects and tracks reads. Both module graphs are set, since a spec
// in a DOM environment resolves through the client one.
// `source` is the directory the imports resolve to: this package's `src/`, or
// another tree of it, which the benchmark measures against this one.
export const compiled = (
  test: { name?: string; environment?: string; include: string[]; exclude?: string[]; fileParallelism?: boolean; execArgv?: string[] },
  { source = true, generates = ['server', 'client'], asyncMode = false }: { source?: boolean | string; generates?: readonly Generate[]; asyncMode?: boolean } = {},
) => generates.map((generate) => ({
  resolve: {
    ...(generate === 'client' ? { conditions: ['browser'] } : {}),
    ...(source ? { alias: sourceImports(generate, source === true ? SRC : source) } : {}),
  },
  ...(generate === 'client' ? { ssr: { resolve: { conditions: ['browser'] } } } : {}),
  plugins: [
    // Compiles the `.svelte.ts` rune modules the core is written in, and, for
    // the async project, a `.async.svelte` component with Svelte's async mode,
    // which its import switches on for the spec that mounts it.
    svelte({ dynamicCompileOptions: ({ filename }) => ({ generate, ...(asyncMode && filename.endsWith('.async.svelte') ? { experimental: { async: true } } : {}) }) }),
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

const asyncSpec = 'tests/specs/async.spec.ts';

export default defineConfig({
  test: {
    projects: [
      ...compiled({
        include: ['tests/specs/**/*.spec.ts'],
        // The dist spec needs a fresh build first; it runs via `npm run test:dist`.
        exclude: ['tests/specs/dist.spec.ts', asyncSpec],
      }),
      // Svelte's async batching, which SvelteKit's remote functions switch on:
      // a client compile in a DOM.
      ...compiled({ name: 'async', environment: 'happy-dom', include: [asyncSpec] }, { generates: ['client'], asyncMode: true }),
    ],
  },
});
