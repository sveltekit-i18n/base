import { defineI18n } from '@sveltekit-i18n/base/kit';
import { expect, it } from 'vitest';

import { collect, timeAsync } from './collect.js';
import { loaders, log, n, parser, table } from './data.js';

const record = collect(import.meta.filename);

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
