/* eslint-disable */
import { defineConfig } from 'tsup';

export default defineConfig((options) => ({
  clean: true,
  dts: true,
  format: ['cjs', 'esm'],
  entry: ['src/index.ts'],
  watch: options.watch && ['src/*'],
  minify: !options.watch,
  sourcemap: options.watch,
}));