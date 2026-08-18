/* eslint-disable */
import { defineConfig } from 'tsup';

export default defineConfig(
  /** @type {() => import('tsup').Options[]} */
  (options) => [
    {
      clean: true,
      dts: true,
      format: ['esm'],
      entry: ['src/index.ts'],
      watch: options.watch && ['src/*'],
      minify: !options.watch,
      sourcemap: options.watch,
      splitting: true,
    },
  ],
);