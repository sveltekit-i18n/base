import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';

import { afterAll } from 'vitest';

/**
 * What a row measures, which decides how a difference is read:
 * - `count`: an algorithmic count — calls, keys rebuilt, effect runs,
 *   instantiations. The same on every machine, and a growth fails the job.
 * - `size`: bytes. The same on every machine, but nearly every change of
 *   runtime code grows one, so a growth is flagged for review.
 * - `time`: milliseconds, or bytes of heap, which vary from run to run: a
 *   difference counts only beyond the spread of the samples.
 */
export type Kind = 'count' | 'size' | 'time';

export type Row = { id: string; kind: Kind; unit: string; value: number };

// Times and heap readings are only meaningful as an app ships the core.
if (process.env.NODE_ENV !== 'production') throw new Error('The benchmark runs with NODE_ENV=production; run it through `npm run bench`.');

/**
 * The rows a bench file measures, written as JSON to `BENCH_OUT` once the
 * file has run, one file per bench file.
 */
export const collect = (file: string) => {
  const rows: Row[] = [];

  afterAll(() => {
    const out = process.env.BENCH_OUT;

    if (!out) return;

    mkdirSync(out, { recursive: true });
    writeFileSync(resolve(out, `${basename(file).replace(/\.ts$/, '')}.json`), JSON.stringify(rows));
  });

  return (id: string, kind: Kind, unit: string, value: number) => {
    rows.push({ id, kind, unit, value });
  };
};

const median = (values: number[]) => [...values].sort((a, b) => a - b)[values.length >> 1];

/**
 * The median duration of `fn` in milliseconds per call, over `samples` rounds
 * of `inner` calls each, after a warm-up. `setup` runs before each round,
 * outside the timing.
 */
export const time = (fn: () => void, { inner = 1, samples = 15, setup }: { inner?: number; samples?: number; setup?: () => void } = {}) => {
  for (let i = 0; i < 3; i++) {
    setup?.();
    for (let j = 0; j < inner; j++) fn();
  }

  const durations: number[] = [];

  for (let i = 0; i < samples; i++) {
    setup?.();

    const start = performance.now();

    for (let j = 0; j < inner; j++) fn();
    durations.push((performance.now() - start) / inner);
  }

  return median(durations);
};

/** `time` for an asynchronous `fn`, one call per round. */
export const timeAsync = async (fn: () => Promise<unknown>, { samples = 15, setup }: { samples?: number; setup?: () => void | Promise<void> } = {}) => {
  for (let i = 0; i < 3; i++) {
    await setup?.();
    await fn();
  }

  const durations: number[] = [];

  for (let i = 0; i < samples; i++) {
    await setup?.();

    const start = performance.now();

    await fn();
    durations.push(performance.now() - start);
  }

  return median(durations);
};
