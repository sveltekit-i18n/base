import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';

// A suite runs once per way a consumer's bundler compiles the rune modules:
// for the server, and for the browser, where deep `$state` hands back proxies
// in place of the objects it was given, and `svelte` resolves to the runtime
// that runs effects and tracks reads.
export const compiled = (test: { include: string[]; exclude?: string[] }) => (['server', 'client'] as const).map((generate) => ({
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
