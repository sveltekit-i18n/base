import { I18n } from '@sveltekit-i18n/base';
import { expect, it } from 'vitest';

import { collect, time, timeAsync } from './collect.js';
import { key, loaders, log, n, navigate, parser, table } from './data.js';

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

  // `Intl` throws on the locale, which the config serves as it is spelled.
  const rejected = new I18n({ parser, log, translations: { qqq_x: { ns: { key: 'v' } } } });

  expect(rejected.l('qqq_x', 'ns.key')).toBe('v');
  record('l, a hit in a locale Intl rejects', 'time', 'µs', micro(() => rejected.l('qqq_x', 'ns.key')));
}, TIMEOUT);

it('enumerating a table', async () => {
  const keys = 200;
  const i18n = new I18n({ parser, log, loaders: loaders(table(keys, 'namespaces')) });

  await i18n.loadTranslations('en', '/');

  const { en } = i18n.translations;

  expect(Object.keys(en)).toHaveLength(keys);
  record(`Object.keys of a loaded table of ${n(keys)} keys`, 'time', 'µs', 1_000 * time(() => Object.keys(en), { inner: 2_000 }));
}, TIMEOUT);

it('a config', () => {
  // Each descriptor expands to a loader per locale, all sharing its routes list.
  const descriptors = Array.from({ length: 2_000 }, (_, n) => ({
    locale: ['en', 'cs', 'de', 'fr', 'es'],
    namespace: `page${n}`,
    routes: [new RegExp(`^/page${n}/(?<id>[^/]+)$`)],
    loader: async () => ({ title: 'v' }),
  }));

  expect(new I18n({ parser, log, loaders: descriptors }).locales).toHaveLength(5);

  record(`new I18n, ${n(2_000)} loader descriptors of 5 locales each`, 'time', 'ms', time(() => new I18n({ parser, log, loaders: descriptors }), { samples: 5 }));
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

it('a seed over a wide namespace a loader delivered', async () => {
  const keys = 2_000;
  const data = Object.fromEntries(Array.from({ length: keys }, (_, i) => [`g.k${i}`, `v${i}`]));
  let i18n = new I18n({ parser, log });

  // One key in each spelling, so both the merge and the dot notation mask a key of the delivery.
  record(`addTranslations, a seed over a flat namespace of ${n(keys)} delivered keys`, 'time', 'ms', await timeAsync(async () => {
    i18n.addTranslations({ en: { common: { 'g.k0': 'flat' } } });
    i18n.addTranslations({ en: { common: { g: { k1: 'nested' } } } });
  }, {
    samples: 5,
    setup: async () => {
      i18n = new I18n({ parser, log, loaders: [{ locale: 'en', namespace: 'common', loader: async () => data }] });
      await i18n.loadTranslations('en', '/');
    },
  }));

  expect([i18n.t('common.g.k0'), i18n.t('common.g.k1'), i18n.t(`common.g.k${keys - 1}`)]).toEqual(['flat', 'nested', `v${keys - 1}`]);
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

  const item = [/^\/item\/(?<id>\d+)$/];
  const navigator = new I18n({
    parser,
    log,
    loaders: [
      { locale: 'en', namespace: 'live', routes: item, cache: false, loader: async ({ params }) => ({ id: params.id ?? '' }) },
      { locale: 'en', namespace: 'item', routes: item, loader: async ({ params }) => ({ id: params.id ?? '' }) },
    ],
  });
  let page = 0;

  await navigator.loadTranslations('en', '/item/0');

  record('a navigation to new params, a loader with cache: false beside a cached one', 'time', 'ms', await timeAsync(() => navigate(navigator, `/item/${++page}`)));

  expect(navigator.translations.en).toEqual({ 'live.id': `${page}`, 'item.id': `${page}` });

  const others = Array.from({ length: 50 }, (_, n) => `l${n}`);
  const wide = new I18n({ parser, log, sanitizeLocales: false, loaders: routed.map((loader) => ({ ...loader, locale: others })) });
  let step = 0;

  await wide.loadTranslations('l0', '/');

  record(`setRoute, to new params among 200 routes of 50 locales (${n(10_000)} loaders)`, 'time', 'ms', await timeAsync(() => wide.setRoute(`/page199/${step++}`)));

  // A load that delivers several namespaces orders them, beside the loaders
  // of 99 other locales.
  const hundred = Array.from({ length: 100 }, (_, n) => `l${n}`);
  const spread = routed.slice(0, 100).map(({ routes, ...loader }) => ({ ...loader, locale: hundred }));
  let reloaded = new I18n({ parser, log, sanitizeLocales: false, loaders: spread });

  record(`loadTranslations of a new instance, 100 namespaces of 100 locales (${n(10_000)} loaders)`, 'time', 'ms', await timeAsync(() => reloaded.loadTranslations('l99'), {
    setup: () => { reloaded = new I18n({ parser, log, sanitizeLocales: false, loaders: spread }); },
  }));
  record(`loadTranslations again, 100 namespaces of 100 locales (${n(10_000)} loaders)`, 'time', 'ms', await timeAsync(() => reloaded.loadTranslations('l99'), {
    setup: () => reloaded.invalidate('l99'),
  }));

  const switcher = await loaded();
  let locale = 'en';

  record(`setLocale, between two loaded locales (${n(KEYS)} keys)`, 'time', 'ms', await timeAsync(() => switcher.setLocale(locale = locale === 'en' ? 'cs' : 'en')));
}, TIMEOUT);

it('the SSR hand-off', async () => {
  const server = await loaded();
  const envelope = server.snapshot({ records: true });

  record(`snapshot({ records: true }) (${n(KEYS)} keys)`, 'time', 'ms', time(() => server.snapshot({ records: true })));

  // Seeded namespaces a loader also delivers, so each is a table the merge built.
  const five = (prefix: string) => Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`k${i}`, `${prefix}${i}`]));
  const namespaces = Array.from({ length: 10 }, (_, i) => `ns${i}`);
  const seeds = Object.fromEntries(namespaces.map((namespace) => [namespace, five('s')]));
  const seeded = new I18n({
    parser,
    log,
    fallbackLocale: 'cs',
    translations: { en: seeds, cs: seeds },
    loaders: ['en', 'cs'].flatMap((locale) => namespaces.map((namespace) => ({ locale, namespace, loader: async () => ({ ...five('l'), extra: 'v' }) }))),
  });

  await seeded.loadTranslations('en', '/');

  expect(seeded.snapshot({ records: true }).records).toHaveLength(20);

  record('snapshot({ records: true }), a locale and its fallback of 10 seeded namespaces of 5 keys', 'time', 'µs', 1_000 * time(() => seeded.snapshot({ records: true }), { inner: 200 }));

  const width = 2_000;
  const wide = new I18n({ parser, log, loaders: [{ locale: 'en', namespace: 'nav', loader: async () => ({ home: 'Home' }) }] });

  await wide.loadTranslations('en', '/');
  wide.addTranslations({ en: { common: JSON.parse(JSON.stringify(table(width, 'flat')).replace('{', '{"__proto__": "x", ')) } });

  expect(Object.keys(wide.snapshot().en.common)).toHaveLength(width);

  record(`snapshot(), a level of ${n(width)} keys holding an own __proto__ key`, 'time', 'ms', time(() => wide.snapshot(), { samples: 5 }));

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

it('one more instance holding a loaded table', async () => {
  const gc = (globalThis as { gc?: () => void }).gc;

  if (!gc) throw new Error('The instance rows need --expose-gc.');

  const instances = 200;

  for (const keys of [200, 1_000]) {
    const config = { parser, log, loaders: loaders(table(keys, 'namespaces')) };
    const held: I18n[] = [];
    const hold = async () => {
      const i18n = new I18n(config);

      await i18n.loadTranslations('en', '/');
      held.push(i18n);
    };

    // The first instance allocates what any load allocates once, and in V8
    // the hidden classes of its key set, which a table in dictionary mode never
    // takes: the rows measure each further instance with the same keys, as a
    // server builds one per request.
    await hold();
    gc();

    const before = process.memoryUsage().heapUsed;

    for (let i = 0; i < instances; i++) await hold();

    gc();

    const retained = process.memoryUsage().heapUsed - before;

    expect(held.map((i18n) => Object.keys(i18n.translations.en).length)).toEqual(Array(instances + 1).fill(keys));
    record(`heap retained per additional instance holding a table of the same ${n(keys)} keys`, 'time', 'B', retained / instances);
  }
}, TIMEOUT);
