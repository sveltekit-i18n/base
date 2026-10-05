import { resolve } from 'node:path';

import { defineConfig } from 'vitest/config';

import { compiled, SRC, type Generate } from './vitest.config.js';

// One project per run of `bench/run.ts`, which picks it and the source tree it
// measures. The time rows run alone and in order, each file in turn, so no
// other file shares the CPU while one is timed.
const projects: Record<string, { include: string[]; generate: Generate }> = {
  counts: { include: ['bench/counts.ts', 'bench/sizes.ts', 'bench/checker.ts'], generate: 'client' },
  times: { include: ['bench/times.ts', 'bench/page.ts'], generate: 'client' },
  kit: { include: ['bench/kit.ts'], generate: 'server' },
};

const { include, generate } = projects[process.env.BENCH_PROJECT ?? 'counts'];
const source = resolve(process.env.BENCH_SOURCE ?? SRC);

export default defineConfig({
  test: {
    projects: compiled({ include, fileParallelism: false, execArgv: ['--expose-gc'] }, { source, generates: [generate] }).map((project) => ({
      ...project,
      resolve: {
        ...project.resolve,
        alias: [
          ...project.resolve.alias ?? [],
          { find: /^@sveltekit-i18n\/base$/, replacement: resolve(source, 'index.ts') },
          { find: /^@sveltekit-i18n\/base\/kit$/, replacement: resolve(source, 'exports/kit.ts') },
        ],
      },
    })),
  },
});
