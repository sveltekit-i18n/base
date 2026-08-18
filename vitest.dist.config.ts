import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    svelte(),
    // See vitest.config.ts — same rolldown-vite filter workaround.
    { name: 'force-js-plugin-pipeline', transform() {} },
  ],
  test: {
    environment: 'node',
    include: ['tests/specs/dist.spec.ts'],
  },
});
