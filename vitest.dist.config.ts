import { defineConfig } from 'vitest/config';

import { compiled } from './vitest.config.js';

export default defineConfig({
  test: {
    projects: compiled({ include: ['tests/specs/dist.spec.ts'] }),
  },
});
