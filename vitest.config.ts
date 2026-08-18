import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    // Compiles the `.svelte.ts` rune modules the core is written in.
    svelte(),
    // Workaround for vite-plugin-svelte 7.3 on rolldown-vite 8: the plugin
    // assigns its module-compile `transform.filter` in `configResolved`, which
    // the native filter pipeline snapshots too early — rune modules then reach
    // the runtime uncompiled ("$state is not defined"). A filter-less transform
    // forces the JS plugin pipeline, where the late-bound filter is honoured.
    // Remove once the plugin registers its filter statically.
    { name: 'force-js-plugin-pipeline', transform() {} },
  ],
  test: {
    environment: 'node',
    include: ['tests/specs/**/*.spec.ts'],
    // The dist spec needs a fresh build first; it runs via `npm run test:dist`.
    exclude: ['tests/specs/dist.spec.ts'],
  },
});
