import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

import { I18n } from '@sveltekit-i18n/base';
import { stringify } from 'devalue';
import * as esbuild from 'esbuild';
import { compileModule } from 'svelte/compiler';
import { expect, it } from 'vitest';

import { SRC } from '../vitest.config.js';

import { collect } from './collect.js';
import { loaders, log, n, parser, table } from './data.js';

const record = collect(import.meta.filename);

const KEYS = 10_000;

// The tree measured, as `vitest.bench.config.ts` aliases it.
const source = resolve(process.env.BENCH_SOURCE ?? SRC);

it('the SSR hand-off', async () => {
  const i18n = new I18n({ parser, log, loaders: loaders(table(KEYS, 'namespaces')) });

  await i18n.loadTranslations('en', '/');
  expect(Object.keys(i18n.translations.en)).toHaveLength(KEYS);

  record(`snapshot({ records: true }) as devalue writes it (${n(KEYS)} keys)`, 'size', 'B', stringify(i18n.snapshot({ records: true })).length);
});

/**
 * What a browser bundle of `entry` ships, minified: compiled from the source
 * as a consumer's bundler compiles it, since the package ships its rune
 * modules uncompiled. `svelte` is the consumer's, so it is left out.
 */
const bundle = async (entry: string) => {
  const { outputFiles: [output] } = await esbuild.build({
    entryPoints: [resolve(source, entry)],
    bundle: true,
    minify: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    external: ['svelte', 'svelte/*'],
    alias: { '#kit-env': resolve(source, 'kit/env.browser.ts'), '#kit-server': resolve(source, 'kit/server.browser.ts') },
    logLevel: 'silent',
    plugins: [{
      name: 'runes',
      setup: (build) => {
        build.onLoad({ filter: /\.svelte\.ts$/ }, async ({ path }) => {
          const { code } = await esbuild.transform(readFileSync(path, 'utf8'), { loader: 'ts' });

          return { contents: compileModule(code, { generate: 'client', dev: false, filename: path }).js.code, loader: 'js' };
        });
      },
    }],
  });

  expect(output.text).not.toMatch(/\$state|\$derived|\$effect/);

  return output.contents;
};

it('the browser bundle', async () => {
  for (const [name, entry] of [['the entry', 'index.ts'], ['/utils', 'exports/utils.ts'], ['/kit', 'exports/kit.ts']]) {
    const contents = await bundle(entry);

    record(`browser bundle of ${name}, minified`, 'size', 'B', contents.length);
    record(`browser bundle of ${name}, minified and gzipped`, 'size', 'B', gzipSync(contents).length);
  }
});
