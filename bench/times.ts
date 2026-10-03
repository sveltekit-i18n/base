import { I18n } from '@sveltekit-i18n/base';
import { expect, it } from 'vitest';

import { collect, time, timeAsync } from './collect.js';
import { key, loaders, log, n, parser, table } from './data.js';

const record = collect(import.meta.filename);

const KEYS = 10_000;
const TIMEOUT = 600_000;

const loaded = async (keys = KEYS) => {
  const data = table(keys, 'namespaces');
  const i18n = new I18n({ parser, log, fallbackLocale: 'cs', loaders: loaders(data, ['en', 'cs']), translations: { cs: { only: { key: 'v' } } } });

  await i18n.loadTranslations('en', '/');
  await i18n.loadTranslations('cs', '/', { activate: false });

  return i18n;
};

it('t and l', async () => {
  const i18n = await loaded();
  const hit = key(KEYS / 2, KEYS, 'namespaces');

  expect([i18n.t(hit), i18n.t('only.key'), i18n.l('cs', hit)]).toEqual([`v${KEYS / 2}`, 'v', `v${KEYS / 2}`]);

  const micro = (fn: () => void) => 1_000 * time(fn, { inner: 2_000 });

  record(`t, a hit (${n(KEYS)} keys)`, 'time', 'µs', micro(() => i18n.t(hit)));
  record(`t, a missing key (${n(KEYS)} keys)`, 'time', 'µs', micro(() => i18n.t('ns0.missing')));
  record(`t, from fallbackLocale (${n(KEYS)} keys)`, 'time', 'µs', micro(() => i18n.t('only.key')));
  record(`t, with params (${n(KEYS)} keys)`, 'time', 'µs', micro(() => i18n.t(hit, { name: 'x' })));
  record(`l, a hit (${n(KEYS)} keys)`, 'time', 'µs', micro(() => i18n.l('cs', hit)));
}, TIMEOUT);

it('addTranslations', () => {
  for (const keys of [10_000, 100_000]) {
    const data = { en: table(keys, 'nested') };

    for (const preprocess of ['full', 'preserveArrays', 'none'] as const) {
      let i18n = new I18n({ parser, log, preprocess });

      record(`addTranslations, preprocess '${preprocess}' (${n(keys)} nested keys)`, 'time', 'ms', time(() => i18n.addTranslations(data), {
        samples: keys > 10_000 ? 5 : 15,
        setup: () => { i18n = new I18n({ parser, log, preprocess }); },
      }));
    }
  }
}, TIMEOUT);

it('a delivery into a namespace other loaders fill', async () => {
  for (const count of [1, 10, 50]) {
    const shared = Array.from({ length: count }, (_, n) => ({
      locale: 'en',
      namespace: 'shared',
      loader: async () => Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`k${n}_${i}`, 'v'])),
    }));
    const i18n = new I18n({ parser, log, loaders: [...loaders(table(KEYS, 'single')), ...shared] });

    await i18n.loadTranslations('en', '/');

    record(`a namespace delivered again, filled by ${count} loader${count === 1 ? '' : 's'} (beside ${n(KEYS)} keys)`, 'time', 'ms', await timeAsync(() => i18n.loadTranslations('en', '/'), {
      setup: () => i18n.invalidate('en', 'shared'),
    }));
  }
}, TIMEOUT);

it('loads', async () => {
  const data = table(10_000, 'namespaces');
  const many = loaders(Object.fromEntries(Object.entries(data).slice(0, 100)));
  let i18n = new I18n({ parser, log, loaders: many });

  record('loadTranslations, 100 namespaces', 'time', 'ms', await timeAsync(() => i18n.loadTranslations('en'), {
    setup: () => { i18n = new I18n({ parser, log, loaders: many }); },
  }));

  const routed = Array.from({ length: 200 }, (_, n) => ({
    locale: 'en',
    namespace: `page${n}`,
    routes: [new RegExp(`^/page${n}/(?<id>[^/]+)$`)],
    loader: async () => ({ title: 'v' }),
  }));
  const router = new I18n({ parser, log, loaders: routed });
  let id = 0;

  await router.loadTranslations('en', '/');

  record('setRoute, to new params among 200 routes', 'time', 'ms', await timeAsync(() => router.setRoute(`/page199/${id++}`)));

  const switcher = await loaded();
  let locale = 'en';

  record(`setLocale, between two loaded locales (${n(KEYS)} keys)`, 'time', 'ms', await timeAsync(() => switcher.setLocale(locale = locale === 'en' ? 'cs' : 'en')));
}, TIMEOUT);

it('the SSR hand-off', async () => {
  const server = await loaded();
  const envelope = server.snapshot({ records: true });

  record(`snapshot({ records: true }) (${n(KEYS)} keys)`, 'time', 'ms', time(() => server.snapshot({ records: true })));

  const config = { parser, log, loaders: loaders(table(KEYS, 'namespaces'), ['en', 'cs']) };
  let client = new I18n(config);

  record(`hydrate() (${n(KEYS)} keys)`, 'time', 'ms', time(() => client.hydrate(envelope), {
    setup: () => { client = new I18n(config); },
  }));
}, TIMEOUT);

it('retention', async () => {
  const gc = (globalThis as { gc?: () => void }).gc;

  if (!gc) throw new Error('The retention row needs --expose-gc.');

  const i18n = new I18n({
    parser,
    log,
    loaders: [{ locale: 'en', namespace: 'item', routes: [/^\/item\/(?<id>\d+)$/], loader: async ({ params }) => ({ id: params.id ?? '' }) }],
  });

  await i18n.setRoute('/item/0');
  await i18n.setLocale('en');

  // The first thousand warm up what any navigation allocates once; what the
  // next ten thousand leave behind is what navigations retain.
  for (let i = 1; i <= 1_000; i++) await i18n.setRoute(`/item/${i}`);

  gc();

  const before = process.memoryUsage().heapUsed;

  for (let i = 1_001; i <= 11_000; i++) await i18n.setRoute(`/item/${i}`);

  gc();
  record('heap retained by 10,000 navigations to new params', 'time', 'B', process.memoryUsage().heapUsed - before);
}, TIMEOUT);
