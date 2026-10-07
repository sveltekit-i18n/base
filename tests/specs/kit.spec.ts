// @vitest-environment happy-dom
import * as devalue from 'devalue';
import { flushSync, mount, unmount } from 'svelte';
import { beforeEach, describe, expect, expectTypeOf, it, onTestFinished, vi } from 'vitest';

import { BROWSER } from '#kit-env';

import { defineI18n } from '../../src/kit/define.svelte.js';
import * as server from '../../src/kit/backend.js';
import type { Shared } from '../../src/kit/internal.js';
import * as stub from '../../src/kit/backend.browser.js';
import type { Kit } from '../../src/kit/types.js';
import Layout from '../components/Layout.svelte';
import Outside from '../components/Outside.svelte';
import { effectsRun } from '../utils/effect.svelte.js';
import { cell, deep } from '../utils/state.svelte.js';

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

type EventOptions = { lang?: string; isDataRequest?: boolean; cookie?: string; id?: string | null; params?: Record<string, string> };

const serverEvent = (path: string, { lang = 'cs', isDataRequest = false, cookie, id = path, params = {} }: EventOptions = {}) => ({
  url: url(path),
  params,
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
    expect(() => half.take({} as any)).toThrow('run on the server only');
  });

  it('throws a named error from use() without the pass of load', () => {
    const { use } = setup();

    expect(() => use(() => ({}))).toThrow('`use()` found no data from `load`');
  });

  it('skips a loader it cannot read, as the instance does', async () => {
    const { load, errors } = setup({
      loaders: [
        { locale: 'cs', namespace: 'common', loader: () => Promise.resolve({ greeting: 'common cs' }) },
        { locale: 'cs', namespace: 'page', loader: () => Promise.resolve({}), get cache() { throw new Error('unreadable'); } },
      ],
    });
    const { i18n } = await load(universalEvent('/', null));

    expect(i18n.t('common.greeting')).toBe('common cs');
    expect(errors).toContain('[i18n]: Skipping a loader that cannot be read.');
  });

  describe.skipIf(BROWSER)('server half', () => {
    it('fills %lang% from Accept-Language, then from preferredLocale', async () => {
      expect(await html(setup(), serverEvent('/', { lang: 'cs,en;q=0.5' }))).toBe('<html lang="cs">');
      expect(await html(setup({}, { preferredLocale: (event) => event.cookies?.get('lang') }), serverEvent('/', { cookie: 'en' }))).toBe('<html lang="en">');
      expect(await html(setup(), serverEvent('/', { lang: 'fr' }))).toBe('<html lang="en">');
      expect(await html(setup({ loaders: [] }), serverEvent('/', { lang: 'fr' }))).toBe('<html lang="">');
    });

    it('fills %dir% from the same negotiation', async () => {
      const template = '<html lang="%lang%" dir="%dir%">';
      const arabic = setup({ translations: { ar: { 'common.greeting': 'Marhaban' } } });

      expect(await html(arabic, serverEvent('/', { lang: 'ar-EG,en;q=0.5' }), template)).toBe('<html lang="ar" dir="rtl">');
      expect(await html(setup(), serverEvent('/', { lang: 'cs' }), template)).toBe('<html lang="cs" dir="ltr">');
      expect(await html(setup({ loaders: [] }), serverEvent('/', { lang: 'fr' }), template)).toBe('<html lang="" dir="ltr">');
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

    it('marks a page render whose locale preferredLocale gave', async () => {
      const { load } = setup({}, { preferredLocale: (event) => event.params.lang });
      const page = await load(serverEvent('/cs/about', { lang: 'en', params: { lang: 'cs' } }));

      expect(page.i18n.locale).toBe('cs');
      expect(page.i18n.preferred).toBe(true);
      expect(wire(page).i18n.preferred).toBe(true);
    });

    it('marks no payload whose locale preferredLocale did not give, nor a data request', async () => {
      const unmarked = async (options: Kit.Options, extra: Record<string, any> = {}, event = serverEvent('/', { lang: 'fr' })) => {
        const page = await setup(extra, options).load(event);

        expect(page.i18n).not.toHaveProperty('preferred');

        return page.i18n.locale;
      };

      expect(await unmarked({}, {}, serverEvent('/', { lang: 'cs' }))).toBe('cs');
      expect(await unmarked({ preferredLocale: () => 'fr' })).toBe('en');
      expect(await unmarked({ preferredLocale: () => undefined }, { initLocale: 'en' })).toBe('en');
      expect(await unmarked({ preferredLocale: () => null }, { fallbackLocale: 'en' })).toBe('en');
      expect(await unmarked({ preferredLocale: () => 'de' }, {}, serverEvent('/', { lang: 'cs' }))).toBe('cs');
      expect(await unmarked({ preferredLocale: () => { throw new Error('cookie'); } }, {}, serverEvent('/', { lang: 'cs' }))).toBe('cs');

      // A prerendered page reads no search params: SvelteKit's getter throws.
      const { load, errors } = setup({ initLocale: 'en' }, { preferredLocale: (event) => event.url.searchParams.get('lang') });

      for (let i = 0; i < 2; i += 1) {
        const event = serverEvent('/', { lang: 'fr' });

        Object.defineProperty(event.url, 'searchParams', { get: () => { throw new Error('Cannot access url.searchParams on a page with prerendering enabled'); } });

        const page = await load(event);

        expect(page.i18n.locale).toBe('en');
        expect(page.i18n).not.toHaveProperty('preferred');
      }

      expect(errors).toEqual(['[i18n]: `preferredLocale` failed. Negotiating without it.']);

      const preferred = setup({}, { preferredLocale: (event) => event.params.lang });

      expect(await preferred.load(serverEvent('/cs/', { isDataRequest: true, params: { lang: 'cs' } }))).toEqual({ i18n: { locale: 'cs', route: '/cs/' } });
    });

    it('marks a region of a locale, and a value a custom sanitizeLocales matches', async () => {
      const region = await setup({}, { preferredLocale: () => 'en-GB' }).load(serverEvent('/'));

      expect(region.i18n).toMatchObject({ locale: 'en', preferred: true });

      const custom = await setup({ sanitizeLocales: (locale: string) => locale.toLowerCase() }, { preferredLocale: () => 'EN' }).load(serverEvent('/'));

      expect(custom.i18n).toMatchObject({ locale: 'en', preferred: true });
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

    it('sanitizes initLocale and fallbackLocale as the config\'s locales are', async () => {
      const loaders = (...locales: string[]) => locales.map((locale) => ({ locale, namespace: 'common', loader: async () => ({ greeting: locale }) }));

      const alias = setup({ initLocale: 'iw', loaders: loaders('iw', 'en') });

      expect((await alias.load(serverEvent('/', { lang: 'fr', isDataRequest: true }))).i18n.locale).toBe('he');

      const custom = { sanitizeLocales: (locale: string) => locale.replace('_', '-'), loaders: loaders('en_US', 'cs_CZ') };

      expect((await setup({ ...custom, initLocale: 'cs_CZ' }).load(serverEvent('/', { lang: 'fr', isDataRequest: true }))).i18n.locale).toBe('cs-CZ');
      expect((await setup({ ...custom, fallbackLocale: 'en_US' }).load(serverEvent('/', { lang: 'fr', isDataRequest: true }))).i18n.locale).toBe('en-US');
    });

    it('runs what preferredLocale returns through a custom sanitizeLocales', async () => {
      const { load } = setup({
        sanitizeLocales: (locale: string) => locale.replace('_', '-'),
        loaders: ['en_US', 'cs_CZ'].map((locale) => ({ locale, namespace: 'common', loader: async () => ({ greeting: locale }) })),
      }, { preferredLocale: (event) => event.cookies?.get('lang') });

      expect((await load(serverEvent('/', { lang: 'en', cookie: 'cs_CZ', isDataRequest: true }))).i18n.locale).toBe('cs-CZ');
    });

    it('reports nothing when a custom sanitizeLocales rejects what preferredLocale returns', async () => {
      const { load, errors, warnings } = setup({
        sanitizeLocales: (locale: string) => new Intl.Locale(locale).baseName,
      }, { preferredLocale: (event) => event.cookies?.get('lang') });

      for (const cookie of ['not a tag!', 'not a tag!']) {
        expect((await load(serverEvent('/', { lang: 'cs', cookie, isDataRequest: true }))).i18n.locale).toBe('cs');
      }

      expect([...errors, ...warnings]).toEqual([]);
    });

    it('reads what a custom sanitizeLocales returns for preferredLocale as a string', async () => {
      const { load } = setup({
        sanitizeLocales: (locale: string) => new Intl.Locale(locale).minimize() as unknown as string,
      }, { preferredLocale: (event) => event.cookies?.get('lang') });

      expect((await load(serverEvent('/', { lang: 'en', cookie: 'cs-Latn-CZ', isDataRequest: true }))).i18n.locale).toBe('cs');
    });

    it('falls back to the first locale the config serves, the loaders\' before the translations\'', async () => {
      const { load, calls } = setup();

      expect((await load(serverEvent('/about', { lang: 'fr' }))).i18n.locale).toBe('en');
      expect(calls).toEqual(['en:common:/about', 'en:about:/about']);

      const seeded = setup({
        translations: { de: { 'common.greeting': 'Hallo' } },
        loaders: [{ locale: 'cs', namespace: 'common', loader: async () => ({ greeting: 'Ahoj' }) }],
      });

      expect((await seeded.load(serverEvent('/', { lang: 'fr', isDataRequest: true }))).i18n.locale).toBe('cs');
      expect((await setup({ loaders: [], translations: { de: {} } }).load(serverEvent('/', { lang: 'fr', isDataRequest: true }))).i18n.locale).toBe('de');
    });

    it('sets the route alone when the config serves no locale', async () => {
      const { load, calls } = setup({ loaders: [] });
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

    const counting = () => {
      const count = { preprocessed: 0 };

      return { count, preprocess: (input: any) => { count.preprocessed += 1; return input; } };
    };

    it('renders a page from the instance its server branch loaded, preprocessing once', async () => {
      const { count, preprocess } = counting();
      const { load, calls } = setup({ preprocess });
      const serverData = await load(serverEvent('/about'));
      const loaded = count.preprocessed;
      const data = await load(universalEvent('/about', { ...serverData, user: 'x' }));

      expect(loaded).toBeGreaterThan(0);
      expect(count.preprocessed).toBe(loaded);
      expect(data.i18n.translations.cs).toEqual({ common: { greeting: 'common cs' }, about: { greeting: 'about cs' } });
      expect(data.i18n.snapshot({ records: true })).toEqual(serverData.i18n);
      expect(calls).toEqual(['cs:common:/about', 'cs:about:/about']);
    });

    it('hands the server branch\'s instance to one pass only', async () => {
      const { count, preprocess } = counting();
      const { load, calls } = setup({ preprocess });
      const serverData = await load(serverEvent('/about'));
      const loaded = count.preprocessed;
      const a = await load(universalEvent('/about', serverData));

      expect(count.preprocessed).toBe(loaded);
      expect(a.i18n.snapshot({ records: true })).toEqual(serverData.i18n);

      const b = await load(universalEvent('/about', serverData));

      expect(a.i18n).not.toBe(b.i18n);
      // The second pass hydrates the snapshot and loads nothing.
      expect(count.preprocessed).toBeGreaterThan(loaded);
      expect(b.i18n.translations.cs).toEqual(a.i18n.translations.cs);
      expect(calls).toHaveLength(2);
    });

    it('builds a fresh instance for a payload the server branch did not return', async () => {
      const { count, preprocess } = counting();
      const { load, calls } = setup({ preprocess });
      const serverData = await load(serverEvent('/about'));
      const loaded = count.preprocessed;
      const data = await load(universalEvent('/about', wire(serverData)));

      expect(count.preprocessed).toBeGreaterThan(loaded);
      expect(data.i18n.translations.cs).toEqual({ common: { greeting: 'common cs' }, about: { greeting: 'about cs' } });
      expect(calls).toHaveLength(2);
    });

    it('renders each request from its own instance', async () => {
      const { count, preprocess } = counting();
      const { load } = setup({ preprocess });
      const [cs, en] = await Promise.all([load(serverEvent('/', { lang: 'cs' })), load(serverEvent('/', { lang: 'en' }))]);
      const loaded = count.preprocessed;
      const second = await load(universalEvent('/', en));
      const first = await load(universalEvent('/', cs));

      expect(count.preprocessed).toBe(loaded);
      expect([first.i18n.locale, second.i18n.locale]).toEqual(['cs', 'en']);
      expect(first.i18n.translations.cs.common.greeting).toBe('common cs');
      expect(second.i18n.translations.en.common.greeting).toBe('common en');
    });

    it('holds a loader with cache: false back for the rest of the render', async () => {
      let fetched = 0;
      const { load } = setup({
        loaders: [
          { locale: 'cs', namespace: 'common', loader: () => Promise.resolve({ greeting: 'common cs' }) },
          { locale: 'cs', namespace: 'live', cache: false, loader: () => Promise.resolve({ value: `live ${fetched += 1}` }) },
        ],
      });
      const serverData = await load(serverEvent('/'));
      const { i18n } = await load(universalEvent('/', serverData));

      // A child +page.js, through `(await parent()).i18n`.
      await i18n.loadNamespace('live');
      await i18n.loadTranslations('cs', '/');

      expect(fetched).toBe(1);
      expect(i18n.t('live.value')).toBe('live 1');
    });

    it('retries in the render a loader that failed soft in the server branch', async () => {
      let attempts = 0;
      const { load } = setup({
        log: { level: 'error', logger: { error: () => {}, warn: () => {}, debug: () => {} } },
        loaders: [
          { locale: 'cs', namespace: 'common', loader: () => Promise.resolve({ greeting: 'common cs' }) },
          { locale: 'cs', namespace: 'flaky', loader: () => (attempts += 1) === 1 ? Promise.reject(new Error('down')) : Promise.resolve({ value: 'back' }) },
        ],
      });
      const serverData = await load(serverEvent('/'));
      const { i18n } = await load(universalEvent('/', serverData));

      expect(attempts).toBe(2);
      expect(i18n.t('flaky.value')).toBe('back');
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
      const languages = vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['cs']);
      const { load } = setup();

      expect((await load(universalEvent('/', null))).i18n.locale).toBe('en');
      expect(languages).not.toHaveBeenCalled();
      languages.mockRestore();
    });
  });

  describe.runIf(effectsRun)('browser', () => {
    // The server half runs in the server project; its output reaches the
    // browser through devalue, as SvelteKit sends it.
    const page = (path: string, locale = 'cs', translations?: Record<string, any>) => wire({
      i18n: { locale, route: path, ...(translations ? { translations } : {}) },
    });

    // A prerendered `__data.json`: the build's page render, with its tables,
    // marked when the build's `preferredLocale` gave the locale.
    const prerendered = (path: string, locale: string, preferred = true) => wire({
      i18n: { locale, route: path, translations: { [locale]: { 'common.greeting': `common ${locale}` } }, ...(preferred ? { preferred: true } : {}) },
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

      const preloaded = await toCs;

      // The commit shows what the load delivered; an invalidation since makes
      // it fetch again, so the switch waits.
      i18n.invalidate('cs');
      data.current = preloaded;
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
      // The commit shows what the load delivered; an invalidation since makes
      // it fetch `cs` again, so the switch waits for the test.
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

          const preloaded = await toCs;

          i18n.invalidate('cs');
          data.current = preloaded;
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

      const toB = await wiring.load(universalEvent('/b', page('/b', 'cs')));

      // The commit shows what the load delivered; an invalidation since makes
      // it fetch again, which fails.
      i18n.invalidate('cs');
      data.current = toB;
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

      const toB = await wiring.load(universalEvent('/b', page('/b', 'cs')));

      // The commit shows what the load delivered; an invalidation since makes
      // it fetch again, which fails.
      i18n.invalidate('cs');
      data.current = toB;
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

    it('follows the locale the build\'s preferredLocale gave a prerendered page, Back included', async () => {
      const wiring = setup();
      const data = cell<object>(await wiring.load(universalEvent('/cs/', prerendered('/cs/', 'cs'))));
      const { component } = mountLayout(wiring, data);
      const { i18n } = data.current as { i18n: any };

      await vi.waitFor(() => expect(i18n.locale).toBe('cs'));

      data.current = await wiring.load(universalEvent('/en/about', prerendered('/en/about', 'en')));
      flushSync();
      await vi.waitFor(() => expect(i18n.locale).toBe('en'));
      expect(document.documentElement.lang).toBe('en');

      data.current = await wiring.load(universalEvent('/cs/', prerendered('/cs/', 'cs')));
      flushSync();
      await vi.waitFor(() => expect(i18n.locale).toBe('cs'));
      void unmount(component);
    });

    it('warms a marked prerendered locale on a preload without activating it, and switches once at commit', async () => {
      const wiring = setup();
      const data = cell<object>(await wiring.load(universalEvent('/cs/', prerendered('/cs/', 'cs'))));
      const { component } = mountLayout(wiring, data);
      const { i18n } = data.current as { i18n: any };

      await vi.waitFor(() => expect(i18n.locale).toBe('cs'));

      const preloaded = await wiring.load(universalEvent('/en/b', prerendered('/en/b', 'en')));

      expect(wiring.calls).toEqual(['en:common:/en/b']);
      expect(i18n.locale).toBe('cs');
      expect(i18n.snapshot({ records: true }).route).toBe('/cs/');

      data.current = preloaded;
      flushSync();
      expect(i18n.locale).toBe('en');
      expect(wiring.calls).toEqual(['en:common:/en/b']);
      void unmount(component);
    });

    it('follows a live answer after an unmarked prerendered page in a mixed app', async () => {
      const wiring = setup();
      const data = cell<object>(await wiring.load(universalEvent('/', page('/', 'cs'))));
      const { component } = mountLayout(wiring, data);
      const { i18n } = data.current as { i18n: any };

      await vi.waitFor(() => expect(i18n.locale).toBe('cs'));

      data.current = await wiring.load(universalEvent('/docs', prerendered('/docs', 'en', false)));
      flushSync();
      await vi.waitFor(() => expect(i18n.snapshot({ records: true }).route).toBe('/docs'));
      expect(i18n.locale).toBe('cs');

      data.current = await wiring.load(universalEvent('/account', page('/account', 'en')));
      flushSync();
      await vi.waitFor(() => expect(i18n.locale).toBe('en'));
      void unmount(component);
    });

    it('keeps a client setLocale through a marked prerendered page until its answer changes', async () => {
      const wiring = setup({ translations: { de: { 'common.greeting': 'Hallo' } } });
      const data = cell<object>(await wiring.load(universalEvent('/cs/', prerendered('/cs/', 'cs'))));
      const { component } = mountLayout(wiring, data);
      const { i18n } = data.current as { i18n: any };

      await vi.waitFor(() => expect(i18n.locale).toBe('cs'));
      await i18n.setLocale('de');

      data.current = await wiring.load(universalEvent('/cs/x', prerendered('/cs/x', 'cs')));
      flushSync();
      await vi.waitFor(() => expect(i18n.snapshot({ records: true }).route).toBe('/cs/x'));
      expect(i18n.locale).toBe('de');

      data.current = await wiring.load(universalEvent('/en/', prerendered('/en/', 'en')));
      flushSync();
      await vi.waitFor(() => expect(i18n.locale).toBe('en'));

      await i18n.setLocale('cs');

      // Preloaded under the choice the tab showed then.
      const preloaded = await wiring.load(universalEvent('/cs/about', prerendered('/cs/about', 'cs')));

      await i18n.setLocale('en');
      data.current = preloaded;
      flushSync();
      await vi.waitFor(() => expect(i18n.snapshot({ records: true }).route).toBe('/cs/about'));
      expect(i18n.locale).toBe('en');
      void unmount(component);
    });

    it('does not switch on a reused marked payload whose answer the tab already took', async () => {
      const wiring = setup();
      const payload = prerendered('/cs/', 'cs');
      const data = cell<object>(await wiring.load(universalEvent('/cs/', payload)));
      const { component } = mountLayout(wiring, data);
      const { i18n } = data.current as { i18n: any };

      await vi.waitFor(() => expect(i18n.locale).toBe('cs'));
      await i18n.setLocale('en');

      data.current = await wiring.load(universalEvent('/cs/', payload));
      flushSync();
      await vi.waitFor(() => expect(i18n.loading).toBe(false));
      expect(i18n.locale).toBe('en');
      void unmount(component);
    });

    it('switches again at the next commit when its switch to a marked prerendered locale failed', async () => {
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
      const data = cell<object>(await wiring.load(universalEvent('/en/', prerendered('/en/', 'en'))));
      const { component } = mountLayout(wiring, data);
      const { i18n } = data.current as { i18n: any };

      await vi.waitFor(() => expect(i18n.locale).toBe('en'));

      const toB = await wiring.load(universalEvent('/cs/b', prerendered('/cs/b', 'cs')));

      // The commit shows what the load delivered; an invalidation since makes
      // it fetch again, which fails.
      i18n.invalidate('cs');
      data.current = toB;
      flushSync();
      await vi.waitFor(() => expect(runs).toBe(2));
      await vi.waitFor(() => expect(i18n.loading).toBe(false));
      expect(i18n.locale).toBe('en');

      data.current = await wiring.load(universalEvent('/cs/c', prerendered('/cs/c', 'cs')));
      flushSync();
      await vi.waitFor(() => expect(i18n.locale).toBe('cs'));
      void unmount(component);
    });

    it('never runs preferredLocale in the browser on a pass that carries the server\'s data', async () => {
      const preferredLocale = vi.fn((event: Kit.Event) => event.params.lang);
      const wiring = setup({}, { preferredLocale });
      const data = cell<object>(await wiring.load(universalEvent('/cs/', prerendered('/cs/', 'cs'), { lang: 'cs' })));
      const { component } = mountLayout(wiring, data);
      const { i18n } = data.current as { i18n: any };

      await vi.waitFor(() => expect(i18n.locale).toBe('cs'));

      data.current = await wiring.load(universalEvent('/en/', page('/en/', 'en'), { lang: 'en' }));
      flushSync();
      data.current = await wiring.load(universalEvent('/cs/x', prerendered('/cs/x', 'cs'), { lang: 'cs' }));
      flushSync();
      data.current = await wiring.load(universalEvent('/en/x', prerendered('/en/x', 'en', false), { lang: 'en' }));
      flushSync();
      await vi.waitFor(() => expect(i18n.loading).toBe(false));
      expect(preferredLocale).not.toHaveBeenCalled();
      void unmount(component);
    });

    it('hydrates a marked prerendered page on the first pass, and keeps the marker out of the state', async () => {
      const wiring = setup();
      const data = cell<object>(await wiring.load(universalEvent('/en/', prerendered('/en/', 'en'))));
      const { component } = mountLayout(wiring, data);
      const { i18n } = data.current as { i18n: any };

      await vi.waitFor(() => expect(i18n.locale).toBe('en'));
      expect(document.body.innerHTML).toContain('common en');
      expect(i18n.snapshot()).not.toHaveProperty('preferred');
      expect(i18n.snapshot({ records: true })).not.toHaveProperty('preferred');
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
      languages.mockReturnValue(['fr']);
      expect((await setup().load(universalEvent('/', null))).i18n.locale).toBe('en');
      languages.mockClear();
      await plain.load(universalEvent('/', page('/', 'cs')));
      expect(languages).not.toHaveBeenCalled();
      languages.mockRestore();
    });

    // A first pass that hydrates nothing: no server load, `ssr = false` with
    // one (a payload without tables), a root error page without its data.
    describe('the first page without a hand-off', () => {
      const firstPage = (routes?: RegExp[], extra: Record<string, any> = {}) => {
        const runs: string[] = [];
        const live = (locale: string) => ({
          locale,
          namespace: 'live',
          routes,
          cache: false,
          loader: ({ route }: { route: string }) => {
            runs.push(`${locale}:${route}`);

            return Promise.resolve({ value: `live ${runs.length}` });
          },
        });
        const wiring = setup({
          loaders: [
            { locale: 'cs', namespace: 'common', loader: () => Promise.resolve({ greeting: 'Ahoj' }) },
            { locale: 'en', namespace: 'common', loader: () => Promise.resolve({ greeting: 'Hello' }) },
            live('cs'),
            live('en'),
          ],
          ...extra,
        });

        return { wiring, runs };
      };

      const answering = (locale: string) => {
        const languages = vi.spyOn(navigator, 'languages', 'get').mockReturnValue([locale]);

        onTestFinished(() => languages.mockRestore());
      };

      const opened = (wiring: Kit.T<any>, data: { current: object }) => {
        const { component } = mountLayout(wiring, data);

        onTestFinished(() => unmount(component));
      };

      const settled = async (i18n: any) => {
        await vi.waitFor(() => expect(i18n.loading).toBe(false));
        await new Promise((resolve) => setTimeout(resolve));
      };

      it.each([
        ['without a server load', '/', null, 'cs', undefined],
        ['with ssr off', '/', 'cs', 'cs', undefined],
        ['for an answer other than the first locale', '/', 'en', 'en', undefined],
        ['for route params', '/blog/a', null, 'cs', [/^\/blog\/(?<slug>[^/]+)$/]],
      ])('runs a loader whose source caches once, %s, and mounts what the pass showed', async (_name, path, answer, locale, routes) => {
        answering('cs');

        const { wiring, runs } = firstPage(routes);
        const data = cell<object>(await wiring.load(universalEvent(path, answer ? page(path, answer) : null)));
        const { i18n } = data.current as { i18n: any };

        opened(wiring, data);
        expect(i18n.loading).toBe(false);
        expect(i18n.t('live.value')).toBe('live 1');
        await settled(i18n);
        expect(runs).toEqual([`${locale}:${path}`]);
        expect(i18n.locale).toBe(locale);
        expect(document.documentElement.lang).toBe(locale);
      });

      it('runs a loader whose source caches once with a fallback locale, whose loaders the pass ran too', async () => {
        answering('cs');

        const { wiring, runs } = firstPage(undefined, { fallbackLocale: 'en' });
        const data = cell<object>(await wiring.load(universalEvent('/', null)));
        const { i18n } = data.current as { i18n: any };

        opened(wiring, data);
        expect(i18n.loading).toBe(false);
        await settled(i18n);
        expect(runs).toEqual(['cs:/', 'en:/']);
      });

      it('runs a loader whose source caches once under a base path', async () => {
        answering('cs');

        const { wiring, runs } = firstPage(undefined, { basePath: '/repo' });
        const data = cell<object>(await wiring.load(universalEvent('/repo/a', null)));
        const { i18n } = data.current as { i18n: any };

        opened(wiring, data);
        expect(i18n.loading).toBe(false);
        await settled(i18n);
        expect(runs).toEqual(['cs:/a']);
      });

      it('switches back at commit from a locale a child load set before it', async () => {
        answering('cs');

        const { wiring, runs } = firstPage();
        const data = cell<object>(await wiring.load(universalEvent('/', null)));
        const { i18n } = data.current as { i18n: any };

        await i18n.setLocale('en');
        opened(wiring, data);
        await settled(i18n);
        expect(i18n.locale).toBe('cs');
        expect(runs).toEqual(['cs:/', 'en:/', 'cs:/']);
      });

      it('commits its answer over a locale a child load is still switching to', async () => {
        answering('cs');

        const { wiring, runs } = firstPage();
        const data = cell<object>(await wiring.load(universalEvent('/', null)));
        const { i18n } = data.current as { i18n: any };

        void i18n.setLocale('en');
        opened(wiring, data);
        await settled(i18n);
        expect(i18n.locale).toBe('cs');
        expect(runs).toEqual(['cs:/', 'en:/', 'cs:/']);
      });

      it('fetches at commit what a child load invalidated before it', async () => {
        answering('cs');

        const { wiring, runs } = firstPage();
        const data = cell<object>(await wiring.load(universalEvent('/', null)));
        const { i18n } = data.current as { i18n: any };

        i18n.invalidate();
        opened(wiring, data);
        await settled(i18n);
        expect(runs).toEqual(['cs:/', 'cs:/']);
        expect(i18n.t('live.value')).toBe('live 2');
      });

      it('fetches at commit a loader that failed soft in the pass', async () => {
        answering('cs');

        let attempts = 0;
        const runs: string[] = [];
        const wiring = setup({
          log: { level: 'error' as const, logger: { error: () => {}, warn: () => {}, debug: () => {} } },
          loaders: [
            {
              locale: 'cs',
              namespace: 'common',
              loader: () => (++attempts === 1 ? Promise.reject(new Error('down')) : Promise.resolve({ greeting: 'Ahoj' })),
            },
            { locale: 'cs', namespace: 'live', cache: false, loader: () => { runs.push('cs'); return Promise.resolve({ value: 'now' }); } },
          ],
        });
        const data = cell<object>(await wiring.load(universalEvent('/', null)));
        const { i18n } = data.current as { i18n: any };

        opened(wiring, data);
        await settled(i18n);
        expect(attempts).toBe(2);
        expect(document.body.innerHTML).toContain('Ahoj');
        expect(runs).toEqual(['cs', 'cs']);
      });

      it('puts back at commit the route a child load moved before it', async () => {
        answering('cs');

        const { wiring, runs } = firstPage();
        const data = cell<object>(await wiring.load(universalEvent('/', null)));
        const { i18n } = data.current as { i18n: any };

        await i18n.setRoute('/elsewhere');
        opened(wiring, data);
        await settled(i18n);
        expect(i18n.snapshot({ records: true }).route).toBe('/');
        expect(runs).toEqual(['cs:/', 'cs:/elsewhere', 'cs:/']);
      });

      // Loaders of one namespace without routes share their description, so
      // none of them has an id, and no snapshot records what they delivered.
      const chunked = (first: () => Promise<Record<string, string>>) => {
        const runs: string[] = [];
        const wiring = setup({
          log: { level: 'error' as const, logger: { error: () => {}, warn: () => {}, debug: () => {} } },
          loaders: [
            { locale: 'cs', namespace: 'common', loader: first },
            { locale: 'cs', namespace: 'common', loader: () => Promise.resolve({ extra: 'navic' }) },
            { locale: 'cs', namespace: 'live', cache: false, loader: () => { runs.push('cs'); return Promise.resolve({ value: 'now' }); } },
          ],
        });

        return { wiring, runs };
      };

      it('fetches at commit a loader without an id that failed soft in the pass', async () => {
        answering('cs');

        let attempts = 0;
        const { wiring, runs } = chunked(() => (++attempts === 1 ? Promise.reject(new Error('down')) : Promise.resolve({ greeting: 'Ahoj' })));
        const data = cell<object>(await wiring.load(universalEvent('/', null)));
        const { i18n } = data.current as { i18n: any };

        opened(wiring, data);
        await settled(i18n);
        expect(attempts).toBe(2);
        expect(document.body.innerHTML).toContain('Ahoj');
        expect(runs).toEqual(['cs', 'cs']);
      });

      it('fetches at commit what a child load invalidated of loaders without an id', async () => {
        answering('cs');

        let version = 0;
        const { wiring } = chunked(() => Promise.resolve({ greeting: `v${++version}` }));
        const data = cell<object>(await wiring.load(universalEvent('/', null)));
        const { i18n } = data.current as { i18n: any };

        i18n.invalidate('cs', 'common');
        opened(wiring, data);
        await settled(i18n);
        expect(version).toBe(2);
        expect(document.body.innerHTML).toContain('v2');
      });

      it('loads at commit what a loadConfig() in between brought for the route', async () => {
        answering('cs');

        const runs: string[] = [];
        const wiring = setup({
          loaders: [
            { locale: 'cs', namespace: 'live', routes: ['/live'], cache: false, loader: () => { runs.push('live'); return Promise.resolve({ value: 'now' }); } },
          ],
        });
        const data = cell<object>(await wiring.load(universalEvent('/', null)));
        const { i18n } = data.current as { i18n: any };

        await i18n.loadConfig({
          parser: valueParser,
          loaders: [
            { locale: 'cs', namespace: 'common', loader: () => { runs.push('common'); return Promise.resolve({ greeting: 'Ahoj' }); } },
          ],
        });
        opened(wiring, data);
        await settled(i18n);
        expect(i18n.locale).toBe('cs');
        expect(runs).toEqual(['common']);
        expect(i18n.t('common.greeting')).toBe('Ahoj');
      });

      it('retries at commit a loader a loadConfig() in between brought and that failed soft', async () => {
        answering('cs');

        let attempts = 0;
        const loaders = [
          { locale: 'cs', namespace: 'common', loader: () => Promise.resolve({ greeting: 'Ahoj' }) },
          { locale: 'cs', namespace: 'live', cache: false, loader: () => Promise.resolve({ value: 'now' }) },
        ];
        const wiring = setup({ loaders });
        const data = cell<object>(await wiring.load(universalEvent('/', null)));
        const { i18n } = data.current as { i18n: any };

        await i18n.loadConfig({
          parser: valueParser,
          log: { level: 'error' as const, logger: { error: () => {} } },
          initLocale: 'cs',
          loaders: [
            ...loaders,
            { locale: 'cs', namespace: 'extra', loader: () => (++attempts === 1 ? Promise.reject(new Error('down')) : Promise.resolve({ more: 'Víc' })) },
          ],
        });
        opened(wiring, data);
        await settled(i18n);
        expect(attempts).toBe(2);
        expect(i18n.t('extra.more')).toBe('Víc');
      });

      it('loads at commit after a setLocale() in between that loaded the same request again', async () => {
        answering('cs');

        const runs: string[] = [];
        const wiring = setup({
          loaders: [
            { locale: 'cs', namespace: 'live', cache: false, loader: () => { runs.push('live'); return Promise.resolve({ value: 'now' }); } },
          ],
        });
        const data = cell<object>(await wiring.load(universalEvent('/', null)));
        const { i18n } = data.current as { i18n: any };

        await i18n.setLocale('cs');
        opened(wiring, data);
        await settled(i18n);
        expect(runs).toEqual(['live', 'live', 'live']);
      });

      it('takes the activation in one commit when the app holds `data` in deep state', async () => {
        answering('cs');

        const runs: string[] = [];
        const wiring = setup({
          loaders: [{ locale: 'cs', namespace: 'live', cache: false, loader: () => { runs.push('live'); return Promise.resolve({ value: 'now' }); } }],
        });
        const data = deep<object>(await wiring.load(universalEvent('/', null)));
        const { i18n } = data.current as { i18n: any };
        const loadTranslations = vi.spyOn(i18n, 'loadTranslations');
        const setRoute = vi.spyOn(i18n, 'setRoute');

        opened(wiring, data);
        await settled(i18n);
        expect(runs).toEqual(['live']);
        expect([loadTranslations.mock.calls, setRoute.mock.calls]).toEqual([[], []]);
      });
    });

    // Every later pass preloads: the commit shows what its request delivered
    // and runs no loader that answered.
    describe('a navigation', () => {
      const items = [/^\/item\/(?<id>\d+)$/];

      const navigation = (loaders: any[], extra: Record<string, any> = {}) => {
        const runs: string[] = [];
        const errors: string[] = [];
        const wiring = defineI18n({
          parser: valueParser,
          log: { level: 'error' as const, logger: { error: (message: string) => { errors.push(message); } } as any },
          loaders: loaders.map(({ loader, ...rest }) => ({
            ...rest,
            loader: (props: any) => {
              runs.push(`${rest.locale}:${rest.namespace}:${props.route}`);

              return loader(props);
            },
          })),
          ...extra,
        }) as unknown as Kit.T<any>;

        return { wiring, runs, errors };
      };

      const text = () => document.body.querySelector('p')?.textContent;

      // Every text the layout shows, sampled whenever the DOM changed.
      const painted = () => {
        const states = [text()];
        const observer = new MutationObserver(() => {
          if (text() !== states.at(-1)) states.push(text());
        });

        observer.observe(document.body, { subtree: true, childList: true, characterData: true });
        onTestFinished(() => observer.disconnect());

        return states;
      };

      // The first page, once its first commit settled.
      const opened = async (wiring: Kit.T<any>, data: { current: object }, shown: string) => {
        const { component } = mountLayout(wiring, data);
        const { i18n } = data.current as { i18n: any };

        onTestFinished(() => unmount(component));
        await vi.waitFor(() => expect(text()).toBe(shown));
        await vi.waitFor(() => expect(i18n.loading).toBe(false));

        return i18n;
      };

      const commit = (data: { current: object }, next: object) => {
        data.current = next;
        flushSync();
      };

      it('switches the locale in the commit\'s own flush, running a loader whose source caches once', async () => {
        const { wiring, runs } = navigation([
          { locale: 'cs', namespace: 'common', loader: () => Promise.resolve({ greeting: 'common cs' }) },
          { locale: 'en', namespace: 'common', cache: false, loader: () => Promise.resolve({ greeting: 'common en' }) },
        ]);
        const data = cell<object>(await wiring.load(universalEvent('/about', page('/about', 'cs'))));
        const i18n = await opened(wiring, data, 'common cs');
        const next = await wiring.load(universalEvent('/', page('/', 'en')));
        const states = painted();

        commit(data, next);
        expect(i18n.locale).toBe('en');
        expect(text()).toBe('common en');
        await vi.waitFor(() => expect(i18n.loading).toBe(false));
        expect(states).toEqual(['common cs', 'common en']);
        expect(runs.filter((run) => run.startsWith('en:'))).toEqual(['en:common:/']);
      });

      it('switches in one flush when the app holds `data` in deep state', async () => {
        const { wiring, runs } = navigation([
          { locale: 'cs', namespace: 'common', loader: () => Promise.resolve({ greeting: 'common cs' }) },
          { locale: 'en', namespace: 'common', cache: false, loader: () => Promise.resolve({ greeting: 'common en' }) },
        ]);
        const data = deep<object>(await wiring.load(universalEvent('/about', page('/about', 'cs'))));
        const i18n = await opened(wiring, data, 'common cs');

        commit(data, await wiring.load(universalEvent('/', page('/', 'en'))));
        expect(i18n.locale).toBe('en');
        expect(text()).toBe('common en');
        expect(runs.filter((run) => run.startsWith('en:'))).toHaveLength(1);
      });

      it.each([
        ['caches', {}],
        ['caches at its source', { cache: false }],
      ])('shows new params of a loader that %s in the commit\'s own flush, one run per navigation', async (_, cache) => {
        const { wiring, runs } = navigation([{
          locale: 'cs', namespace: 'common', routes: items, ...cache,
          loader: ({ params }: any) => Promise.resolve({ greeting: `item ${params.id}` }),
        }]);
        const data = cell<object>(await wiring.load(universalEvent('/item/1', page('/item/1'))));
        await opened(wiring, data, 'item 1');

        const before = runs.length;
        const next = await wiring.load(universalEvent('/item/2', page('/item/2')));
        const states = painted();

        commit(data, next);
        expect(text()).toBe('item 2');
        await Promise.resolve();
        expect(states).toEqual(['item 1', 'item 2']);
        expect(runs.slice(before)).toEqual(['cs:common:/item/2']);
      });

      it('shows a hovered link at its click, which reuses the hover\'s data, without loading again', async () => {
        const { wiring, runs } = navigation([
          { locale: 'cs', namespace: 'common', routes: items, loader: ({ params }: any) => Promise.resolve({ greeting: `item ${params.id}` }) },
          { locale: 'cs', namespace: 'live', cache: false, loader: () => Promise.resolve({ value: 'now' }) },
        ]);
        const data = cell<object>(await wiring.load(universalEvent('/item/1', page('/item/1'))));
        const i18n = await opened(wiring, data, 'item 1');
        const before = runs.length;
        // The hover: SvelteKit keeps its promise and hands the click its result.
        const hovered = await wiring.load(universalEvent('/item/2', page('/item/2')));

        expect(text()).toBe('item 1');

        commit(data, hovered);
        expect(text()).toBe('item 2');
        expect(i18n.t('live.value')).toBe('now');
        expect(i18n.loading).toBe(false);
        expect(runs.slice(before)).toEqual(['cs:common:/item/2', 'cs:live:/item/2']);
      });

      it('shows the clicked link when a sibling hover lands while its load is slow', async () => {
        const held: Record<string, () => void> = {};
        const { wiring, runs } = navigation([{
          locale: 'cs', namespace: 'common', routes: items, cache: false,
          loader: ({ params }: any) => new Promise((resolve) => { held[params.id] = () => resolve({ greeting: `item ${params.id}` }); }),
        }]);
        const first = wiring.load(universalEvent('/item/1', page('/item/1')));

        await vi.waitFor(() => expect(held['1']).toBeDefined());
        held['1']();

        const data = cell<object>(await first);
        const { component } = mountLayout(wiring, data);

        onTestFinished(() => unmount(component));
        // The first commit runs it again: no hand-off holds it back.
        held['1']();
        await vi.waitFor(() => expect((data.current as { i18n: any }).i18n.loading).toBe(false));

        const before = runs.length;
        const clicked = wiring.load(universalEvent('/item/2', page('/item/2')));
        const sibling = wiring.load(universalEvent('/item/3', page('/item/3')));

        await vi.waitFor(() => expect(Object.keys(held)).toEqual(['1', '2', '3']));
        held['3']();
        await sibling;
        expect(text()).toBe('item 1');
        held['2']();
        commit(data, await clicked);
        expect(text()).toBe('item 2');
        expect(runs.slice(before)).toEqual(['cs:common:/item/2', 'cs:common:/item/3']);
      });

      it.each([
        ['caches', {}, {}],
        ['caches at its source', { cache: false }, {}],
        ['caches for no time', {}, { cache: 0 }],
      ])('shows the clicked link of a loader that %s when a sibling hover lands between its load and its commit', async (_, cache, extra) => {
        // SvelteKit awaits `onNavigate` callbacks between the two.
        const { wiring, runs } = navigation([{
          locale: 'cs', namespace: 'common', routes: items, ...cache,
          loader: ({ params }: any) => Promise.resolve({ greeting: `item ${params.id}` }),
        }], extra);
        const data = cell<object>(await wiring.load(universalEvent('/item/1', page('/item/1'))));
        await opened(wiring, data, 'item 1');

        const before = runs.length;
        const clicked = await wiring.load(universalEvent('/item/2', page('/item/2')));

        await wiring.load(universalEvent('/item/3', page('/item/3')));
        expect(text()).toBe('item 1');
        commit(data, clicked);
        expect(text()).toBe('item 2');
        expect(runs.slice(before)).toEqual(['cs:common:/item/2', 'cs:common:/item/3']);
      });

      it('loads at the commit for the locale an app setLocale() chose between the hover and the click', async () => {
        const { wiring, runs } = navigation([
          { locale: 'cs', namespace: 'common', cache: false, loader: () => Promise.resolve({ greeting: 'common cs' }) },
          { locale: 'en', namespace: 'common', cache: false, loader: () => Promise.resolve({ greeting: 'common en' }) },
        ]);
        const data = cell<object>(await wiring.load(universalEvent('/a', page('/a'))));
        const i18n = await opened(wiring, data, 'common cs');
        const next = await wiring.load(universalEvent('/b', page('/b')));

        await i18n.setLocale('en');
        flushSync();
        expect(text()).toBe('common en');

        const before = runs.length;

        commit(data, next);
        await vi.waitFor(() => expect(i18n.snapshot({ records: true }).route).toBe('/b'));
        expect(i18n.locale).toBe('en');
        expect(text()).toBe('common en');
        expect(runs.slice(before)).toEqual(['en:common:/b']);
      });

      it('judges an expired window at the load and shows its refetch at the commit, running once', async () => {
        const { wiring, runs } = navigation([
          { locale: 'cs', namespace: 'common', routes: items, loader: ({ params }: any) => Promise.resolve({ greeting: `item ${params.id}` }) },
        ], { cache: 0 });
        const data = cell<object>(await wiring.load(universalEvent('/item/1', page('/item/1'))));
        const i18n = await opened(wiring, data, 'item 1');
        const before = runs.length;
        const next = await wiring.load(universalEvent('/item/2', page('/item/2')));

        commit(data, next);
        expect(text()).toBe('item 2');
        expect(i18n.loading).toBe(false);
        expect(runs.slice(before)).toEqual(['cs:common:/item/2']);
      });

      it('loads again at the commit what an invalidate() between the load and the commit covers', async () => {
        let version = 0;
        const { wiring, runs } = navigation([
          { locale: 'cs', namespace: 'common', cache: false, loader: () => Promise.resolve({ greeting: `v${++version}` }) },
        ]);
        const data = cell<object>(await wiring.load(universalEvent('/a', page('/a'))));
        const i18n = await opened(wiring, data, 'v1');
        const before = runs.length;
        const next = await wiring.load(universalEvent('/b', page('/b')));

        i18n.invalidate();
        commit(data, next);
        await vi.waitFor(() => expect(i18n.loading).toBe(false));
        expect(text()).toBe('v3');
        expect(runs.slice(before)).toEqual(['cs:common:/b', 'cs:common:/b']);
      });

      describe('an invalidateAll() while a load of a loader whose source caches is in flight', () => {
        // Each run answers with the source's version as the run starts; the
        // run `holding()` returns the release of waits for it.
        const moving = () => {
          const source = { version: 1, fail: false, hold: undefined as Promise<void> | undefined };
          const { wiring, runs } = navigation([{
            locale: 'cs', namespace: 'common', routes: items, cache: false,
            loader: async ({ params }: any) => {
              const { version, fail, hold } = source;

              if (fail) throw new Error('down');
              source.hold = undefined;
              await hold;

              return { greeting: `item ${params.id} v${version}` };
            },
          }]);
          const holding = () => {
            let release!: () => void;

            source.hold = new Promise<void>((resolve) => { release = resolve; });

            return release;
          };

          return { wiring, runs, source, holding };
        };

        it('ends on the source after the invalidation, the commit\'s own fetch still in flight', async () => {
          const { wiring, source, holding } = moving();
          const data = cell<object>(await wiring.load(universalEvent('/item/1', page('/item/1'))));
          const i18n = await opened(wiring, data, 'item 1 v1');

          // The navigation's load: the loader fails soft, so the commit fetches it.
          source.fail = true;

          const next = await wiring.load(universalEvent('/item/2', page('/item/2')));

          source.fail = false;

          const release = holding();

          commit(data, next);
          // The source moves, and the app invalidates: SvelteKit runs the load again and commits it.
          source.version = 2;

          const again = wiring.load(universalEvent('/item/2', page('/item/2')));

          release();
          commit(data, await again);
          await vi.waitFor(() => expect(text()).toBe('item 2 v2'));
          await vi.waitFor(() => expect(i18n.loading).toBe(false));
        });

        it('ends on the source after the second of two, the first one\'s load still in flight', async () => {
          const { wiring, source, holding } = moving();
          const data = cell<object>(await wiring.load(universalEvent('/item/1', page('/item/1'))));
          const i18n = await opened(wiring, data, 'item 1 v1');

          commit(data, await wiring.load(universalEvent('/item/2', page('/item/2'))));
          expect(text()).toBe('item 2 v1');

          const release = holding();
          // SvelteKit drops the first one's result once the second one starts.
          const first = wiring.load(universalEvent('/item/2', page('/item/2')));

          source.version = 2;

          const second = wiring.load(universalEvent('/item/2', page('/item/2')));

          release();
          await first;
          commit(data, await second);
          await vi.waitFor(() => expect(text()).toBe('item 2 v2'));
          await vi.waitFor(() => expect(i18n.loading).toBe(false));
        });
      });

      it.each([
        ['invalidateAll()', '/'],
        ['use:enhance\'s invalidateAll() after an action', '/'],
        ['a search-param navigation', '/?q=2'],
      ])('runs a loader whose source caches once on %s of the server-rendered first page', async (_, path) => {
        let version = 0;
        const { wiring, runs } = navigation([
          { locale: 'cs', namespace: 'common', cache: false, loader: () => Promise.resolve({ greeting: `v${++version}` }) },
        ]);
        const data = cell<object>(await wiring.load(universalEvent('/', page('/', 'cs', { cs: { common: { greeting: 'server' } } }))));
        const i18n = await opened(wiring, data, 'server');

        expect(runs).toEqual([]);

        // A data request: the server sends the locale and the route, no tables.
        const states = painted();

        commit(data, await wiring.load(universalEvent(path, page('/'))));
        expect(text()).toBe('v1');
        await vi.waitFor(() => expect(i18n.loading).toBe(false));
        expect(states).toEqual(['server', 'v1']);
        expect(runs).toEqual(['cs:common:/']);
      });

      it.each([
        ['caches', {}],
        ['caches at its source', { cache: false }],
      ])('shows each page of a loader that %s in its commit\'s flush on back and forward', async (_, cache) => {
        const { wiring, runs } = navigation([{
          locale: 'cs', namespace: 'common', routes: items, ...cache,
          loader: ({ params }: any) => Promise.resolve({ greeting: `item ${params.id}` }),
        }]);
        const data = cell<object>(await wiring.load(universalEvent('/item/1', page('/item/1'))));
        await opened(wiring, data, 'item 1');

        const before = runs.length;

        commit(data, await wiring.load(universalEvent('/item/2', page('/item/2'))));
        expect(text()).toBe('item 2');
        // Back: SvelteKit runs the load again.
        commit(data, await wiring.load(universalEvent('/item/1', page('/item/1'))));
        expect(text()).toBe('item 1');
        // Forward.
        commit(data, await wiring.load(universalEvent('/item/2', page('/item/2'))));
        expect(text()).toBe('item 2');
        expect(runs.slice(before)).toEqual(['cs:common:/item/2', 'cs:common:/item/1', 'cs:common:/item/2']);
      });

      it.each([
        ['caches', {}],
        ['caches at its source', { cache: false }],
      ])('fetches at the commit only a loader that %s and failed soft in the load', async (_, cache) => {
        let fail = true;
        const { wiring, runs } = navigation([
          {
            locale: 'cs', namespace: 'common', routes: items, ...cache,
            loader: ({ params }: any) => (params.id === '2' && fail ? Promise.reject(new Error('down')) : Promise.resolve({ greeting: `item ${params.id}` })),
          },
          { locale: 'cs', namespace: 'live', cache: false, loader: () => Promise.resolve({ value: 'now' }) },
        ]);
        const data = cell<object>(await wiring.load(universalEvent('/item/1', page('/item/1'))));
        const i18n = await opened(wiring, data, 'item 1');
        const before = runs.length;
        const next = await wiring.load(universalEvent('/item/2', page('/item/2')));

        fail = false;
        commit(data, next);
        await vi.waitFor(() => expect(text()).toBe('item 2'));
        await vi.waitFor(() => expect(i18n.loading).toBe(false));
        expect(runs.slice(before)).toEqual(['cs:common:/item/2', 'cs:live:/item/2', 'cs:common:/item/2']);
      });

      it('reports a commit whose data fails to apply, and keeps the page', async () => {
        const { wiring, errors } = navigation([{
          locale: 'cs', namespace: 'common', routes: items, cache: false,
          loader: ({ params }: any) => Promise.resolve({ greeting: `item ${params.id}` }),
        }], {
          preprocess: (input: any) => {
            if (JSON.stringify(input).includes('item 2')) throw new Error('broken');

            return Object.fromEntries(Object.entries(input).flatMap(([namespace, keys]: [string, any]) => Object.entries(keys).map(([key, value]) => [`${namespace}.${key}`, value])));
          },
        });
        const data = cell<object>(await wiring.load(universalEvent('/item/1', page('/item/1'))));
        await opened(wiring, data, 'item 1');

        commit(data, await wiring.load(universalEvent('/item/2', page('/item/2'))));
        expect(text()).toBe('item 1');
        expect(errors).toContain('[i18n]: Failed to load translations for \'cs\' locale and \'/item/2\' route.');

        commit(data, await wiring.load(universalEvent('/item/3', page('/item/3'))));
        expect(text()).toBe('item 3');
      });

      it('switches back at the next answer after a switch whose data failed to apply', async () => {
        const { wiring, errors, runs } = navigation([
          { locale: 'cs', namespace: 'common', loader: () => Promise.resolve({ greeting: 'common cs' }) },
          { locale: 'en', namespace: 'common', routes: items, loader: ({ params }: any) => Promise.resolve({ greeting: `item ${params.id} en` }) },
          { locale: 'en', namespace: 'common', routes: ['/about'], loader: () => Promise.resolve({ greeting: 'about en' }) },
        ], {
          preprocess: (input: any) => {
            if (JSON.stringify(input).includes('item 2 en')) throw new Error('broken');

            return Object.fromEntries(Object.entries(input).flatMap(([namespace, keys]: [string, any]) => Object.entries(keys).map(([key, value]) => [`${namespace}.${key}`, value])));
          },
        });
        const data = cell<object>(await wiring.load(universalEvent('/item/1', page('/item/1', 'en'))));
        const i18n = await opened(wiring, data, 'item 1 en');

        commit(data, await wiring.load(universalEvent('/about', page('/about', 'cs'))));
        await vi.waitFor(() => expect(text()).toBe('common cs'));

        commit(data, await wiring.load(universalEvent('/item/2', page('/item/2', 'en'))));
        expect(errors).toContain('[i18n]: Failed to load translations for \'en\' locale and \'/item/2\' route.');
        await new Promise((resolve) => { setTimeout(resolve); });

        // The failed switch is over: the preload is one of the locale shown.
        const before = runs.length;

        commit(data, await wiring.load(universalEvent('/about', page('/about', 'cs'))));
        await vi.waitFor(() => expect(i18n.loading).toBe(false));
        expect(i18n.locale).toBe('cs');
        expect(text()).toBe('common cs');
        expect(runs.slice(before)).toEqual([]);
      });

      it('leaves the next commit to switch after a switch whose data failed to apply, though the client set the locale shown', async () => {
        const { wiring, runs } = navigation([
          { locale: 'cs', namespace: 'common', loader: () => Promise.resolve({ greeting: 'common cs' }) },
          { locale: 'en', namespace: 'common', routes: items, loader: ({ params }: any) => Promise.resolve({ greeting: `item ${params.id} en` }) },
          { locale: 'en', namespace: 'common', routes: ['/about'], loader: () => Promise.resolve({ greeting: 'about en' }) },
        ], {
          preprocess: (input: any) => {
            if (JSON.stringify(input).includes('item 2 en')) throw new Error('broken');

            return Object.fromEntries(Object.entries(input).flatMap(([namespace, keys]: [string, any]) => Object.entries(keys).map(([key, value]) => [`${namespace}.${key}`, value])));
          },
        });
        const data = cell<object>(await wiring.load(universalEvent('/item/1', page('/item/1', 'en'))));
        const i18n = await opened(wiring, data, 'item 1 en');

        commit(data, await wiring.load(universalEvent('/about', page('/about', 'cs'))));
        await vi.waitFor(() => expect(text()).toBe('common cs'));
        commit(data, await wiring.load(universalEvent('/item/2', page('/item/2', 'en'))));
        await new Promise((resolve) => { setTimeout(resolve); });
        await i18n.setLocale('cs');
        await new Promise((resolve) => { setTimeout(resolve); });

        const before = runs.length;

        commit(data, await wiring.load(universalEvent('/item/4', page('/item/4', 'en'))));
        expect(i18n.locale).toBe('en');
        expect(text()).toBe('item 4 en');
        expect(runs.slice(before)).toEqual(['en:common:/item/4']);
      });

      const throwsOn = (shown: string) => ({
        preprocess: (input: any) => {
          if (JSON.stringify(input).includes(shown)) throw new Error('broken');

          return Object.fromEntries(Object.entries(input).flatMap(([namespace, keys]: [string, any]) => Object.entries(keys).map(([key, value]) => [`${namespace}.${key}`, value])));
        },
      });

      // Fails soft as a navigation's preload runs it, then waits for the test,
      // so the commit's switch fetches it and stays under way.
      const gated = (greeting: string) => {
        const gates: Array<() => void> = [];
        let calls = 0;
        const loader = () => {
          calls += 1;

          return calls === 1
            ? Promise.reject(new Error('down'))
            : new Promise((resolve) => { gates.push(() => resolve({ greeting })); });
        };

        return { loader, open: () => gates.splice(0).forEach((open) => open()) };
      };

      it('lands the switch still under way when a later switch\'s data failed to apply', async () => {
        const de = gated('common de');
        const { wiring } = navigation([
          { locale: 'cs', namespace: 'common', loader: () => Promise.resolve({ greeting: 'common cs' }) },
          { locale: 'de', namespace: 'common', loader: de.loader },
          { locale: 'en', namespace: 'common', routes: items, loader: ({ params }: any) => Promise.resolve({ greeting: `item ${params.id} en` }) },
          { locale: 'en', namespace: 'common', routes: ['/about'], loader: () => Promise.resolve({ greeting: 'about en' }) },
        ], throwsOn('item 2 en'));
        const data = cell<object>(await wiring.load(universalEvent('/item/1', page('/item/1', 'en'))));
        const i18n = await opened(wiring, data, 'item 1 en');

        commit(data, await wiring.load(universalEvent('/about', page('/about', 'cs'))));
        await vi.waitFor(() => expect(text()).toBe('common cs'));
        commit(data, await wiring.load(universalEvent('/x', page('/x', 'de'))));
        await new Promise((resolve) => { setTimeout(resolve); });
        commit(data, await wiring.load(universalEvent('/item/2', page('/item/2', 'en'))));
        await new Promise((resolve) => { setTimeout(resolve); });
        de.open();
        await vi.waitFor(() => expect(i18n.locale).toBe('de'));

        commit(data, await wiring.load(universalEvent('/y', page('/y', 'de'))));
        await vi.waitFor(() => expect(i18n.loading).toBe(false));
        expect(i18n.locale).toBe('de');
        expect(text()).toBe('common de');
      });

      it('switches at the next commit answered as a switch to the active locale whose data failed to apply, after the switch under way landed', async () => {
        const cs = gated('common cs');
        const { wiring } = navigation([
          { locale: 'cs', namespace: 'common', loader: cs.loader },
          { locale: 'en', namespace: 'common', routes: items, loader: ({ params }: any) => Promise.resolve({ greeting: `item ${params.id} en` }) },
          { locale: 'en', namespace: 'common', routes: ['/about'], loader: () => Promise.resolve({ greeting: 'about en' }) },
        ], throwsOn('item 2 en'));
        const data = cell<object>(await wiring.load(universalEvent('/item/1', page('/item/1', 'en'))));
        const i18n = await opened(wiring, data, 'item 1 en');

        commit(data, await wiring.load(universalEvent('/about', page('/about', 'cs'))));
        await new Promise((resolve) => { setTimeout(resolve); });
        commit(data, await wiring.load(universalEvent('/item/2', page('/item/2', 'en'))));
        await new Promise((resolve) => { setTimeout(resolve); });
        cs.open();
        await vi.waitFor(() => expect(i18n.locale).toBe('cs'));

        commit(data, await wiring.load(universalEvent('/item/3', page('/item/3', 'en'))));
        await vi.waitFor(() => expect(i18n.loading).toBe(false));
        expect(i18n.locale).toBe('en');
        expect(text()).toBe('item 3 en');
      });

      it('keeps the answer a later commit stays on when a switch to the locale it started from fails to apply', async () => {
        const extra = gated('BROKEN');
        const { wiring } = navigation([
          { locale: 'cs', namespace: 'common', loader: () => Promise.resolve({ greeting: 'common cs' }) },
          { locale: 'en', namespace: 'common', loader: () => Promise.resolve({ greeting: 'common en' }) },
          {
            locale: 'en', namespace: 'extra', cache: false,
            loader: ({ route }: any) => (route === '/item/2' ? extra.loader() : Promise.resolve({ greeting: 'fine' })),
          },
        ], throwsOn('BROKEN'));
        const data = cell<object>(await wiring.load(universalEvent('/about', page('/about', 'cs'))));
        const i18n = await opened(wiring, data, 'common cs');

        await i18n.setLocale('en');
        await new Promise((resolve) => { setTimeout(resolve); });
        commit(data, await wiring.load(universalEvent('/item/2', page('/item/2', 'en'))));
        await new Promise((resolve) => { setTimeout(resolve); });
        commit(data, await wiring.load(universalEvent('/item/3', page('/item/3', 'en'))));
        await new Promise((resolve) => { setTimeout(resolve); });
        extra.open();
        await vi.waitFor(() => expect(i18n.loading).toBe(false));
        expect(i18n.locale).toBe('en');

        commit(data, await wiring.load(universalEvent('/about', page('/about', 'cs'))));
        await vi.waitFor(() => expect(i18n.locale).toBe('cs'));
        expect(text()).toBe('common cs');
      });

      it.each([
        ['its data fails to apply', (resolve: (data: unknown) => void) => { resolve({ greeting: 'item 2 en' }); }],
        ['a loader throws control flow', (_: unknown, reject: (reason: unknown) => void) => { reject({ status: 404, body: { message: 'Not found' } }); }],
      ])('switches at a commit preloaded while a switch was under way, after that switch failed as %s', async (_, settle) => {
        const gates: Array<() => void> = [];
        let calls = 0;
        const item = ({ params }: any) => {
          if (params.id !== '2') return Promise.resolve({ greeting: `item ${params.id} en` });

          calls += 1;

          return calls === 1
            ? Promise.reject(new Error('down'))
            : new Promise((resolve, reject) => { gates.push(() => settle(resolve, reject)); });
        };
        const { wiring } = navigation([
          { locale: 'cs', namespace: 'common', loader: () => Promise.resolve({ greeting: 'common cs' }) },
          { locale: 'en', namespace: 'common', routes: items, loader: item },
        ], throwsOn('item 2 en'));
        const data = cell<object>(await wiring.load(universalEvent('/about', page('/about', 'cs'))));
        const i18n = await opened(wiring, data, 'common cs');

        commit(data, await wiring.load(universalEvent('/item/2', page('/item/2', 'en'))));
        await new Promise((resolve) => { setTimeout(resolve); });

        const hovered = await wiring.load(universalEvent('/item/3', page('/item/3', 'en')));

        gates.splice(0).forEach((open) => open());
        await vi.waitFor(() => expect(i18n.loading).toBe(false));
        await new Promise((resolve) => { setTimeout(resolve); });
        expect(i18n.locale).toBe('cs');

        commit(data, hovered);
        await vi.waitFor(() => expect(i18n.locale).toBe('en'));
        expect(text()).toBe('item 3 en');
      });

      it.each([
        ['its data fails to apply', (resolve: (data: unknown) => void) => { resolve({ greeting: 'item 2 en' }); }],
        ['a loader throws control flow', (_: unknown, reject: (reason: unknown) => void) => { reject({ status: 404, body: { message: 'Not found' } }); }],
      ])('switches at a commit preloaded while a switch was under way behind another, after that switch failed as %s', async (_, settle) => {
        const de = gated('common de');
        const gates: Array<() => void> = [];
        let calls = 0;
        const { wiring } = navigation([
          { locale: 'cs', namespace: 'common', loader: () => Promise.resolve({ greeting: 'common cs' }) },
          { locale: 'de', namespace: 'common', loader: de.loader },
          {
            locale: 'en', namespace: 'common', routes: items,
            loader: ({ params }: any) => {
              if (params.id !== '2') return Promise.resolve({ greeting: `item ${params.id} en` });

              calls += 1;

              return calls === 1
                ? Promise.reject(new Error('down'))
                : new Promise((resolve, reject) => { gates.push(() => settle(resolve, reject)); });
            },
          },
        ], throwsOn('item 2 en'));
        const data = cell<object>(await wiring.load(universalEvent('/about', page('/about', 'cs'))));
        const i18n = await opened(wiring, data, 'common cs');

        commit(data, await wiring.load(universalEvent('/de', page('/de', 'de'))));
        await new Promise((resolve) => { setTimeout(resolve); });
        commit(data, await wiring.load(universalEvent('/item/2', page('/item/2', 'en'))));
        await new Promise((resolve) => { setTimeout(resolve); });

        const hovered = await wiring.load(universalEvent('/item/3', page('/item/3', 'en')));

        gates.splice(0).forEach((open) => open());
        await new Promise((resolve) => { setTimeout(resolve); });
        de.open();
        await vi.waitFor(() => expect(i18n.locale).toBe('de'));
        await vi.waitFor(() => expect(i18n.loading).toBe(false));

        commit(data, hovered);
        await vi.waitFor(() => expect(i18n.locale).toBe('en'));
        expect(text()).toBe('item 3 en');
      });

      it('keeps a client setLocale() made after a switch failed at a commit preloaded while it was under way', async () => {
        const gates: Array<() => void> = [];
        let calls = 0;
        const { wiring } = navigation([
          { locale: 'cs', namespace: 'common', loader: () => Promise.resolve({ greeting: 'common cs' }) },
          { locale: 'de', namespace: 'common', loader: () => Promise.resolve({ greeting: 'common de' }) },
          {
            locale: 'en', namespace: 'common', routes: items,
            loader: ({ params }: any) => {
              if (params.id !== '2') return Promise.resolve({ greeting: `item ${params.id} en` });

              calls += 1;

              return calls === 1
                ? Promise.reject(new Error('down'))
                : new Promise((resolve) => { gates.push(() => resolve({ greeting: 'item 2 en' })); });
            },
          },
        ], throwsOn('item 2 en'));
        const data = cell<object>(await wiring.load(universalEvent('/about', page('/about', 'cs'))));
        const i18n = await opened(wiring, data, 'common cs');

        commit(data, await wiring.load(universalEvent('/item/2', page('/item/2', 'en'))));
        await new Promise((resolve) => { setTimeout(resolve); });

        const hovered = await wiring.load(universalEvent('/item/3', page('/item/3', 'en')));

        gates.splice(0).forEach((open) => open());
        await vi.waitFor(() => expect(i18n.loading).toBe(false));
        await i18n.setLocale('de');

        commit(data, hovered);
        await vi.waitFor(() => expect(i18n.loading).toBe(false));
        expect(i18n.locale).toBe('de');
        expect(text()).toBe('common de');
      });

      it('switches at a commit preloaded while a switch was under way whose locale a later stay landed before it failed', async () => {
        const gates: Array<() => void> = [];
        let calls = 0;
        const { wiring } = navigation([
          { locale: 'cs', namespace: 'common', loader: () => Promise.resolve({ greeting: 'common cs' }) },
          {
            locale: 'en', namespace: 'common', cache: false,
            loader: ({ route }: any) => {
              if (route !== '/item/2') return Promise.resolve({ greeting: 'common en' });

              calls += 1;

              return calls === 1
                ? Promise.reject(new Error('down'))
                : new Promise((resolve) => { gates.push(() => resolve({ greeting: 'BROKEN' })); });
            },
          },
          { locale: 'fr', namespace: 'common', loader: () => Promise.resolve({ greeting: 'common fr' }) },
        ], throwsOn('BROKEN'));
        const data = cell<object>(await wiring.load(universalEvent('/about', page('/about', 'cs'))));
        const i18n = await opened(wiring, data, 'common cs');

        commit(data, await wiring.load(universalEvent('/item/2', page('/item/2', 'en'))));
        await new Promise((resolve) => { setTimeout(resolve); });

        const hovered = await wiring.load(universalEvent('/fr', page('/fr', 'fr')));

        commit(data, await wiring.load(universalEvent('/item/3', page('/item/3', 'en'))));
        await vi.waitFor(() => expect(i18n.locale).toBe('en'));
        gates.splice(0).forEach((open) => open());
        await vi.waitFor(() => expect(i18n.loading).toBe(false));
        await new Promise((resolve) => { setTimeout(resolve); });
        expect(i18n.locale).toBe('en');

        commit(data, hovered);
        await vi.waitFor(() => expect(i18n.locale).toBe('fr'));
        expect(text()).toBe('common fr');
      });

      it('keeps the answer a stay committed while a switch was under way lands after a later stay failed', async () => {
        const gates: Record<string, () => void> = {};
        const counts: Record<string, number> = {};
        const notFound: unknown = { status: 404, body: { message: 'Not found' } };
        const { wiring } = navigation([
          { locale: 'cs', namespace: 'common', loader: () => Promise.resolve({ greeting: 'common cs' }) },
          {
            locale: 'en', namespace: 'common', routes: items,
            loader: async ({ params }: any) => {
              counts[params.id] = (counts[params.id] ?? 0) + 1;

              if (counts[params.id] === 1) throw new Error('down');
              if (params.id === '4') throw notFound;

              return new Promise((resolve) => { gates[params.id] = () => resolve({ greeting: `item ${params.id} en` }); });
            },
          },
        ]);
        const data = cell<object>(await wiring.load(universalEvent('/about', page('/about', 'cs'))));
        const i18n = await opened(wiring, data, 'common cs');

        commit(data, await wiring.load(universalEvent('/item/2', page('/item/2', 'en'))));
        await new Promise((resolve) => { setTimeout(resolve); });
        commit(data, await wiring.load(universalEvent('/item/3', page('/item/3', 'en'))));
        await new Promise((resolve) => { setTimeout(resolve); });
        commit(data, await wiring.load(universalEvent('/item/4', page('/item/4', 'en'))));
        await new Promise((resolve) => { setTimeout(resolve); });
        gates['2']();
        await new Promise((resolve) => { setTimeout(resolve); });
        expect(i18n.locale).toBe('cs');
        gates['3']();
        await vi.waitFor(() => expect(i18n.locale).toBe('en'));
        await vi.waitFor(() => expect(i18n.loading).toBe(false));

        commit(data, await wiring.load(universalEvent('/about', page('/about', 'cs'))));
        await vi.waitFor(() => expect(i18n.locale).toBe('cs'));
        expect(text()).toBe('common cs');
      });

      it('keeps the answer of a switch still under way after a stay committed meanwhile failed', async () => {
        const gates: Array<() => void> = [];
        const counts: Record<string, number> = {};
        const notFound: unknown = { status: 404, body: { message: 'Not found' } };
        const { wiring } = navigation([
          { locale: 'cs', namespace: 'common', loader: () => Promise.resolve({ greeting: 'common cs' }) },
          {
            locale: 'en', namespace: 'common', routes: items,
            loader: async ({ params }: any) => {
              counts[params.id] = (counts[params.id] ?? 0) + 1;

              if (counts[params.id] === 1) throw new Error('down');
              if (params.id === '3') throw notFound;

              return new Promise((resolve) => { gates.push(() => resolve({ greeting: `item ${params.id} en` })); });
            },
          },
        ]);
        const data = cell<object>(await wiring.load(universalEvent('/about', page('/about', 'cs'))));
        const i18n = await opened(wiring, data, 'common cs');

        commit(data, await wiring.load(universalEvent('/item/2', page('/item/2', 'en'))));
        await new Promise((resolve) => { setTimeout(resolve); });
        commit(data, await wiring.load(universalEvent('/item/3', page('/item/3', 'en'))));
        await new Promise((resolve) => { setTimeout(resolve); });
        expect(gates).toHaveLength(1);
        commit(data, await wiring.load(universalEvent('/about', page('/about', 'cs'))));
        gates.splice(0).forEach((open) => open());
        await vi.waitFor(() => expect(i18n.loading).toBe(false));
        await new Promise((resolve) => { setTimeout(resolve); });

        expect(i18n.locale).toBe('cs');
        expect(text()).toBe('common cs');
      });

      it('keeps a client locale set after a switch reached its locale despite a stay that failed meanwhile', async () => {
        const gates: Array<() => void> = [];
        const counts: Record<string, number> = {};
        const notFound: unknown = { status: 404, body: { message: 'Not found' } };
        const { wiring } = navigation([
          { locale: 'cs', namespace: 'common', loader: () => Promise.resolve({ greeting: 'common cs' }) },
          { locale: 'de', namespace: 'common', loader: () => Promise.resolve({ greeting: 'common de' }) },
          { locale: 'en', namespace: 'common', loader: () => Promise.resolve({ greeting: 'common en' }) },
          {
            locale: 'en', namespace: 'item', routes: items,
            loader: async ({ params }: any) => {
              counts[params.id] = (counts[params.id] ?? 0) + 1;

              if (counts[params.id] === 1) throw new Error('down');
              if (params.id === '3') throw notFound;

              return new Promise((resolve) => { gates.push(() => resolve({ title: `item ${params.id}` })); });
            },
          },
        ]);
        const data = cell<object>(await wiring.load(universalEvent('/about', page('/about', 'cs'))));
        const i18n = await opened(wiring, data, 'common cs');

        commit(data, await wiring.load(universalEvent('/item/2', page('/item/2', 'en'))));
        await new Promise((resolve) => { setTimeout(resolve); });
        commit(data, await wiring.load(universalEvent('/item/3', page('/item/3', 'en'))));
        await new Promise((resolve) => { setTimeout(resolve); });
        gates.splice(0).forEach((open) => open());
        await vi.waitFor(() => expect(i18n.locale).toBe('en'));
        await vi.waitFor(() => expect(i18n.loading).toBe(false));
        await new Promise((resolve) => { setTimeout(resolve); });
        await i18n.setLocale('de');

        commit(data, await wiring.load(universalEvent('/about', page('/about', 'en'))));
        await vi.waitFor(() => expect(i18n.loading).toBe(false));
        await new Promise((resolve) => { setTimeout(resolve); });

        expect(i18n.locale).toBe('de');
        expect(text()).toBe('common de');
      });

      it('switches at the next commit after a switch, a stay committed while it was under way and a stay committed after it failed all failed', async () => {
        const held: Record<string, Array<(reason: unknown) => void>> = {};
        const counts: Record<string, number> = {};
        const notFound: unknown = { status: 404, body: { message: 'Not found' } };
        const { wiring } = navigation([
          { locale: 'cs', namespace: 'common', loader: () => Promise.resolve({ greeting: 'common cs' }) },
          { locale: 'en', namespace: 'common', loader: () => Promise.resolve({ greeting: 'common en' }) },
          {
            locale: 'en', namespace: 'item', routes: items,
            loader: async ({ params }: any) => {
              counts[params.id] = (counts[params.id] ?? 0) + 1;

              if (params.id === '4') throw notFound;
              if (counts[params.id] === 1) throw new Error('down');

              return new Promise((_, reject) => { (held[params.id] ??= []).push(reject); });
            },
          },
        ]);
        const data = cell<object>(await wiring.load(universalEvent('/about', page('/about', 'cs'))));
        const i18n = await opened(wiring, data, 'common cs');

        commit(data, await wiring.load(universalEvent('/item/2', page('/item/2', 'en'))));
        await new Promise((resolve) => { setTimeout(resolve); });
        commit(data, await wiring.load(universalEvent('/item/3', page('/item/3', 'en'))));
        await new Promise((resolve) => { setTimeout(resolve); });
        held['2'].shift()!(notFound);
        await new Promise((resolve) => { setTimeout(resolve); });
        expect(i18n.locale).toBe('cs');
        commit(data, await wiring.load(universalEvent('/item/4', page('/item/4', 'en'))));
        await new Promise((resolve) => { setTimeout(resolve); });
        held['3'].shift()!(notFound);
        await vi.waitFor(() => expect(i18n.loading).toBe(false));
        await new Promise((resolve) => { setTimeout(resolve); });
        expect(i18n.locale).toBe('cs');

        commit(data, await wiring.load(universalEvent('/about', page('/about', 'en'))));
        await vi.waitFor(() => expect(i18n.locale).toBe('en'));
        expect(text()).toBe('common en');
      });

      it('keeps a client locale set back to where a switch started after a commit that did not carry that switch on', async () => {
        const held: Record<string, Array<{ resolve: (value: unknown) => void; reject: (reason: unknown) => void }>> = {};
        const counts: Record<string, number> = {};
        const { wiring } = navigation([
          { locale: 'cs', namespace: 'common', loader: () => Promise.resolve({ greeting: 'common cs' }) },
          { locale: 'de', namespace: 'common', loader: () => Promise.resolve({ greeting: 'common de' }) },
          { locale: 'en', namespace: 'common', loader: () => Promise.resolve({ greeting: 'common en' }) },
          {
            locale: 'en', namespace: 'item', routes: [/^\/item\//],
            loader: async ({ route }: any) => {
              counts[route] = (counts[route] ?? 0) + 1;

              if (counts[route] === 1) throw new Error('down');

              return new Promise((resolve, reject) => { (held[route] ??= []).push({ resolve, reject }); });
            },
          },
        ]);
        const data = cell<object>(await wiring.load(universalEvent('/about', page('/about', 'cs'))));
        const i18n = await opened(wiring, data, 'common cs');

        commit(data, await wiring.load(universalEvent('/item/2', page('/item/2', 'en'))));
        await new Promise((resolve) => { setTimeout(resolve); });
        commit(data, await wiring.load(universalEvent('/item/3', page('/item/3', 'en'))));
        await new Promise((resolve) => { setTimeout(resolve); });
        held['/item/2'].shift()!.reject({ status: 404, body: { message: 'Not found' } });
        await new Promise((resolve) => { setTimeout(resolve); });
        expect(i18n.locale).toBe('cs');

        await i18n.setLocale('de');
        commit(data, await wiring.load(universalEvent('/about', page('/about', 'en'))));
        await new Promise((resolve) => { setTimeout(resolve); });
        await i18n.setLocale('cs');
        commit(data, await wiring.load(universalEvent('/about', page('/about', 'en'))));
        await new Promise((resolve) => { setTimeout(resolve); });
        held['/item/3'].shift()!.resolve({ title: 'item 3' });
        await vi.waitFor(() => expect(i18n.loading).toBe(false));
        await new Promise((resolve) => { setTimeout(resolve); });

        commit(data, await wiring.load(universalEvent('/about', page('/about', 'en'))));
        await vi.waitFor(() => expect(i18n.loading).toBe(false));
        await new Promise((resolve) => { setTimeout(resolve); });

        expect(i18n.locale).toBe('cs');
        expect(text()).toBe('common cs');
      });

      describe('when an undo lands the locale switched to after its switch and stays settled', () => {
        const undoPending = async () => {
          const held: Record<string, Array<{ resolve: (value: unknown) => void; reject: (reason: unknown) => void }>> = {};
          const counts: Record<string, number> = {};
          const { wiring } = navigation([
            { locale: 'cs', namespace: 'common', loader: () => Promise.resolve({ greeting: 'common cs' }) },
            { locale: 'de', namespace: 'common', loader: () => Promise.resolve({ greeting: 'common de' }) },
            { locale: 'en', namespace: 'common', loader: () => Promise.resolve({ greeting: 'common en' }) },
            {
              locale: 'en', namespace: 'item', routes: items,
              loader: async ({ params }: any) => {
                counts[params.id] = (counts[params.id] ?? 0) + 1;

                if (counts[params.id] === 1) throw new Error('down');

                return new Promise((resolve, reject) => { (held[params.id] ??= []).push({ resolve, reject }); });
              },
            },
          ]);
          const data = cell<object>(await wiring.load(universalEvent('/about', page('/about', 'cs'))));
          const i18n = await opened(wiring, data, 'common cs');

          commit(data, await wiring.load(universalEvent('/item/2', page('/item/2', 'en'))));
          await new Promise((resolve) => { setTimeout(resolve); });
          commit(data, await wiring.load(universalEvent('/item/3', page('/item/3', 'en'))));
          await new Promise((resolve) => { setTimeout(resolve); });
          held['2'].shift()!.reject(new Error('down'));
          await new Promise((resolve) => { setTimeout(resolve); });
          held['3'].shift()!.reject({ status: 404, body: { message: 'Not found' } });
          await vi.waitFor(() => expect(held['2']).toHaveLength(1));
          await new Promise((resolve) => { setTimeout(resolve); });
          expect(i18n.locale).toBe('cs');

          return { data, i18n, wiring, land: () => held['2'].shift()!.resolve({ title: 'item 2' }) };
        };

        const undoLands = async () => {
          const { data, i18n, wiring, land } = await undoPending();

          land();
          await vi.waitFor(() => expect(i18n.locale).toBe('en'));
          await vi.waitFor(() => expect(i18n.loading).toBe(false));

          return { data, i18n, wiring };
        };

        it('switches at a commit whose answer changed', async () => {
          const { data, i18n, wiring } = await undoLands();

          commit(data, await wiring.load(universalEvent('/about', page('/about', 'cs'))));
          await vi.waitFor(() => expect(i18n.locale).toBe('cs'));
          expect(text()).toBe('common cs');
        });

        it('switches at a commit whose answer changed after a stale commit in the flush the undo landed in', async () => {
          const { data, i18n, wiring, land } = await undoPending();
          const stale = await wiring.load(universalEvent('/about', page('/about', 'en')));

          land();
          for (let spins = 0; i18n.locale !== 'en' && spins < 100; spins += 1) await Promise.resolve();
          expect(i18n.locale).toBe('en');
          expect(document.documentElement.lang).toBe('cs');
          commit(data, stale);
          await vi.waitFor(() => expect(i18n.loading).toBe(false));

          commit(data, await wiring.load(universalEvent('/about', page('/about', 'cs'))));
          await vi.waitFor(() => expect(i18n.locale).toBe('cs'));
          expect(text()).toBe('common cs');
        });

        it('keeps a client locale set afterwards at a commit whose answer did not change', async () => {
          const { data, i18n, wiring } = await undoLands();

          await i18n.setLocale('de');
          commit(data, await wiring.load(universalEvent('/about', page('/about', 'en'))));
          await vi.waitFor(() => expect(i18n.loading).toBe(false));
          await new Promise((resolve) => { setTimeout(resolve); });

          expect(i18n.locale).toBe('de');
          expect(text()).toBe('common de');
        });
      });

      it('switches at a commit whose answer changed while a stay committed during the switch is still under way after another failed', async () => {
        const gates: Record<string, () => void> = {};
        const counts: Record<string, number> = {};
        const notFound: unknown = { status: 404, body: { message: 'Not found' } };
        const { wiring } = navigation([
          { locale: 'cs', namespace: 'common', loader: () => Promise.resolve({ greeting: 'common cs' }) },
          {
            locale: 'en', namespace: 'common', routes: items,
            loader: async ({ params }: any) => {
              counts[params.id] = (counts[params.id] ?? 0) + 1;

              if (counts[params.id] === 1) throw new Error('down');
              if (params.id === '4') throw notFound;

              return new Promise((resolve) => { gates[params.id] = () => resolve({ greeting: `item ${params.id} en` }); });
            },
          },
        ]);
        const data = cell<object>(await wiring.load(universalEvent('/about', page('/about', 'cs'))));
        const i18n = await opened(wiring, data, 'common cs');

        commit(data, await wiring.load(universalEvent('/item/2', page('/item/2', 'en'))));
        await new Promise((resolve) => { setTimeout(resolve); });
        commit(data, await wiring.load(universalEvent('/item/3', page('/item/3', 'en'))));
        await new Promise((resolve) => { setTimeout(resolve); });
        commit(data, await wiring.load(universalEvent('/item/4', page('/item/4', 'en'))));
        await new Promise((resolve) => { setTimeout(resolve); });
        gates['2']();
        await new Promise((resolve) => { setTimeout(resolve); });
        expect(i18n.locale).toBe('cs');

        commit(data, await wiring.load(universalEvent('/about', page('/about', 'cs'))));
        gates['3']();
        await vi.waitFor(() => expect(i18n.loading).toBe(false));
        await new Promise((resolve) => { setTimeout(resolve); });

        expect(i18n.locale).toBe('cs');
        expect(text()).toBe('common cs');
      });

      it('keeps a client locale set while a switch was under way when that switch fails after a later commit', async () => {
        const broken = gated('BROKEN');
        const { wiring } = navigation([
          { locale: 'cs', namespace: 'common', loader: () => Promise.resolve({ greeting: 'common cs' }) },
          { locale: 'de', namespace: 'common', loader: () => Promise.resolve({ greeting: 'common de' }) },
          { locale: 'en', namespace: 'common', loader: () => Promise.resolve({ greeting: 'common en' }) },
          { locale: 'en', namespace: 'item', routes: [/^\/item\/2$/], loader: broken.loader },
        ], throwsOn('BROKEN'));
        const data = cell<object>(await wiring.load(universalEvent('/about', page('/about', 'cs'))));
        const i18n = await opened(wiring, data, 'common cs');

        commit(data, await wiring.load(universalEvent('/item/2', page('/item/2', 'en'))));
        await new Promise((resolve) => { setTimeout(resolve); });
        await i18n.setLocale('de');
        commit(data, await wiring.load(universalEvent('/about', page('/about', 'en'))));
        broken.open();
        await vi.waitFor(() => expect(i18n.loading).toBe(false));
        await new Promise((resolve) => { setTimeout(resolve); });

        commit(data, await wiring.load(universalEvent('/item/3', page('/item/3', 'en'))));
        await vi.waitFor(() => expect(i18n.loading).toBe(false));
        await new Promise((resolve) => { setTimeout(resolve); });

        expect(i18n.locale).toBe('de');
        expect(text()).toBe('common de');
      });

      it('keeps a client locale a switch to it failed to apply when the next commit answers the previous one', async () => {
        let calls = 0;
        const { wiring } = navigation([
          { locale: 'cs', namespace: 'common', loader: () => Promise.resolve({ greeting: 'common cs' }) },
          { locale: 'de', namespace: 'common', loader: () => Promise.resolve({ greeting: 'common de' }) },
          {
            locale: 'de', namespace: 'item', routes: items,
            loader: () => {
              calls += 1;

              return calls === 1 ? Promise.reject(new Error('down')) : Promise.resolve({ title: 'BROKEN' });
            },
          },
        ], throwsOn('BROKEN'));
        const data = cell<object>(await wiring.load(universalEvent('/about', page('/about', 'cs'))));
        const i18n = await opened(wiring, data, 'common cs');

        await i18n.setLocale('de');
        commit(data, await wiring.load(universalEvent('/item/2', page('/item/2', 'de'))));
        await vi.waitFor(() => expect(i18n.loading).toBe(false));
        await new Promise((resolve) => { setTimeout(resolve); });
        expect(calls).toBe(2);

        commit(data, await wiring.load(universalEvent('/about', page('/about', 'cs'))));
        await vi.waitFor(() => expect(i18n.loading).toBe(false));
        await new Promise((resolve) => { setTimeout(resolve); });

        expect(i18n.locale).toBe('de');
        expect(text()).toBe('common de');
      });

      it('preloads the active locale, not the answer of a switch that failed, for an unmarked prerendered page', async () => {
        let calls = 0;
        const notFound: unknown = { status: 404, body: { message: 'Not found' } };
        const { wiring, runs } = navigation([
          { locale: 'cs', namespace: 'common', loader: () => Promise.resolve({ greeting: 'common cs' }) },
          {
            locale: 'en', namespace: 'common', routes: items,
            loader: async () => {
              calls += 1;

              if (calls === 1) throw new Error('down');

              throw notFound;
            },
          },
          { locale: 'cs', namespace: 'page', routes: ['/p'], loader: () => Promise.resolve({ title: 'p cs' }) },
          { locale: 'en', namespace: 'page', routes: ['/p'], loader: () => Promise.resolve({ title: 'p en' }) },
        ]);
        const data = cell<object>(await wiring.load(universalEvent('/about', page('/about', 'cs'))));
        const i18n = await opened(wiring, data, 'common cs');

        commit(data, await wiring.load(universalEvent('/item/2', page('/item/2', 'en'))));
        await vi.waitFor(() => expect(i18n.loading).toBe(false));
        await new Promise((resolve) => { setTimeout(resolve); });
        expect(i18n.locale).toBe('cs');

        await wiring.load(universalEvent('/p', prerendered('/p', 'cs', false)));

        expect(runs).toContain('cs:page:/p');
        expect(runs).not.toContain('en:page:/p');
      });

      it('switches at a commit preloaded while a switch was under way behind another, after both failed', async () => {
        const gates: Array<() => void> = [];
        const counts: Record<string, number> = {};
        const notFound: unknown = { status: 404, body: { message: 'Not found' } };
        const failing = (data: (key: string) => unknown) => async ({ locale, params }: any) => {
          const key = `${locale} ${params.id}`;

          counts[key] = (counts[key] ?? 0) + 1;

          if (counts[key] === 1) throw new Error('down');
          if (locale === 'de' || params.id === '2') {
            await new Promise<void>((resolve) => { gates.push(resolve); });
            throw notFound;
          }

          return data(key);
        };
        const { wiring } = navigation([
          { locale: 'cs', namespace: 'common', loader: () => Promise.resolve({ greeting: 'common cs' }) },
          { locale: 'de', namespace: 'common', loader: failing(() => ({ greeting: 'common de' })) },
          { locale: 'en', namespace: 'common', routes: items, loader: failing((key) => ({ greeting: `item ${key.split(' ')[1]} en` })) },
        ]);
        const data = cell<object>(await wiring.load(universalEvent('/about', page('/about', 'cs'))));
        const i18n = await opened(wiring, data, 'common cs');

        commit(data, await wiring.load(universalEvent('/de', page('/de', 'de'))));
        await new Promise((resolve) => { setTimeout(resolve); });
        commit(data, await wiring.load(universalEvent('/item/2', page('/item/2', 'en'))));
        await new Promise((resolve) => { setTimeout(resolve); });

        const hovered = await wiring.load(universalEvent('/item/3', page('/item/3', 'en')));

        expect(gates).toHaveLength(2);
        gates[1]();
        await new Promise((resolve) => { setTimeout(resolve); });
        gates[0]();
        await vi.waitFor(() => expect(i18n.loading).toBe(false));
        await new Promise((resolve) => { setTimeout(resolve); });
        expect(i18n.locale).toBe('cs');

        commit(data, hovered);
        await vi.waitFor(() => expect(i18n.locale).toBe('en'));
        expect(text()).toBe('item 3 en');
      });

      it('switches nothing at a prerendered commit preloaded while a switch that failed was under way', async () => {
        const gates: Array<() => void> = [];
        let calls = 0;
        const notFound: unknown = { status: 404, body: { message: 'Not found' } };
        const { wiring } = navigation([
          { locale: 'cs', namespace: 'common', loader: () => Promise.resolve({ greeting: 'common cs' }) },
          {
            locale: 'en', namespace: 'common', routes: items,
            loader: ({ params }: any) => {
              if (params.id !== '2') return Promise.resolve({ greeting: `item ${params.id} en` });

              calls += 1;

              return calls === 1
                ? Promise.reject(new Error('down'))
                : new Promise<void>((resolve) => { gates.push(resolve); }).then(() => { throw notFound; });
            },
          },
          { locale: 'en', namespace: 'common', routes: ['/p'], loader: () => Promise.resolve({ greeting: 'p en' }) },
        ]);
        const data = cell<object>(await wiring.load(universalEvent('/about', page('/about', 'cs'))));
        const i18n = await opened(wiring, data, 'common cs');

        commit(data, await wiring.load(universalEvent('/item/2', page('/item/2', 'en'))));
        await new Promise((resolve) => { setTimeout(resolve); });

        const hovered = await wiring.load(universalEvent('/p', prerendered('/p', 'cs', false)));

        gates.splice(0).forEach((open) => open());
        await vi.waitFor(() => expect(i18n.loading).toBe(false));
        await new Promise((resolve) => { setTimeout(resolve); });
        expect(i18n.locale).toBe('cs');

        commit(data, hovered);
        await vi.waitFor(() => expect(i18n.loading).toBe(false));
        await new Promise((resolve) => { setTimeout(resolve); });
        expect(i18n.locale).toBe('cs');
        expect(text()).toBe('common cs');
      });

      it('leaves the answer to the next commit when a stay committed while a switch was under way fails with it', async () => {
        const gates: Array<() => void> = [];
        let calls = 0;
        const { wiring } = navigation([
          { locale: 'cs', namespace: 'common', loader: () => Promise.resolve({ greeting: 'common cs' }) },
          { locale: 'en', namespace: 'common', routes: items, loader: ({ params }: any) => Promise.resolve({ greeting: `item ${params.id} en` }) },
          {
            locale: 'en', namespace: 'extra', cache: false,
            loader: () => {
              calls += 1;

              if (calls > 4) return Promise.resolve({ greeting: 'fine' });

              return calls % 2 === 1
                ? Promise.reject(new Error('down'))
                : new Promise((resolve) => { gates.push(() => resolve({ greeting: 'BROKEN' })); });
            },
          },
        ], throwsOn('BROKEN'));
        const data = cell<object>(await wiring.load(universalEvent('/about', page('/about', 'cs'))));
        const i18n = await opened(wiring, data, 'common cs');

        commit(data, await wiring.load(universalEvent('/item/2', page('/item/2', 'en'))));
        await new Promise((resolve) => { setTimeout(resolve); });
        commit(data, await wiring.load(universalEvent('/item/3', page('/item/3', 'en'))));
        await new Promise((resolve) => { setTimeout(resolve); });
        expect(gates).toHaveLength(2);
        gates.splice(0).forEach((open) => open());
        await vi.waitFor(() => expect(i18n.loading).toBe(false));
        await new Promise((resolve) => { setTimeout(resolve); });
        expect(i18n.locale).toBe('cs');

        commit(data, await wiring.load(universalEvent('/item/4', page('/item/4', 'en'))));
        await vi.waitFor(() => expect(i18n.locale).toBe('en'));
        expect(text()).toBe('item 4 en');
      });

      it('shows the page a switch whose data failed to apply committed to in the locale it switched from', async () => {
        const { wiring } = navigation([
          { locale: 'cs', namespace: 'common', routes: items, loader: ({ params }: any) => Promise.resolve({ greeting: `item ${params.id} cs` }) },
          { locale: 'en', namespace: 'common', routes: items, loader: ({ params }: any) => Promise.resolve({ greeting: `item ${params.id} en` }) },
        ], throwsOn('item 2 en'));
        const data = cell<object>(await wiring.load(universalEvent('/item/1', page('/item/1', 'en'))));
        const i18n = await opened(wiring, data, 'item 1 en');

        commit(data, await wiring.load(universalEvent('/item/3', page('/item/3', 'cs'))));
        await vi.waitFor(() => expect(text()).toBe('item 3 cs'));
        commit(data, await wiring.load(universalEvent('/item/2', page('/item/2', 'en'))));
        await vi.waitFor(() => expect(text()).toBe('item 2 cs'));
        await vi.waitFor(() => expect(i18n.loading).toBe(false));
        expect(i18n.locale).toBe('cs');
      });

      it('switches at the next answer after a switch whose data failed to apply, so a client setLocale() back stands once it lands', async () => {
        const { wiring, runs } = navigation([
          { locale: 'cs', namespace: 'common', loader: () => Promise.resolve({ greeting: 'common cs' }) },
          { locale: 'en', namespace: 'common', routes: items, loader: ({ params }: any) => Promise.resolve({ greeting: `item ${params.id} en` }) },
          { locale: 'en', namespace: 'common', routes: ['/about'], loader: () => Promise.resolve({ greeting: 'about en' }) },
        ], {
          preprocess: (input: any) => {
            if (JSON.stringify(input).includes('item 2 en')) throw new Error('broken');

            return Object.fromEntries(Object.entries(input).flatMap(([namespace, keys]: [string, any]) => Object.entries(keys).map(([key, value]) => [`${namespace}.${key}`, value])));
          },
        });
        const data = cell<object>(await wiring.load(universalEvent('/item/1', page('/item/1', 'en'))));
        const i18n = await opened(wiring, data, 'item 1 en');

        commit(data, await wiring.load(universalEvent('/about', page('/about', 'cs'))));
        await vi.waitFor(() => expect(text()).toBe('common cs'));
        commit(data, await wiring.load(universalEvent('/item/2', page('/item/2', 'en'))));
        await new Promise((resolve) => { setTimeout(resolve); });
        commit(data, await wiring.load(universalEvent('/item/3', page('/item/3', 'en'))));
        expect(text()).toBe('item 3 en');
        await i18n.setLocale('cs');
        await new Promise((resolve) => { setTimeout(resolve); });

        const before = runs.length;

        commit(data, await wiring.load(universalEvent('/item/4', page('/item/4', 'en'))));
        await vi.waitFor(() => expect(i18n.loading).toBe(false));
        expect(i18n.locale).toBe('cs');
        expect(text()).toBe('common cs');
        expect(runs.slice(before)).toEqual([]);
      });

      it('preloads the answer of a switch whose data failed to apply at the next navigation, and shows it in that commit\'s flush', async () => {
        const { wiring, runs } = navigation([
          { locale: 'cs', namespace: 'common', loader: () => Promise.resolve({ greeting: 'common cs' }) },
          { locale: 'en', namespace: 'common', routes: items, loader: ({ params }: any) => Promise.resolve({ greeting: `item ${params.id} en` }) },
          { locale: 'en', namespace: 'common', routes: ['/about'], loader: () => Promise.resolve({ greeting: 'about en' }) },
        ], {
          preprocess: (input: any) => {
            if (JSON.stringify(input).includes('item 2 en')) throw new Error('broken');

            return Object.fromEntries(Object.entries(input).flatMap(([namespace, keys]: [string, any]) => Object.entries(keys).map(([key, value]) => [`${namespace}.${key}`, value])));
          },
        });
        const data = cell<object>(await wiring.load(universalEvent('/item/1', page('/item/1', 'en'))));
        const i18n = await opened(wiring, data, 'item 1 en');

        commit(data, await wiring.load(universalEvent('/about', page('/about', 'cs'))));
        await vi.waitFor(() => expect(text()).toBe('common cs'));
        commit(data, await wiring.load(universalEvent('/item/2', page('/item/2', 'en'))));
        // SvelteKit starts the next load a task later.
        await new Promise((resolve) => { setTimeout(resolve); });

        const before = runs.length;

        commit(data, await wiring.load(universalEvent('/item/3', page('/item/3', 'en'))));
        expect(i18n.locale).toBe('en');
        expect(text()).toBe('item 3 en');
        expect(runs.slice(before)).toEqual(['en:common:/item/3']);

        commit(data, await wiring.load(universalEvent('/about', page('/about', 'cs'))));
        await vi.waitFor(() => expect(i18n.loading).toBe(false));
        expect(i18n.locale).toBe('cs');
        expect(text()).toBe('common cs');
      });
    });
  });
});
