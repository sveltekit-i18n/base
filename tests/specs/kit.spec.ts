// @vitest-environment happy-dom
import * as devalue from 'devalue';
import { flushSync, mount, unmount } from 'svelte';
import { beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';

import { BROWSER } from '#kit-env';

import { defineI18n } from '../../src/kit/define.svelte.js';
import * as server from '../../src/kit/server.js';
import type { Shared } from '../../src/kit/internal.js';
import * as stub from '../../src/kit/server.browser.js';
import type { Kit } from '../../src/kit/types.js';
import Layout from '../components/Layout.svelte';
import Outside from '../components/Outside.svelte';
import { effectsRun } from '../utils/effect.svelte.js';
import { cell } from '../utils/state.svelte.js';

const valueParser = { parse: (text: any, _params: any, _locale: any, key: string) => (text === undefined ? key : String(text)) };

const setup = (extra: Record<string, any> = {}, options: Kit.Options = {}) => {
  const calls: string[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];

  const loader = (locale: string, namespace: string, routes?: string[]) => ({
    locale,
    namespace,
    routes,
    loader: ({ route }: { route: string }) => {
      calls.push(`${locale}:${namespace}:${route}`);

      return Promise.resolve({ greeting: `${namespace} ${locale}` });
    },
  });

  const config = {
    parser: valueParser,
    log: {
      level: 'warn' as const,
      logger: { error: (message: string) => { errors.push(message); }, warn: (message: string) => { warnings.push(message); }, debug: () => {} },
    },
    loaders: [loader('en', 'common'), loader('cs', 'common'), loader('en', 'about', ['/about']), loader('cs', 'about', ['/about'])],
    ...extra,
  };

  return { ...(defineI18n(config, options) as unknown as Kit.T<any>), calls, errors, warnings };
};

const url = (path: string) => new URL(`https://x.test${path}`);

type EventOptions = { lang?: string; isDataRequest?: boolean; cookie?: string; id?: string | null };

const serverEvent = (path: string, { lang = 'cs', isDataRequest = false, cookie, id = path }: EventOptions = {}) => ({
  url: url(path),
  params: {},
  route: { id },
  isDataRequest,
  cookies: { get: (name: string) => (name === 'lang' ? cookie : undefined) },
  request: new Request(`https://x.test${path}`, { headers: { 'accept-language': lang } }),
});

const universalEvent = (path: string, data: Record<string, any> | null, params: Record<string, string> = {}) => ({
  url: url(path), params, route: { id: path }, data,
});

// What SvelteKit does to server data between the server and the browser.
const wire = <T>(value: T): T => devalue.parse(devalue.stringify(value)) as T;

const html = async ({ handle }: Pick<Kit.T, 'handle'>, event: ReturnType<typeof serverEvent>, template = '<html lang="%lang%">') => {
  let out = '';

  await handle({
    event,
    resolve: (_event, options) => {
      out = options?.transformPageChunk?.({ html: template, done: true }) ?? '';

      return new Response(out);
    },
  });

  return out;
};

describe('/kit', () => {
  it('runs effects exactly in the client compile, where #kit-env is true', ({ task }) => {
    expect(effectsRun).toBe(task.file.projectName === 'client');
    expect(BROWSER).toBe(task.file.projectName === 'client');
  });

  it('ships a browser stub with the server half\'s exports, which throws', () => {
    expect(Object.keys(stub)).toEqual(Object.keys(server));

    const half = stub.serverHalf({} as Shared);

    expect(() => half.handle({} as any)).toThrow('run on the server only');
    expect(() => half.load({} as any)).toThrow('run on the server only');
  });

  it('throws a named error from use() without the pass of load', () => {
    const { use } = setup();

    expect(() => use(() => ({}))).toThrow('`use()` found no data from `load`');
  });

  describe.skipIf(BROWSER)('server half', () => {
    it('fills %lang% from Accept-Language, then from preferredLocale', async () => {
      expect(await html(setup(), serverEvent('/', { lang: 'cs,en;q=0.5' }))).toBe('<html lang="cs">');
      expect(await html(setup({}, { preferredLocale: (event) => event.cookies?.get('lang') }), serverEvent('/', { cookie: 'en' }))).toBe('<html lang="en">');
      expect(await html(setup(), serverEvent('/', { lang: 'fr' }))).toBe('<html lang="">');
    });

    it('fills %dir% from the same negotiation', async () => {
      const template = '<html lang="%lang%" dir="%dir%">';
      const arabic = setup({ translations: { ar: { 'common.greeting': 'Marhaban' } } });

      expect(await html(arabic, serverEvent('/', { lang: 'ar-EG,en;q=0.5' }), template)).toBe('<html lang="ar" dir="rtl">');
      expect(await html(setup(), serverEvent('/', { lang: 'cs' }), template)).toBe('<html lang="cs" dir="ltr">');
      expect(await html(setup(), serverEvent('/', { lang: 'fr' }), template)).toBe('<html lang="" dir="ltr">');
      expect(await html(arabic, serverEvent('/', { lang: 'ar' }), '<html dir="%dir%">')).toBe('<html dir="rtl">');
    });

    it('negotiates once for both placeholders', async () => {
      const preferredLocale = vi.fn(() => 'en');

      expect(await html(setup({}, { preferredLocale }), serverEvent('/'), '<html lang="%lang%" dir="%dir%">')).toBe('<html lang="en" dir="ltr">');
      expect(preferredLocale).toHaveBeenCalledTimes(1);
    });

    it('fills the <html> start tag only, every placeholder there', async () => {
      const template = (tag: string) => `<!doctype html><!-- %lang% -->${tag}<head><title>%lang% %dir%</title><meta content="%lang%"></head><body><p dir="%dir%">%lang%</p></body></html>`;

      expect(await html(setup(), serverEvent('/'), template('<html lang="%lang%" dir="%dir%" data-x="%lang%">')))
        .toBe(template('<html lang="cs" dir="ltr" data-x="cs">'));
      expect(await html(setup(), serverEvent('/'), template('<HTML LANG="%lang%">'))).toBe(template('<HTML LANG="cs">'));
      expect(await html(setup(), serverEvent('/'), template('<html>'))).toBe(template('<html>'));
    });

    it('fills the first chunk only, and leaves a page without an <html> tag alone', async () => {
      const chunks = ['<head><title>%lang%</title></head>', '<html lang="%lang%">'];
      const out: string[] = [];

      await setup().handle({
        event: serverEvent('/'),
        resolve: (_event, options) => {
          chunks.forEach((html, index) => { out.push(options?.transformPageChunk?.({ html, done: index === chunks.length - 1 }) ?? ''); });

          return new Response(out.join(''));
        },
      });

      expect(out).toEqual(chunks);
      expect(await html(setup(), serverEvent('/'), '<htmlx lang="%lang%"><html lang="%lang%"')).toBe('<htmlx lang="%lang%"><html lang="%lang%"');
    });

    it('negotiates in handle only for a chunk that asks for %lang%', async () => {
      const preferredLocale = vi.fn(() => 'en');
      const { handle } = setup({}, { preferredLocale });

      await handle({
        event: serverEvent('/'),
        resolve: (_event, options) => new Response(options?.transformPageChunk?.({ html: '<body>', done: true })),
      });
      expect(preferredLocale).not.toHaveBeenCalled();
    });

    it('skips a preferred locale nothing serves', async () => {
      const { load } = setup({}, { preferredLocale: () => 'fr' });

      expect((await load(serverEvent('/', { isDataRequest: true }))).i18n.locale).toBe('cs');
    });

    it('logs a throwing preferredLocale once and negotiates without it', async () => {
      const { load, errors } = setup({}, { preferredLocale: () => { throw new Error('cookie'); } });

      expect((await load(serverEvent('/', { isDataRequest: true }))).i18n.locale).toBe('cs');
      expect((await load(serverEvent('/', { isDataRequest: true }))).i18n.locale).toBe('cs');
      expect(errors).toEqual(['[i18n]: `preferredLocale` failed. Negotiating without it.']);
    });

    it('sends the tables on a page render only, and reads url first', async () => {
      const { load, calls } = setup();
      const page = await load(serverEvent('/about'));

      expect(wire(page)).toEqual(page);
      expect(page.i18n.locale).toBe('cs');
      expect(page.i18n.translations?.cs).toMatchObject({ about: { greeting: 'about cs' } });
      expect(calls).toEqual(['cs:common:/about', 'cs:about:/about']);

      const event = serverEvent('/about', { isDataRequest: true });
      const read = vi.spyOn(event.url, 'pathname', 'get');

      expect(await load(event)).toEqual({ i18n: { locale: 'cs', route: '/about' } });
      expect(read).toHaveBeenCalled();
      expect(calls).toHaveLength(2);
    });

    it('builds an instance per request, so concurrent requests keep their locales', async () => {
      const { load } = setup();
      const [cs, en] = await Promise.all([load(serverEvent('/', { lang: 'cs' })), load(serverEvent('/', { lang: 'en' }))]);

      expect(cs.i18n.locale).toBe('cs');
      expect(en.i18n.locale).toBe('en');
      expect(Object.keys(cs.i18n.translations ?? {})).toEqual(['cs']);
    });

    it('starts no initLocale load of its own, and falls back to initLocale, then fallbackLocale', async () => {
      const init = setup({ initLocale: 'en' });

      expect((await init.load(serverEvent('/', { lang: 'fr' }))).i18n.locale).toBe('en');
      expect(init.calls).toEqual(['en:common:/']);

      const fallback = setup({ fallbackLocale: 'en' });

      expect((await fallback.load(serverEvent('/', { lang: 'fr', isDataRequest: true }))).i18n.locale).toBe('en');

      const both = setup({ initLocale: 'cs', fallbackLocale: 'en' });

      expect((await both.load(serverEvent('/', { lang: 'fr', isDataRequest: true }))).i18n.locale).toBe('cs');
      expect((await init.load(serverEvent('/', { lang: 'cs', isDataRequest: true }))).i18n.locale).toBe('cs');
    });

    it('sets the route alone when nothing matches', async () => {
      const { load, calls } = setup();
      const page = await load(serverEvent('/about', { lang: 'fr' }));

      expect(page.i18n.locale).toBe(undefined);
      expect(page.i18n.route).toBe('/about');
      expect(calls).toEqual([]);
    });

    it('strips basePath from the route it hands over', async () => {
      const { load } = setup({ basePath: '/repo' });

      expect((await load(serverEvent('/repo/about', { isDataRequest: true }))).i18n.route).toBe('/about');
      expect((await load(serverEvent('/repo/about'))).i18n.translations?.cs).toMatchObject({ about: { greeting: 'about cs' } });
    });

    it('warns once about a prefix in front of the matched route, naming it', async () => {
      const { load, handle, warnings } = setup();

      await load(serverEvent('/repo/about', { isDataRequest: true, id: '/about' }));
      await load(serverEvent('/repo/', { isDataRequest: true, id: '/' }));
      await html({ handle }, serverEvent('/repo/about', { id: '/about' }));
      expect(warnings).toEqual(['[i18n]: \'/repo\' precedes the route SvelteKit matched. If it is kit.paths.base, set basePath: \'/repo\'.']);
    });

    it('warns from handle too, for an app without a server load', async () => {
      const { handle, warnings } = setup();

      await html({ handle }, serverEvent('/repo/about', { id: '/about' }));
      expect(warnings).toHaveLength(1);
    });

    it('takes a language segment for a locale of that language', async () => {
      const { load, warnings } = setup({ loaders: [{ locale: 'en-US', namespace: 'common', loader: () => Promise.resolve({}) }] });

      await load(serverEvent('/en/about', { isDataRequest: true, id: '/about' }));
      expect(warnings).toEqual([]);
    });

    it('does not warn about a locale segment, a basePath it strips, or a 404', async () => {
      const plain = setup();

      await plain.load(serverEvent('/cs/about', { isDataRequest: true, id: '/about' }));
      await plain.load(serverEvent('/CS/about', { isDataRequest: true, id: '/about' }));
      await plain.load(serverEvent('/en-GB/about', { isDataRequest: true, id: '/about' }));
      await plain.load(serverEvent('/nowhere', { isDataRequest: true, id: null }));
      await plain.load(serverEvent('/about', { isDataRequest: true, id: '/about' }));
      expect(plain.warnings).toEqual([]);

      const configured = setup({ basePath: '/repo' });

      await configured.load(serverEvent('/repo/cs/about', { isDataRequest: true, id: '/about' }));
      expect(configured.warnings).toEqual([]);

      await configured.load(serverEvent('/repo/x/about', { isDataRequest: true, id: '/about' }));
      expect(configured.warnings).toEqual(['[i18n]: \'/repo/x\' precedes the route SvelteKit matched. If it is kit.paths.base, set basePath: \'/repo/x\'.']);
    });

    it('builds a fresh instance on every SSR pass of the universal branch', async () => {
      const { load, calls } = setup();
      const serverData = await load(serverEvent('/about'));
      const a = await load(universalEvent('/about', serverData));
      const b = await load(universalEvent('/about', serverData));

      expect(a.i18n).not.toBe(b.i18n);
      expect(a.i18n.t('about.greeting')).toBe('about cs');
      // The hand-off, not the loaders.
      expect(calls).toHaveLength(2);
    });

    it('returns the server\'s other data along with the instance, typed', async () => {
      const { load } = setup();
      const serverData = await load(serverEvent('/'));
      const data = await load({ ...universalEvent('/', null), data: { ...serverData, user: 'x' as const } });

      expectTypeOf(data.user).toEqualTypeOf<'x'>();
      expect(data.user).toBe('x');
      expect(data.i18n.locale).toBe('cs');
    });

    it('drives the core and hands out what the extensions make of it', async () => {
      const wrap = (i18n: any) => ({ wrapped: i18n });
      const { load, calls } = setup({ extensions: [wrap] });
      const data = await load(universalEvent('/about', await load(serverEvent('/about'))));

      expect(data.i18n.wrapped.t('about.greeting')).toBe('about cs');
      expect(calls).toHaveLength(2);
    });

    it('does not consult the runtime\'s navigator on the server', async () => {
      // Node and Deno define navigator.languages.
      const { load } = setup();

      expect((await load(universalEvent('/', null))).i18n.locale).toBe(undefined);
    });
  });

  describe.runIf(effectsRun)('browser', () => {
    // The server half runs in the server project; its output reaches the
    // browser through devalue, as SvelteKit sends it.
    const page = (path: string, locale = 'cs', translations?: Record<string, any>) => wire({
      i18n: { locale, route: path, ...(translations ? { translations } : {}) },
    });

    beforeEach(() => {
      document.documentElement.lang = '';
      document.documentElement.dir = '';
    });

    const mountLayout = ({ use, get }: Pick<Kit.T, 'use' | 'get'>, data: { current: object }) => {
      let found: unknown;

      const component = mount(Layout, {
        target: document.body,
        props: { use, get, get data() { return data.current; }, probe: (value: unknown) => { found = value; } },
      });

      flushSync();

      return { component, found: () => found };
    };

    it('hydrates once, keeps the instance, provides it, and fetches nothing handed off', async () => {
      const wiring = setup();
      const first = await wiring.load(universalEvent('/about', page('/about', 'cs', { cs: { 'common.greeting': 'Ahoj' } })));
      const { component, found } = mountLayout(wiring, cell<object>(first));

      expect(found()).toEqual([first.i18n, first.i18n]);
      expect(first.i18n.locale).toBe('cs');
      expect(document.body.innerHTML).toContain('Ahoj');
      expect(document.documentElement.lang).toBe('cs');

      const second = await wiring.load(universalEvent('/', page('/')));

      expect(second.i18n).toBe(first.i18n);
      void unmount(component);
      expect(wiring.calls.filter((call) => call.startsWith('cs:common'))).toEqual([]);
    });

    it('keeps <html dir> in sync with the active locale', async () => {
      const wiring = setup({ translations: { ar: { 'common.greeting': 'Marhaban' } } });
      const data = cell<object>(await wiring.load(universalEvent('/', page('/', 'ar', { ar: { 'common.greeting': 'Marhaban' } }))));
      const { component } = mountLayout(wiring, data);
      const { i18n } = data.current as { i18n: any };

      expect(document.documentElement.dir).toBe('rtl');

      await i18n.setLocale('cs');
      flushSync();
      expect(document.documentElement.lang).toBe('cs');
      expect(document.documentElement.dir).toBe('ltr');
      void unmount(component);
    });

    it('provides what the extensions make of the tab\'s instance, and still drives the instance', async () => {
      const wiring = setup({ extensions: [(i18n: any) => ({ t: (key: string) => i18n.t(key), wrapped: i18n })] });
      const first = await wiring.load(universalEvent('/', page('/', 'cs', { cs: { 'common.greeting': 'Ahoj' } })));
      const { component, found } = mountLayout(wiring, cell<object>(first));

      expect(found()).toEqual([first.i18n, first.i18n]);
      expect(first.i18n.wrapped.locale).toBe('cs');
      expect(document.body.innerHTML).toContain('Ahoj');
      expect(document.documentElement.lang).toBe('cs');
      void unmount(component);
    });

    it('throws a named error from get() outside the layout', () => {
      const { get } = setup();

      expect(() => mount(Outside, { target: document.body, props: { get } })).toThrow('`get()` found no instance');
    });

    it('keeps a client setLocale while the answer holds, even through stale preload data', async () => {
      const wiring = setup();
      const data = cell<object>(await wiring.load(universalEvent('/', page('/', 'en'))));
      const { component } = mountLayout(wiring, data);
      const { i18n } = data.current as { i18n: any };

      await vi.waitFor(() => expect(i18n.locale).toBe('en'));

      const preloaded = await wiring.load(universalEvent('/about', page('/about', 'en')));

      await i18n.setLocale('cs');
      flushSync();
      expect(document.documentElement.lang).toBe('cs');

      data.current = preloaded;
      flushSync();
      await vi.waitFor(() => expect(i18n.snapshot({ records: true }).route).toBe('/about'));
      expect(i18n.locale).toBe('cs');

      data.current = await wiring.load(universalEvent('/', page('/', 'en')));
      flushSync();
      await vi.waitFor(() => expect(i18n.snapshot({ records: true }).route).toBe('/'));
      expect(i18n.locale).toBe('cs');

      // The load warms the active locale's tables too, so the commit finds them.
      const count = () => wiring.calls.filter((call) => call === 'cs:about:/about').length;
      const before = count();

      i18n.invalidate('cs', 'about');
      await wiring.load(universalEvent('/about', page('/about', 'en')));
      expect(count()).toBe(before + 1);
      void unmount(component);
    });

    it('switches at commit when the answer changes, and a preload neither activates nor moves the comparison', async () => {
      const wiring = setup();
      const data = cell<object>(await wiring.load(universalEvent('/', page('/', 'en'))));
      const { component } = mountLayout(wiring, data);
      const { i18n } = data.current as { i18n: any };

      await vi.waitFor(() => expect(i18n.locale).toBe('en'));

      const preloaded = await wiring.load(universalEvent('/about', page('/about', 'cs')));

      expect(i18n.locale).toBe('en');
      expect(i18n.snapshot({ records: true }).route).toBe('/');
      expect(i18n.translations.cs['about.greeting']).toBe('about cs');

      data.current = await wiring.load(universalEvent('/', page('/', 'en')));
      flushSync();
      await vi.waitFor(() => expect(i18n.snapshot({ records: true }).route).toBe('/'));
      expect(i18n.locale).toBe('en');

      const fetched = wiring.calls.length;

      data.current = preloaded;
      flushSync();
      // The tables are warm: the switch lands in the commit's own flush.
      expect(i18n.locale).toBe('cs');
      expect(document.body.innerHTML).toContain('common cs');
      expect(wiring.calls).toHaveLength(fetched);
      void unmount(component);
    });

    it('shows the new route params in the commit\'s own flush, fetched once by the load', async () => {
      const slugs: string[] = [];
      const wiring = setup({
        loaders: [{
          locale: 'cs',
          namespace: 'common',
          routes: [/^\/blog\/(?<slug>[^/]+)$/],
          loader: ({ params }: { params: Record<string, string> }) => {
            slugs.push(params.slug);

            return Promise.resolve({ greeting: `post ${params.slug}` });
          },
        }],
      });
      const data = cell<object>(await wiring.load(universalEvent('/blog/a', page('/blog/a'))));
      const { component } = mountLayout(wiring, data);

      await vi.waitFor(() => expect(document.body.innerHTML).toContain('post a'));

      data.current = await wiring.load(universalEvent('/blog/b', page('/blog/b')));
      flushSync();
      expect(document.body.innerHTML).toContain('post b');
      expect(slugs).toEqual(['a', 'b']);
      void unmount(component);
    });

    it('takes an answer given while the commit\'s own switch was pending as current', async () => {
      const pending: Array<() => void> = [];
      const wiring = setup({
        loaders: [
          { locale: 'en', namespace: 'common', loader: () => Promise.resolve({ greeting: 'Hello' }) },
          {
            locale: 'cs',
            namespace: 'common',
            // Its source caches, so the commit runs it again and the switch waits.
            cache: false,
            loader: () => new Promise((resolve) => { pending.push(() => resolve({ greeting: 'Ahoj' })); }),
          },
        ],
      });
      const data = cell<object>(await wiring.load(universalEvent('/', page('/', 'en'))));
      const { component } = mountLayout(wiring, data);
      const { i18n } = data.current as { i18n: any };

      await vi.waitFor(() => expect(i18n.locale).toBe('en'));

      const toCs = wiring.load(universalEvent('/b', page('/b', 'cs')));

      await vi.waitFor(() => expect(pending).toHaveLength(1));
      pending[0]();
      data.current = await toCs;
      flushSync();

      // The switch to cs waits for its loader while the next navigation loads.
      const back = await wiring.load(universalEvent('/c', page('/c', 'en')));

      pending[1]();
      await vi.waitFor(() => expect(i18n.locale).toBe('cs'));

      data.current = back;
      flushSync();
      await vi.waitFor(() => expect(i18n.locale).toBe('en'));
      void unmount(component);
    });

    describe('while the commit\'s own switch is pending', () => {
      // `cs` caches at its source, so the commit runs it again and the switch
      // waits for the test.
      const switching = (extra: any[] = []) => {
        const pending: Array<() => void> = [];
        const calls: string[] = [];
        const plain = (locale: string, namespace = 'common', routes?: string[]) => ({
          locale,
          namespace,
          routes,
          loader: () => {
            calls.push(`${locale}:${namespace}`);

            return Promise.resolve({ greeting: `${namespace} ${locale}` });
          },
        });
        const wiring = setup({
          loaders: [
            plain('en'),
            { locale: 'cs', namespace: 'common', cache: false, loader: () => new Promise((resolve) => { pending.push(() => resolve({ greeting: 'Ahoj' })); }) },
            ...extra.map((args: [string, string?, string[]?]) => plain(...args)),
          ],
        });

        const start = async () => {
          const data = cell<object>(await wiring.load(universalEvent('/', page('/', 'en'))));
          const { component } = mountLayout(wiring, data);
          const { i18n } = data.current as { i18n: any };

          await vi.waitFor(() => expect(i18n.locale).toBe('en'));

          const toCs = wiring.load(universalEvent('/b', page('/b', 'cs')));

          await vi.waitFor(() => expect(pending).toHaveLength(1));
          pending[0]();
          data.current = await toCs;
          flushSync();
          await vi.waitFor(() => expect(pending).toHaveLength(2));

          return { data, component, i18n };
        };

        return { wiring, pending, calls, start };
      };

      it('warms the locale it switches to', async () => {
        const { wiring, pending, calls, start } = switching([['en', 'about', ['/about']], ['cs', 'about', ['/about']]]);
        const { component } = await start();

        const warm = wiring.load(universalEvent('/about', page('/about', 'cs')));

        await vi.waitFor(() => expect(pending).toHaveLength(3));
        pending.forEach((resolve) => resolve());
        await warm;

        expect(calls).toContain('cs:about');
        expect(calls).not.toContain('en:about');
        void unmount(component);
      });

      it('ignores an answer given before a client setLocale that replaced it', async () => {
        const { wiring, pending, start } = switching([['de'], ['fr']]);
        const { data, component, i18n } = await start();

        const toDe = await wiring.load(universalEvent('/c', page('/c', 'de')));

        await i18n.setLocale('fr');
        pending[1]();
        data.current = toDe;
        flushSync();
        await vi.waitFor(() => expect(i18n.snapshot({ records: true }).route).toBe('/c'));
        expect(i18n.locale).toBe('fr');
        void unmount(component);
      });
    });

    it('switches again at the next commit when its own switch failed', async () => {
      const thrown: unknown = { status: 303, location: '/login' };
      let runs = 0;
      const wiring = setup({
        loaders: [
          { locale: 'en', namespace: 'common', loader: () => Promise.resolve({ greeting: 'Hello' }) },
          {
            locale: 'cs',
            namespace: 'common',
            cache: false,
            loader: async () => {
              runs += 1;
              if (runs === 2) throw thrown;

              return { greeting: 'Ahoj' };
            },
          },
        ],
      });
      const data = cell<object>(await wiring.load(universalEvent('/', page('/', 'en'))));
      const { component } = mountLayout(wiring, data);
      const { i18n } = data.current as { i18n: any };

      await vi.waitFor(() => expect(i18n.locale).toBe('en'));

      data.current = await wiring.load(universalEvent('/b', page('/b', 'cs')));
      flushSync();
      await vi.waitFor(() => expect(runs).toBe(2));
      await vi.waitFor(() => expect(i18n.loading).toBe(false));
      expect(i18n.locale).toBe('en');

      data.current = await wiring.load(universalEvent('/c', page('/c', 'cs')));
      flushSync();
      await vi.waitFor(() => expect(i18n.locale).toBe('cs'));
      void unmount(component);
    });

    it('keeps the answer of a failed switch whose locale a later commit activated', async () => {
      const thrown: unknown = { status: 303, location: '/login' };
      let runs = 0;
      let fail: () => void = () => undefined;
      const wiring = setup({
        loaders: [
          { locale: 'en', namespace: 'common', loader: () => Promise.resolve({ greeting: 'Hello' }) },
          { locale: 'cs', namespace: 'common', loader: () => Promise.resolve({ greeting: 'Ahoj' }) },
          {
            locale: 'cs',
            namespace: 'special',
            routes: ['/b'],
            cache: false,
            loader: async () => {
              runs += 1;
              if (runs === 2) {
                await new Promise<void>((resolve) => { fail = resolve; });
                throw thrown;
              }

              return { greeting: 'Speciální' };
            },
          },
        ],
      });
      const data = cell<object>(await wiring.load(universalEvent('/', page('/', 'en'))));
      const { component } = mountLayout(wiring, data);
      const { i18n } = data.current as { i18n: any };

      await vi.waitFor(() => expect(i18n.locale).toBe('en'));

      data.current = await wiring.load(universalEvent('/b', page('/b', 'cs')));
      flushSync();
      await vi.waitFor(() => expect(runs).toBe(2));

      data.current = await wiring.load(universalEvent('/c', page('/c', 'cs')));
      flushSync();
      await vi.waitFor(() => expect(i18n.locale).toBe('cs'));

      fail();
      await vi.waitFor(() => expect(i18n.loading).toBe(false));

      data.current = await wiring.load(universalEvent('/d', page('/d', 'en')));
      flushSync();
      await vi.waitFor(() => expect(i18n.locale).toBe('en'));
      void unmount(component);
    });

    it('ignores an answer given before a client setLocale', async () => {
      const wiring = setup();
      const data = cell<object>(await wiring.load(universalEvent('/', page('/', 'en'))));
      const { component } = mountLayout(wiring, data);
      const { i18n } = data.current as { i18n: any };

      await vi.waitFor(() => expect(i18n.locale).toBe('en'));
      await i18n.setLocale('cs');

      // Preloaded under the choice the server saw then.
      const preloaded = await wiring.load(universalEvent('/about', page('/about', 'cs')));

      await i18n.setLocale('en');
      data.current = preloaded;
      flushSync();
      await vi.waitFor(() => expect(i18n.snapshot({ records: true }).route).toBe('/about'));
      expect(i18n.locale).toBe('en');
      void unmount(component);
    });

    it('keeps the tab\'s locale on a prerendered page, whose answer is the build\'s', async () => {
      const wiring = setup();
      const data = cell<object>(await wiring.load(universalEvent('/', page('/', 'cs'))));
      const { component } = mountLayout(wiring, data);
      const { i18n } = data.current as { i18n: any };

      await vi.waitFor(() => expect(i18n.locale).toBe('cs'));

      data.current = await wiring.load(universalEvent('/about', page('/about', 'en', { en: { 'common.greeting': 'Hello' } })));
      flushSync();
      await vi.waitFor(() => expect(i18n.snapshot({ records: true }).route).toBe('/about'));
      expect(i18n.locale).toBe('cs');
      expect(wiring.calls.filter((call) => call.startsWith('en:'))).toEqual([]);
      void unmount(component);
    });

    it('warms the active locale when the answer turns undefined', async () => {
      const wiring = setup();
      const data = cell<object>(await wiring.load(universalEvent('/', page('/', 'cs'))));
      const { component } = mountLayout(wiring, data);
      const { i18n } = data.current as { i18n: any };

      await vi.waitFor(() => expect(i18n.locale).toBe('cs'));

      data.current = await wiring.load(universalEvent('/about', wire({ i18n: { route: '/about' } })));
      expect(wiring.calls).toContain('cs:about:/about');
      flushSync();
      expect(i18n.locale).toBe('cs');
      void unmount(component);
    });

    it('negotiates in the browser only when no server load exists', async () => {
      const withParam = setup({}, { preferredLocale: (event) => event.params.lang });

      expect((await withParam.load(universalEvent('/', null, { lang: 'cs' }))).i18n.locale).toBe('cs');

      const languages = vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['en-GB', 'cs']);
      const plain = setup();

      expect((await plain.load(universalEvent('/', null))).i18n.locale).toBe('en');
      languages.mockClear();
      await plain.load(universalEvent('/', page('/', 'cs')));
      expect(languages).not.toHaveBeenCalled();
      languages.mockRestore();
    });
  });
});
