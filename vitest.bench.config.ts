import { resolve } from 'node:path';

import { defineConfig } from 'vitest/config';

import { compiled, SRC, type Generate } from './vitest.config.js';

// One project per run of `bench/run.ts`, which picks it and the source tree it
// measures. The time rows run alone and in order, each file in turn, so no
// other file shares the CPU while one is timed. The heap rows run without V8's
// compilers, whose code and feedback grow and shrink by hundreds of kB as
// functions tier up (which also turns WebAssembly off, with a warning on
// Node 22).
const projects: Record<string, { include: string[]; generate: Generate; execArgv?: string[] }> = {
  counts: { include: ['bench/counts.ts', 'bench/sizes.ts', 'bench/checker.ts'], generate: 'client' },
  times: { include: ['bench/times.ts', 'bench/page.ts'], generate: 'client' },
  heap: { include: ['bench/heap.ts'], generate: 'client', execArgv: ['--jitless'] },
  kit: { include: ['bench/kit.ts'], generate: 'server' },
};

const { include, generate, execArgv = [] } = projects[process.env.BENCH_PROJECT ?? 'counts'];
const source = resolve(process.env.BENCH_SOURCE ?? SRC);

export default defineConfig({
  test: {
    projects: compiled({ include, fileParallelism: false, execArgv: ['--expose-gc', ...execArgv] }, { source, generates: [generate] }).map((project) => ({
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
