import * as kit from '@sveltekit-i18n/base/kit';
import { expect, it } from 'vitest';

import { collect, time, timeAsync } from './collect.js';
import { loaders, log, n, parser, table } from './data.js';

const record = collect(import.meta.filename);

const { defineI18n } = kit;
// A base without translated pathnames has no `translatePathnames`.
const { translatePathnames } = kit as Partial<typeof kit>;

const KEYS = 10_000;

const event = () => ({
  url: new URL('https://x.test/'),
  params: {},
  route: { id: '/' },
  isDataRequest: false,
  cookies: { get: () => undefined },
  request: new Request('https://x.test/', { headers: { 'accept-language': 'cs,en;q=0.8' } }),
});

it('the server load', async () => {
  const data = table(KEYS, 'namespaces');
  const { load } = defineI18n({ parser, log, loaders: loaders(data, ['en', 'cs']) });
  const { i18n } = await load(event());

  // The tables travel raw: one entry per namespace of 20 keys.
  expect([i18n.locale, Object.keys(i18n.translations?.cs ?? {}).length]).toEqual(['cs', KEYS / 20]);

  record(`the server load, a page render (${n(KEYS)} keys)`, 'time', 'ms', await timeAsync(() => load(event())));
}, 600_000);

it('the universal load', async () => {
  const data = table(KEYS, 'namespaces');
  const { load } = defineI18n({ parser, log, loaders: loaders(data, ['en', 'cs']) });
  let server = await load(event());
  const universal = () => load({ url: new URL('https://x.test/'), params: {}, route: { id: '/' }, data: server });

  expect((await universal()).i18n.locale).toBe('cs');

  // Each round renders a page of its own: the server load builds the instance the universal one renders from.
  record(`the universal load, a page render after its server load (${n(KEYS)} keys)`, 'time', 'ms', await timeAsync(universal, {
    setup: async () => { server = await load(event()); },
  }));
}, 600_000);

const LOCALES = ['cs', 'de', 'fr', 'es', 'it'];

/** A table of `entries` pathnames in 5 locales, half of them static and half with a param, beside a catch-all. */
const pathnames = (entries: number) => Object.fromEntries([
  ...Array.from({ length: entries }, (_, i) => {
    const tail = i % 2 ? '/[id]' : '';

    return [`/page${i}${tail}`, Object.fromEntries(LOCALES.map((locale) => [locale, `/${locale}/strana${i}${tail}`]))];
  }),
  ['/[...rest]', Object.fromEntries(LOCALES.map((locale) => [locale, `/${locale}/[...rest]`]))],
]);

it('translated pathnames', () => {
  // A base without translated pathnames measures none of them.
  if (!translatePathnames) return;

  const wiring = defineI18n({ parser, log, loaders: loaders(table(20, 'namespaces'), LOCALES) }, { pathnames: translatePathnames(pathnames(1_000)) });

  // Distinct pathnames, so each call walks the trie rather than reading the last answer back.
  const cycle = <T>(values: T[]) => {
    let at = 0;

    return () => values[at++ % values.length];
  };
  const micro = (fn: () => void) => 1_000 * time(fn, { inner: 2_000 });

  for (const entries of [10, 1_000]) {
    const { reroute, localizePath } = defineI18n({ parser, log, loaders: loaders(table(20, 'namespaces'), LOCALES) }, { pathnames: translatePathnames(pathnames(entries)) });
    const translated = cycle(Array.from({ length: 64 }, (_, i) => new URL(`https://x.test/${LOCALES[i % 5]}/strana${(i * 7) % entries}${(i * 7) % entries % 2 ? `/${i}` : ''}`)));
    const missed = cycle(Array.from({ length: 64 }, (_, i) => new URL(`https://x.test/elsewhere/${i}`)));
    const canonical = cycle(Array.from({ length: 64 }, (_, i) => `/page${(i * 7) % entries}${(i * 7) % entries % 2 ? `/${i}` : ''}`));
    const localized = cycle(Array.from({ length: 64 }, (_, i) => `/cs/strana${(i * 7) % entries}${(i * 7) % entries % 2 ? `/${i}` : ''}`));

    expect([reroute({ url: new URL('https://x.test/de/strana1/42') }), localizePath('/page1/42', 'cs'), localizePath('/cs/strana1/42', 'de')]).toEqual(['/page1/42', '/cs/strana1/42', '/de/strana1/42']);

    record(`reroute, a translated pathname (${n(entries)} entries of 5 locales)`, 'time', 'µs', micro(() => reroute({ url: translated() })));
    record(`reroute, a pathname no entry translates (${n(entries)} entries of 5 locales)`, 'time', 'µs', micro(() => reroute({ url: missed() })));
    record(`localizePath, a canonical path to a locale (${n(entries)} entries of 5 locales)`, 'time', 'µs', micro(() => localizePath(canonical(), 'de')));
    record(`localizePath, a translated path to another locale (${n(entries)} entries of 5 locales)`, 'time', 'µs', micro(() => localizePath(localized(), 'de')));
  }

  // The first call compiles the table: the first load of a tab and of a server process pays for it.
  const fresh = translatePathnames(pathnames(1_000));
  let first = wiring;

  record('reroute, its first call, which compiles the table (1,000 entries of 5 locales)', 'time', 'ms', time(() => first.reroute({ url: new URL('https://x.test/de/strana1/42') }), {
    setup: () => { first = defineI18n({ parser, log, loaders: loaders(table(20, 'namespaces'), LOCALES) }, { pathnames: fresh }); },
  }));

  const deep = cycle(Array.from({ length: 2 }, (_, i) => new URL(`https://x.test/cs/${'x/'.repeat(1_000)}${i}`)));

  record('reroute, a pathname of 1,000 segments', 'time', 'µs', micro(() => wiring.reroute({ url: deep() })));
});
