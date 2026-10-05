import { I18n } from '@sveltekit-i18n/base';
import { expect, it } from 'vitest';

import { collect } from './collect.js';
import { loaders, log, n, parser, table } from './data.js';

const record = collect(import.meta.filename);

const TIMEOUT = 600_000;

const gc = (globalThis as { gc?: () => void }).gc;

if (!gc) throw new Error('The heap rows need --expose-gc.');

// The heap in use once the tasks already queued have run and two collections
// have freed what they can: a queued task (the runner reports a test from a
// timer) keeps what it references until it runs, and a second collection
// still frees a few kB the first one leaves.
const heap = async () => {
  await new Promise((resolve) => setImmediate(resolve));
  gc();
  gc();

  return process.memoryUsage().heapUsed;
};

it('retention', async () => {
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

  const before = await heap();

  for (let i = 1_001; i <= 11_000; i++) await i18n.setRoute(`/item/${i}`);

  record('heap retained by 10,000 navigations to new params', 'heap', 'B', await heap() - before);
}, TIMEOUT);

it('one more instance holding a loaded table', async () => {
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

    const before = await heap();

    for (let i = 0; i < instances; i++) await hold();

    const retained = await heap() - before;

    expect(held.map((i18n) => Object.keys(i18n.translations.en).length)).toEqual(Array(instances + 1).fill(keys));
    record(`heap retained per additional instance holding a table of the same ${n(keys)} keys`, 'heap', 'B', retained / instances);
  }
}, TIMEOUT);
