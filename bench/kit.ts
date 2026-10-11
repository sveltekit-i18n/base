import * as kit from '@sveltekit-i18n/base/kit';
import { expect, it } from 'vitest';

import { collect, time, timeAsync } from './collect.js';
import { loaders, log, n, parser, table } from './data.js';

const record = collect(import.meta.filename);

const { defineI18n } = kit;
// A base without translated pathnames has no `translatePathnames`, and one without domains no `localeDomains`.
const { translatePathnames, localeDomains } = kit as Partial<typeof kit>;

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

/**
 * A table of `entries` pathnames in 5 locales, half of them static and half
 * with a param, beside a catch-all, each under the locale's prefix or, `shared`,
 * the static ones and the catch-all one pattern of all 5.
 */
const pathnames = (entries: number, shared = false) => Object.fromEntries([
  ...Array.from({ length: entries }, (_, i) => {
    const tail = i % 2 ? '/[id]' : '';

    return [`/page${i}${tail}`, Object.fromEntries(LOCALES.map((locale) => [locale, `${shared && !tail ? '' : `/${locale}`}/strana${i}${tail}`]))];
  }),
  ['/[...rest]', Object.fromEntries(LOCALES.map((locale) => [locale, `${shared ? '' : `/${locale}`}/[...rest]`]))],
]);

// Distinct pathnames, so each call walks the trie rather than reading the last answer back.
const cycle = <T>(values: T[]) => {
  let at = 0;

  return () => values[at++ % values.length];
};
const micro = (fn: () => void) => 1_000 * time(fn, { inner: 2_000 });

it('translated pathnames', () => {
  // A base without translated pathnames measures none of them.
  if (!translatePathnames) return;

  const wiring = defineI18n({ parser, log, loaders: loaders(table(20, 'namespaces'), LOCALES) }, { pathnames: translatePathnames(pathnames(1_000)) });

  for (const entries of [10, 1_000]) {
    const { delocalize, reroute, localizePath } = defineI18n({ parser, log, loaders: loaders(table(20, 'namespaces'), LOCALES) }, { pathnames: translatePathnames(pathnames(entries)) });
    const { reroute: rerouteShared } = defineI18n({ parser, log, loaders: loaders(table(20, 'namespaces'), LOCALES) }, { pathnames: translatePathnames(pathnames(entries, true)) });
    const translated = cycle(Array.from({ length: 64 }, (_, i) => new URL(`https://x.test/${LOCALES[i % 5]}/strana${(i * 7) % entries}${(i * 7) % entries % 2 ? `/${i}` : ''}`)));
    const missed = cycle(Array.from({ length: 64 }, (_, i) => new URL(`https://x.test/elsewhere/${i}`)));
    // The catch-all takes these, though each of their pages has a pathname of its own in the locale.
    const elsewhere = cycle(Array.from({ length: 64 }, (_, i) => new URL(`https://x.test/${LOCALES[i % 5]}/page${(i * 7) % entries}${(i * 7) % entries % 2 ? `/${i}` : ''}`)));
    // The static pages of the shared table, which a catch-all the locales share too ranks below.
    const shared = cycle(Array.from({ length: 64 }, (_, i) => new URL(`https://x.test/strana${((i * 7) % Math.ceil(entries / 2)) * 2}`)));
    const canonical = cycle(Array.from({ length: 64 }, (_, i) => `/page${(i * 7) % entries}${(i * 7) % entries % 2 ? `/${i}` : ''}`));

    expect(rerouteShared({ url: new URL('https://x.test/strana2') })).toBe('/page2');
    expect([reroute({ url: new URL('https://x.test/de/strana1/42') }), localizePath('/page1/42', 'cs'), localizePath(delocalize(new URL('https://x.test/cs/strana1/42')).path, 'de')]).toEqual(['/page1/42', '/cs/strana1/42', '/de/strana1/42']);

    record(`reroute, a translated pathname (${n(entries)} entries of 5 locales)`, 'time', 'µs', micro(() => reroute({ url: translated() })));
    record(`delocalize, a translated pathname (${n(entries)} entries of 5 locales)`, 'time', 'µs', micro(() => delocalize(translated())));
    record(`reroute, a pathname no entry translates (${n(entries)} entries of 5 locales)`, 'time', 'µs', micro(() => reroute({ url: missed() })));
    record(`reroute, a pathname another pathname of its page serves (${n(entries)} entries of 5 locales)`, 'time', 'µs', micro(() => reroute({ url: elsewhere() })));
    record(`reroute, a pathname of a pattern the locales share (${n(entries)} entries of 5 locales)`, 'time', 'µs', micro(() => rerouteShared({ url: shared() })));
    record(`localizePath, a canonical path to a locale (${n(entries)} entries of 5 locales)`, 'time', 'µs', micro(() => localizePath(canonical(), 'de')));
    record(`localizePath of delocalize, a translated pathname to another locale (${n(entries)} entries of 5 locales)`, 'time', 'µs', micro(() => localizePath(delocalize(translated()).path, 'de')));
  }

  // The first call compiles the table: the first load of a tab and of a server process pays for it.
  const fresh = translatePathnames(pathnames(1_000));
  let first = wiring;

  record('reroute, its first call, which compiles the table (1,000 entries of 5 locales)', 'time', 'ms', time(() => first.reroute({ url: new URL('https://x.test/de/strana1/42') }), {
    setup: () => { first = defineI18n({ parser, log, loaders: loaders(table(20, 'namespaces'), LOCALES) }, { pathnames: fresh }); },
  }));

  // Half the patterns shared by the 5 locales: the server checks each for a pattern of one locale alone that ranks above it.
  const shared = translatePathnames(pathnames(1_000, true));

  record('reroute, its first call, which compiles a table the locales share half of (1,000 entries of 5 locales)', 'time', 'ms', time(() => first.reroute({ url: new URL('https://x.test/strana2') }), {
    setup: () => { first = defineI18n({ parser, log, loaders: loaders(table(20, 'namespaces'), LOCALES) }, { pathnames: shared }); },
  }));

  const deep = cycle(Array.from({ length: 2 }, (_, i) => new URL(`https://x.test/cs/${'x/'.repeat(1_000)}${i}`)));

  record('reroute, a pathname of 1,000 segments', 'time', 'µs', micro(() => wiring.reroute({ url: deep() })));

  const files = defineI18n({ parser, log, loaders: loaders(table(20, 'namespaces'), LOCALES) }, {
    pathnames: translatePathnames({ ...pathnames(1_000), '/files/[...path]': Object.fromEntries(LOCALES.map((locale) => [locale, `/${locale}/soubory/[...path]`])) }),
  });
  const astray = cycle(Array.from({ length: 2 }, (_, i) => new URL(`https://x.test/cs/files/${'x/'.repeat(1_000)}${i}`)));

  record('reroute, a pathname of 1,000 segments another pathname of its page serves', 'time', 'µs', micro(() => files.reroute({ url: astray() })));
}, 600_000);

it('domains', async () => {
  // A base without domains measures none of them.
  if (!localeDomains) return;

  const domains = localeDomains(Object.fromEntries(LOCALES.map((locale) => [`https://example.${locale}`, locale])));
  const { delocalize, load, localizeHref } = defineI18n({ parser, log, loaders: loaders(table(KEYS, 'namespaces'), LOCALES) }, { domains });
  const from = new URL('https://example.cs/');
  const onDomain = () => ({ ...event(), url: new URL('https://example.de/') });

  expect([(await load(onDomain())).i18n.locale, localizeHref('/about', 'de', from), localizeHref('/about', 'cs', from), delocalize(from)]).toEqual(['de', 'https://example.de/about', '/about', { path: '/', domain: 'cs' }]);

  record(`the server load, a page render on a domain (${n(KEYS)} keys)`, 'time', 'ms', await timeAsync(() => load(onDomain())));
  record('delocalize, a URL on a domain (5 domains)', 'time', 'µs', 1_000 * time(() => delocalize(from), { inner: 2_000 }));
  record('localizeHref, a link to the domain of another locale (5 domains)', 'time', 'µs', 1_000 * time(() => localizeHref('/about', 'de', from), { inner: 2_000 }));
}, 600_000);

it('translated pathnames on a domain', () => {
  // A base without translated pathnames or domains reads no pathname on a host.
  if (!translatePathnames || !localeDomains) return;

  const domains = localeDomains({ 'https://example.com': ['cs', 'de'], 'https://example.eu': ['fr', 'es', 'it'] });

  for (const entries of [10, 1_000]) {
    const hosted = defineI18n({ parser, log, loaders: loaders(table(20, 'namespaces'), LOCALES) }, { pathnames: translatePathnames(pathnames(entries)), domains });
    const hostedShared = defineI18n({ parser, log, loaders: loaders(table(20, 'namespaces'), LOCALES) }, { pathnames: translatePathnames(pathnames(entries, true)), domains });
    const at = (host: string, locale: string, i: number) => new URL(`https://${host}/${locale}/strana${(i * 7) % entries}${(i * 7) % entries % 2 ? `/${i}` : ''}`);
    const own = cycle(Array.from({ length: 64 }, (_, i) => at('example.com', LOCALES[i % 2], i)));
    // Pathnames of the locales of the other host, which a base whose `reroute` ignores the host serves.
    const foreign = cycle(Array.from({ length: 64 }, (_, i) => at('example.com', LOCALES[2 + (i % 3)], i)));
    const sharedOn = cycle(Array.from({ length: 64 }, (_, i) => new URL(`https://example.eu/strana${((i * 7) % Math.ceil(entries / 2)) * 2}`)));

    expect([hosted.reroute({ url: new URL('https://example.com/de/strana1/42') }), hosted.delocalize(new URL('https://example.com/de/strana1/42'))]).toEqual(['/page1/42', { path: '/page1/42', locale: 'de', domain: 'cs' }]);
    expect(hostedShared.delocalize(new URL('https://example.eu/strana2'))).toEqual({ path: '/page2', domain: 'fr' });

    record(`reroute, a translated pathname on a host of its locale (${n(entries)} entries of 5 locales, 2 hosts)`, 'time', 'µs', micro(() => hosted.reroute({ url: own() })));
    record(`reroute, a translated pathname on a host of other locales (${n(entries)} entries of 5 locales, 2 hosts)`, 'time', 'µs', micro(() => hosted.reroute({ url: foreign() })));
    record(`delocalize, a translated pathname on a host of its locale (${n(entries)} entries of 5 locales, 2 hosts)`, 'time', 'µs', micro(() => hosted.delocalize(own())));
    record(`delocalize, a pathname of a pattern the 3 locales of its host share (${n(entries)} entries of 5 locales, 2 hosts)`, 'time', 'µs', micro(() => hostedShared.delocalize(sharedOn())));
  }
}, 600_000);
