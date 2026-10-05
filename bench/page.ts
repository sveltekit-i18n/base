import { defineI18n } from '@sveltekit-i18n/base/kit';
import { flushSync, mount, unmount } from 'svelte';
import { afterAll, expect, it } from 'vitest';
import { builtinEnvironments } from 'vitest/environments';

import { collect, timeAsync } from './collect.js';
import { loaders, log, n, parser, table } from './data.js';
import Page from './Page.svelte';

const record = collect(import.meta.filename);

const KEYS = 10_000;

// A DOM for this file alone: as the environment of the file, it would resolve
// the modules for a browser, and the rows could not be written.
const dom = await builtinEnvironments['happy-dom'].setup(globalThis, {});

afterAll(() => dom.teardown(globalThis));

// A tab's first page in the browser without a hand-off to hydrate (no server
// load, `ssr = false`): the root layout's load, then its mount, until the
// first commit settled. The time row leaves the load out: it measures what the
// commit adds to the paint.
it('the first page in the browser', async () => {
  const data = table(KEYS, 'namespaces');
  let runs = 0;

  const load = async () => {
    const wiring = defineI18n({
      parser,
      log,
      loaders: [
        ...loaders(data),
        { locale: 'en', namespace: 'live', cache: false, loader: async () => ({ runs: `${++runs}` }) },
      ],
    });

    return { use: wiring.use, data: await wiring.load({ url: new URL('https://x.test/'), params: {}, route: { id: '/' }, data: null }) };
  };

  const commit = async ({ use, data: loaded }: Awaited<ReturnType<typeof load>>) => {
    const component = mount(Page, { target: document.body, props: { use, data: loaded } });

    flushSync();

    while (loaded.i18n.loading) await new Promise((resolve) => setImmediate(resolve));

    void unmount(component);

    return loaded.i18n;
  };

  const i18n = await commit(await load());

  expect([i18n.locale, i18n.t('ns0.k0')]).toEqual(['en', 'v0']);
  record('loader runs of a cache: false loader, a first page in the browser without a hand-off', 'count', 'runs', runs);

  let page: Awaited<ReturnType<typeof load>>;

  record(`the first page in the browser without a hand-off, its first commit until settled (${n(KEYS)} keys)`, 'time', 'ms', await timeAsync(() => commit(page), { setup: async () => { page = await load(); } }));
}, 600_000);
