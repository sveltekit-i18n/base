import * as devalue from 'devalue';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import i18n from '../../src/index.js';
import type { Config, Extension, I18n, Loader, Parser, Schema, Snapshot, Translations } from '../../src/index.js';
import { logger, loggerFactory, setLogger } from '../../src/logger.js';
import { matchLocale, read, resolveLoaders, sanitizeLocales, testRoute, toDotNotation, translate } from '../../src/utils.js';
import * as publicUtils from '../../src/exports/utils.js';
import type { DotNotation } from '../../src/exports/utils.js';
import { CONFIG, getTranslations } from '../data/index.js';
import { filterTranslationKeys } from '../utils/index.js';

const TRANSLATIONS = getTranslations();

const { initLocale = '', loaders = [], parser, log } = CONFIG;

// The public descriptor type is a union over the two namespace spellings, so
// reading one takes the same resolution the core applies at the config boundary.
const resolved = resolveLoaders(loaders);

describe('i18n instance', () => {
  it('exports all properties and methods', () => {
    const instance = new i18n();

    // Called per property: destructured matchers are not bound in vitest.
    expect(instance).toHaveProperty('locale');
    expect(instance).toHaveProperty('locales');
    expect(instance).toHaveProperty('loading');
    expect(instance).toHaveProperty('initialized');
    expect(instance).toHaveProperty('translations');
    expect(instance).toHaveProperty('rawTranslations');
    expect(instance).toHaveProperty('t');
    expect(instance).toHaveProperty('l');
    expect(instance).toHaveProperty('loadConfig');
    expect(instance).toHaveProperty('loadTranslations');
    expect(instance).toHaveProperty('loadNamespace');
    expect(instance).toHaveProperty('addTranslations');
    expect(instance).toHaveProperty('setLocale');
    expect(instance).toHaveProperty('setRoute');
    expect(instance).toHaveProperty('invalidate');
    expect(instance).toHaveProperty('snapshot');
    expect(instance).toHaveProperty('hydrate');
    expect(instance).toHaveProperty('destroy');
    // The v2 SSR hand-off primitive is deleted from v3, not deprecated — pin
    // its absence so it cannot quietly return.
    expect(instance).not.toHaveProperty('getTranslationProps');
  });
  it('`setRoute` does not trigger loading when no locale was requested', async () => {
    const instance = new i18n({ loaders, parser, log });

    await instance.setRoute('/');

    expect(instance.locale).toBe(undefined);
    expect(instance.initialized).toBe(false);
    expect(instance.loading).toBe(false);
  });
  it('`setRoute` triggers loading once a locale was requested', async () => {
    const instance = new i18n({ loaders, parser, log });

    await instance.setLocale(initLocale);

    const promise = instance.setRoute('/');

    expect(instance.loading).toBe(true);
    expect(instance.initialized).toBe(false);

    await promise;

    expect(instance.initialized).toBe(true);
  });
  it('`setLocale` does not trigger loading when no route is set', async () => {
    const instance = new i18n({ loaders, parser, log });

    await instance.setLocale(initLocale);

    expect(instance.loading).toBe(false);
    expect(Object.keys(instance.translations).length).toBe(0);
  });
  it('`setLocale` triggers loading when a route is set', async () => {
    const instance = new i18n({ loaders, parser, log });

    await instance.setRoute('');

    const promise = instance.setLocale(initLocale);

    expect(instance.loading).toBe(true);

    await promise;

    expect(Object.keys(instance.translations).length).toBeGreaterThan(0);
  });
  it('`setLocale` does not set an unknown locale', async () => {
    const instance = new i18n({ loaders, parser, log });

    await instance.setRoute('');
    await instance.setLocale('unknown');

    expect(instance.loading).toBe(false);
    expect(instance.locale).toBe(undefined);
  });
  it('assigning `locale` does not load until a route is set', async () => {
    const instance = new i18n({ loaders, parser, log });

    instance.locale = initLocale;

    expect(instance.loading).toBe(false);

    const promise = instance.setRoute('');

    expect(instance.loading).toBe(true);

    await promise;

    expect(instance.initialized).toBe(true);
  });
  it('the active `locale` is case-insensitive to the requested one', async () => {
    const instance = new i18n({ loaders, parser, log });

    await instance.setRoute('');
    await instance.setLocale(initLocale.toUpperCase());

    expect(instance.locale).toBe(initLocale.toLowerCase());
  });
  it('`locale` can be non-standard', async () => {
    const nonStandardLocale = 'ku';
    const instance = new i18n({
      loaders: [{
        namespace: 'common',
        locale: nonStandardLocale.toUpperCase(),
        loader: async () => (await import(`../data/translations/${nonStandardLocale}/common.json`)).default,
      }],
      parser,
      log,
    });

    await instance.setRoute('');
    await instance.setLocale(nonStandardLocale);

    expect(instance.locale).toBe(nonStandardLocale);
    expect(instance.locales).toContainEqual(nonStandardLocale);
    expect(instance.translations[nonStandardLocale]).toEqual(
      expect.objectContaining(filterTranslationKeys(TRANSLATIONS[nonStandardLocale], ['common'])),
    );
  });
  it('`addTranslations` adds raw translations', () => {
    const instance = new i18n();

    const translations = getTranslations('none');

    instance.addTranslations(translations);

    expect(instance.rawTranslations).toStrictEqual(translations);
  });
  it('`addTranslations` adds preprocessed translations', () => {
    const instance = new i18n();

    instance.addTranslations(getTranslations('none'));

    expect(instance.translations).toStrictEqual(TRANSLATIONS);
  });
  it('a plain `hydrate` prevents a duplicit load', () => {
    const instance = new i18n({ loaders, parser, log });

    instance.hydrate({ translations: TRANSLATIONS });
    void instance.loadTranslations(initLocale);

    expect(instance.loading).toBe(false);
  });
  it('a cache-served load still activates the locale', async () => {
    const instance = new i18n({ loaders, parser, log });

    instance.hydrate({ translations: TRANSLATIONS });
    await instance.loadTranslations(initLocale);

    expect(instance.locale).toBe(initLocale);
  });
  it('`preprocess` works when set to `full`', async () => {
    const instance = new i18n({ loaders, parser, log, preprocess: 'full' });

    await instance.loadTranslations(initLocale);

    expect(instance.translations[initLocale]['common.preprocess.0.test.array']).toBe('passed');
  });
  it('`preprocess` works when set to `preserveArrays`', async () => {
    const instance = new i18n({ loaders, parser, log, preprocess: 'preserveArrays' });

    await instance.loadTranslations(initLocale);

    expect(instance.translations[initLocale]['common.preprocess']).toStrictEqual([
      { 'test.array': 'passed' },
      'string',
      null,
      0,
      1,
      -1,
      true,
      false,
    ]);
  });
  it('`preprocess` works when set to `none`', async () => {
    const instance = new i18n({ loaders, parser, log, preprocess: 'none' });

    await instance.loadTranslations(initLocale);

    expect(instance.translations).toStrictEqual(instance.rawTranslations);
    expect(instance.translations[initLocale].common.preprocess[0].test.array).toBe('passed');
  });
  it('`preprocess` set to a custom function stores its output as-is', async () => {
    const instance = new i18n({
      loaders,
      parser,
      log,
      preprocess: (input) => Object.fromEntries(
        Object.entries(input).map(([key, value]) => [`app.${key}`, value]),
      ),
    });

    await instance.loadTranslations(initLocale);

    // A custom function replaces the flattening rather than feeding it: the
    // nesting survives and the namespace is reachable only under the key the
    // function produced.
    expect(instance.translations[initLocale]['app.common'].preprocess[0].test.array).toBe('passed');
    expect(instance.translations[initLocale].common).toBeUndefined();
    expect(instance.rawTranslations[initLocale].common.preprocess[0].test.array).toBe('passed');
  });
  it('initializes properly with `initLocale`', async () => {
    const instance = new i18n();

    await instance.loadConfig(CONFIG);

    expect(instance.initialized).toBe(true);
  });
  it('does not initialize without `initLocale`', async () => {
    const instance = new i18n();

    await instance.loadConfig({ loaders, parser, log });

    expect(instance.initialized).toBe(false);
  });
  it('`loading` is set for the duration of a load and released after', async () => {
    const instance = new i18n({ loaders, parser, log });

    const promise = instance.loadTranslations(initLocale, '/');

    expect(instance.loading).toBe(true);

    await promise;

    expect(instance.loading).toBe(false);
  });
  it('includes `locales` after config load', async () => {
    const instance = new i18n();

    await instance.loadConfig(CONFIG);

    expect(instance.locales).toContain(initLocale);
  });
  it('includes the current `locale` value', async () => {
    const instance = new i18n();

    await instance.loadConfig(CONFIG);

    expect(instance.locale).toBe(initLocale);
  });
  it('includes `translations` for `initLocale` only after config load', async () => {
    const instance = new i18n();

    await instance.loadConfig(CONFIG);

    const keys = resolved.filter(({ routes }) => !routes).map(({ namespace }) => namespace);

    instance.locales.forEach((locale) => {
      expect(instance.translations[locale]).toEqual(
        (locale === initLocale)
          ? expect.objectContaining(filterTranslationKeys(TRANSLATIONS[locale], keys))
          : expect.not.objectContaining(TRANSLATIONS[locale]),
      );
    });
  });
  it('includes both `translations` when using `fallbackLocale`', async () => {
    const instance = new i18n();
    const fallbackLocale = resolved.find(({ locale }) => locale.toLowerCase() !== initLocale.toLowerCase())?.locale;

    await instance.loadConfig({ ...CONFIG, fallbackLocale });

    const keys = resolved.filter(({ routes }) => !routes).map(({ namespace }) => namespace);

    instance.locales.forEach((locale) => {
      expect(instance.translations[locale]).toEqual(
        expect.objectContaining(filterTranslationKeys(TRANSLATIONS[locale], keys)),
      );
    });
  });
  it('`fallbackLocale` is used instead of an unknown locale', async () => {
    const fallbackLocale = resolved.find(({ locale }) => locale.toLowerCase() !== initLocale.toLowerCase())?.locale;

    const instance = new i18n({ loaders, parser, fallbackLocale });

    await instance.loadTranslations('de', '');

    expect(instance.locale).toBe(fallbackLocale);
  });
  it('includes `translations` only for loaders without routes', async () => {
    const instance = new i18n();

    await instance.loadConfig(CONFIG);

    const keys = resolved.filter(({ routes }) => !!routes).map(({ namespace }) => namespace);

    expect(instance.translations[initLocale]).toEqual(
      expect.not.objectContaining(filterTranslationKeys(TRANSLATIONS[initLocale], keys)),
    );
  });
  it('`loadTranslations` works without a route', async () => {
    const instance = new i18n();

    await instance.loadConfig({ loaders, parser, log });
    expect(instance.initialized).toBe(false);

    await instance.loadTranslations(initLocale);
    expect(instance.initialized).toBe(true);
  });
  it('`loadTranslations` works for given routes only', async () => {
    const instance = new i18n({ loaders, parser, log });
    const url = '/path#hash?a=b&c=d';
    const keys = resolved.filter(({ routes }) => routes?.includes(url)).map(({ namespace }) => namespace);

    await instance.loadTranslations(initLocale, '/');
    expect(instance.translations[initLocale]).toEqual(
      expect.not.objectContaining(filterTranslationKeys(TRANSLATIONS[initLocale], keys)),
    );

    await instance.loadTranslations(initLocale, url);
    expect(instance.translations[initLocale]).toEqual(
      expect.objectContaining(TRANSLATIONS[initLocale]),
    );
  });
  it('loads a namespace the same whether it is named `namespace` or the deprecated `key`', async () => {
    const loader = async () => ({ greeting: 'Hi' });

    const current = new i18n({ parser, log, loaders: [{ namespace: 'common', locale: 'en', loader }] });
    const legacy = new i18n({ parser, log, loaders: [{ key: 'common', locale: 'en', loader }] });

    await Promise.all([
      current.loadTranslations('en', '/'),
      legacy.loadTranslations('en', '/'),
    ]);

    expect(legacy.translations).toEqual(current.translations);
    expect(legacy.rawTranslations).toEqual(current.rawTranslations);
    expect(legacy.t('common.greeting')).toBe(current.t('common.greeting'));
  });
  it('keeps a deprecated-name loader from refetching, exactly as the current name does', async () => {
    let calls = 0;
    const loader = async () => { calls += 1; return { greeting: 'Hi' }; };

    const instance = new i18n({ parser, log, loaders: [{ key: 'common', locale: 'en', loader }] });

    await instance.loadTranslations('en', '/');
    await instance.loadTranslations('en', '/');

    expect(calls).toBe(1);
  });
  it('a failed load rejects the returned promise', async () => {
    const instance = new i18n({
      parser,
      log,
      preprocess: () => { throw new Error('preprocess boom'); },
      loaders: [{ namespace: 'common', locale: 'en', loader: async () => ({ greeting: 'Hi' }) }],
    });

    await expect(instance.loadTranslations('en', '/')).rejects.toThrow('preprocess boom');

    // The failed load must not stay pending forever.
    expect(instance.loading).toBe(false);
  });
  it('`fallbackValue` works with a `string` value', async () => {
    const fallbackValue = 'CUSTOM_FALLBACK_VALUE';

    const instance = new i18n({ ...CONFIG, fallbackValue });

    await instance.loadTranslations(initLocale);

    expect(instance.t('unknown.key')).toBe(fallbackValue);
  });
  it('`fallbackValue` works with an `undefined` value', async () => {
    const fallbackValue = undefined;

    const instance = new i18n({ ...CONFIG, fallbackValue });

    await instance.loadTranslations(initLocale);

    expect(instance.t('unknown.key')).toBe(fallbackValue);
  });
  it('returns the translation key when `fallbackValue` is not present', async () => {
    const instance = new i18n(CONFIG);

    await instance.loadTranslations(initLocale);

    const key = 'unknown.key';

    expect(instance.t(key)).toBe(key);
  });
  it('answers a missing translation itself rather than asking the parser', async () => {
    const parse = vi.fn(() => 'PARSED');

    const instance = new i18n({ ...CONFIG, parser: { parse } });

    await instance.loadTranslations(initLocale);

    const key = 'unknown.key';

    expect(instance.t(key)).toBe(key);
    expect(parse).not.toHaveBeenCalled();
  });
  it('treats `Object.prototype` keys as missing translations', async () => {
    const fallbackValue = 'CUSTOM_FALLBACK_VALUE';

    const instance = new i18n({ ...CONFIG, fallbackValue });

    await instance.loadTranslations(initLocale);

    // These keys exist on `Object.prototype`; they must not leak as translations.
    ['toString', 'constructor', 'valueOf', 'hasOwnProperty', '__proto__'].forEach((key) => {
      expect(instance.t(key)).toBe(fallbackValue);
    });
  });
  it('handles a locale named like an `Object.prototype` member', async () => {
    // A loader locale colliding with a prototype member must not throw when the
    // `loadedKeys` cache is indexed by it, must keep its data, and must still
    // be deduped by that cache.
    let calls = 0;
    const instance = new i18n({
      ...CONFIG,
      initLocale: undefined,
      loaders: [
        {
          namespace: 'common',
          locale: '__proto__',
          loader: async () => { calls += 1; return { greeting: 'Hi' }; },
        },
      ],
    });

    await expect(instance.loadTranslations('__proto__')).resolves.not.toThrow();

    expect(read(instance.translations, '__proto__')).toEqual(
      expect.objectContaining({ 'common.greeting': 'Hi' }),
    );

    // The dedupe cache must hold an OWN entry for the locale — on a plain
    // object the write would go through the `__proto__` setter instead, and
    // the loader would refire on every route change.
    await instance.loadTranslations('__proto__', '/second');
    expect(calls).toBe(1);
  });
  it('keeps a literal `__proto__` translation key as an own property', () => {
    const instance = new i18n({ parser, log });

    // JSON.parse creates real own '__proto__' keys (object literals would not).
    instance.addTranslations({ en: JSON.parse('{"__proto__": "boom", "plain": "ok"}') });

    const table = instance.translations.en;

    expect(read(table, '__proto__')).toBe('boom');
    expect(table.plain).toBe('ok');
    expect(({} as any).boom).toBe(undefined); // Object.prototype untouched
  });
  it('`addTranslations` fails soft on a `null` payload', () => {
    const instance = new i18n({ parser, log });

    // A module that resolved to `null` is consumer input, not a bug in the
    // instance: every other step tolerates it, so the whole call must too.
    expect(() => instance.addTranslations({ en: null as any, de: { greeting: 'Hallo' } })).not.toThrow();

    expect(read(instance.translations, 'de')).toEqual(
      expect.objectContaining({ greeting: 'Hallo' }),
    );
  });
  it('merges two loaders sharing a prototype-named locale into one table', async () => {
    const instance = new i18n({
      ...CONFIG,
      initLocale: undefined,
      loaders: [
        { namespace: 'a', locale: '__proto__', loader: async () => ({ one: '1' }) },
        { namespace: 'b', locale: '__proto__', loader: async () => ({ two: '2' }) },
      ],
    });

    await instance.loadTranslations('__proto__');

    expect(read(instance.translations, '__proto__')).toEqual(
      expect.objectContaining({ 'a.one': '1', 'b.two': '2' }),
    );
  });
  it('logger works as expected', async () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      const instance = new i18n({
        ...CONFIG,
        initLocale: 'unknown',
        log: { level: 'debug', logger: console, prefix: '[PREFIX] ' },
      });

      await vi.waitFor(() => {
        expect(warn).toHaveBeenCalledWith("[PREFIX] 'unknown' locale is non-standard.");
      });

      expect(debug).toHaveBeenCalledWith('[PREFIX] Setting config.');
      expect(instance.loading).toBe(false);
    } finally {
      debug.mockRestore();
      warn.mockRestore();
    }
  });
  it('keeps successful translations when one loader throws', async () => {
    const errorSpy = vi.fn();
    const instance = new i18n({
      parser: { parse: (text: any, _params: any, _locale: any, key: string) => (text === undefined ? key : text) },
      log: { level: 'error', logger: { error: errorSpy, warn: () => {}, debug: () => {} } },
      loaders: [
        { namespace: 'common', locale: 'en', loader: async () => ({ greeting: 'Hello' }) },
        { namespace: 'broken', locale: 'en', loader: async () => { throw new Error('loader boom'); } },
      ],
    });

    await instance.loadTranslations('en', '/');

    expect(instance.t('common.greeting')).toBe('Hello');
    expect(errorSpy).toHaveBeenCalled();
  });
  it('merges loaders sharing a locale and key instead of keeping the last one', async () => {
    const instance = new i18n({
      parser: { parse: (text: any, _params: any, _locale: any, key: string) => (text === undefined ? key : text) },
      log,
      loaders: [
        { namespace: 'common', locale: 'en', routes: ['/'], loader: async () => ({ menu: { home: 'Home' } }) },
        { namespace: 'common', locale: 'en', loader: async () => ({ menu: { about: 'About' }, greeting: 'Hello' }) },
      ],
    });

    await instance.loadTranslations('en', '/');

    expect(instance.t('common.menu.home')).toBe('Home');
    expect(instance.t('common.menu.about')).toBe('About');
    expect(instance.t('common.greeting')).toBe('Hello');
    expect(instance.rawTranslations['en']['common']).toEqual({ menu: { home: 'Home', about: 'About' }, greeting: 'Hello' });
  });
  it('keeps the last loader value on a leaf conflict and reports it', async () => {
    const warnSpy = vi.fn();
    const instance = new i18n({
      parser: { parse: (text: any, _params: any, _locale: any, key: string) => (text === undefined ? key : text) },
      log: { level: 'warn', logger: { error: () => {}, warn: warnSpy, debug: () => {} } },
      loaders: [
        { namespace: 'common', locale: 'en', loader: async () => ({ home: { title: 'Title' } }) },
        { namespace: 'common', locale: 'en', loader: async () => ({ home: 'Home' }) },
      ],
    });

    await instance.loadTranslations('en', '/');

    expect(instance.t('common.home')).toBe('Home');
    expect(warnSpy).toHaveBeenCalledWith("[i18n]: Conflicting translations for 'common.home'. Keeping the value of the last loader.");
  });
  it('merges data added to a namespace that already holds some', async () => {
    const warnSpy = vi.fn();
    const instance = new i18n({
      parser: { parse: (text: any, _params: any, _locale: any, key: string) => (text === undefined ? key : text) },
      log: { level: 'warn', logger: { error: () => {}, warn: warnSpy, debug: () => {} } },
      initLocale: 'en',
      loaders: [
        { namespace: 'common', locale: 'en', loader: async () => ({ menu: { home: 'Home' } }) },
      ],
    });

    await instance.loadTranslations('en', '/');
    instance.addTranslations({ en: { common: { menu: { about: 'About' } } } });

    expect(instance.t('common.menu.home')).toBe('Home');
    expect(instance.t('common.menu.about')).toBe('About');
    expect(instance.rawTranslations['en']['common']).toEqual({ menu: { home: 'Home', about: 'About' } });
    expect(instance.snapshot()).toEqual({ en: { common: { menu: { home: 'Home', about: 'About' } } } });

    instance.addTranslations({ en: { common: { menu: { home: 'Domov' } } } });

    expect(instance.t('common.menu.home')).toBe('Domov');
    expect(warnSpy).not.toHaveBeenCalled();
  });
  it('a loader receives its sanitized locale and the triggering route', async () => {
    const received: unknown[] = [];
    const instance = new i18n({
      parser,
      log,
      loaders: [
        { namespace: 'common', locale: 'EN', loader: async (props) => { received.push(props); return { greeting: 'Hello' }; } },
      ],
    });

    await instance.loadTranslations('en', '/path');

    expect(received).toEqual([{ locale: 'en', namespace: 'common', route: '/path', params: {} }]);
  });
  it('a fallback-locale loader receives its own locale, not the requested one', async () => {
    const received: unknown[] = [];
    const push = async (props: Loader.Props) => { received.push(props); return { greeting: 'Hello' }; };
    const instance = new i18n({
      parser,
      log,
      fallbackLocale: 'EN',
      loaders: [
        { namespace: 'common', locale: 'EN', loader: push },
        { namespace: 'common', locale: 'DE', loader: push },
      ],
    });

    await instance.loadTranslations('de', '/path');

    expect(received).toEqual(expect.arrayContaining([
      { locale: 'de', namespace: 'common', route: '/path', params: {} },
      { locale: 'en', namespace: 'common', route: '/path', params: {} },
    ]));
    expect(received).toHaveLength(2);
  });
  it('sanitizes every locale once, so a `sanitizeLocales` that is not idempotent still matches', async () => {
    const instance = new i18n({
      parser,
      log,
      sanitizeLocales: (locale) => `${locale}-x`,
      initLocale: 'de',
      fallbackLocale: 'en',
      loaders: [
        { namespace: 'common', locale: 'en', loader: async () => ({ greeting: 'Hello' }) },
        { namespace: 'common', locale: 'de', loader: async () => ({ greeting: 'Hallo' }) },
      ],
    });

    await instance.setRoute('/');
    await instance.loadTranslations('de');

    expect(instance.locale).toBe('de-x');
    expect(instance.translations).toEqual({
      'de-x': { 'common.greeting': 'Hallo' },
      'en-x': { 'common.greeting': 'Hello' },
    });
    expect(instance.locales).toEqual(['en-x', 'de-x']);
    expect(Object.keys(instance.snapshot()).sort()).toEqual(['de-x', 'en-x']);
  });
  it('calls a loader naming several locales and namespaces once per pair', async () => {
    const received: Loader.Props[] = [];
    const instance = new i18n({
      parser,
      log,
      fallbackLocale: 'en',
      loaders: [
        {
          locale: ['EN', 'de'],
          namespace: ['common', 'nav'],
          loader: async (props) => { received.push(props); return { title: `${props.locale}:${props.namespace}` }; },
        },
      ],
    });

    await instance.loadTranslations('de', '/path');

    expect(received).toHaveLength(4);
    expect(received).toEqual(expect.arrayContaining([
      { locale: 'en', namespace: 'common', route: '/path', params: {} },
      { locale: 'en', namespace: 'nav', route: '/path', params: {} },
      { locale: 'de', namespace: 'common', route: '/path', params: {} },
      { locale: 'de', namespace: 'nav', route: '/path', params: {} },
    ]));
    expect(instance.translations.de).toEqual({ 'common.title': 'de:common', 'nav.title': 'de:nav' });
    expect(instance.locales).toEqual(['en', 'de']);
  });
  it('passes the named groups of the first matching route to a loader as `params`', async () => {
    const received: Loader.Params[] = [];
    const instance = new i18n({
      parser,
      log,
      loaders: [
        {
          namespace: 'article',
          locale: 'en',
          routes: ['/article/list', /^\/article\/(?<articleId>\d+)(?:\/(?<section>[a-z]+))?/, /^\/article\/(?<other>.+)/],
          loader: async ({ params }) => { received.push(params); return { title: 'Article' }; },
        },
      ],
    });

    await instance.loadTranslations('en', '/article/5');
    await instance.loadTranslations('en', '/article/list');

    // A group that took no part is left out; a string route yields none.
    expect(received).toEqual([{ articleId: '5' }, {}]);
    expect(Object.getPrototypeOf(received[0])).toBe(Object.prototype);
  });
  it('runs a loader again when its params change, replacing the data of the previous ones', async () => {
    const calls: string[] = [];
    const instance = new i18n({
      parser,
      log,
      loaders: [
        {
          namespace: 'article',
          locale: 'en',
          routes: [/^\/article\/(?<articleId>\d+)/],
          loader: async ({ params }) => {
            calls.push(params.articleId);

            return params.articleId === '5' ? { title: 'Five', only5: 'stale' } : { title: 'Six' };
          },
        },
      ],
    });

    await instance.loadTranslations('en', '/article/5');
    expect(instance.translations.en).toEqual({ 'article.title': 'Five', 'article.only5': 'stale' });

    await instance.loadTranslations('en', '/article/6');
    expect(instance.translations.en).toEqual({ 'article.title': 'Six' });
    expect(instance.rawTranslations.en).toEqual({ article: { title: 'Six' } });

    // The params decide, not the route that yielded them.
    await instance.loadTranslations('en', '/article/6/comments');
    expect(calls).toEqual(['5', '6']);
  });
  it('applies only the latest params when an older load settles after a newer one', async () => {
    const resolvers: Record<string, () => void> = {};
    const instance = new i18n({
      parser,
      log,
      loaders: [
        {
          namespace: 'item',
          locale: 'en',
          routes: [/^\/item\/(?<id>\d+)$/],
          loader: ({ params }) => new Promise((resolve) => { resolvers[params.id] = () => resolve({ id: params.id }); }),
        },
      ],
    });

    await instance.setLocale('en');
    const first = instance.setRoute('/item/1');
    const second = instance.setRoute('/item/2');

    resolvers['2']?.();
    await second;
    resolvers['1']?.();
    await first;

    expect(instance.translations.en).toEqual({ 'item.id': '2' });

    // The record holds item 2's params, so staying on it fetches nothing more.
    await instance.setRoute('/item/2');
    expect(Object.keys(resolvers)).toEqual(['1', '2']);
  });
  it('treats a loader that returns nothing as having delivered no keys', async () => {
    const loader = vi.fn(async ({ params }: Loader.Props) => (params.id === '1' ? { title: 'One' } : undefined as any));
    const instance = new i18n({
      parser,
      log,
      loaders: [{ namespace: 'item', locale: 'en', routes: [/^\/item\/(?<id>\d+)$/], loader }],
    });

    await instance.loadTranslations('en', '/item/1');
    await instance.loadTranslations('en', '/item/2');

    expect(instance.translations.en).toEqual({});

    await instance.loadTranslations('en', '/item/2');
    expect(loader).toHaveBeenCalledTimes(2);
  });
  it('applies an older load of a loader whose newer load asks for the same params', async () => {
    const resolvers: Array<() => void> = [];
    const instance = new i18n({
      parser,
      log,
      loaders: [
        { namespace: 'common', locale: 'de', loader: () => new Promise((resolve) => { resolvers.push(() => resolve({ greeting: 'Hallo' })); }) },
      ],
    });

    await instance.setRoute('/');
    const activating = instance.setLocale('de');
    void instance.loadTranslations('de', '/about', { activate: false });

    resolvers[0]?.();
    await activating;

    expect(instance.locale).toBe('de');
    expect(instance.translations.de).toEqual({ 'common.greeting': 'Hallo' });
  });
  it('replaces the data of the previous params across a reconfiguration', async () => {
    const config = {
      parser,
      log,
      loaders: [
        {
          namespace: 'article',
          locale: 'en',
          routes: [/^\/a\/(?<id>\d+)/],
          loader: async ({ params }: Loader.Props) => (params.id === '1' ? { title: 'One', only1: 'x' } : { title: 'Two' }),
        },
      ],
    };
    const instance = new i18n(config);

    await instance.loadTranslations('en', '/a/1');
    await instance.loadConfig(config);
    await instance.loadTranslations('en', '/a/2');

    expect(instance.translations.en).toEqual({ 'article.title': 'Two' });
  });
  it('keeps both tables consistent when a custom `preprocess` renames the keys of replaced data', async () => {
    const instance = new i18n({
      parser,
      log,
      preprocess: (table: any) => Object.fromEntries(Object.entries(toDotNotation(table) as Record<string, unknown>).map(([key, value]) => [key.replace('article.', 'A/'), value])),
      loaders: [
        {
          namespace: 'article',
          locale: 'en',
          routes: [/^\/a\/(?<id>\d+)/],
          loader: async ({ params }: Loader.Props) => (params.id === '1' ? { title: 'One', only1: 'x' } : { title: 'Two' }),
        },
      ],
    });

    await instance.loadTranslations('en', '/a/1');
    await instance.loadTranslations('en', '/a/2');

    expect(instance.rawTranslations.en).toEqual({ article: { title: 'Two' } });
    expect(instance.translations.en).toEqual({ 'A/title': 'Two' });
  });
  describe('params wanted by the current route', () => {
    const itemLoader = (resolvers: Record<string, () => void>, locale = 'en') => ({
      namespace: 'item',
      locale,
      routes: [/^\/item\/(?<id>\d+)$/],
      loader: ({ params }: Loader.Props) => new Promise<Record<string, string>>((resolve) => { resolvers[params.id] = () => resolve({ id: params.id }); }),
    });

    it('drops an older load for other params once the route returned to the params it holds', async () => {
      const resolvers: Record<string, () => void> = {};
      const instance = new i18n({ parser, log, loaders: [itemLoader(resolvers)] });

      await instance.setLocale('en');
      const first = instance.setRoute('/item/1');
      resolvers['1']?.();
      await first;

      const second = instance.setRoute('/item/2');
      await instance.setRoute('/item/1');
      resolvers['2']?.();
      await second;

      expect(instance.translations.en).toEqual({ 'item.id': '1' });
    });
    it('applies a joined load once the route asks for its params again', async () => {
      const resolvers: Record<string, () => void> = {};
      const instance = new i18n({ parser, log, loaders: [itemLoader(resolvers)] });

      await instance.setLocale('en');
      const first = instance.setRoute('/item/1');
      const second = instance.setRoute('/item/2');
      const third = instance.setRoute('/item/1');

      resolvers['1']?.();
      await third;
      expect(instance.translations.en).toEqual({ 'item.id': '1' });

      resolvers['2']?.();
      await Promise.all([first, second]);
      expect(instance.translations.en).toEqual({ 'item.id': '1' });
    });
    it('leaves what the current route displays to its own load when a warm load asks for other params', async () => {
      const resolvers: Record<string, () => void> = {};
      const instance = new i18n({ parser, log, loaders: [itemLoader(resolvers)] });

      await instance.setLocale('en');
      const active = instance.setRoute('/item/1');
      const warm = instance.loadTranslations('en', '/item/2', { activate: false });

      resolvers['1']?.();
      await active;
      expect(instance.translations.en).toEqual({ 'item.id': '1' });

      resolvers['2']?.();
      await warm;
      expect(instance.translations.en).toEqual({ 'item.id': '1' });
    });
    it('activates a locale only through the load of the params its route asks for', async () => {
      const resolvers: Record<string, () => void> = {};
      const instance = new i18n({ parser, log, loaders: [itemLoader(resolvers, 'de')] });

      await instance.setRoute('/item/1');
      const first = instance.setLocale('de');
      const second = instance.setRoute('/item/2');

      resolvers['1']?.();
      await first;
      expect(instance.locale).toBeUndefined();

      resolvers['2']?.();
      await second;
      expect(instance.locale).toBe('de');
      expect(instance.translations.de).toEqual({ 'item.id': '2' });
    });
  });
  it('runs a params loader again for a route without params though its namespace arrived as plain data', async () => {
    const instance = new i18n({
      parser,
      log,
      loaders: [
        {
          namespace: 'item',
          locale: 'en',
          routes: [/^\/item$/, /^\/item\/(?<id>\d+)$/],
          loader: async ({ params }: Loader.Props) => (params.id ? { [`only${params.id}`]: params.id } : { list: 'All' }),
        },
      ],
    });

    await instance.loadTranslations('en', '/item/5');
    instance.hydrate({ translations: { en: { item: { static: 'Static' } } } });
    await instance.loadTranslations('en', '/item');

    expect(instance.translations.en).toEqual({ 'item.static': 'Static', 'item.list': 'All' });
  });
  it('keeps the part of a loader that cannot be handed on across a reconfiguration', async () => {
    const config = {
      parser,
      log,
      loaders: [
        // Identical content: neither loader is identifiable.
        { namespace: 'a', locale: 'en', routes: ['/a/1'], loader: async () => ({ first: 'First' }) },
        { namespace: 'a', locale: 'en', routes: ['/a/1'], loader: async () => ({ second: 'Second' }) },
        {
          namespace: 'a',
          locale: 'en',
          routes: [/^\/a\/(?<id>\d+)/],
          loader: async ({ params }: Loader.Props) => ({ [`only${params.id}`]: params.id }),
        },
      ],
    };
    const instance = new i18n(config);

    await instance.loadTranslations('en', '/a/1');
    await instance.loadConfig(config);
    await instance.loadTranslations('en', '/a/2');

    expect(instance.translations.en).toEqual({ 'a.first': 'First', 'a.second': 'Second', 'a.only2': '2' });
  });
  it('keeps a sibling loader\'s part and data supplied without a loader when a loader\'s params change', async () => {
    const instance = new i18n({
      parser,
      log,
      loaders: [
        { namespace: 'article', locale: 'en', loader: async () => ({ shared: 'Shared' }) },
        {
          namespace: 'article',
          locale: 'en',
          routes: [/^\/article\/(?<articleId>\d+)/],
          loader: async ({ params }) => ({ [`only${params.articleId}`]: params.articleId }),
        },
      ],
    });

    await instance.loadTranslations('en', '/article/5');
    instance.addTranslations({ en: { article: { static: 'Static' } } });
    await instance.loadTranslations('en', '/article/6');

    expect(instance.translations.en).toEqual({ 'article.static': 'Static', 'article.shared': 'Shared', 'article.only6': '6' });
    expect(instance.rawTranslations.en).toEqual({ article: { static: 'Static', shared: 'Shared', only6: '6' } });
  });
  it('runs each route-scoped loader of a shared namespace on its own route', async () => {
    const instance = new i18n({
      parser,
      log,
      loaders: [
        { namespace: 'common', locale: 'en', routes: ['/'], loader: async () => ({ menu: { home: 'Home' } }) },
        { namespace: 'common', locale: 'en', routes: ['/about'], loader: async () => ({ menu: { about: 'About' } }) },
      ],
    });

    await instance.loadTranslations('en', '/');
    await instance.loadTranslations('en', '/about');

    expect(instance.translations.en).toEqual({ 'common.menu.home': 'Home', 'common.menu.about': 'About' });
  });
  it('refetches for a parameterized loader whose namespace arrived as plain data', async () => {
    const loader = vi.fn(async () => ({ title: 'Six' }));
    const instance = new i18n({
      parser,
      log,
      loaders: [{ namespace: 'article', locale: 'en', routes: [/^\/article\/(?<articleId>\d+)/], loader }],
    });

    instance.hydrate({ translations: { en: { article: { title: 'Five' } } } });
    await instance.loadTranslations('en', '/article/6');

    expect(loader).toHaveBeenCalledTimes(1);
    expect(instance.translations.en).toEqual({ 'article.title': 'Six' });
  });
  it('lets a loader run again once a plain hand-off is invalidated', async () => {
    const loader = vi.fn(async () => ({ greeting: 'Hello' }));
    const instance = new i18n({ parser, log, loaders: [{ namespace: 'common', locale: 'en', loader }] });

    instance.hydrate({ translations: { en: { common: { greeting: 'Hi' } } } });
    await instance.loadTranslations('en', '/');
    expect(loader).not.toHaveBeenCalled();

    instance.invalidate('en');
    await instance.loadTranslations('en', '/');
    expect(loader).toHaveBeenCalledTimes(1);
  });
  it('records no load for a loader that threw, so the next trigger retries it', async () => {
    const loader = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue({ greeting: 'Hello' });
    const instance = new i18n({
      parser,
      log: { level: 'error', logger: { error: () => {}, warn: () => {}, debug: () => {} } },
      loaders: [
        { namespace: 'common', locale: 'en', loader },
        { namespace: 'nav', locale: 'en', loader: async () => ({ home: 'Home' }) },
      ],
    });

    await instance.loadTranslations('en', '/');
    await instance.loadTranslations('en', '/other');

    expect(loader).toHaveBeenCalledTimes(2);
    expect(instance.translations.en).toEqual({ 'nav.home': 'Home', 'common.greeting': 'Hello' });
  });
  it('forwards a thrown loader value to the configured logger unwrapped', async () => {
    const errorSpy = vi.fn();
    const boom = new Error('loader boom');
    const instance = new i18n({
      parser,
      log: { level: 'error', logger: { error: errorSpy, warn: () => {}, debug: () => {} } },
      loaders: [
        { namespace: 'broken', locale: 'en', loader: async () => { throw boom; } },
      ],
    });

    await instance.loadTranslations('en', '/');

    expect(errorSpy).toHaveBeenCalledWith(
      "[i18n]: Failed to load translation. Verify your 'en' > 'broken' Loader.",
      boom,
    );
  });
  it('matches `routes` through a custom matcher object', async () => {
    const seen: string[] = [];
    const instance = new i18n({
      parser,
      log,
      loaders: [
        {
          namespace: 'common',
          locale: 'en',
          routes: [{ test: (route: string) => { seen.push(route); return route.startsWith('/products'); } }],
          loader: async () => ({ greeting: 'Hello' }),
        },
      ],
    });

    await instance.loadTranslations('en', '/about');
    expect(instance.translations['en']).toBeUndefined();

    await instance.loadTranslations('en', '/products/123');
    expect(instance.translations['en']['common.greeting']).toBe('Hello');
    // The matcher may be consulted more than once per load — it is given the
    // bare route path every time, never a full URL.
    expect(Array.from(new Set(seen))).toEqual(['/about', '/products/123']);
  });
  it('reports a non-string loader key without throwing', async () => {
    const errorSpy = vi.fn();
    const instance = new i18n();

    await expect(instance.loadConfig({
      parser,
      log: { level: 'error', logger: { error: errorSpy, warn: () => {}, debug: () => {} } },
      loaders: [
        { namespace: Symbol('common') as unknown as string, locale: 'en', loader: async () => ({ greeting: 'Hello' }) },
      ],
    })).resolves.toBeUndefined();

    expect(errorSpy).not.toHaveBeenCalled();
  });
  it('drops a loader whose accessor throws and keeps the resolvable ones', async () => {
    const errorSpy = vi.fn();
    const boom = new Error('locale accessor');
    const instance = new i18n({
      parser,
      log: { level: 'error', logger: { error: errorSpy, warn: () => {}, debug: () => {} } },
      loaders: [
        { namespace: 'broken', get locale(): string { throw boom; }, loader: async () => ({ greeting: 'Ahoj' }) },
        { namespace: 'common', locale: 'en', loader: async () => ({ greeting: 'Hello' }) },
      ],
    });

    // A public read returns the resolvable subset instead of propagating.
    expect(instance.locales).toEqual(['en']);
    expect(errorSpy).toHaveBeenCalledWith('[i18n]: Skipping a loader that cannot be read.', boom);

    await instance.loadTranslations('en', '/');

    expect(instance.translations['en']['common.greeting']).toBe('Hello');
  });
  it('reports a loader key containing a `.` character but keeps the loader', async () => {
    const errorSpy = vi.fn();
    const instance = new i18n();

    await instance.loadConfig({
      parser,
      log: { level: 'error', logger: { error: errorSpy, warn: () => {}, debug: () => {} } },
      initLocale: 'en',
      loaders: [
        { namespace: 'common.nested', locale: 'en', loader: async () => ({ greeting: 'Hello' }) },
      ],
    });

    expect(errorSpy).toHaveBeenCalledWith("[i18n]: Invalid 'common.nested' loader namespace. It shouldn't include the '.' character.");
    // Report-only: the loader still ran and its data landed in the table.
    expect(read(instance.translations['en'], 'common.nested.greeting')).toBe('Hello');
  });
  it('does not throw when `t`/`l` are used before a config is loaded', () => {
    const instance = new i18n();

    expect(() => instance.t('common.key')).not.toThrow();
    expect(() => instance.l('en', 'common.key')).not.toThrow();
  });

  it('refreshes the `t`/`l` identity when the config, the tables or the locale change', async () => {
    const valueParser = { parse: (text: any, _params: any, _locale: any, key: string) => (text === undefined ? key : text) };
    const instance = new i18n({ parser: valueParser, log, initLocale: 'en' });

    const initialT = instance.t;
    const initialL = instance.l;

    instance.addTranslations({ en: { greeting: 'Hello' }, cs: { greeting: 'Ahoj' } });

    expect(instance.t).not.toBe(initialT);
    expect(instance.l).not.toBe(initialL);

    const loadedT = instance.t;

    await instance.setLocale('cs');

    expect(instance.t).not.toBe(loadedT);

    const localeT = instance.t;
    const localeL = instance.l;

    await instance.loadConfig({
      parser: { parse: (text: any, _params: any, _locale: any, key: string) => `[${text ?? key}]` },
      log,
    });

    expect(instance.t).not.toBe(localeT);
    expect(instance.l).not.toBe(localeL);
  });

  it('keeps destructured `t`/`l` translating against live state', async () => {
    const valueParser = { parse: (text: any, _params: any, _locale: any, key: string) => (text === undefined ? key : text) };
    const instance = new i18n({ parser: valueParser, log, initLocale: 'en' });

    // Snapshotted before any data exists: the reads happen when it is CALLED,
    // so it must keep up with everything that lands afterwards.
    const { t, l } = instance;

    instance.addTranslations({ en: { greeting: 'Hello' }, cs: { greeting: 'Ahoj' } });
    await instance.setLocale('en');

    expect(t('greeting')).toBe('Hello');
    expect(l('cs', 'greeting')).toBe('Ahoj');

    await instance.setLocale('cs');

    expect(t('greeting')).toBe('Ahoj');
  });
});

describe('i18n locale keys', () => {
  const valueParser = { parse: (text: any, _params: any, _locale: any, key: string) => (text === undefined ? key : text) };

  it('`addTranslations` normalizes the locale key so `t` reaches the data', async () => {
    const instance = new i18n({ parser: valueParser, log, initLocale: 'EN', translations: { EN: { greeting: 'Hello' } } });

    await instance.loadTranslations('EN');

    expect(instance.locale).toBe('en');
    expect(Object.keys(instance.translations)).toEqual(['en']);
    expect(instance.t('greeting')).toBe('Hello');
  });

  it('`addTranslations` merges spellings that normalize to the same locale', () => {
    const instance = new i18n({ parser: valueParser, log });

    instance.addTranslations({ EN: { greeting: 'Hello' }, en: { farewell: 'Bye' } });

    expect(instance.rawTranslations).toStrictEqual({ en: { greeting: 'Hello', farewell: 'Bye' } });
  });

  it('`l` reaches the table through a non-canonical locale', () => {
    const instance = new i18n({ parser: valueParser, log, translations: { en: { greeting: 'Hello' } } });

    expect(instance.l('EN', 'greeting')).toBe('Hello');
  });

  it('a non-canonical `config.translations` key seeds the table its loader merges into', async () => {
    let calls = 0;
    const instance = new i18n({
      parser: valueParser,
      log,
      translations: { EN: { common: { greeting: 'Hello' } } },
      loaders: [{ namespace: 'common', locale: 'en', loader: async () => { calls += 1; return { farewell: 'Bye' }; } }],
    });

    await instance.loadTranslations('en');

    expect(calls).toBe(1);
    expect(instance.translations).toEqual({ en: { 'common.greeting': 'Hello', 'common.farewell': 'Bye' } });
  });

  it('`snapshot` carries data added under a non-canonical locale', async () => {
    const instance = new i18n({ parser: valueParser, log, translations: { EN: { common: { greeting: 'Hello' } } } });

    await instance.loadTranslations('EN');

    expect(instance.snapshot()).toEqual({ en: { common: { greeting: 'Hello' } } });
  });
});

describe('i18n sanitizeLocales config', () => {
  const valueParser = { parse: (text: any, _params: any, _locale: any, key: string) => (text === undefined ? key : text) };

  it('`false` keeps every locale exactly as it was authored', async () => {
    const instance = new i18n({
      parser: valueParser,
      log,
      sanitizeLocales: false,
      initLocale: 'CS',
      translations: { CS: { greeting: 'Ahoj' } },
    });

    await instance.loadTranslations('CS');

    expect(instance.locale).toBe('CS');
    expect(instance.locales).toEqual(['CS']);
    expect(Object.keys(instance.translations)).toEqual(['CS']);
    expect(instance.t('greeting')).toBe('Ahoj');
    expect(instance.l('CS', 'greeting')).toBe('Ahoj');
  });

  it('`false` keeps spellings of one locale apart', () => {
    const instance = new i18n({ parser: valueParser, log, sanitizeLocales: false });

    instance.addTranslations({ CS: { greeting: 'Ahoj' }, cs: { farewell: 'Ahoj' } });

    expect(instance.rawTranslations).toStrictEqual({ CS: { greeting: 'Ahoj' }, cs: { farewell: 'Ahoj' } });
  });

  it('a custom transform keys loaders, tables and the active locale', async () => {
    let calls = 0;
    const instance = new i18n({
      parser: valueParser,
      log,
      sanitizeLocales: (locale) => locale.toUpperCase(),
      loaders: [{ namespace: 'common', locale: 'en', loader: async () => { calls += 1; return { greeting: 'Hello' }; } }],
    });

    await instance.loadTranslations('en');

    expect(calls).toBe(1);
    expect(instance.locale).toBe('EN');
    expect(instance.locales).toEqual(['EN']);
    expect(Object.keys(instance.translations)).toEqual(['EN']);
    expect(instance.t('common.greeting')).toBe('Hello');

    // The bookkeeping is keyed through the same transform, so an authored
    // locale reaches the entry the load created.
    instance.invalidate('en');
    await instance.loadTranslations('EN');

    expect(calls).toBe(2);
  });

  it('normalizes `initLocale` and `fallbackLocale` the way the INCOMING config asks', async () => {
    // They are normalized before the config is applied, so they must not be
    // read through the strategy the instance is still configured with.
    const instance = new i18n();

    await instance.loadConfig({
      parser: valueParser,
      log,
      sanitizeLocales: false,
      initLocale: 'EN',
      fallbackLocale: 'CS',
      translations: { CS: { greeting: 'Ahoj' }, EN: { farewell: 'Ahoj' } },
    });

    expect(instance.locale).toBe('EN');
    expect(instance.t('greeting')).toBe('Ahoj');
  });

  it('a throwing transform falls back to the locale as authored', async () => {
    const instance = new i18n({
      parser: valueParser,
      log,
      sanitizeLocales: () => { throw new Error('nope'); },
      translations: { en: { greeting: 'Hello' } },
    });

    await expect(instance.loadTranslations('en')).resolves.toBeUndefined();

    expect(instance.locale).toBe('en');
    expect(instance.t('greeting')).toBe('Hello');
  });
});

describe('i18n extensions', () => {
  it('constructs the plain instance when no extensions are configured', () => {
    // Assignability doubles as the type-level assertion: without extensions
    // the construction-time type stays the instance type.
    const instance: I18n = new i18n({ parser, log });

    expect(instance).toBeInstanceOf(i18n);
  });
  it('pipes the instance through the extensions left to right', () => {
    const order: string[] = [];
    const instance = new i18n({
      parser,
      log,
      extensions: [
        (input: I18n) => { order.push('first'); return Object.assign(input, { first: true as const }); },
        (input: I18n & { first: true }) => { order.push('second'); return Object.assign(input, { second: true as const }); },
      ],
    });

    expect(order).toEqual(['first', 'second']);
    // Property accesses double as type-level assertions: the construction-time
    // type is the instance folded through the extension tuple.
    expect(instance.first).toBe(true);
    expect(instance.second).toBe(true);
    expect(instance).toBeInstanceOf(i18n);
  });
  it('an augmenting extension keeps the instance surface intact', () => {
    // Synchronous translations + `initLocale` activate the locale within the
    // constructor, so `t` resolves right after construction.
    const instance = new i18n({
      parser,
      log,
      initLocale: 'en',
      translations: { en: { 'common.key': 'value' } },
      extensions: [(input: I18n) => Object.assign(input, { flag: true as const })],
    });

    expect(instance.flag).toBe(true);
    // The no-op test parser returns the key, so `t` resolving proves the
    // reactive surface survived the pipe.
    expect(instance.t('common.key')).toBe('common.key');
  });
  it('a transforming extension replaces the constructed surface', () => {
    const instance = new i18n({
      parser,
      log,
      initLocale: 'en',
      translations: { en: { 'common.key': 'value' } },
      extensions: [(input: I18n) => ({ translate: input.t, instance: input })],
    });

    expect(instance).not.toBeInstanceOf(i18n);
    expect(instance.instance).toBeInstanceOf(i18n);

    // Bound fields survive being carried off the instance by a transform.
    const { translate } = instance;
    expect(translate('common.key')).toBe('common.key');
  });
  it('extensions receive an already configured instance', () => {
    let seenLocales: string[] = [];

    void new i18n({
      parser,
      log,
      loaders,
      extensions: [(input: I18n) => {
        seenLocales = input.locales;
        return input;
      }],
    });

    expect(seenLocales).toContain('en');
  });
  it('`loadConfig` ignores `extensions` — the pipe is construction-only', async () => {
    const calls = vi.fn();
    const instance = new i18n();

    await instance.loadConfig({
      parser,
      log,
      initLocale: 'en',
      translations: { en: { 'common.key': 'value' } },
      extensions: [(input: I18n) => { calls(); return input; }],
    });

    expect(calls).not.toHaveBeenCalled();
    expect(instance.t('common.key')).toBe('common.key');
  });
  it('a configured extension erases the constructed type parameters', () => {
    // `Config.T['extensions']` types every element `(input: any) => any`, so an
    // extension that annotates neither side collapses the construction: the
    // pipe reports what the extension's TYPE says, and that type says `any`.
    const erased = new i18n({ parser, log, initLocale: 'en', fallbackLocale: 'de', extensions: [(input) => input] });

    expectTypeOf(erased).toBeAny();

    // An extension annotated with the bare instance type hands the bare
    // instance back: the locale union the config spelled - and any schema - is
    // gone.
    const widened = new i18n({ parser, log, initLocale: 'en', fallbackLocale: 'de', extensions: [(input: I18n) => input] });

    expectTypeOf(widened).toEqualTypeOf<I18n>();
    expectTypeOf(widened.locale).toEqualTypeOf<Config.LocaleInput<string> | undefined>();
    expectTypeOf(widened.locale).not.toEqualTypeOf<'en' | 'de' | (string & {}) | undefined>();

    expect(widened).toBeInstanceOf(i18n);
  });
  it('an `Operator`-typed extension threads the constructed surface through the pipe', () => {
    interface WithFirst extends Extension.Operator {
      readonly output: this['input'] & { first: true };
    }
    interface WithSecond extends Extension.Operator {
      readonly output: this['input'] & { second: true };
    }

    const withFirst: Extension.Generic<WithFirst> = (input: I18n) => Object.assign(input, { first: true as const });
    const withSecond: Extension.Generic<WithSecond> = (input: I18n) => Object.assign(input, { second: true as const });

    type Schema = { 'common.key': { count: number } };

    const instance = new i18n({
      parser,
      log,
      initLocale: 'en',
      fallbackLocale: 'de',
      schema: {} as Schema,
      translations: { en: { 'common.key': 'value' } },
      extensions: [withFirst, withSecond],
    });

    // Both operators applied, in order, to the surface each was handed.
    expect(instance.first).toBe(true);
    expect(instance.second).toBe(true);
    expect(instance).toBeInstanceOf(i18n);

    // The instance the operators were folded over survives whole: the locale
    // union the config spelled and the schema that narrows `t` are both intact.
    expectTypeOf(instance.locale).toEqualTypeOf<'en' | 'de' | (string & {}) | undefined>();
    expect(instance.t('common.key', { count: 1 })).toBe('common.key');
    // @ts-expect-error the schema still closes the key set behind the pipe
    instance.t('common.missing');
  });
});

describe('i18n loading concurrency', () => {
  // Unlike the shared no-op parser, this one returns the loaded value, so the
  // specs below can assert on actual translation output.
  const valueParser = { parse: (text: any, _params: any, _locale: any, key: string) => (text === undefined ? key : text) };

  it('concurrent identical load triggers share one in-flight load', async () => {
    let calls = 0;
    const instance = new i18n({
      parser,
      log,
      loaders: [
        { namespace: 'common', locale: 'en', loader: async () => { calls += 1; return { greeting: 'Hello' }; } },
      ],
    });

    const first = instance.loadTranslations('en', '/');
    const second = instance.loadTranslations('en', '/');
    const third = instance.setLocale('en');

    // Duplicates must resolve with the load already in flight, not a new one.
    expect(second).toBe(first);
    expect(third).toBe(first);

    await first;

    expect(calls).toBe(1);
  });

  it('activates the most recently requested locale when loads resolve out of order', async () => {
    const gates: Record<string, () => void> = {};
    const blockUntilOpened = (locale: string) => new Promise<void>((resolve) => { gates[locale] = resolve; });

    const instance = new i18n({
      parser,
      log,
      loaders: [
        { namespace: 'common', locale: 'en', loader: async () => { await blockUntilOpened('en'); return { greeting: 'Hello' }; } },
        { namespace: 'common', locale: 'cs', loader: async () => { await blockUntilOpened('cs'); return { greeting: 'Ahoj' }; } },
      ],
    });

    await instance.setRoute('/');

    const first = instance.setLocale('en');
    const second = instance.setLocale('cs');

    // The superseded 'en' load resolves AFTER the current 'cs' one.
    gates.cs();
    await second;
    expect(instance.locale).toBe('cs');

    gates.en();
    await first;

    expect(instance.locale).toBe('cs');
  });

  it('an unknown requested locale does not block activation of a completed load', async () => {
    const gates: Record<string, () => void> = {};
    const instance = new i18n({
      parser,
      log,
      loaders: [
        {
          namespace: 'common',
          locale: 'en',
          loader: async () => {
            await new Promise<void>((resolve) => { gates.en = resolve; });
            return { greeting: 'Hello' };
          },
        },
      ],
    });

    const first = instance.loadTranslations('en', '/');
    // 'xx' matches no loader and no fallback, so it resolves to no known
    // locale — a request that supersedes nothing.
    const second = instance.setLocale('xx');

    gates.en();
    await Promise.all([first, second]);

    expect(instance.locale).toBe('en');
  });

  it('does not mark a loader as loaded because of a similarly named sibling key', async () => {
    // 'navbar' data must never satisfy the 'nav' loader — a failed 'nav' load
    // has to retry on the next navigation.
    let attempts = 0;
    const instance = new i18n({
      parser: valueParser,
      log: { level: 'error', logger: { error: () => {}, warn: () => {}, debug: () => {} } },
      loaders: [
        { namespace: 'navbar', locale: 'en', loader: async () => ({ title: 'Navbar' }) },
        {
          namespace: 'nav',
          locale: 'en',
          loader: async () => {
            attempts += 1;
            if (attempts === 1) throw new Error('nav boom');
            return { items: 'Items' };
          },
        },
      ],
    });

    await instance.loadTranslations('en', '/');
    await instance.loadTranslations('en', '/other');

    expect(attempts).toBe(2);
    expect(instance.t('nav.items')).toBe('Items');
  });
});

describe('i18n warm loads', () => {
  const gated = () => {
    const gates: Record<string, () => void> = {};
    const calls: Record<string, number> = {};
    const routes: Record<string, string[]> = {};

    const loader = (locale: string) => ({
      namespace: 'common',
      locale,
      loader: async ({ route }: Loader.Props) => {
        calls[locale] = (calls[locale] ?? 0) + 1;
        routes[locale] = [...(routes[locale] ?? []), route];
        await new Promise<void>((resolve) => { gates[locale] = resolve; });
        return { greeting: `Hello ${locale}` };
      },
    });

    return { gates, calls, routes, loader };
  };

  const open = async (gates: Record<string, () => void>, locale: string) => {
    await vi.waitFor(() => expect(gates[locale]).toBeDefined());
    gates[locale]();
  };

  it('fills the tables without touching the locale or the route', async () => {
    const { gates, routes, loader } = gated();
    const instance = new i18n({ parser, log, loaders: [loader('en'), loader('de')] });

    const hot = instance.loadTranslations('en', '/home');
    await open(gates, 'en');
    await hot;

    const warm = instance.loadTranslations('de', '/about', { activate: false });
    await open(gates, 'de');
    await warm;

    expect(instance.translations.de).toEqual({ 'common.greeting': 'Hello de' });
    expect(instance.locale).toBe('en');

    // The route stayed '/home': a hot trigger for another locale loads on it.
    instance.invalidate('de');
    const next = instance.setLocale('de');
    await open(gates, 'de');
    await next;

    expect(routes.de).toEqual(['/about', '/home']);
  });

  it('does not raise `loading`', async () => {
    const { gates, loader } = gated();
    const instance = new i18n({ parser, log, loaders: [loader('de')] });

    const warm = instance.loadTranslations('de', '/about', { activate: false });

    expect(instance.loading).toBe(false);

    await open(gates, 'de');
    await warm;

    expect(instance.loading).toBe(false);
  });

  it('an activating trigger joining an in-flight warm load raises `loading` and activates on settle', async () => {
    const { gates, calls, loader } = gated();
    const instance = new i18n({ parser, log, loaders: [loader('de')] });

    const warm = instance.loadTranslations('de', '/about', { activate: false });
    const hot = instance.loadTranslations('de', '/about');

    expect(hot).toBe(warm);
    expect(instance.loading).toBe(true);

    await open(gates, 'de');
    await hot;

    expect(calls.de).toBe(1);
    expect(instance.locale).toBe('de');
    expect(instance.loading).toBe(false);
  });

  it('an activating trigger after a settled warm load activates without fetching again', async () => {
    const { gates, calls, loader } = gated();
    const instance = new i18n({ parser, log, loaders: [loader('de')] });

    const warm = instance.loadTranslations('de', '/about', { activate: false });
    await open(gates, 'de');
    await warm;

    expect(instance.locale).toBeUndefined();

    const hot = instance.loadTranslations('de', '/about');

    expect(instance.loading).toBe(false);
    expect(instance.locale).toBe('de');

    await hot;

    expect(calls.de).toBe(1);
  });

  it('a warm load for the active locale disturbs nothing', async () => {
    const { gates, calls, loader } = gated();
    const instance = new i18n({ parser, log, loaders: [loader('en')] });

    const hot = instance.loadTranslations('en', '/home');
    await open(gates, 'en');
    await hot;

    await instance.loadTranslations('en', '/about', { activate: false });

    expect(calls.en).toBe(1);
    expect(instance.locale).toBe('en');
    expect(instance.loading).toBe(false);
  });

  it.each([
    ['without a `fallbackLocale`', undefined],
    ['with a `fallbackLocale`', 'de'],
  ])('a warm load on a fresh instance leaves `locale` undefined %s', async (_, fallbackLocale) => {
    const { gates, loader } = gated();
    const instance = new i18n({ parser, log, fallbackLocale, loaders: [loader('de')] });

    const warm = instance.loadTranslations('de', '/about', { activate: false });
    await open(gates, 'de');
    await warm;

    expect(instance.translations.de).toEqual({ 'common.greeting': 'Hello de' });
    expect(instance.locale).toBeUndefined();
    expect(instance.initialized).toBe(false);
  });

  it('`invalidate()` severs a warm load', async () => {
    const { gates, calls, loader } = gated();
    const instance = new i18n({ parser, log, loaders: [loader('de')] });

    const warm = instance.loadTranslations('de', '/about', { activate: false });
    await vi.waitFor(() => expect(gates.de).toBeDefined());

    instance.invalidate('de');
    gates.de();
    await warm;

    expect(instance.translations.de).toBeUndefined();

    delete gates.de;
    const hot = instance.loadTranslations('de', '/about');
    await open(gates, 'de');
    await hot;

    expect(calls.de).toBe(2);
    expect(instance.locale).toBe('de');
  });

  it('does not become the requested locale', async () => {
    const { gates, loader } = gated();
    const instance = new i18n({ parser, log, loaders: [loader('en'), loader('de')] });

    const hot = instance.loadTranslations('en', '/home');
    const warm = instance.loadTranslations('de', '/home', { activate: false });
    await open(gates, 'de');
    await open(gates, 'en');
    await Promise.all([hot, warm]);

    expect(instance.locale).toBe('en');

    await instance.setRoute('/other');

    expect(instance.locale).toBe('en');
  });

  it('a warm trigger joining an in-flight warm load stays warm', async () => {
    const { gates, calls, loader } = gated();
    const instance = new i18n({ parser, log, loaders: [loader('de')] });

    const first = instance.loadTranslations('de', '/about', { activate: false });
    const second = instance.loadTranslations('de', '/about', { activate: false });

    expect(second).toBe(first);
    expect(instance.loading).toBe(false);

    await open(gates, 'de');
    await second;

    expect(calls.de).toBe(1);
    expect(instance.locale).toBeUndefined();
    expect(instance.initialized).toBe(false);
  });

  it('a warm trigger joining an in-flight activating load does not demote it', async () => {
    const { gates, calls, loader } = gated();
    const instance = new i18n({ parser, log, loaders: [loader('de')] });

    const hot = instance.loadTranslations('de', '/about');
    const warm = instance.loadTranslations('de', '/about', { activate: false });

    expect(warm).toBe(hot);
    expect(instance.loading).toBe(true);

    await open(gates, 'de');
    await hot;

    expect(calls.de).toBe(1);
    expect(instance.locale).toBe('de');
    expect(instance.loading).toBe(false);
  });

  it('a warm load with nothing to fetch does not activate', async () => {
    const loader = vi.fn(async () => ({ greeting: 'Hallo' }));
    const instance = new i18n({ parser, log, loaders: [{ namespace: 'common', locale: 'de', loader }] });

    instance.hydrate({ translations: { de: { common: { greeting: 'Hallo' } } } });
    await instance.loadTranslations('de', '/', { activate: false });

    expect(loader).not.toHaveBeenCalled();
    expect(instance.locale).toBeUndefined();
    expect(instance.initialized).toBe(false);
  });

  it('an activating trigger arriving right after a warm load applied its data activates', async () => {
    const { gates, loader } = gated();
    let hot: Promise<void> | undefined;

    const instance: I18n = new i18n({
      parser,
      log,
      loaders: [loader('de')],
      // Runs while the warm load applies its data, so the queued trigger lands
      // after the data is in but before the load has settled.
      preprocess: (input) => {
        queueMicrotask(() => { hot ??= instance.loadTranslations('de', '/about'); });
        return input;
      },
    });

    const warm = instance.loadTranslations('de', '/about', { activate: false });
    await open(gates, 'de');
    await warm;
    await hot;

    expect(hot).toBeDefined();
    expect(instance.locale).toBe('de');
    expect(instance.loading).toBe(false);
  });

  it('a warm load does not expire an activating load in flight', async () => {
    let now = 0;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);

    try {
      let release: (() => void) | undefined;
      const instance = new i18n({
        parser,
        log,
        cache: 1000,
        loaders: [
          { namespace: 'common', locale: 'de', loader: async () => ({ greeting: 'Hallo' }) },
          { namespace: 'common', locale: 'en', loader: async () => ({ greeting: 'Hello' }) },
          {
            namespace: 'about',
            locale: 'en',
            routes: ['/about'],
            loader: () => new Promise<any>((resolve) => { release = () => resolve({ title: 'About' }); }),
          },
        ],
      });

      await instance.loadTranslations('de', '/about');
      await instance.loadTranslations('en', '/home', { activate: false });

      now = 500;
      const hot = instance.setLocale('en');

      // Past the window of the warm-loaded 'en' data.
      now = 1500;
      await instance.loadTranslations('en', '/home', { activate: false });

      await vi.waitFor(() => expect(release).toBeDefined());
      release?.();
      await hot;

      expect(instance.locale).toBe('en');
    } finally {
      clock.mockRestore();
    }
  });
});

describe('i18n loadNamespace', () => {
  const valueParser = { parse: (text: any, _params: any, _locale: any, key: string) => (text === undefined ? key : text) };

  type Calls = Record<string, number>;

  const loaders = (calls: Calls, editor: () => Promise<any> = async () => ({ title: 'Editor' })) => [
    { namespace: 'common', locale: 'en', loader: async () => { calls.common = (calls.common ?? 0) + 1; return { greeting: 'Hello' }; } },
    { namespace: 'home', locale: 'en', routes: ['/'], loader: async () => { calls.home = (calls.home ?? 0) + 1; return { title: 'Home' }; } },
    { namespace: 'editor', locale: 'en', routes: ['/editor'], loader: () => { calls.editor = (calls.editor ?? 0) + 1; return editor(); } },
    { namespace: 'editor', locale: 'cs', routes: ['/editor'], loader: async () => { calls.editorCs = (calls.editorCs ?? 0) + 1; return { title: 'Editor CS' }; } },
  ];

  const deferred = () => {
    const resolvers: Array<(value: any) => void> = [];

    return { resolvers, loader: () => new Promise<any>((resolve) => { resolvers.push(resolve); }) };
  };

  it('loads a namespace outside every route its loader declares, and keeps it across routes', async () => {
    const calls: Calls = {};
    const instance = new i18n({ parser: valueParser, log, loaders: loaders(calls) });

    await instance.loadTranslations('en', '/');
    await instance.loadNamespace('editor');

    expect(instance.t('editor.title')).toBe('Editor');

    await instance.setRoute('/about');

    expect(instance.t('editor.title')).toBe('Editor');
    expect(calls).toEqual({ common: 1, home: 1, editor: 1 });
  });

  it('fetches once for concurrent calls, whichever route they come from', async () => {
    const calls: Calls = {};
    const { resolvers, loader } = deferred();
    const instance = new i18n({ parser: valueParser, log, loaders: loaders(calls, loader) });

    await instance.loadTranslations('en', '/');

    const first = instance.loadNamespace('editor');

    await instance.setRoute('/about');

    const second = instance.loadNamespace('editor');

    resolvers[0]?.({ title: 'Editor' });
    await Promise.all([first, second]);

    expect(calls.editor).toBe(1);
    expect(instance.t('editor.title')).toBe('Editor');
  });

  it('fetches nothing once the namespace is loaded', async () => {
    const calls: Calls = {};
    const instance = new i18n({ parser: valueParser, log, loaders: loaders(calls) });

    await instance.loadTranslations('en', '/');
    await instance.loadNamespace('editor');
    await instance.loadNamespace('editor');
    await instance.loadTranslations('en', '/editor');

    expect(calls.editor).toBe(1);
  });

  it('neither activates what it loads nor raises `loading`', async () => {
    const { resolvers, loader } = deferred();
    const instance = new i18n({
      parser: valueParser,
      log,
      loaders: [...loaders({}), { namespace: 'common', locale: 'cs', loader }],
    });

    await instance.loadTranslations('en', '/');

    const pending = instance.loadNamespace('common', 'cs');

    expect(instance.loading).toBe(false);

    resolvers[0]?.({ greeting: 'Ahoj' });
    await pending;

    expect(instance.locale).toBe('en');
    expect(instance.l('cs', 'common.greeting')).toBe('Ahoj');
  });

  it('loads the fallback locale\'s part of the namespace too', async () => {
    const calls: Calls = {};
    const instance = new i18n({ parser: valueParser, log, fallbackLocale: 'cs', loaders: loaders(calls) });

    await instance.loadTranslations('en', '/');
    await instance.loadNamespace('editor');

    expect(calls).toMatchObject({ editor: 1, editorCs: 1 });
    expect(instance.l('cs', 'editor.title')).toBe('Editor CS');
  });

  it('does not join a route load in flight that selected other loaders', async () => {
    const calls: Calls = {};
    const { resolvers, loader } = deferred();
    const instance = new i18n({
      parser: valueParser,
      log,
      loaders: [{ namespace: 'common', locale: 'en', loader }, ...loaders(calls).slice(1)],
    });

    const route = instance.loadTranslations('en', '/');

    await instance.loadNamespace('editor', 'en');

    expect(calls.editor).toBe(1);
    expect(instance.l('en', 'editor.title')).toBe('Editor');

    resolvers.forEach((resolve) => resolve({ greeting: 'Hello' }));
    await route;
  });

  it('hands a parameterized loader the params of the current route, and none off its routes', async () => {
    const received: Loader.Params[] = [];
    const instance = new i18n({
      parser: valueParser,
      log,
      loaders: [
        { namespace: 'common', locale: 'en', loader: async () => ({ greeting: 'Hello' }) },
        {
          namespace: 'article',
          locale: 'en',
          routes: [/^\/article\/(?<articleId>\d+)/],
          loader: async ({ params }: Loader.Props) => { received.push(params); return { title: `Article ${params.articleId}` }; },
        },
      ],
    });

    await instance.loadTranslations('en', '/');
    await instance.loadNamespace('article');
    await instance.setRoute('/article/5');

    expect(received).toEqual([{}, { articleId: '5' }]);

    await instance.loadNamespace('article');

    expect(received).toHaveLength(2);

    await instance.setRoute('/');
    await instance.loadNamespace('article');
    await instance.loadNamespace('article');

    expect(received).toHaveLength(2);
    expect(instance.t('article.title')).toBe('Article 5');
  });

  it('refetches once `cache` expired and an activating trigger evaluated it', async () => {
    const calls: Calls = {};
    const instance = new i18n({ parser: valueParser, log, cache: 0, loaders: loaders(calls) });

    await instance.loadTranslations('en', '/');
    await instance.loadNamespace('editor');
    await instance.loadNamespace('editor');

    expect(calls.editor).toBe(1);

    await instance.setRoute('/');
    await instance.loadNamespace('editor');

    expect(calls.editor).toBe(2);
  });

  it('is severed by `invalidate()` like any other load', async () => {
    const calls: Calls = {};
    const { resolvers, loader } = deferred();
    const instance = new i18n({ parser: valueParser, log, loaders: loaders(calls, loader) });

    await instance.loadTranslations('en', '/');

    const pending = instance.loadNamespace('editor');

    instance.invalidate('en');
    resolvers[0]?.({ title: 'Stale' });
    await pending;

    expect(instance.t('editor.title')).toBe('editor.title');

    const again = instance.loadNamespace('editor');

    resolvers[1]?.({ title: 'Fresh' });
    await again;

    expect(calls.editor).toBe(2);
    expect(instance.t('editor.title')).toBe('Fresh');
  });

  it('fails soft like any other load, and the next call retries', async () => {
    let fail = true;
    const calls: Calls = {};
    const instance = new i18n({
      parser: valueParser,
      log: { level: 'error', logger: { error: () => {}, warn: () => {}, debug: () => {} } },
      loaders: loaders(calls, async () => {
        if (fail) throw new Error('down');

        return { title: 'Editor' };
      }),
    });

    await instance.loadTranslations('en', '/');
    await instance.loadNamespace('editor');

    expect(instance.t('editor.title')).toBe('editor.title');

    fail = false;
    await instance.loadNamespace('editor');

    expect(calls.editor).toBe(2);
    expect(instance.t('editor.title')).toBe('Editor');
  });

  it('reaches the snapshot, with its record', async () => {
    const instance = new i18n({ parser: valueParser, log, loaders: loaders({}) });

    await instance.loadTranslations('en', '/');
    await instance.loadNamespace('editor');

    const envelope = instance.snapshot({ records: true });

    expect(envelope.translations.en).toHaveProperty('editor', { title: 'Editor' });
    expect(envelope.records).toContainEqual({ id: resolveLoaders(loaders({}))[2].id });
    expect(instance.snapshot().en).toHaveProperty('editor');
  });

  it('does nothing without a locale, and after `destroy()`', async () => {
    const calls: Calls = {};
    const instance = new i18n({ parser: valueParser, log, loaders: loaders(calls) });

    await instance.loadNamespace('editor');

    expect(calls).toEqual({});

    await instance.loadTranslations('en', '/');
    instance.destroy();
    await instance.loadNamespace('editor');

    expect(calls.editor).toBeUndefined();
  });
});

describe('i18n cache and invalidation', () => {
  const valueParser = { parse: (text: any, _params: any, _locale: any, key: string) => (text === undefined ? key : text) };

  const counterLoader = (locale: string, calls: Record<string, number>) => ({
    namespace: 'common',
    locale,
    loader: async () => {
      calls[locale] = (calls[locale] ?? 0) + 1;
      return { greeting: `Hello ${locale}` };
    },
  });

  it('loaded translations never expire by default', async () => {
    vi.useFakeTimers();
    try {
      const calls: Record<string, number> = {};
      const instance = new i18n({ parser, log, loaders: [counterLoader('en', calls)] });

      await instance.loadTranslations('en', '/');
      vi.advanceTimersByTime(365 * 24 * 60 * 60 * 1000);
      await instance.loadTranslations('en', '/');

      expect(calls.en).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a finite `cache` expires translations exactly after the window elapses', async () => {
    vi.useFakeTimers();
    try {
      const calls: Record<string, number> = {};
      const instance = new i18n({ parser, log, cache: 1000, loaders: [counterLoader('en', calls)] });

      await instance.loadTranslations('en', '/');
      expect(calls.en).toBe(1);

      vi.advanceTimersByTime(999);
      await instance.loadTranslations('en', '/');
      expect(calls.en).toBe(1);

      vi.advanceTimersByTime(1);
      await instance.loadTranslations('en', '/');
      expect(calls.en).toBe(2);

      // The refetch opens a NEW freshness window measured from its own data —
      // the original load's stamp must be gone, or the next trigger would
      // treat the fresh data as already expired.
      vi.advanceTimersByTime(999);
      await instance.loadTranslations('en', '/');
      expect(calls.en).toBe(2);

      vi.advanceTimersByTime(1);
      await instance.loadTranslations('en', '/');
      expect(calls.en).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('`cache: 0` treats translations as always stale', async () => {
    // Fake timers pin `Date.now()`, proving the refetch is not a side effect
    // of time passing between the two calls.
    vi.useFakeTimers();
    try {
      const calls: Record<string, number> = {};
      const instance = new i18n({ parser, log, cache: 0, loaders: [counterLoader('en', calls)] });

      await instance.loadTranslations('en', '/');
      await instance.loadTranslations('en', '/');

      expect(calls.en).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('each locale expires independently', async () => {
    vi.useFakeTimers();
    try {
      const calls: Record<string, number> = {};
      const instance = new i18n({
        parser,
        log,
        cache: 1000,
        loaders: [counterLoader('en', calls), counterLoader('cs', calls)],
      });

      await instance.loadTranslations('en', '/');
      vi.advanceTimersByTime(600);
      await instance.loadTranslations('cs', '/');
      vi.advanceTimersByTime(500);

      // 1100ms after the 'en' load, 500ms after the 'cs' one.
      await instance.loadTranslations('en', '/');
      await instance.loadTranslations('cs', '/');

      expect(calls.en).toBe(2);
      expect(calls.cs).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('`invalidate` keeps translations and triggers no load, but the next load refetches', async () => {
    const calls: Record<string, number> = {};
    const instance = new i18n({ parser: valueParser, log, loaders: [counterLoader('en', calls)] });

    await instance.loadTranslations('en', '/');
    expect(calls.en).toBe(1);

    // Sanitized like every other locale input — 'EN' must hit the 'en' entry.
    instance.invalidate('EN');

    // No load was triggered and the loaded data is still served.
    expect(instance.loading).toBe(false);
    expect(instance.t('common.greeting')).toBe('Hello en');

    await instance.loadTranslations('en', '/');
    expect(calls.en).toBe(2);
  });

  it('`invalidate` without a locale marks every locale stale', async () => {
    const calls: Record<string, number> = {};
    const instance = new i18n({ parser, log, loaders: [counterLoader('en', calls), counterLoader('cs', calls)] });

    await instance.loadTranslations('en', '/');
    await instance.loadTranslations('cs', '/');

    instance.invalidate();

    await instance.loadTranslations('en', '/');
    await instance.loadTranslations('cs', '/');

    expect(calls.en).toBe(2);
    expect(calls.cs).toBe(2);
  });

  it('`invalidate` with an empty locale is a no-op instead of clearing every locale', async () => {
    const calls: Record<string, number> = {};
    const instance = new i18n({ parser, log, loaders: [counterLoader('en', calls), counterLoader('cs', calls)] });

    await instance.loadTranslations('en', '/');
    await instance.loadTranslations('cs', '/');

    // Falsy locale inputs no-op everywhere else (`setLocale('')`,
    // `loadTranslations('')`) — '' must not select the clear-all branch.
    instance.invalidate('');

    await instance.loadTranslations('en', '/');
    await instance.loadTranslations('cs', '/');

    expect(calls.en).toBe(1);
    expect(calls.cs).toBe(1);
  });

  it('`invalidate` severs an in-flight load, and its trigger fetches again before it activates', async () => {
    let calls = 0;
    const resolvers: Array<(value: any) => void> = [];
    const instance = new i18n({
      parser: valueParser,
      log,
      loaders: [
        { namespace: 'common', locale: 'en', loader: () => new Promise<any>((resolve) => { calls += 1; resolvers.push(resolve); }) },
      ],
    });

    const pending = instance.loadTranslations('en', '/');
    expect(calls).toBe(1);

    instance.invalidate('en');

    resolvers[0]?.({ greeting: 'stale', old: 'stale' });
    await vi.waitFor(() => expect(calls).toBe(2));

    // The severed load's data is discarded — it predates the invalidation —
    // and the trigger is still loading.
    expect(instance.rawTranslations).toEqual({});
    expect(instance.locale).toBeUndefined();
    expect(instance.loading).toBe(true);

    resolvers[1]?.({ greeting: 'fresh' });
    await pending;

    expect(instance.t('common.greeting')).toBe('fresh');
    expect(instance.t('common.old')).toBe('common.old');
    expect(instance.locale).toBe('en');
    expect(instance.loading).toBe(false);
  });

  it('a severed trigger joins the load a later trigger started instead of fetching again', async () => {
    let calls = 0;
    const resolvers: Array<(value: any) => void> = [];
    const instance = new i18n({
      parser: valueParser,
      log,
      loaders: [
        { namespace: 'common', locale: 'en', loader: () => new Promise<any>((resolve) => { calls += 1; resolvers.push(resolve); }) },
      ],
    });

    const stale = instance.loadTranslations('en', '/');
    instance.invalidate('en');

    const fresh = instance.loadTranslations('en', '/');

    resolvers[0]?.({ greeting: 'stale' });
    resolvers[1]?.({ greeting: 'fresh' });
    await stale;
    await fresh;

    expect(calls).toBe(2);
    expect(instance.t('common.greeting')).toBe('fresh');
    expect(instance.locale).toBe('en');
  });

  it('a severed trigger activates at once when a warm load delivered its part first', async () => {
    let calls = 0;
    const resolvers: Array<(value: any) => void> = [];
    const instance = new i18n({
      parser: valueParser,
      log,
      loaders: [
        { namespace: 'common', locale: 'en', loader: () => new Promise<any>((resolve) => { calls += 1; resolvers.push(resolve); }) },
      ],
    });

    const stale = instance.loadTranslations('en', '/');
    instance.invalidate('en');

    const warm = instance.loadTranslations('en', '/', { activate: false });

    resolvers[1]?.({ greeting: 'fresh' });
    await warm;

    expect(instance.locale).toBeUndefined();

    resolvers[0]?.({ greeting: 'stale' });
    await stale;

    expect(calls).toBe(2);
    expect(instance.t('common.greeting')).toBe('fresh');
    expect(instance.locale).toBe('en');
  });

  it('a severed trigger makes the warm load it joins activate', async () => {
    let calls = 0;
    const resolvers: Array<(value: any) => void> = [];
    const instance = new i18n({
      parser: valueParser,
      log,
      loaders: [
        { namespace: 'common', locale: 'en', loader: () => new Promise<any>((resolve) => { calls += 1; resolvers.push(resolve); }) },
        { namespace: 'nav', locale: 'en', loader: async () => ({ home: 'Home' }) },
      ],
    });

    const stale = instance.loadTranslations('en', '/');
    instance.invalidate('en', 'common');

    const warm = instance.loadTranslations('en', '/', { activate: false });

    // The part the invalidation left lands once the severed load settles.
    resolvers[0]?.({ greeting: 'stale' });
    await vi.waitFor(() => expect(instance.translations.en).toEqual({ 'nav.home': 'Home' }));

    expect(instance.locale).toBeUndefined();

    resolvers[1]?.({ greeting: 'fresh' });
    await stale;
    await warm;

    expect(calls).toBe(2);
    expect(instance.t('common.greeting')).toBe('fresh');
    expect(instance.locale).toBe('en');
  });

  it('a severed trigger superseded by another locale fetches nothing again', async () => {
    const calls: Record<string, number> = {};
    const resolvers: Array<(value: any) => void> = [];
    const instance = new i18n({
      parser: valueParser,
      log,
      loaders: [
        { namespace: 'common', locale: 'en', loader: () => new Promise<any>((resolve) => { calls.en = (calls.en ?? 0) + 1; resolvers.push(resolve); }) },
        counterLoader('cs', calls),
      ],
    });

    const stale = instance.loadTranslations('en', '/');
    instance.invalidate('en');

    await instance.setLocale('cs');

    resolvers[0]?.({ greeting: 'stale' });
    await stale;

    expect(calls).toEqual({ en: 1, cs: 1 });
    expect(instance.locale).toBe('cs');
  });

  it('a severed trigger whose params a later trigger no longer wants fetches nothing again', async () => {
    const received: Loader.Params[] = [];
    const resolvers: Array<(value: any) => void> = [];
    const instance = new i18n({
      parser: valueParser,
      log,
      loaders: [
        {
          namespace: 'article',
          locale: 'en',
          routes: [/^\/article\/(?<articleId>\d+)/],
          loader: ({ params }: Loader.Props) => new Promise<any>((resolve) => { received.push(params); resolvers.push(resolve); }),
        },
      ],
    });

    const stale = instance.loadTranslations('en', '/article/1');
    instance.invalidate('en');

    const current = instance.loadTranslations('en', '/article/2');

    resolvers[0]?.({ title: 'Article 1' });
    await stale;

    resolvers[1]?.({ title: 'Article 2' });
    await current;

    expect(received).toEqual([{ articleId: '1' }, { articleId: '2' }]);
    expect(instance.t('article.title')).toBe('Article 2');
  });

  it('a reconfiguration leaves a severed trigger to the next one', async () => {
    let calls = 0;
    const resolvers: Array<(value: any) => void> = [];
    const loaders = [
      { namespace: 'common', locale: 'en', loader: () => new Promise<any>((resolve) => { calls += 1; resolvers.push(resolve); }) },
    ];
    const instance = new i18n({ parser: valueParser, log, loaders });

    const stale = instance.loadTranslations('en', '/');

    await instance.loadConfig({ parser: valueParser, log, loaders });

    resolvers[0]?.({ greeting: 'stale' });
    await stale;

    expect(calls).toBe(1);
    expect(instance.locale).toBeUndefined();
    expect(instance.rawTranslations).toEqual({});
  });

  it('a load trigger after a mid-flight `invalidate` refetches instead of joining the severed load', async () => {
    let calls = 0;
    const resolvers: Array<(value: any) => void> = [];
    const instance = new i18n({
      parser: valueParser,
      log,
      loaders: [
        { namespace: 'common', locale: 'en', loader: () => new Promise<any>((resolve) => { calls += 1; resolvers.push(resolve); }) },
      ],
    });

    const stale = instance.loadTranslations('en', '/');
    instance.invalidate('en');

    const fresh = instance.loadTranslations('en', '/');

    // The post-invalidation trigger must start a NEW load, not join the
    // severed one.
    expect(fresh).not.toBe(stale);
    expect(calls).toBe(2);

    resolvers[1]?.({ greeting: 'fresh' });
    await fresh;
    resolvers[0]?.({ greeting: 'stale' });
    await stale;

    // The stale settle must neither overwrite the fresh data nor resurrect
    // the bookkeeping the invalidation dropped.
    expect(instance.t('common.greeting')).toBe('fresh');

    await instance.loadTranslations('en', '/');
    expect(calls).toBe(2);
  });

  it('a load trigger with nothing to fetch activates at once instead of waiting for a severed load', async () => {
    const resolvers: Array<(value: any) => void> = [];
    const instance = new i18n({
      parser: valueParser,
      log,
      loaders: [
        { namespace: 'common', locale: 'en', loader: () => new Promise<any>((resolve) => { resolvers.push(resolve); }) },
      ],
    });

    const stale = instance.loadTranslations('en', '/');
    instance.invalidate('en');
    // A hand-off while a load is in flight is unsupported, and warns; it is the
    // one way to record the namespace before its severed load settles.
    instance.hydrate({ translations: { en: { common: { greeting: 'supplied' } } } });

    void instance.loadTranslations('en', '/');

    expect(instance.locale).toBe('en');

    resolvers[0]?.({ greeting: 'stale' });
    await stale;

    expect(instance.t('common.greeting')).toBe('supplied');
  });

  it('a reconfiguration with nothing to fetch activates without waiting for the load it replaced', async () => {
    const resolvers: Array<(value: any) => void> = [];
    const loaders = [
      { namespace: 'common', locale: 'en', loader: () => new Promise<any>((resolve) => { resolvers.push(resolve); }) },
    ];
    const instance = new i18n({ parser: valueParser, log, initLocale: 'en', loaders });

    const reconfigured = instance.loadConfig({
      parser: valueParser,
      log,
      initLocale: 'en',
      translations: { en: { common: { greeting: 'new' } } },
    });

    await vi.waitFor(() => expect(instance.locale).toBe('en'));

    resolvers[0]?.({ greeting: 'old' });
    await reconfigured;

    expect(resolvers).toHaveLength(1);
    expect(instance.t('common.greeting')).toBe('new');
  });

  it('`invalidate` severs the loaders of a locale that ride in the load of another one', async () => {
    const calls: Record<string, number> = {};
    const resolvers: Array<(value: any) => void> = [];
    const instance = new i18n({
      parser: valueParser,
      log,
      fallbackLocale: 'de',
      loaders: [
        counterLoader('en', calls),
        { namespace: 'common', locale: 'de', loader: () => new Promise<any>((resolve) => { calls.de = (calls.de ?? 0) + 1; resolvers.push(resolve); }) },
      ],
    });

    const pending = instance.loadTranslations('en', '/');
    instance.invalidate('de');

    resolvers[0]?.({ greeting: 'stale' });
    await vi.waitFor(() => expect(calls.de).toBe(2));

    // The fallback locale's part predates the invalidation; the rest lands,
    // and the locale waits for the part fetched again.
    expect(instance.translations.de).toBeUndefined();
    expect(instance.translations.en).toEqual({ 'common.greeting': 'Hello en' });
    expect(instance.locale).toBeUndefined();

    resolvers[1]?.({ greeting: 'fresh' });
    await pending;

    expect(calls).toEqual({ en: 1, de: 2 });
    expect(instance.translations.de).toEqual({ 'common.greeting': 'fresh' });
    expect(instance.locale).toBe('en');
  });

  describe('of one namespace', () => {
    type Calls = Record<string, number>;

    const counted = (calls: Calls, namespace: string, locale: string) => ({
      namespace,
      locale,
      loader: async () => {
        const name = `${namespace}.${locale}`;

        calls[name] = (calls[name] ?? 0) + 1;

        return { title: `${name} ${calls[name]}` };
      },
    });

    type Resolvers = Record<string, Array<(value: any) => void>>;

    const deferred = (calls: Calls, resolvers: Resolvers, namespace: string) => ({
      namespace,
      locale: 'en',
      loader: () => new Promise<any>((resolve) => {
        const name = `${namespace}.en`;

        calls[name] = (calls[name] ?? 0) + 1;
        (resolvers[name] ??= []).push(resolve);
      }),
    });

    // Resolves the `round`th call of every deferred loader.
    const release = (resolvers: Resolvers, round: number, title: string) => {
      Object.values(resolvers).forEach((queue) => queue[round]?.({ title }));
    };

    it('refetches only that namespace of that locale, and keeps it displayed meanwhile', async () => {
      const calls: Calls = {};
      const instance = new i18n({
        parser: valueParser,
        log,
        loaders: [counted(calls, 'common', 'en'), counted(calls, 'editor', 'en'), counted(calls, 'editor', 'cs')],
      });

      await instance.loadTranslations('cs', '/');
      await instance.loadTranslations('en', '/');

      instance.invalidate('en', 'editor');

      expect(instance.t('editor.title')).toBe('editor.en 1');

      await instance.loadTranslations('cs', '/');
      await instance.loadTranslations('en', '/');

      expect(calls).toEqual({ 'common.en': 1, 'editor.en': 2, 'editor.cs': 1 });
      expect(instance.t('editor.title')).toBe('editor.en 2');
    });

    it('covers every locale when no locale is named', async () => {
      const calls: Calls = {};
      const instance = new i18n({
        parser: valueParser,
        log,
        loaders: [counted(calls, 'common', 'en'), counted(calls, 'editor', 'en'), counted(calls, 'editor', 'cs')],
      });

      instance.hydrate({ translations: { cs: { editor: { seeded: 'Seeded' } } } });

      await instance.loadTranslations('cs', '/');
      await instance.loadTranslations('en', '/');

      expect(calls).toEqual({ 'common.en': 1, 'editor.en': 1 });

      instance.invalidate(undefined, 'editor');

      await instance.loadTranslations('cs', '/');
      await instance.loadTranslations('en', '/');

      expect(calls).toEqual({ 'common.en': 1, 'editor.en': 2, 'editor.cs': 1 });
    });

    it('drops the namespace record of a plain hand-off', async () => {
      const calls: Calls = {};
      const instance = new i18n({
        parser: valueParser,
        log,
        loaders: [counted(calls, 'common', 'en'), counted(calls, 'editor', 'en')],
      });

      instance.hydrate({ translations: { en: { editor: { seeded: 'Seeded' }, common: { seeded: 'Seeded' } } } });

      await instance.loadTranslations('en', '/');

      expect(calls).toEqual({});

      instance.invalidate('en', 'editor');
      await instance.loadTranslations('en', '/');

      expect(calls).toEqual({ 'editor.en': 1 });
    });

    it('severs only the loaders of that namespace, lets the rest of the load land, and fetches them again', async () => {
      const calls: Calls = {};
      const resolvers: Array<(value: any) => void> = [];
      const instance = new i18n({
        parser: valueParser,
        log,
        loaders: [
          counted(calls, 'common', 'en'),
          { namespace: 'editor', locale: 'en', loader: () => new Promise<any>((resolve) => { calls['editor.en'] = (calls['editor.en'] ?? 0) + 1; resolvers.push(resolve); }) },
        ],
      });

      const pending = instance.loadTranslations('en', '/');
      instance.invalidate('en', 'editor');

      resolvers[0]?.({ title: 'stale' });
      await vi.waitFor(() => expect(calls['editor.en']).toBe(2));

      expect(instance.translations.en).toEqual({ 'common.title': 'common.en 1' });
      expect(instance.locale).toBeUndefined();

      resolvers[1]?.({ title: 'fresh' });
      await pending;

      expect(calls).toEqual({ 'common.en': 1, 'editor.en': 2 });
      expect(instance.t('editor.title')).toBe('fresh');
      expect(instance.locale).toBe('en');
    });

    it('leaves the rest of the load it severed within reach of a later invalidation', async () => {
      const calls: Calls = {};
      const resolvers: Resolvers = {};
      const instance = new i18n({
        parser: valueParser,
        log,
        loaders: [deferred(calls, resolvers, 'common'), deferred(calls, resolvers, 'editor')],
      });

      const pending = instance.loadTranslations('en', '/');
      instance.invalidate('en', 'editor');
      instance.invalidate('en', 'common');

      release(resolvers, 0, 'stale');
      await vi.waitFor(() => expect(calls).toEqual({ 'common.en': 2, 'editor.en': 2 }));

      expect(instance.rawTranslations).toEqual({});

      release(resolvers, 1, 'fresh');
      await pending;

      expect(instance.translations.en).toEqual({ 'common.title': 'fresh', 'editor.title': 'fresh' });
      expect(instance.locale).toBe('en');
    });

    it('leaves the rest of the load it severed within reach of `destroy()`', async () => {
      const calls: Calls = {};
      const resolvers: Resolvers = {};
      const instance = new i18n({
        parser: valueParser,
        log,
        loaders: [deferred(calls, resolvers, 'common'), deferred(calls, resolvers, 'editor')],
      });

      const pending = instance.loadTranslations('en', '/');
      instance.invalidate('en', 'editor');
      instance.destroy();

      release(resolvers, 0, 'late');
      await pending;

      expect(calls).toEqual({ 'common.en': 1, 'editor.en': 1 });
      expect(instance.rawTranslations).toEqual({});
    });

    it('leaves the rest of the load it severed within reach of a reconfiguration', async () => {
      const calls: Calls = {};
      const resolvers: Resolvers = {};
      const loaders = [deferred(calls, resolvers, 'common'), deferred(calls, resolvers, 'editor')];
      const instance = new i18n({ parser: valueParser, log, loaders });

      const pending = instance.loadTranslations('en', '/');
      instance.invalidate('en', 'editor');
      await instance.loadConfig({ parser: valueParser, log, loaders });

      release(resolvers, 0, 'stale');
      await pending;

      expect(calls).toEqual({ 'common.en': 1, 'editor.en': 1 });
      expect(instance.rawTranslations).toEqual({});
    });

    it('keeps a trigger from joining a load in flight that leaves the invalidated namespace out', async () => {
      const calls: Calls = {};
      const resolvers: Resolvers = {};
      const instance = new i18n({
        parser: valueParser,
        log,
        loaders: [deferred(calls, resolvers, 'common'), deferred(calls, resolvers, 'editor')],
      });

      const loaded = instance.loadTranslations('en', '/');
      release(resolvers, 0, 'first');
      await loaded;

      instance.invalidate('en', 'common');
      const commonOnly = instance.loadTranslations('en', '/');

      instance.invalidate('en', 'editor');
      const both = instance.loadTranslations('en', '/');

      expect(both).not.toBe(commonOnly);
      expect(calls['editor.en']).toBe(2);

      release(resolvers, 1, 'second');
      release(resolvers, 2, 'second');
      await commonOnly;
      await both;

      expect(instance.translations.en).toEqual({ 'common.title': 'second', 'editor.title': 'second' });
    });

    it('retries a loader that failed rather than join the load fetching a severed part again', async () => {
      const calls: Calls = {};
      const resolvers: Resolvers = {};
      let failing = true;
      const instance = new i18n({
        parser: valueParser,
        log: { level: 'error', logger: { error: () => {}, warn: () => {}, debug: () => {} } },
        loaders: [
          {
            namespace: 'common',
            locale: 'en',
            loader: async () => {
              calls['common.en'] = (calls['common.en'] ?? 0) + 1;

              if (failing) throw new Error('down');

              return { title: 'recovered' };
            },
          },
          deferred(calls, resolvers, 'editor'),
        ],
      });

      const first = instance.loadTranslations('en', '/');
      instance.invalidate('en', 'editor');

      release(resolvers, 0, 'stale');
      await vi.waitFor(() => expect(calls['editor.en']).toBe(2));

      failing = false;
      const second = instance.loadTranslations('en', '/');

      release(resolvers, 1, 'fresh');
      release(resolvers, 2, 'fresh');
      await first;
      await second;

      expect(calls['common.en']).toBe(2);
      expect(instance.translations.en).toEqual({ 'common.title': 'recovered', 'editor.title': 'fresh' });
    });

    it('leaves the locale to expire at its original stamp', async () => {
      vi.useFakeTimers();
      try {
        const calls: Calls = {};
        const instance = new i18n({
          parser: valueParser,
          log,
          cache: 1000,
          loaders: [counted(calls, 'common', 'en'), counted(calls, 'editor', 'en')],
        });

        await instance.loadTranslations('en', '/');

        vi.advanceTimersByTime(600);
        instance.invalidate('en', 'editor');
        await instance.loadTranslations('en', '/');

        expect(calls).toEqual({ 'common.en': 1, 'editor.en': 2 });

        vi.advanceTimersByTime(500);
        await instance.loadTranslations('en', '/');

        expect(calls).toEqual({ 'common.en': 2, 'editor.en': 3 });
      } finally {
        vi.useRealTimers();
      }
    });
  });

  it('`loadConfig` marks previous loads stale so a reconfiguration refetches', async () => {
    const calls: Record<string, number> = {};
    const instance = new i18n({ parser, log, loaders: [counterLoader('en', calls)] });

    await instance.loadTranslations('en', '/');
    expect(calls.en).toBe(1);

    let reconfiguredCalls = 0;
    await instance.loadConfig({
      parser,
      log,
      loaders: [{ namespace: 'common', locale: 'en', loader: async () => { reconfiguredCalls += 1; return { greeting: 'Hi' }; } }],
    });
    await instance.loadTranslations('en', '/');

    expect(reconfiguredCalls).toBe(1);
  });

  it('`loadConfig` during an in-flight load discards it and fetches through the new loaders', async () => {
    const resolvers: Array<(value: any) => void> = [];
    let oldCalls = 0;
    let newCalls = 0;

    const instance = new i18n({
      parser: valueParser,
      log,
      initLocale: 'en',
      loaders: [
        { namespace: 'common', locale: 'en', loader: () => new Promise<any>((resolve) => { oldCalls += 1; resolvers.push(resolve); }) },
      ],
    });
    expect(oldCalls).toBe(1);

    const reconfigured = instance.loadConfig({
      parser: valueParser,
      log,
      initLocale: 'en',
      loaders: [
        { namespace: 'common', locale: 'en', loader: async () => { newCalls += 1; return { greeting: 'new' }; } },
      ],
    });

    resolvers[0]?.({ greeting: 'old' });
    await reconfigured;

    // The reconfiguration must fetch through the NEW loaders, not adopt the
    // old-config load that was still in flight.
    expect(newCalls).toBe(1);
    expect(instance.t('common.greeting')).toBe('new');

    await instance.loadTranslations('en');
    expect(newCalls).toBe(1);
  });
});

describe('i18n loaders with `cache: false`', () => {
  const valueParser = { parse: (text: any, _params: any, _locale: any, key: string) => (text === undefined ? key : text) };

  type Calls = Record<string, number>;

  const setup = (calls: Calls, source = { version: 1 }) => [
    { namespace: 'common', locale: 'en', loader: async () => { calls.common = (calls.common ?? 0) + 1; return { greeting: 'Hello' }; } },
    { namespace: 'about', locale: 'en', routes: ['/about'], loader: async () => { calls.about = (calls.about ?? 0) + 1; return { title: 'About' }; } },
    {
      namespace: 'live',
      locale: 'en',
      cache: false as const,
      loader: async () => { calls.live = (calls.live ?? 0) + 1; return { title: `v${source.version}` }; },
    },
  ];

  it('runs on every trigger that selects it, and its data is applied each time', async () => {
    const calls: Calls = {};
    const source = { version: 1 };
    const instance = new i18n({ parser: valueParser, log, loaders: setup(calls, source) });

    await instance.loadTranslations('en', '/');

    source.version = 2;
    await instance.loadTranslations('en', '/');
    await instance.loadNamespace('live');

    expect(calls).toEqual({ common: 1, live: 3 });
    expect(instance.t('live.title')).toBe('v2');
  });

  it('joins a load in flight like any other loader', async () => {
    const calls: Calls = {};
    const instance = new i18n({ parser: valueParser, log, loaders: setup(calls) });

    const first = instance.loadTranslations('en', '/');
    const second = instance.loadTranslations('en', '/');

    expect(second).toBe(first);

    await second;

    expect(calls.live).toBe(1);
  });

  it('starts no `cache` window', async () => {
    vi.useFakeTimers();
    try {
      const calls: Calls = {};
      const instance = new i18n({ parser: valueParser, log, cache: 1000, loaders: setup(calls).filter(({ namespace }) => namespace !== 'common') });

      await instance.loadTranslations('en', '/');

      vi.advanceTimersByTime(900);
      await instance.setRoute('/about');

      // The window starts with the first data a caching loader delivered.
      vi.advanceTimersByTime(600);
      await instance.setRoute('/about');

      expect(calls).toEqual({ live: 3, about: 1 });
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    ['with records', (server: I18n) => server.snapshot({ records: true })],
    ['without records', (server: I18n) => ({ translations: server.snapshot(), locale: 'en', route: '/' })],
  ])('starts no `cache` window from a hand-off %s either', async (_, envelopeOf) => {
    vi.useFakeTimers();
    try {
      const loaders = (calls: Calls) => setup(calls).filter(({ namespace }) => namespace !== 'common');
      const server = new i18n({ parser: valueParser, log, loaders: loaders({}) });

      await server.loadTranslations('en', '/');

      const calls: Calls = {};
      const client = new i18n({ parser: valueParser, log, cache: 1000, loaders: loaders(calls) });

      client.hydrate(envelopeOf(server));
      await client.loadTranslations('en', '/');

      vi.advanceTimersByTime(900);
      await client.setRoute('/about');

      vi.advanceTimersByTime(600);
      await client.setRoute('/about');

      expect(calls).toEqual({ live: 2, about: 1 });
    } finally {
      vi.useRealTimers();
    }
  });

  it('leaves the `cache` window to a caching loader it shares a namespace with after a hand-off', async () => {
    vi.useFakeTimers();
    try {
      const loaders = (calls: Calls) => [
        { namespace: 'page', locale: 'en', cache: false as const, loader: async () => { calls.live = (calls.live ?? 0) + 1; return { live: 'L' }; } },
        { namespace: 'page', locale: 'en', routes: ['/'], loader: async () => { calls.cached = (calls.cached ?? 0) + 1; return { cached: 'C' }; } },
      ];
      const server = new i18n({ parser: valueParser, log, loaders: loaders({}) });

      await server.loadTranslations('en', '/');

      const calls: Calls = {};
      const client = new i18n({ parser: valueParser, log, cache: 1000, loaders: loaders(calls) });

      client.hydrate(server.snapshot({ records: true }));
      await client.loadTranslations('en', '/');

      expect(calls).toEqual({});

      vi.advanceTimersByTime(1000);
      await client.loadTranslations('en', '/');

      expect(calls).toEqual({ cached: 1 });
    } finally {
      vi.useRealTimers();
    }
  });

  it('lands what it delivers while the `cache` window of its locale elapses', async () => {
    vi.useFakeTimers();
    try {
      const calls: Calls = {};
      const resolvers: Array<(value: any) => void> = [];
      const [common] = setup(calls);
      const instance = new i18n({
        parser: valueParser,
        log,
        cache: 1000,
        loaders: [
          common,
          { namespace: 'editor', locale: 'en', cache: false as const, routes: ['/editor'], loader: () => new Promise<any>((resolve) => { resolvers.push(resolve); }) },
        ],
      });

      await instance.loadTranslations('en', '/');
      vi.advanceTimersByTime(1500);

      const warm = instance.loadNamespace('editor');
      await instance.setRoute('/');

      resolvers[0]?.({ title: 'Editor' });
      await warm;

      expect(calls).toEqual({ common: 2 });
      expect(instance.t('editor.title')).toBe('Editor');
    } finally {
      vi.useRealTimers();
    }
  });

  it('is severed by `invalidate()` like any other loader', async () => {
    let calls = 0;
    const resolvers: Array<(value: any) => void> = [];
    const instance = new i18n({
      parser: valueParser,
      log,
      loaders: [
        { namespace: 'live', locale: 'en', cache: false as const, loader: () => new Promise<any>((resolve) => { calls += 1; resolvers.push(resolve); }) },
      ],
    });

    const pending = instance.loadTranslations('en', '/');
    instance.invalidate('en', 'live');

    resolvers[0]?.({ title: 'stale' });
    await vi.waitFor(() => expect(calls).toBe(2));

    expect(instance.rawTranslations).toEqual({});

    resolvers[1]?.({ title: 'fresh' });
    await pending;

    expect(instance.t('live.title')).toBe('fresh');
  });

  describe('with route params', () => {
    const article = (received: Loader.Params[]) => ({
      namespace: 'article',
      locale: 'en',
      cache: false as const,
      routes: [/^\/article\/(?<articleId>\d+)/],
      loader: async ({ params }: Loader.Props) => {
        received.push(params);

        return { title: `Article ${params.articleId}` };
      },
    });

    it('serves what it delivered last off its routes', async () => {
      const received: Loader.Params[] = [];
      const instance = new i18n({ parser: valueParser, log, loaders: [article(received)] });

      await instance.loadTranslations('en', '/article/1');
      await instance.setRoute('/');
      await instance.loadNamespace('article');
      await instance.loadNamespace('article');

      expect(received).toEqual([{ articleId: '1' }]);
      expect(instance.t('article.title')).toBe('Article 1');
    });

    it('is handed over with the params it delivered for', async () => {
      const server = new i18n({ parser: valueParser, log, loaders: [article([])] });

      await server.loadTranslations('en', '/article/1');

      const envelope = server.snapshot({ records: true });

      expect(envelope.translations).toEqual({ en: { article: { title: 'Article 1' } } });
      expect(envelope.records).toHaveLength(1);

      const received: Loader.Params[] = [];
      const client = new i18n({ parser: valueParser, log, loaders: [article(received)] });

      client.hydrate(envelope);
      await client.loadTranslations('en', '/article/1');
      await client.setRoute('/');
      await client.loadNamespace('article');

      expect(received).toEqual([]);

      await client.setRoute('/article/2');

      expect(received).toEqual([{ articleId: '2' }]);
      expect(client.t('article.title')).toBe('Article 2');
    });
  });

  it('is served by a hand-off with records for the pass it arrived with', async () => {
    const server = new i18n({ parser: valueParser, log, loaders: setup({}) });

    await server.loadTranslations('en', '/');

    const envelope = server.snapshot({ records: true });

    expect(envelope.records).toHaveLength(2);

    const calls: Calls = {};
    const client = new i18n({ parser: valueParser, log, loaders: setup(calls) });

    client.hydrate(envelope);
    await client.loadTranslations('en', '/');

    expect(calls).toEqual({});
    expect(client.t('live.title')).toBe('v1');

    await client.setRoute('/about');
    await client.setRoute('/');

    expect(calls).toEqual({ about: 1, live: 2 });
  });

  it('is served by a plain hand-off for the pass the first trigger after it settles', async () => {
    const server = new i18n({ parser: valueParser, log, loaders: setup({}) });

    await server.loadTranslations('en', '/');

    const calls: Calls = {};
    const client = new i18n({ parser: valueParser, log, loaders: setup(calls) });

    client.hydrate({ translations: server.snapshot(), locale: 'en' });
    await client.loadTranslations('en', '/');
    await client.setRoute('/');

    expect(calls).toEqual({});

    await client.setRoute('/about');

    expect(calls).toEqual({ about: 1, live: 1 });
  });

  it('keeps its hand-off through warm triggers, until an activating one leaves the pass the envelope named', async () => {
    const server = new i18n({ parser: valueParser, log, loaders: setup({}) });

    await server.loadTranslations('en', '/');

    const calls: Calls = {};
    const client = new i18n({ parser: valueParser, log, loaders: setup(calls) });

    client.hydrate(server.snapshot({ records: true }));
    await client.loadTranslations('en', '/about', { activate: false });

    expect(calls).toEqual({ about: 1 });

    await client.setRoute('/about');

    expect(calls).toEqual({ about: 1, live: 1 });
  });

  it('hands over no record of what it delivered under a previous config', async () => {
    const server = new i18n({ parser: valueParser, log, loaders: setup({}) });

    await server.loadTranslations('en', '/');
    await server.loadConfig({ parser: valueParser, log, loaders: setup({}) });

    expect(server.snapshot({ records: true }).records).toEqual([]);
  });

  it('keeps its hand-off when the `cache` window of its locale elapses', async () => {
    const server = new i18n({ parser: valueParser, log, loaders: setup({}) });

    await server.loadTranslations('en', '/');

    const calls: Calls = {};
    const client = new i18n({ parser: valueParser, log, cache: 0, loaders: setup(calls) });

    client.hydrate(server.snapshot({ records: true }));
    await client.loadTranslations('en', '/');

    expect(calls).toEqual({ common: 1 });
  });

  it('runs within the pass once `invalidate()` dropped the hand-off', async () => {
    const server = new i18n({ parser: valueParser, log, loaders: setup({}) });

    await server.loadTranslations('en', '/');

    const calls: Calls = {};
    const client = new i18n({ parser: valueParser, log, loaders: setup(calls) });

    client.hydrate(server.snapshot({ records: true }));
    client.invalidate('en', 'live');
    await client.loadTranslations('en', '/');

    expect(calls).toEqual({ live: 1 });
  });
});

describe('i18n seeded translations', () => {
  const valueParser = { parse: (text: any, _params: any, _locale: any, key: string) => (text === undefined ? key : text) };

  const extra = (loader: () => Promise<Record<string, string>>, routes?: string[]) => ({ namespace: 'extra', locale: 'en', ...(routes && { routes }), loader });

  it('lets the loader of a namespace seeded through `config.translations` run, and merges the two', async () => {
    const loader = vi.fn(async () => ({ b: 'loaded-b' }));
    const instance = new i18n({ parser: valueParser, log, translations: { en: { extra: { a: 'static-a' } } }, loaders: [extra(loader)] });

    await instance.loadTranslations('en', '/');

    expect(loader).toHaveBeenCalledTimes(1);
    expect(instance.translations.en).toEqual({ 'extra.a': 'static-a', 'extra.b': 'loaded-b' });
  });

  it('lets the loader of a namespace seeded through `addTranslations()` run, and merges the two', async () => {
    const loader = vi.fn(async () => ({ b: 'loaded-b' }));
    const instance = new i18n({ parser: valueParser, log, loaders: [extra(loader)] });

    instance.addTranslations({ en: { extra: { a: 'static-a' } } });
    await instance.loadTranslations('en', '/');

    expect(loader).toHaveBeenCalledTimes(1);
    expect(instance.translations.en).toEqual({ 'extra.a': 'static-a', 'extra.b': 'loaded-b' });
  });

  it('runs a route-scoped loader of a seeded namespace once its route is reached', async () => {
    const loader = vi.fn(async () => ({ b: 'loaded-b' }));
    const instance = new i18n({ parser: valueParser, log, translations: { en: { extra: { a: 'static-a' } } }, loaders: [extra(loader, ['/other'])] });

    await instance.loadTranslations('en', '/');

    expect(loader).not.toHaveBeenCalled();

    await instance.setRoute('/other');

    expect(loader).toHaveBeenCalledTimes(1);
    expect(instance.translations.en).toEqual({ 'extra.a': 'static-a', 'extra.b': 'loaded-b' });
  });

  it('lets `loadNamespace()` fetch a seeded namespace off its loader\'s routes', async () => {
    const loader = vi.fn(async () => ({ b: 'loaded-b' }));
    const instance = new i18n({ parser: valueParser, log, translations: { en: { extra: { a: 'static-a' } } }, loaders: [extra(loader, ['/other'])] });

    await instance.loadTranslations('en', '/');
    await instance.loadNamespace('extra');

    expect(loader).toHaveBeenCalledTimes(1);
    expect(instance.translations.en).toEqual({ 'extra.a': 'static-a', 'extra.b': 'loaded-b' });
  });

  it('keeps a dotted leaf from claiming its namespace', async () => {
    const loader = vi.fn(async () => ({ b: 'loaded-b' }));
    const instance = new i18n({ parser: valueParser, log, translations: { en: { 'extra.a': 'static-a' } }, loaders: [extra(loader)] });

    await instance.loadTranslations('en', '/');

    expect(loader).toHaveBeenCalledTimes(1);
    expect(instance.translations.en).toEqual({ 'extra.a': 'static-a', 'extra.b': 'loaded-b' });
  });

  it('starts no `cache` window, which its loader\'s first delivery starts', async () => {
    vi.useFakeTimers();
    try {
      const loader = vi.fn(async () => ({ b: 'loaded-b' }));
      const instance = new i18n({ parser: valueParser, log, cache: 1000, translations: { en: { extra: { a: 'static-a' } } }, loaders: [extra(loader)] });

      vi.advanceTimersByTime(600);
      await instance.loadTranslations('en', '/');
      expect(loader).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(999);
      await instance.loadTranslations('en', '/');
      expect(loader).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(1);
      await instance.loadTranslations('en', '/');
      expect(loader).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('starts no `cache` window when a hand-off carries it', async () => {
    vi.useFakeTimers();
    try {
      const loader = vi.fn(async () => ({ b: 'loaded-b' }));
      const instance = new i18n({ parser: valueParser, log, cache: 1000, loaders: [extra(loader)] });

      instance.hydrate({ translations: { en: { labels: { en: 'English' } } }, records: [], locale: 'en', route: '/' });

      vi.advanceTimersByTime(600);
      await instance.loadTranslations('en', '/');

      vi.advanceTimersByTime(999);
      await instance.loadTranslations('en', '/');
      expect(loader).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('still suppresses the loader when the same data arrives as a plain hand-off', async () => {
    const loader = vi.fn(async () => ({ b: 'loaded-b' }));
    const instance = new i18n({ parser: valueParser, log, loaders: [extra(loader)] });

    instance.hydrate({ translations: { en: { extra: { a: 'static-a' } } } });
    await instance.loadTranslations('en', '/');

    expect(loader).not.toHaveBeenCalled();
    expect(instance.translations.en).toEqual({ 'extra.a': 'static-a' });
  });
});

describe('i18n snapshot', () => {
  const valueParser = { parse: (text: any, _params: any, _locale: any, key: string) => (text === undefined ? key : text) };

  const countingLoaders = (calls: Record<string, number>) => [
    { namespace: 'common', locale: 'en', loader: async () => { calls.common = (calls.common ?? 0) + 1; return { greeting: 'Hello' }; } },
    { namespace: 'home', locale: 'en', routes: ['/'], loader: async () => { calls.home = (calls.home ?? 0) + 1; return { title: 'Home' }; } },
    { namespace: 'about', locale: 'en', routes: ['/about'], loader: async () => { calls.about = (calls.about ?? 0) + 1; return { title: 'About' }; } },
    { namespace: 'common', locale: 'cs', loader: async () => { calls.cs = (calls.cs ?? 0) + 1; return { greeting: 'Ahoj' }; } },
  ];

  it('returns nothing before anything loaded', () => {
    const instance = new i18n({ parser: valueParser, log, loaders: countingLoaders({}) });

    expect(instance.snapshot()).toEqual({});
  });

  it('serializes what the active locale holds, whichever route loaded it', async () => {
    const instance = new i18n({ parser: valueParser, log, loaders: countingLoaders({}) });

    await instance.loadTranslations('en', '/about');
    await instance.setRoute('/');

    expect(instance.snapshot()).toEqual({
      en: {
        common: { greeting: 'Hello' },
        home: { title: 'Home' },
        about: { title: 'About' },
      },
    });
  });

  it('keeps data supplied without a loader in a namespace a loader claims', async () => {
    const instance = new i18n({ parser: valueParser, log, loaders: countingLoaders({}) });

    await instance.loadTranslations('en', '/about');
    await instance.setRoute('/');
    instance.addTranslations({ en: { about: { note: 'static' } } });

    expect(instance.snapshot().en.about).toEqual({ title: 'About', note: 'static' });
  });

  it('leaves out a namespace fed by several loaders, for the client to load', async () => {
    const shared = (calls: Record<string, number>) => [
      { namespace: 'common', locale: 'en', loader: async () => { calls.common = (calls.common ?? 0) + 1; return { greeting: 'Hello' }; } },
      { namespace: 'nav', locale: 'en', routes: ['/'], loader: async () => { calls.home = (calls.home ?? 0) + 1; return { home: 'Home' }; } },
      { namespace: 'nav', locale: 'en', routes: ['/about'], loader: async () => { calls.about = (calls.about ?? 0) + 1; return { about: 'About' }; } },
    ];
    const server = new i18n({ parser: valueParser, log, loaders: shared({}) });

    await server.loadTranslations('en', '/');

    expect(server.snapshot()).toEqual({ en: { common: { greeting: 'Hello' } } });

    const calls: Record<string, number> = {};
    const client = new i18n({ parser: valueParser, log, loaders: shared(calls) });

    client.hydrate({ translations: server.snapshot() });
    await client.loadTranslations('en', '/');
    await client.setRoute('/about');

    expect(calls).toEqual({ home: 1, about: 1 });
    expect(client.t('nav.home')).toBe('Home');
    expect(client.t('nav.about')).toBe('About');
  });

  it('leaves out a namespace a loader delivered for route params', async () => {
    const article = {
      namespace: 'article',
      locale: 'en',
      routes: [/^\/article\/(?<articleId>\d+)/],
      loader: async ({ params }: Loader.Props) => ({ title: `Article ${params.articleId}`, [`only${params.articleId}`]: 'x' }),
    };
    const server = new i18n({ parser: valueParser, log, loaders: [article] });

    await server.loadTranslations('en', '/article/6');

    expect(server.snapshot()).toEqual({});

    const client = new i18n({ parser: valueParser, log, loaders: [article] });

    client.hydrate({ translations: server.snapshot() });
    await client.loadTranslations('en', '/article/6');
    await client.setRoute('/article/7');

    expect(client.translations.en).toEqual({ 'article.title': 'Article 7', 'article.only7': 'x' });
  });

  it('keeps keys no loader claims', async () => {
    const instance = new i18n({ parser: valueParser, log, loaders: countingLoaders({}) });

    await instance.loadTranslations('en', '/');
    instance.addTranslations({ en: { extra: { note: 'kept' } } });

    expect(instance.snapshot().en).toHaveProperty('extra');
  });

  it('includes the fallback locale', async () => {
    const instance = new i18n({ parser: valueParser, log, fallbackLocale: 'cs', loaders: countingLoaders({}) });

    await instance.loadTranslations('en', '/');

    expect(Object.keys(instance.snapshot()).sort()).toEqual(['cs', 'en']);
  });

  it('is pre-preprocess, so the receiving instance applies its own', async () => {
    const instance = new i18n({ parser: valueParser, log, preprocess: 'none', loaders: countingLoaders({}) });

    await instance.loadTranslations('en', '/');

    // Nested, not dot-notated — `rawTranslations` shape, not `translations`.
    expect(instance.snapshot().en.common).toEqual({ greeting: 'Hello' });
  });

  it('hydrates a fresh instance through a plain `hydrate()` without refetching', async () => {
    const server = new i18n({ parser: valueParser, log, loaders: countingLoaders({}) });

    await server.loadTranslations('en', '/');

    const calls: Record<string, number> = {};
    const client = new i18n({ parser: valueParser, log, loaders: countingLoaders(calls) });

    client.hydrate({ translations: server.snapshot() });

    await client.loadTranslations('en', '/');

    expect(calls).toEqual({});
    expect(client.t('common.greeting')).toBe('Hello');
    expect(client.t('home.title')).toBe('Home');
  });

  it('leaves out a namespace a loader delivered on a route that captured no params', async () => {
    const article = {
      namespace: 'article',
      locale: 'en',
      routes: [/^\/articles$/, /^\/articles\/(?<id>\d+)$/],
      loader: async ({ params }: Loader.Props) => (params.id ? { title: `T${params.id}` } : { list: 'All' }),
    };
    const server = new i18n({ parser: valueParser, log, loaders: [article] });

    await server.loadTranslations('en', '/articles');

    expect(server.snapshot()).toEqual({});

    const client = new i18n({ parser: valueParser, log, loaders: [article] });

    client.hydrate({ translations: server.snapshot() });
    await client.loadTranslations('en', '/articles/5');

    expect(client.translations.en).toEqual({ 'article.title': 'T5' });
  });

  it('keeps the loaders of every route it carries from running on the client', async () => {
    const server = new i18n({ parser: valueParser, log, loaders: countingLoaders({}) });

    await server.loadTranslations('en', '/about');
    await server.setRoute('/');

    const calls: Record<string, number> = {};
    const client = new i18n({ parser: valueParser, log, loaders: countingLoaders(calls) });

    client.hydrate({ translations: server.snapshot() });

    await client.loadTranslations('en', '/');
    await client.setRoute('/about');

    expect(calls).toEqual({});
    expect(client.t('about.title')).toBe('About');
  });

  it('leaves out a literal `__proto__` key, which the serializers of load data refuse', async () => {
    const hasOwnProtoKey = (value: any): boolean => !!value && typeof value === 'object'
      && (Object.hasOwn(value, '__proto__') || Object.values(value).some(hasOwnProtoKey));

    const instance = new i18n({
      parser: valueParser,
      log,
      loaders: [
        // JSON.parse creates real own '__proto__' keys (object literals would not).
        { namespace: 'home', locale: 'en', loader: async () => JSON.parse('{"__proto__": {"x": "y"}, "list": [{"__proto__": "z", "ok": "1"}], "title": "Home"}') },
      ],
    });

    await instance.loadTranslations('en', '/');
    instance.addTranslations({ en: JSON.parse('{"__proto__": {"a": "b"}}') });

    const snapshot = instance.snapshot();

    expect(hasOwnProtoKey(snapshot)).toBe(false);
    expect(snapshot).toEqual({ en: { home: { list: [{ ok: '1' }], title: 'Home' } } });
  });
});

describe('i18n hydrate', () => {
  const valueParser = { parse: (text: any, _params: any, _locale: any, key: string) => (text === undefined ? key : text) };

  type Calls = Record<string, number>;

  const counted = (calls: Calls, name: string, data: any) => async () => {
    calls[name] = (calls[name] ?? 0) + 1;

    return data;
  };

  const sharedLoaders = (calls: Calls) => [
    { namespace: 'common', locale: 'en', loader: counted(calls, 'common', { greeting: 'Hello' }) },
    { namespace: 'nav', locale: 'en', routes: ['/'], loader: counted(calls, 'home', { home: 'Home' }) },
    { namespace: 'nav', locale: 'en', routes: ['/about'], loader: counted(calls, 'about', { about: 'About' }) },
    { namespace: 'common', locale: 'cs', routes: ['/about'], loader: counted(calls, 'cs', { greeting: 'Ahoj' }) },
  ];

  const article = (calls: Calls) => ({
    namespace: 'article',
    locale: 'en',
    routes: [/^\/article\/(?<articleId>\d+)/],
    loader: async ({ params }: Loader.Props) => {
      calls.article = (calls.article ?? 0) + 1;

      return { title: `Article ${params.articleId}`, [`only${params.articleId}`]: 'x' };
    },
  });

  it('hands over a namespace fed by several loaders, and only its missing part loads', async () => {
    const server = new i18n({ parser: valueParser, log, loaders: sharedLoaders({}) });

    await server.loadTranslations('en', '/');

    const envelope = server.snapshot({ records: true });

    expect(envelope.translations).toEqual({ en: { common: { greeting: 'Hello' }, nav: { home: 'Home' } } });
    expect(envelope.records).toHaveLength(2);

    const calls: Calls = {};
    const client = new i18n({ parser: valueParser, log, loaders: sharedLoaders(calls) });

    client.hydrate(envelope);
    await client.loadTranslations('en', '/');
    await client.setRoute('/about');

    expect(calls).toEqual({ about: 1 });
    expect(client.t('nav.home')).toBe('Home');
    expect(client.t('nav.about')).toBe('About');
  });

  it('keeps a parameterized loader from refetching its params, and replaces its data for others', async () => {
    const server = new i18n({ parser: valueParser, log, loaders: [article({})] });

    await server.loadTranslations('en', '/article/6');

    const envelope = server.snapshot({ records: true });

    expect(envelope.records).toEqual([{ id: resolveLoaders([article({})])[0].id, signature: '[["articleId","6"]]' }]);

    const calls: Calls = {};
    const client = new i18n({ parser: valueParser, log, loaders: [article(calls)] });

    client.hydrate(envelope);
    await client.loadTranslations('en', '/article/6');

    expect(calls).toEqual({});
    expect(client.t('article.title')).toBe('Article 6');

    await client.setRoute('/article/7');

    expect(calls).toEqual({ article: 1 });
    expect(client.translations.en).toEqual({ 'article.title': 'Article 7', 'article.only7': 'x' });
  });

  it('leaves out the data of a parameterized loader it holds no record of', async () => {
    const server = new i18n({ parser: valueParser, log, loaders: [article({})] });

    await server.loadTranslations('en', '/article/6');
    server.invalidate('en');

    expect(server.snapshot({ records: true })).toEqual({ translations: {}, records: [], locale: 'en', route: '/article/6' });

    const client = new i18n({ parser: valueParser, log, loaders: [article({})] });

    client.hydrate(server.snapshot({ records: true }));
    await client.loadTranslations('en', '/article/6');
    await client.setRoute('/article/7');

    expect(client.translations.en).toEqual({ 'article.title': 'Article 7', 'article.only7': 'x' });
  });

  it('still leaves out a namespace fed by several loaders when one of them captures params', async () => {
    const loaders = [
      article({}),
      { namespace: 'article', locale: 'en', loader: async () => ({ back: 'Back' }) },
      { namespace: 'common', locale: 'en', loader: async () => ({ greeting: 'Hello' }) },
    ];
    const server = new i18n({ parser: valueParser, log, loaders });

    await server.loadTranslations('en', '/article/6');

    const envelope = server.snapshot({ records: true });

    expect(envelope.translations).toEqual({ en: { common: { greeting: 'Hello' } } });
    expect(envelope.records).toEqual([{ id: resolveLoaders(loaders)[2].id }]);
  });

  it('leaves a loader without an id out of the records, so it loads again', async () => {
    const matcher = (calls: Calls, name: string) => ({
      namespace: 'common',
      locale: 'en',
      routes: [{ test: (route: string) => route === '/' }],
      loader: counted(calls, name, { [name]: name }),
    });
    const loaders = (calls: Calls) => [matcher(calls, 'a'), matcher(calls, 'b')];
    const server = new i18n({ parser: valueParser, log, loaders: loaders({}) });

    await server.loadTranslations('en', '/');

    const envelope = server.snapshot({ records: true });

    expect(envelope.records).toEqual([]);

    const calls: Calls = {};
    const client = new i18n({ parser: valueParser, log, loaders: loaders(calls) });

    client.hydrate(envelope);
    await client.loadTranslations('en', '/');

    expect(calls).toEqual({ a: 1, b: 1 });
  });

  it('runs a loader again that threw on the server, rather than suppressing it', async () => {
    const loaders = (calls: Calls, fail: boolean) => [
      { namespace: 'common', locale: 'en', loader: counted(calls, 'common', { greeting: 'Hello' }) },
      {
        namespace: 'home',
        locale: 'en',
        loader: async () => {
          calls.home = (calls.home ?? 0) + 1;

          if (fail) throw new Error('down');

          return { title: 'Home' };
        },
      },
    ];
    const server = new i18n({
      parser: valueParser,
      log: { level: 'error', logger: { error: () => {}, warn: () => {}, debug: () => {} } },
      loaders: loaders({}, true),
    });

    await server.loadTranslations('en', '/').catch(() => {});

    const calls: Calls = {};
    const client = new i18n({ parser: valueParser, log, loaders: loaders(calls, false) });

    client.hydrate(server.snapshot({ records: true }));
    await client.loadTranslations('en', '/');

    expect(calls).toEqual({ home: 1 });
    expect(client.t('home.title')).toBe('Home');
  });

  it('drops a record naming no loader of the client config, which then loads again', async () => {
    // The same loader, its route spelled another way: the ids differ.
    const server = new i18n({ parser: valueParser, log, loaders: [{ namespace: 'nav', locale: 'en', routes: [/^\/$/], loader: async () => ({ home: 'Home' }) }] });

    await server.loadTranslations('en', '/');

    const calls: Calls = {};
    const client = new i18n({ parser: valueParser, log, loaders: sharedLoaders(calls) });

    client.hydrate(server.snapshot({ records: true }));
    await client.loadTranslations('en', '/');
    await client.setRoute('/about');

    expect(calls).toEqual({ common: 1, home: 1, about: 1 });
    expect(client.t('nav.about')).toBe('About');
  });

  it('carries a locale named like an envelope key through the round trip', async () => {
    const loaders = [{ namespace: 'common', locale: 'translations', loader: async () => ({ greeting: 'Hello' }) }];
    const server = new i18n({ parser: valueParser, log, sanitizeLocales: false, loaders });

    await server.loadTranslations('translations', '/');

    let calls = 0;
    const client = new i18n({
      parser: valueParser,
      log,
      sanitizeLocales: false,
      loaders: [{ ...loaders[0], loader: async () => { calls += 1; return {}; } }],
    });

    client.hydrate(server.snapshot({ records: true }));
    await client.loadTranslations('translations', '/');

    expect(calls).toBe(0);
    expect(client.locale).toBe('translations');
    expect(client.t('common.greeting')).toBe('Hello');
  });

  it('applies an envelope without records as plain data, suppressing every loader of its namespaces', async () => {
    const server = new i18n({ parser: valueParser, log, loaders: sharedLoaders({}) });

    await server.loadTranslations('en', '/');

    const { records, ...plain } = server.snapshot({ records: true });

    expect(records).toHaveLength(2);

    const calls: Calls = {};
    const client = new i18n({ parser: valueParser, log, loaders: sharedLoaders(calls) });

    client.hydrate(plain);
    await client.loadTranslations('en', '/');
    await client.setRoute('/about');

    expect(calls).toEqual({});
    expect(client.t('nav.about')).toBe('nav.about');
  });

  it('restores the locale and the route without any load running', async () => {
    const server = new i18n({ parser: valueParser, log, loaders: sharedLoaders({}) });

    await server.loadTranslations('en', '/about');

    const calls: Calls = {};
    const client = new i18n({ parser: valueParser, log, loaders: sharedLoaders(calls) });

    client.hydrate(server.snapshot({ records: true }));

    expect(client.initialized).toBe(true);
    expect(client.locale).toBe('en');
    expect(client.t('nav.about')).toBe('About');

    // The route is restored too: a locale change loads for it.
    await client.setLocale('cs');

    expect(calls).toEqual({ cs: 1 });
    expect(client.locale).toBe('cs');
  });

  it('restores the locale and the route from an envelope without data, staying uninitialized', async () => {
    const envelope: Snapshot.Envelope = { translations: {}, records: [], locale: 'en', route: '/about' };

    const calls: Calls = {};
    const client = new i18n({ parser: valueParser, log, loaders: sharedLoaders(calls) });

    client.hydrate(envelope);

    expect(client.initialized).toBe(false);
    expect(client.locale).toBe('en');

    await client.setLocale('cs');

    expect(calls).toEqual({ cs: 1 });
  });

  it('leaves a warm load after it with nothing to fetch and nothing to activate', async () => {
    const server = new i18n({ parser: valueParser, log, loaders: sharedLoaders({}) });

    await server.loadTranslations('en', '/');

    const calls: Calls = {};
    const client = new i18n({ parser: valueParser, log, loaders: sharedLoaders(calls) });

    client.hydrate(server.snapshot({ records: true }));

    const warm = client.loadTranslations('en', '/', { activate: false });

    expect(client.loading).toBe(false);
    await warm;

    expect(calls).toEqual({});
    expect(client.locale).toBe('en');
  });

  it('keeps a warm load for other params from replacing what the restored route shows', async () => {
    const server = new i18n({ parser: valueParser, log, loaders: [article({})] });

    await server.loadTranslations('en', '/article/6');

    const client = new i18n({ parser: valueParser, log, loaders: [article({})] });

    client.hydrate(server.snapshot({ records: true }));
    await client.loadTranslations('en', '/article/7', { activate: false });

    expect(client.t('article.title')).toBe('Article 6');
  });

  it('does nothing after `destroy()`', async () => {
    const server = new i18n({ parser: valueParser, log, loaders: sharedLoaders({}) });

    await server.loadTranslations('en', '/');

    const client = new i18n({ parser: valueParser, log, loaders: sharedLoaders({}) });

    client.destroy();
    client.hydrate(server.snapshot({ records: true }));

    expect(client.locale).toBeUndefined();
    expect(client.rawTranslations).toEqual({});
  });

  it('warns when it arrives after a load started', async () => {
    const server = new i18n({ parser: valueParser, log, loaders: sharedLoaders({}) });

    await server.loadTranslations('en', '/');

    const warnSpy = vi.fn();
    const calls: Calls = {};
    const client = new i18n({
      parser: valueParser,
      log: { level: 'warn', logger: { error: () => {}, warn: warnSpy, debug: () => {} } },
      initLocale: 'en',
      loaders: sharedLoaders(calls),
    });

    client.hydrate(server.snapshot({ records: true }));

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('after a load started'));
    expect(calls).toEqual({ common: 1 });
  });

  it('leaves the instance untouched for `undefined`', async () => {
    const calls: Calls = {};
    const client = new i18n({ parser: valueParser, log, loaders: sharedLoaders(calls) });

    await client.loadTranslations('en', '/');

    const before = client.rawTranslations;

    client.hydrate(undefined);

    expect(client.rawTranslations).toBe(before);
    expect(client.locale).toBe('en');
  });

  it('produces an envelope both devalue encoders accept', async () => {
    const server = new i18n({ parser: valueParser, log, fallbackLocale: 'cs', loaders: [...sharedLoaders({}), article({})] });

    await server.loadTranslations('cs', '/about');
    await server.loadTranslations('en', '/article/6');

    const envelope = server.snapshot({ records: true });

    expect(envelope.records!.length).toBeGreaterThan(0);
    expect(devalue.parse(devalue.stringify(envelope))).toEqual(envelope);
    expect((0, eval)(`(${devalue.uneval(envelope)})`)).toEqual(envelope);
  });
});

describe('i18n destroy', () => {
  const valueParser = { parse: (text: any, _params: any, _locale: any, key: string) => (text === undefined ? key : text) };

  it('discards an in-flight load and clears the loading flag', async () => {
    let calls = 0;
    const resolvers: Array<(value: any) => void> = [];
    const instance = new i18n({
      parser: valueParser,
      log,
      loaders: [
        { namespace: 'common', locale: 'en', loader: () => new Promise<any>((resolve) => { calls += 1; resolvers.push(resolve); }) },
      ],
    });

    const pending = instance.loadTranslations('en', '/');
    expect(instance.loading).toBe(true);

    instance.destroy();
    expect(instance.loading).toBe(false);

    resolvers[0]?.({ greeting: 'late' });
    await pending;

    expect(calls).toBe(1);
    expect(instance.rawTranslations).toEqual({});
    expect(instance.locale).toBeUndefined();
  });

  it('ignores every further load and mutation', async () => {
    let calls = 0;
    const instance = new i18n({
      parser: valueParser,
      log,
      loaders: [{ namespace: 'common', locale: 'en', loader: async () => { calls += 1; return { greeting: 'Hello' }; } }],
    });

    await instance.loadTranslations('en', '/');
    expect(calls).toBe(1);

    instance.destroy();

    await instance.loadTranslations('en', '/about');
    await instance.setLocale('cs');
    await instance.setRoute('/about');
    instance.invalidate();
    instance.addTranslations({ en: { extra: { note: 'ignored' } } });

    expect(calls).toBe(1);
    expect(instance.locale).toBe('en');
    expect(instance.rawTranslations.en).not.toHaveProperty('extra');
  });

  it('keeps reads working, so a tearing-down component still renders', async () => {
    const instance = new i18n({
      parser: valueParser,
      log,
      loaders: [{ namespace: 'common', locale: 'en', loader: async () => ({ greeting: 'Hello' }) }],
    });

    await instance.loadTranslations('en', '/');
    instance.destroy();

    expect(instance.t('common.greeting')).toBe('Hello');
    expect(instance.l('en', 'common.greeting')).toBe('Hello');
    expect(instance.snapshot()).toEqual({ en: { common: { greeting: 'Hello' } } });
  });

  it('is idempotent', async () => {
    const instance = new i18n({
      parser: valueParser,
      log,
      loaders: [{ namespace: 'common', locale: 'en', loader: async () => ({ greeting: 'Hello' }) }],
    });

    await instance.loadTranslations('en', '/');

    instance.destroy();
    instance.destroy();

    expect(instance.t('common.greeting')).toBe('Hello');
  });
});

describe('logger', () => {
  it('skips silently when a custom logger omits a level', () => {
    const logger = { error: vi.fn() } as any;
    const output = loggerFactory({ level: 'debug', logger });

    expect(() => output.warn('missing level')).not.toThrow();
    expect(() => output.debug('missing level')).not.toThrow();

    output.error('present level');
    expect(logger.error).toHaveBeenCalledWith('[i18n]: present level');
  });
  it('survives a logger it cannot even call', () => {
    const output = loggerFactory({ level: 'debug', logger: null as any });

    expect(() => output.error('boom')).not.toThrow();
  });
  it('falls back to `warn` level for an unknown configured level', () => {
    const logger = { error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
    const output = loggerFactory({ level: 'noise' as any, logger });

    output.warn('shown');
    output.debug('hidden');

    expect(logger.warn).toHaveBeenCalledWith('[i18n]: shown');
    expect(logger.debug).not.toHaveBeenCalled();
  });
  it('passes the raw error alongside the prefixed message', () => {
    const logger = { error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
    const output = loggerFactory({ level: 'error', logger });
    const error = new Error('boom');

    output.error('context', error);
    expect(logger.error).toHaveBeenCalledWith('[i18n]: context', error);

    // No error → single-argument call, so `console` does not print `undefined`.
    output.error('no error attached');
    expect(logger.error).toHaveBeenLastCalledWith('[i18n]: no error attached');
  });
});

describe('translate', () => {
  it('returns the key when no parser is configured and the translation is missing', () => {
    const output = translate({
      parser: undefined as any,
      key: 'common.key',
      params: [],
      translations: { en: {} },
      locale: 'en',
    });

    expect(output).toBe('common.key');
  });
});

describe('type inference', () => {
  it('types the snapshot by the form asked for', () => {
    const instance = new i18n({ parser, log });

    expectTypeOf(instance.snapshot()).toEqualTypeOf<Translations.SerializedTranslations>();
    expectTypeOf(instance.snapshot({ records: false })).toEqualTypeOf<Translations.SerializedTranslations>();
    expectTypeOf(instance.snapshot({ records: true })).toEqualTypeOf<Snapshot.Envelope>();
    expectTypeOf(instance.snapshot({ records: Math.random() > 0.5 })).toEqualTypeOf<Translations.SerializedTranslations | Snapshot.Envelope>();
    expectTypeOf(instance.hydrate).parameter(0).toEqualTypeOf<Snapshot.Envelope | undefined>();
  });

  it('infers the `t`/`l` output type from the configured parser', () => {
    const richParser = { parse: (_value: unknown, _params: unknown[], _locale: string, key: string) => ({ html: key }) };
    const rich = new i18n({ parser: richParser, log });
    const plain = new i18n({ parser, log });

    // A parser declaring a rich output surfaces it on `t`/`l`, alongside the
    // string the miss paths yield without ever reaching the parser.
    expectTypeOf(rich.t('key')).toEqualTypeOf<{ html: string } | string>();
    expectTypeOf(rich.l('en', 'key')).toEqualTypeOf<{ html: string } | string>();

    // An undeclared parser output (`any`) still surfaces as `string`.
    expectTypeOf(plain.t('key')).toEqualTypeOf<string>();
    expectTypeOf(plain.l('en', 'key')).toEqualTypeOf<string>();

    // Load methods resolve with no value.
    expectTypeOf(plain.setLocale('en')).toEqualTypeOf<Promise<void>>();

    expect(rich).toBeInstanceOf(i18n);
    expect(plain).toBeInstanceOf(i18n);
  });

  it('yields a string from the paths a rich parser never reaches', () => {
    const richParser = { parse: (_value: unknown, _params: unknown[], _locale: string, key: string) => ({ html: key }) };

    const rich = new i18n({ parser: richParser, log, initLocale: 'en', translations: { en: { key: 'x' } } });

    // Reaches the parser, so the declared output is what comes back.
    expect(rich.t('key')).toEqual({ html: 'key' });

    // No namespace: nothing to parse.
    expect(rich.t('')).toBe('');

    // No locale: nothing to parse either.
    const localeless = new i18n({ parser: richParser, log });

    expect(localeless.t('key')).toBe('');
  });

  it('narrows `t`/`l` keys and params to a supplied key schema', async () => {
    type TestSchema = {
      'common.no_placeholder': never;
      'common.void': undefined;
      'common.placeholder': { value: string };
      'common.optional': { value?: string };
      'common.maybe': { value: string } | undefined;
      'common.plural': { mode: 'few'; count: number } | { mode: 'many'; total: number };
      'common.loose': any;
    };

    // Only the TYPE of the slot is read — the generator emits a bare object.
    const schema = {} as TestSchema;
    const instance = new i18n({ ...CONFIG, schema });

    expectTypeOf(instance.t('common.placeholder', { value: 'a' })).toEqualTypeOf<string>();
    expectTypeOf(instance.l('en', 'common.placeholder', { value: 'a' })).toEqualTypeOf<string>();

    // A message without params takes no payload; an all-optional one may omit it.
    instance.t('common.no_placeholder');
    instance.t('common.void');
    instance.t('common.optional');

    // A payload the schema marks optional is omittable, not forbidden.
    instance.t('common.maybe', { value: 'a' });
    instance.t('common.maybe');

    // A discriminated payload stays a union — every branch is a valid call.
    instance.t('common.plural', { mode: 'few', count: 3 });
    instance.t('common.plural', { mode: 'many', total: 12 });
    instance.l('en', 'common.plural', { mode: 'few', count: 3 });

    // An `any` slot stays unchecked rather than collapsing to "no payload".
    instance.t('common.loose', { anything: true });
    instance.t('common.loose');

    // @ts-expect-error unknown translation key
    instance.t('common.unknown');
    // @ts-expect-error wrong payload shape
    instance.t('common.placeholder', { value: 1 });
    // @ts-expect-error missing payload
    instance.t('common.placeholder');
    // @ts-expect-error arguments past the payload the parser declares
    instance.t('common.placeholder', { value: 'a' }, 'junk');
    // @ts-expect-error wrong payload shape behind an optional union
    instance.t('common.maybe', { value: 1 });
    // @ts-expect-error payload passed to a message that takes none
    instance.t('common.no_placeholder', { value: 'a' });
    // @ts-expect-error payload passed to a message that takes none
    instance.t('common.void', { value: 'a' });
    // @ts-expect-error branches of a discriminated payload cannot be mixed
    instance.t('common.plural', { mode: 'few', total: 12 });
    // @ts-expect-error missing payload behind a discriminated union
    instance.t('common.plural');

    // A key that is a union has to satisfy every key it might be.
    const eitherKey: 'common.no_placeholder' | 'common.placeholder' = 'common.placeholder';

    instance.t(eitherKey, { value: 'a' });
    // @ts-expect-error missing payload behind a union of keys
    instance.t(eitherKey);

    // The slot is inert at runtime — the instance loads and translates as usual.
    await instance.loadTranslations('EN', '/');
    expect(instance.t('common.no_placeholder')).toBe('common.no_placeholder');
  });

  it('reads the key schema off an annotated config, and ignores an open one', () => {
    type TestSchema = { 'common.placeholder': { value: string } };

    // `Config.T` declares `schema` optional, so the annotated form has to match
    // just as the inferred one does.
    const config: Config.T<Parser.Params, string, TestSchema> = { ...CONFIG, schema: {} as TestSchema };
    const annotated = new i18n(config);

    annotated.t('common.placeholder', { value: 'a' });
    // @ts-expect-error unknown translation key
    annotated.t('common.unknown');

    // A schema without a closed key set types nothing — keys stay plain strings
    // rather than every call failing. The shape comes from an annotation, not
    // an `as`: the slot accepts a bare object, so lint strips the assertion.
    const openKeys: Record<string, { value: string }> = {};
    const open = new i18n({ ...CONFIG, schema: openKeys });
    const noKeys = new i18n({ ...CONFIG, schema: {} });

    open.t('any.key', 'anything', 1);
    noKeys.t('any.key', 'anything', 1);

    expect(annotated).toBeInstanceOf(i18n);
  });

  it('reads the key schema back off a constructed instance', () => {
    type TestSchema = { 'common.placeholder': { value: string } };

    const typed = new i18n({ ...CONFIG, schema: {} as TestSchema });
    const untyped = new i18n({ ...CONFIG });

    expectTypeOf<Schema.FromInstance<typeof typed>>().toEqualTypeOf<TestSchema>();
    expectTypeOf<Schema.FromInstance<typeof untyped>>().toEqualTypeOf<never>();

    expect([typed, untyped]).toHaveLength(2);
  });

  it('reads the key schema off a surface whose `t` an extension retyped', () => {
    type TestSchema = { 'common.placeholder': { value: string } };

    // A structural read of `t` cannot pick the schema out of an intersected
    // signature; the instance stays a member of the intersection, so reading
    // the class type parameter survives what a `t`-enriching extension returns.
    interface WithTree extends Extension.Operator {
      readonly output: this['input'] extends infer I
        ? I & { t: { tree: true } }
        : never;
    }

    const withTree: Extension.Generic<WithTree> = (input: I18n) => Object.assign(input, { t: { tree: true as const } });

    const piped = new i18n({ ...CONFIG, schema: {} as TestSchema, extensions: [withTree] });

    expectTypeOf<Schema.FromInstance<typeof piped>>().toEqualTypeOf<TestSchema>();
    expectTypeOf(piped.t.tree).toEqualTypeOf<true>();

    expect(piped.t.tree).toBe(true);
  });

  it('leaves `t`/`l` untyped when no key schema is supplied', () => {
    const instance = new i18n({ parser, log });

    expectTypeOf(instance.t('any.key')).toEqualTypeOf<string>();
    instance.t('any.key', 'anything', 1);
    instance.l('en', 'any.key', 'anything', 1);

    expect(instance).toBeInstanceOf(i18n);
  });

  it('falls back to a `string` output for an untyped parser', () => {
    // A parser the consumer has no types for: inference has no return type to
    // read, so the output has to degrade to `string` like an undeclared one.
    const untypedParser: any = parser;
    const instance = new i18n({ parser: untypedParser, log });

    expectTypeOf(instance.t('key')).toEqualTypeOf<string>();
    expectTypeOf(instance.l('en', 'key')).toEqualTypeOf<string>();

    expect(instance).toBeInstanceOf(i18n);
  });

  it('describes extracted params without pulling an extractor into the core', () => {
    // `name` is the only thing a message always yields; everything else is a
    // refinement a parser may or may not be able to prove.
    const minimal: Parser.ParamSpec = { name: 'value' };
    const detailed: Parser.ParamSpec = {
      name: 'count',
      kind: ['number', 'string'],
      values: ['one', 'other'],
      optional: true,
      when: [{ param: 'gender', branch: 'female' }],
    };

    // An extractor is built from the same options the runtime parser takes, and
    // reads a translation value – not a parser instance.
    const factory: Parser.ExtractParamsFactory<{ modifiers?: string[] }> = () =>
      (message, context) => (typeof message === 'string' && context?.key ? [minimal] : []);
    const extract: Parser.ExtractParams = factory({ modifiers: [] });

    // @ts-expect-error a spec without a name says nothing a generator can use
    const nameless: Parser.ParamSpec = { kind: 'string' };

    expectTypeOf(extract).parameters.toEqualTypeOf<[Parser.Value, (Parser.ExtractContext | undefined)?]>();
    expectTypeOf(extract).returns.toEqualTypeOf<readonly Parser.ParamSpec[]>();

    expect(extract('a message', { key: 'a.key', locale: 'en' })).toEqual([minimal]);
    expect(extract(42)).toEqual([]);
    expect([detailed, nameless]).toHaveLength(2);
  });

  it('reads the locales a config names off every slot that carries one', () => {
    const config = {
      parser,
      log,
      initLocale: 'en',
      fallbackLocale: 'de',
      translations: { cs: { greeting: 'Ahoj' } },
      loaders: [{ locale: 'sk', namespace: 'common', routes: ['/about'], loader: async () => ({}) }],
    } as const;

    // Every config slot that names a locale feeds the same union — the one the
    // instance takes and reports. A loader's `routes` is frozen by the same
    // `as const` and must not reject the literal config.
    expectTypeOf<Config.LocalesFromConfig<typeof config>>().toEqualTypeOf<'en' | 'de' | 'cs' | 'sk'>();

    // The union stays open: a custom `sanitizeLocales` may map an arbitrary
    // input onto a known locale, so an unlisted one is still accepted.
    expectTypeOf<Config.LocaleInput<'en' | 'de'>>().toEqualTypeOf<'en' | 'de' | (string & {})>();
    expectTypeOf<Config.LocaleInput>().toEqualTypeOf<string>();

    expect(new i18n(config)).toBeInstanceOf(i18n);
  });

  it('leaves locale inputs open when the config names no literal locale', () => {
    // An annotated config erases the literals, and so does a widened one.
    const annotated: Config.T = { parser, log, initLocale: 'en' };
    const widened = { parser, log, initLocale: 'en' };

    expectTypeOf<Config.LocalesFromConfig<typeof annotated>>().toEqualTypeOf<string>();
    expectTypeOf<Config.LocalesFromConfig<typeof widened>>().toEqualTypeOf<string>();

    const instance = new i18n(annotated);

    void instance.setLocale('anything');
    void instance.l('anything', 'key');

    expect(instance).toBeInstanceOf(i18n);
    expect(new i18n(widened)).toBeInstanceOf(i18n);
  });

  it('degrades the locale union to plain strings when one source is dynamic', () => {
    const dynamicLocales: string[] = ['cs', 'sk'];

    const config = {
      parser,
      log,
      initLocale: 'en',
      loaders: dynamicLocales.map((locale) => ({ locale, namespace: 'common', loader: async () => ({}) })),
    } as const;

    // A half-known union would complete `'en'` while silently hiding every
    // locale the dynamic source names.
    expectTypeOf<Config.LocalesFromConfig<typeof config>>().toEqualTypeOf<string>();

    expect(new i18n(config)).toBeInstanceOf(i18n);
  });

  it('narrows locale inputs and reads while keeping the instance assignable', () => {
    const instance = new i18n({ parser, log, initLocale: 'en', fallbackLocale: 'de' });

    type Narrowed = 'en' | 'de' | (string & {});

    expectTypeOf<Parameters<typeof instance.setLocale>[0]>().toEqualTypeOf<Narrowed | undefined>();
    expectTypeOf<Parameters<typeof instance.loadTranslations>[0]>().toEqualTypeOf<Narrowed>();
    expectTypeOf<Parameters<typeof instance.invalidate>[0]>().toEqualTypeOf<Narrowed | undefined>();
    expectTypeOf<Parameters<typeof instance.l>[0]>().toEqualTypeOf<Narrowed>();

    // Reads carry the same union: the locale the instance reports is the one
    // it was asked for, sanitized.
    expectTypeOf(instance.locale).toEqualTypeOf<Narrowed | undefined>();
    expectTypeOf(instance.locales).toEqualTypeOf<Narrowed[]>();

    // A locale outside the union still passes — narrowing drives completion,
    // it does not close the input.
    void instance.setLocale('sv');
    void instance.loadTranslations('sv');
    instance.invalidate('sv');
    void instance.l('sv', 'key');
    instance.locale = 'sv';

    // The union stays open in both directions, so narrowing never makes the
    // instance type invariant.
    const untyped: I18n = instance;
    const renarrowed: I18n<any, string, never, 'en' | 'de'> = untyped;

    expect(renarrowed).toBeInstanceOf(i18n);
  });

  it('accepts either namespace spelling, but never both and never neither', () => {
    const loader = async () => ({});

    const current: Loader.LoaderModule = { namespace: 'common', locale: 'en', loader };
    const legacy: Loader.LoaderModule = { key: 'common', locale: 'en', loader };

    // @ts-expect-error a loader names its namespace under one spelling, not both
    const both: Loader.LoaderModule = { namespace: 'common', key: 'common', locale: 'en', loader };

    // @ts-expect-error a loader has to name its namespace
    const neither: Loader.LoaderModule = { locale: 'en', loader };

    expect([current, legacy, both, neither]).toHaveLength(4);
  });

  it('narrows the locale union across a config mixing both namespace spellings', () => {
    const loader = async () => ({});

    const config = {
      parser,
      log,
      initLocale: 'en',
      loaders: [
        { namespace: 'common', locale: 'en', loader },
        { key: 'home', locale: 'cs', loader },
      ],
    } as const satisfies Config.T;

    expectTypeOf<Config.LocalesFromConfig<typeof config>>().toEqualTypeOf<'en' | 'cs'>();

    const instance = new i18n(config);

    expectTypeOf<Parameters<typeof instance.loadTranslations>[0]>().toEqualTypeOf<'en' | 'cs' | (string & {})>();

    expect(instance).toBeInstanceOf(i18n);
  });

  it('narrows the locale union across loaders naming several locales', () => {
    const loader = async () => ({});

    const config = {
      parser,
      log,
      loaders: [
        { namespace: ['common', 'nav'], locale: ['en', 'de'], loader },
        { namespace: 'home', locale: 'cs', loader },
      ],
    } as const satisfies Config.T;

    expectTypeOf<Config.LocalesFromConfig<typeof config>>().toEqualTypeOf<'en' | 'de' | 'cs'>();

    expectTypeOf<Config.LocalesFromConfig<{ loaders: [{ namespace: 'common'; locale: string[]; loader: typeof loader }] }>>().toEqualTypeOf<string>();

    // @ts-expect-error the deprecated `key` names one namespace only
    const legacyList: Loader.LoaderModule = { key: ['common', 'nav'], locale: 'en', loader };

    expect([config, legacyList]).toHaveLength(2);
  });
});

describe('utils', () => {
  it('publishes the reusable helpers, and only those', () => {
    expect(publicUtils.toDotNotation).toBe(toDotNotation);
    expect(publicUtils.sanitizeLocales).toBe(sanitizeLocales);
    expect(publicUtils.matchLocale).toBe(matchLocale);
    expect(publicUtils.resolveLoaders).toBe(resolveLoaders);
    expect(Object.keys(publicUtils).sort()).toEqual(['matchLocale', 'resolveLoaders', 'sanitizeLocales', 'toDotNotation']);
    expectTypeOf(publicUtils.toDotNotation).toEqualTypeOf<DotNotation.T>();
  });
  // The library logs through one module-level singleton, so a test that
  // asserts on its output installs a capturing logger and restores the
  // previous one afterwards — restoring anything else would silently change
  // the level for every later test.
  const captureLogs = () => {
    const previous = logger;
    type Entry = { message: string; error?: unknown };
    const captured = { error: [] as Entry[], warn: [] as Entry[] };

    setLogger(loggerFactory({
      level: 'warn',
      logger: {
        error: (message: any, error?: unknown) => { captured.error.push({ message: `${message}`, error }); },
        warn: (message: any, error?: unknown) => { captured.warn.push({ message: `${message}`, error }); },
      } as any,
    }));

    return { captured, restore: () => { setLogger(previous); } };
  };

  it('`sanitizeLocales` caches successes but keeps warning for unknown locales', () => {
    const { captured, restore } = captureLogs();

    try {
      // A standard locale resolves identically whether or not it is cached.
      expect(sanitizeLocales('zh-Hans')).toEqual(sanitizeLocales('zh-Hans'));

      // Failures are never cached, so the warning is not deduplicated away —
      // deduplicating it would tie the diagnostic to whichever logger and
      // level happened to be installed on the first occurrence.
      sanitizeLocales('qqq-alpha');
      sanitizeLocales('qqq-alpha');
    } finally {
      restore();
    }

    expect(captured.warn.filter(({ message }) => message.includes('qqq-alpha'))).toHaveLength(2);
  });
  it('`sanitizeLocales` does not let a non-string input poison a string key', () => {
    const { restore } = captureLogs();

    try {
      // The array stringifies to 'de,fr'; caching it under that key would make
      // a later lookup of the literal string 'de,fr' return the array's result.
      const fromArray = sanitizeLocales(['de', 'fr'] as any);
      const fromString = sanitizeLocales('de,fr');

      expect(fromArray).toEqual(['de']);
      expect(fromString).toEqual(['de,fr']); // non-standard, lowercased as-is
    } finally {
      restore();
    }
  });
  it('`toDotNotation` keeps a literal `__proto__` key an own property', () => {
    // JSON.parse creates real own '__proto__' keys (object literals would not).
    const output: any = toDotNotation(JSON.parse('{"__proto__": {"polluted": "yes"}, "plain": "ok"}'));

    expect(({} as any).polluted).toBe(undefined); // Object.prototype untouched
    expect(output['__proto__.polluted']).toBe('yes');
    expect(output.plain).toBe('ok');
  });
  it('matches a `g`-flagged route pattern on every navigation', () => {
    // `test` advances `lastIndex` on a global/sticky pattern, so a route object
    // shared across navigations would match only every other time.
    const pattern = /\/shop/g;

    expect(testRoute('/shop')(pattern)).toBe(true);
    expect(testRoute('/shop/cart')(pattern)).toBe(true);
    expect(testRoute('/shop')(pattern)).toBe(true);
  });
  it('leaves a route pattern unmutated', () => {
    // The pattern belongs to the consumer's config; matching a route must not
    // write state into an object they may also use themselves.
    const pattern = /shop/g;

    testRoute('/shop/cart')(pattern);

    expect(pattern.lastIndex).toBe(0);
  });
  it('matches a frozen route pattern, including a stateful one', () => {
    // A deep-frozen config is legitimate: `lastIndex` is then read-only, so any
    // implementation that writes it throws, and the surrounding catch turns
    // that into a silent permanent non-match.
    expect(testRoute('/shop')(Object.freeze(/^\/shop/))).toBe(true);
    expect(testRoute('/other')(Object.freeze(/^\/shop/))).toBe(false);
    expect(testRoute('/shop/cart')(Object.freeze(/\/shop/g))).toBe(true);

    // Sticky still anchors at the start rather than degrading to a free match.
    expect(testRoute('/shop/cart')(Object.freeze(/\/shop/y))).toBe(true);
    expect(testRoute('/shop/cart')(Object.freeze(/cart/y))).toBe(false);
  });
  it('keeps matching a duck-typed route matcher', () => {
    // `Loader.Route` officially admits any object with a `test` method — the
    // matcher decides for itself.
    const matcher = { test: (route: string) => route.startsWith('/shop') };

    expect(testRoute('/shop/cart')(matcher)).toBe(true);
    expect(testRoute('/about')(matcher)).toBe(false);

    // Its own `test` decides even when it carries pattern-shaped properties:
    // copying it would produce `new RegExp(undefined)`, i.e. match everything.
    const flagged = { global: true, test: (route: string) => route.startsWith('/shop') };

    expect(testRoute('/about')(flagged)).toBe(false);
    expect(testRoute('/shop')({ sticky: true, source: 'nope', test: () => false })).toBe(false);

    // The route reaches a custom matcher unchanged, so it can tell an unset
    // route from the string 'undefined'.
    expect(testRoute(undefined as any)({ test: (route: any) => route === undefined })).toBe(true);
  });
  it('asks a callable route matcher for its `test` method', () => {
    // `Loader.Route` admits anything carrying `test`, and a function carries
    // properties like any other object — typing one as a matcher must not turn
    // it into a silent non-match.
    const matcher = Object.assign(() => true, { test: (route: string) => route.startsWith('/shop') });

    expect(testRoute('/shop/cart')(matcher)).toBe(true);
    expect(testRoute('/about')(matcher)).toBe(false);
  });
  it('reports a route that carries no `test` method', () => {
    const { captured, restore } = captureLogs();

    try {
      // A bare predicate is not a `Loader.Route` — it has to be reported, not
      // dropped without a trace.
      expect(testRoute('/contact')(((route: string) => route === '/contact') as any)).toBe(false);
    } finally {
      restore();
    }

    expect(captured.error.some(({ message }) => message.includes('Invalid route config!'))).toBe(true);
  });
  it('rejects a route that is not a pattern instead of coercing it', () => {
    const { captured, restore } = captureLogs();

    let matched: boolean | undefined;
    try {
      // Coercing this to a regex would yield /[object Object]/, which matches
      // any route containing one of those characters.
      matched = testRoute('/contact')({} as any);
    } finally {
      restore();
    }

    expect(matched).toBe(false);
    expect(captured.error.some(({ message }) => message.includes('Invalid route config!'))).toBe(true);
  });
  it('forwards the error a throwing route matcher raised', () => {
    const { captured, restore } = captureLogs();
    const boom = new Error('matcher boom');

    try {
      expect(testRoute('/contact')({ test: () => { throw boom; } })).toBe(false);
    } finally {
      restore();
    }

    // The context message alone cannot say WHICH matcher blew up or how — the
    // thrown value has to reach the consumer's logger unwrapped.
    const reported = captured.error.find(({ message }) => message.includes('Invalid route config!'));

    expect(reported?.error).toBe(boom);
  });
  it('`resolveLoaders` settles both namespace spellings into one', () => {
    const loader = async () => ({});

    const [current, legacy] = resolveLoaders([
      { namespace: 'common', locale: 'en', loader },
      { key: 'nav', locale: 'en', loader },
    ]);

    expect(current?.namespace).toBe('common');
    expect(legacy?.namespace).toBe('nav');
    // Nothing downstream should be able to tell which name was used.
    expect(Object.hasOwn(legacy, 'key')).toBe(false);
  });
  it('`resolveLoaders` warns for the deprecated name and stays quiet for the current one', () => {
    const { captured, restore } = captureLogs();
    const loader = async () => ({});

    try {
      resolveLoaders([
        { namespace: 'common', locale: 'en', loader },
        { key: 'nav', locale: 'en', loader },
      ]);
    } finally {
      restore();
    }

    const deprecations = captured.warn.filter(({ message }) => message.includes("uses 'key'"));

    expect(deprecations).toHaveLength(1);
    expect(deprecations[0]?.message).toContain('nav');
  });
  it('`resolveLoaders` keeps `cache: false`, and reports and drops any other `cache`', () => {
    const { captured, restore } = captureLogs();
    const loader = async () => ({});

    try {
      const [live, timed] = resolveLoaders([
        { namespace: 'live', locale: 'en', loader, cache: false },
        { namespace: 'timed', locale: 'en', loader, cache: 60_000 as any },
      ]);

      expect(live?.cache).toBe(false);
      expect(Object.hasOwn(timed ?? {}, 'cache')).toBe(false);
    } finally {
      restore();
    }

    expect(captured.error.map(({ message }) => message)).toEqual([expect.stringContaining("'timed'")]);
  });
  it('`resolveLoaders` expands a descriptor into one loader per locale and namespace pair', () => {
    const loader = async () => ({});
    const routes = ['/'];

    const expanded = resolveLoaders([{ locale: ['en', 'de'], namespace: ['common', 'nav'], loader, routes }]);
    const written = resolveLoaders([
      { locale: 'en', namespace: 'common', loader, routes },
      { locale: 'en', namespace: 'nav', loader, routes },
      { locale: 'de', namespace: 'common', loader, routes },
      { locale: 'de', namespace: 'nav', loader, routes },
    ]);

    expect(expanded).toEqual(written);
  });
  it('`resolveLoaders` names each loader by its content, equally across runs', () => {
    const loader = async () => ({});
    const config = () => [
      { locale: ['en', 'cs'], namespace: 'common', loader },
      { locale: 'en', namespace: 'home', routes: ['/', /^\/home/i], loader },
    ];

    const first = resolveLoaders(config()).map(({ id }) => id);

    expect(first).toEqual(resolveLoaders(config()).map(({ id }) => id));
    expect(first).toEqual(['["en","common"]', '["cs","common"]', JSON.stringify(['en', 'home', ['s:/', 'r:/^\\/home/i']])]);
  });
  it('`resolveLoaders` tells a string route from a pattern with the same text', () => {
    const loader = async () => ({});

    const [text, pattern] = resolveLoaders([
      { locale: 'en', namespace: 'home', routes: ['/home'], loader },
      { locale: 'en', namespace: 'home', routes: [/\/home/], loader },
    ]);

    expect(text?.id).not.toBeNull();
    expect(pattern?.id).not.toBeNull();
    expect(text?.id).not.toBe(pattern?.id);
  });
  it('`resolveLoaders` leaves loaders it cannot tell apart without an id', () => {
    const loader = async () => ({});

    const [first, second, other] = resolveLoaders([
      { locale: 'en', namespace: 'home', routes: [{ test: (route: string) => route === '/' }], loader },
      { locale: 'en', namespace: 'home', routes: [{ test: (route: string) => route === '/about' }], loader },
      { locale: 'en', namespace: 'nav', routes: [{ test: () => true }], loader },
    ]);

    expect(first?.id).toBeNull();
    expect(second?.id).toBeNull();
    expect(other?.id).toBe('["en","nav",["m"]]');
  });
  it('`resolveLoaders` sanitizes each locale, as `sanitizeLocales` asks', () => {
    const loader = async () => ({});
    const descriptor = { locale: ['en-us', 'CS'], namespace: 'common', loader };

    expect(resolveLoaders([descriptor]).map(({ locale }) => locale)).toEqual(['en-US', 'cs']);
    expect(resolveLoaders([descriptor], false).map(({ locale }) => locale)).toEqual(['en-us', 'CS']);
    expect(resolveLoaders([descriptor], (locale) => `x-${locale}`).map(({ locale }) => locale)).toEqual(['x-en-us', 'x-CS']);
  });
  it('`resolveLoaders` collapses a pair named twice and skips a descriptor naming none', () => {
    const { captured, restore } = captureLogs();
    const loader = async () => ({});

    let resolvedLoaders: Loader.Resolved[];

    try {
      resolvedLoaders = resolveLoaders([
        { locale: ['en', 'en'], namespace: ['common', 'common'], loader },
        { locale: [], namespace: 'nav', loader },
        { locale: 'en', namespace: [], loader },
        { locale: 'en', loader } as unknown as Loader.LoaderModule,
      ]);
    } finally {
      restore();
    }

    expect(resolvedLoaders.map(({ locale, namespace }) => `${locale}:${namespace}`)).toEqual(['en:common']);
    expect(captured.warn.filter(({ message }) => message.includes('names no locale or no namespace'))).toHaveLength(3);
  });
});

describe('matchLocale', () => {
  it('falls back from a subtag to its base', () => {
    expect(matchLocale('en-GB', ['en', 'cs'])).toBe('en');
    expect(matchLocale('cs-CZ', ['en', 'cs'])).toBe('cs');
    expect(matchLocale('zh-Hant-TW', ['zh', 'en'])).toBe('zh');
    expect(matchLocale('de-AT', ['en', 'cs'])).toBe(undefined);
  });
  it('compares case-insensitively and answers with the configured spelling', () => {
    expect(matchLocale('EN-gb', ['en', 'cs'])).toBe('en');
    expect(matchLocale('en-gb', ['en-GB'])).toBe('en-GB');
    expect(matchLocale('EN', ['En'])).toBe('En');
  });
  it('reads the range as written as a prefix when the configured set is finer', () => {
    expect(matchLocale('en', ['en-GB', 'en-US'])).toBe('en-GB');
    expect(matchLocale('en-GB', ['en-GB-oed'])).toBe('en-GB-oed');

    // An exact hit always wins the level it is on, whatever the config order.
    expect(matchLocale('en', ['en-GB', 'en'])).toBe('en');
  });
  it('never substitutes a sibling for a locale it was not asked for', () => {
    // Widening runs on the range AS WRITTEN and never on a truncated one, so
    // no region or script is ever inferred from another.
    expect(matchLocale('en-AU', ['en-US'])).toBe(undefined);
    expect(matchLocale('pt-BR', ['pt-PT'])).toBe(undefined);
    expect(matchLocale('zh-Hant', ['zh-Hans'])).toBe(undefined);
  });
  it('exhausts the truncation chain before widening', () => {
    // RFC 4647 §3.4 names this case: the range `de-ch` may produce `de`, never
    // `de-CH-1996`. Widening can only turn a miss into a hit, never change
    // what plain lookup already answered.
    expect(matchLocale('de-CH', ['de', 'de-CH-1996'])).toBe('de');
    expect(matchLocale('zh-Hant', ['zh', 'zh-Hant-TW'])).toBe('zh');
  });
  it('never truncates to a bare singleton subtag', () => {
    // RFC 5646 §4.4.2: a one-character subtag introduces an extension or a
    // private-use sequence and never outlives it.
    expect(matchLocale('x-pig-latin', ['x-pig'])).toBe('x-pig');
    expect(matchLocale('x-pig-latin', ['x'])).toBe(undefined);
    expect(matchLocale('en-u-co-phonebk', ['en'])).toBe('en');
  });
  it('takes a preference list in its own order', () => {
    expect(matchLocale(['de', 'cs', 'en'], ['en', 'cs'])).toBe('cs');
    expect(matchLocale(['de-AT', 'en-GB'], ['cs', 'en'])).toBe('en');

    // Range-major: a base hit on the first preference beats an exact hit on a
    // later one, because the visitor asked for English first.
    expect(matchLocale('en, cs', ['cs', 'en-GB'])).toBe('en-GB');
  });
  it('honours q weights, including the spellings a header really carries', () => {
    expect(matchLocale('en;q=0.8, cs;q=0.9', ['en', 'cs'])).toBe('cs');
    expect(matchLocale('en;Q=0.8, cs;q=0.9', ['en', 'cs'])).toBe('cs');
    expect(matchLocale('en ; q=0.8, cs;q=0.9', ['en', 'cs'])).toBe('cs');
    expect(matchLocale('cs;q=0.9;foo=bar, en', ['en', 'cs'])).toBe('en');

    // A weight out of range is clamped, not dropped, so both stay preferences
    // and the field's own order decides.
    expect(matchLocale('en;q=5, cs;q=1', ['en', 'cs'])).toBe('en');
  });
  it('reads `q=0` as a refusal, beaten only by a more specific range', () => {
    expect(matchLocale('en;q=0, *', ['en', 'cs'])).toBe('cs');
    expect(matchLocale('*;q=0, en', ['en', 'cs'])).toBe('en');
    expect(matchLocale('*;q=0.1, en;q=0', ['en', 'cs'])).toBe('cs');
    expect(matchLocale('en;q=0, en-GB;q=0.9', ['en-GB'])).toBe('en-GB');
    expect(matchLocale('en;q=0, en-GB;q=0.9', ['en'])).toBe(undefined);
    expect(matchLocale('en;q=0', ['en', 'cs'])).toBe(undefined);
  });
  it('reads the wildcard as a preference of its own', () => {
    expect(matchLocale('*', ['cs', 'en'])).toBe('cs');

    // At equal weight a concrete range is consulted first; a stronger wildcard
    // is still the stronger preference.
    expect(matchLocale('en, *', ['cs', 'en'])).toBe('en');
    expect(matchLocale('*, en', ['cs', 'en'])).toBe('en');
    expect(matchLocale('cs;q=0.1, *', ['en', 'cs'])).toBe('en');
  });
  it('answers a miss rather than throwing on whatever arrives', () => {
    expect(matchLocale('', ['en'])).toBe(undefined);
    expect(matchLocale(null, ['en'])).toBe(undefined);
    expect(matchLocale(undefined, ['en'])).toBe(undefined);
    expect(matchLocale(42 as any, ['en'])).toBe(undefined);
    expect(matchLocale({} as any, ['en'])).toBe(undefined);

    // Read as a field value, never coerced into one: whatever arrives may
    // carry a `toString` of its own, and a render must not die on it.
    expect(matchLocale({ toString: () => { throw new Error('boom'); } } as any, ['en'])).toBe(undefined);
    expect(matchLocale([{ toString: () => { throw new Error('boom'); } }] as any, ['en'])).toBe(undefined);
    expect(matchLocale('en', [])).toBe(undefined);
    expect(matchLocale('en', null as any)).toBe(undefined);
    expect(matchLocale('en', [null, undefined, ''] as any)).toBe(undefined);
    expect(matchLocale('en', 'en' as any)).toBe(undefined);

    // A list is read member by member, so one unusable entry costs only itself.
    expect(matchLocale([null, 42, 'cs'] as any, ['en', 'cs'])).toBe('cs');
  });
  it('ignores what is not a language range and keeps the rest of the field', () => {
    expect(matchLocale(',,en,,', ['en'])).toBe('en');
    expect(matchLocale('en-, cs', ['en', 'cs'])).toBe('cs');
    expect(matchLocale('-en, cs', ['en', 'cs'])).toBe('cs');
    expect(matchLocale('en--US, cs', ['en', 'cs'])).toBe('cs');
    expect(matchLocale('en_US, cs', ['en', 'cs'])).toBe('cs');

    // An unreadable weight drops its own range: reading it as 1 would promote
    // junk to the strongest preference, and 0 would make it a refusal.
    expect(matchLocale('en;q=abc, cs', ['en', 'cs'])).toBe('cs');
    expect(matchLocale('en;q=0x10, cs', ['en', 'cs'])).toBe('cs');
    expect(matchLocale('en;q=, *', ['en', 'cs'])).toBe('en');
  });
  it('treats a prototype member name as an ordinary range', () => {
    // Neither side is ever used as an object key, so `toString` matches only a
    // locale that is actually configured.
    expect(matchLocale('toString', ['toString'])).toBe('toString');

    // Over the eight characters RFC 4647 §2.1 allows a subtag, so it is not a
    // range at all rather than a range that happens to miss.
    expect(matchLocale('constructor', ['constructor'])).toBe(undefined);
    expect(matchLocale('toString', ['en'])).toBe(undefined);
    expect(matchLocale('__proto__', ['en'])).toBe(undefined);
    expect(({} as any).polluted).toBe(undefined);
  });
  it('costs a bounded amount on a hostile field', () => {
    // Over the range cap, over the length cap, and a range that is all
    // separators — none of which may reach the matcher as work.
    expect(matchLocale(`${'x,'.repeat(5000)}cs`, ['cs'])).toBe(undefined);
    expect(matchLocale(`${'a'.repeat(100000)}, cs`, ['en', 'cs'])).toBe('cs');
    expect(matchLocale(`${'-'.repeat(100000)}, cs`, ['en', 'cs'])).toBe('cs');

    // Every subtag of this one is well formed, so only the length cap stands
    // between the truncation chain and a stack the size of the field.
    expect(matchLocale(`en-${'ab-'.repeat(30000)}gb, cs`, ['en', 'cs'])).toBe('cs');
  });
  it('narrows its result to the locales it was given', () => {
    expectTypeOf(matchLocale('en-GB', ['en', 'cs'])).toEqualTypeOf<'en' | 'cs' | undefined>();
    expectTypeOf(matchLocale('en-GB', ['en', 'cs'] as const)).toEqualTypeOf<'en' | 'cs' | undefined>();

    // A list whose type has already widened cannot narrow back.
    const locales: string[] = ['en', 'cs'];

    expectTypeOf(matchLocale('en-GB', locales)).toEqualTypeOf<string | undefined>();
  });
});
