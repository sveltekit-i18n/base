import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

import { I18n } from '@sveltekit-i18n/base';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { stringify } from 'devalue';
import { build, type Rolldown } from 'vite';
import { expect, it } from 'vitest';

import { sourceImports, SRC } from '../vitest.config.js';

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
 * What a browser bundle of `entry`, or of the `names` an app imports from it,
 * ships, minified: built by Vite with the Svelte plugin, as a SvelteKit app
 * builds it, so the rune modules, which the package ships uncompiled, compile
 * as there and the server-only code `BROWSER` guards is dropped as there.
 * `svelte` is the consumer's, so it is left out.
 */
const bundle = async (entry: string, names?: string) => {
  const input = '\0entry';
  const { output: [chunk, ...rest] } = await build({
    configFile: false,
    envFile: false,
    logLevel: 'silent',
    resolve: { alias: sourceImports('client', source) },
    plugins: [
      svelte({ configFile: false }),
      ...(names ? [{ name: 'entry', resolveId: (id: string) => (id === input ? id : null), load: (id: string) => (id === input ? `export { ${names} } from ${JSON.stringify(resolve(source, entry))};` : null) }] : []),
    ],
    build: { write: false, minify: true, modulePreload: false, rolldownOptions: { input: names ? input : resolve(source, entry), preserveEntrySignatures: 'strict', external: [/^svelte($|\/)/] } },
  }) as Rolldown.RolldownOutput;

  expect(rest).toEqual([]);

  const { code } = chunk;

  expect(code).not.toMatch(/\$state|\$derived|\$effect/);

  return Buffer.from(code);
};

it('the browser bundle', async () => {
  for (const [name, entry] of [['the entry', 'index.ts'], ['/utils', 'exports/utils.ts'], ['/kit', 'exports/kit.ts']]) {
    const contents = await bundle(entry);

    record(`browser bundle of ${name}, minified`, 'size', 'B', contents.length);
    record(`browser bundle of ${name}, minified and gzipped`, 'size', 'B', gzipSync(contents).length);
  }

  // An app without translated pathnames imports `defineI18n` alone.
  const wiring = await bundle('exports/kit.ts', 'defineI18n');

  record('browser bundle of defineI18n alone, minified', 'size', 'B', wiring.length);
  record('browser bundle of defineI18n alone, minified and gzipped', 'size', 'B', gzipSync(wiring).length);
});
